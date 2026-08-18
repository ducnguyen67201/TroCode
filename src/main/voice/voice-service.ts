import { z } from 'zod';

import {
  ConfigureVoiceRequestSchema,
  TranscribeVoiceSegmentRequestSchema,
  VoiceSegmentTranscriptionSchema,
  VoiceStatusSchema,
  type PrimaryLanguage,
  type VoiceSegmentTranscription,
  type VoiceStatus,
} from '../../shared/contracts';
import type { AppPreferencesService } from '../preferences/app-preferences-service';

const OPENAI_MODEL_URL = 'https://api.openai.com/v1/models/gpt-transcribe';
const OPENAI_TRANSCRIPTIONS_URL =
  'https://api.openai.com/v1/audio/transcriptions';
const VOICE_MODEL = 'gpt-transcribe' as const;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1_000_000;

const OpenAIErrorResponseSchema = z.object({
  error: z
    .union([
      z.string().min(1).max(2_000),
      z.object({ message: z.string().min(1).max(2_000) }),
    ])
    .optional(),
});

const OpenAIModelResponseSchema = z.object({ id: z.literal(VOICE_MODEL) });

const OpenAITranscriptionResponseSchema = z.object({
  languages: z
    .array(z.object({ code: z.string().trim().min(1).max(32) }))
    .optional(),
  text: z.string().trim().max(8_000),
});

const HostedTranscriptionResponseSchema = VoiceSegmentTranscriptionSchema.omit({
  sequence: true,
  utteranceId: true,
}).extend({
  usageSource: z.enum(['actual', 'missing']).optional(),
});

function apiErrorMessage(responseBody: unknown): string | undefined {
  const apiError = OpenAIErrorResponseSchema.safeParse(responseBody);
  if (!apiError.success) return undefined;
  if (typeof apiError.data.error === 'string') return apiError.data.error;
  return apiError.data.error?.message;
}

export interface VoiceCredentialStore {
  read(): Promise<string | null>;
  write(apiKey: string): Promise<void>;
}

type VoiceDiagnosticProperties = Record<string, string | number | boolean>;
type VoiceDiagnosticLogger = (
  event: string,
  properties?: VoiceDiagnosticProperties,
) => void;

interface VoiceServiceOptions {
  accessTokenProvider?: () => Promise<string | null>;
  apiBaseUrl?: string;
  credentialStore: VoiceCredentialStore;
  diagnosticLogger?: VoiceDiagnosticLogger;
  environmentApiKey?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, 'error'>;
  preferencesService?: Pick<AppPreferencesService, 'getPrimaryLanguage'>;
}

const SECRET_PATTERN = /\b(?:ek|sk|tro_live)[-_][a-z0-9._-]+/gi;

function defaultVoiceDiagnosticLogger(
  event: string,
  properties: VoiceDiagnosticProperties = {},
): void {
  if (process.env.NODE_ENV === 'test') return;
  const details =
    Object.keys(properties).length > 0 ? ` ${JSON.stringify(properties)}` : '';
  console.info(`[voice:main] ${event}${details}`);
}

function diagnosticErrorProperties(error: unknown): VoiceDiagnosticProperties {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const rawMessage =
    error instanceof Error ? error.message : 'Unknown voice service error.';
  return {
    errorMessage: rawMessage.replace(SECRET_PATTERN, '[redacted]').slice(0, 500),
    errorName: name,
  };
}

function readyStatus(): VoiceStatus {
  return VoiceStatusSchema.parse({
    model: VOICE_MODEL,
    provider: 'openai',
    state: 'ready',
    summary: 'OpenAI GPT Transcribe is configured.',
  });
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('Voice response exceeded the size limit.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('Voice response exceeded the size limit.');
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export class VoiceService {
  private readonly accessTokenProvider?: () => Promise<string | null>;
  private readonly apiBaseUrl: string;
  private readonly credentialStore: VoiceCredentialStore;
  private readonly diagnosticLogger: VoiceDiagnosticLogger;
  private readonly environmentApiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Pick<Console, 'error'>;
  private readonly preferencesService: Pick<
    AppPreferencesService,
    'getPrimaryLanguage'
  >;

  constructor({
    accessTokenProvider,
    apiBaseUrl,
    credentialStore,
    diagnosticLogger = defaultVoiceDiagnosticLogger,
    environmentApiKey = process.env.OPENAI_API_KEY,
    fetchImpl = fetch,
    logger = console,
    preferencesService = { getPrimaryLanguage: async () => 'en' },
  }: VoiceServiceOptions) {
    this.accessTokenProvider = accessTokenProvider;
    this.apiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
    this.credentialStore = credentialStore;
    this.diagnosticLogger = diagnosticLogger;
    this.environmentApiKey = environmentApiKey?.trim() || undefined;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.preferencesService = preferencesService;
  }

  async getStatus(): Promise<VoiceStatus> {
    this.diagnosticLogger('status.check-start');
    try {
      const credential = await this.readCredential();
      if (credential) {
        this.diagnosticLogger('status.ready');
        return readyStatus();
      }
      this.diagnosticLogger('status.not-configured');
      return VoiceStatusSchema.parse({
        model: VOICE_MODEL,
        provider: 'openai',
        state: 'not_configured',
        summary: this.apiBaseUrl
          ? 'Sign in with Google to use voice input.'
          : 'OPENAI_API_KEY is missing from Doppler. Add it and restart TroCode.',
      });
    } catch (error) {
      this.diagnosticLogger('status.failed', diagnosticErrorProperties(error));
      return VoiceStatusSchema.parse({
        model: VOICE_MODEL,
        provider: 'openai',
        state: 'error',
        summary: 'TroCode could not read the encrypted voice credential.',
      });
    }
  }

  async configure(input: unknown): Promise<VoiceStatus> {
    this.diagnosticLogger('configure.start');
    if (this.apiBaseUrl) {
      throw new Error('TroCode voice is managed by the hosted service.');
    }
    const { apiKey } = ConfigureVoiceRequestSchema.parse(input);
    await this.validateTranscriptionAccess(apiKey);
    await this.credentialStore.write(apiKey);
    this.diagnosticLogger('configure.ready');
    return readyStatus();
  }

  async transcribeSegment(input: unknown): Promise<VoiceSegmentTranscription> {
    const request = TranscribeVoiceSegmentRequestSchema.parse(input);
    const credential = await this.readCredential();
    if (!credential) {
      throw new Error(
        this.apiBaseUrl
          ? 'Sign in with Google to use voice input.'
          : 'OPENAI_API_KEY is missing from Doppler. Add it and restart TroCode.',
      );
    }
    const language = await this.preferencesService.getPrimaryLanguage();
    const startedAt = Date.now();
    this.diagnosticLogger('segment.request-start', {
      byteCount: Math.floor((request.audioBase64.length * 3) / 4),
      durationMs: request.durationMs,
      model: VOICE_MODEL,
      requestId: request.requestId,
      sequence: request.sequence,
    });

    let response: Response;
    try {
      response = this.apiBaseUrl
        ? await this.requestHostedSegment(credential, request, language)
        : await this.requestLocalSegment(credential, request, language);
    } catch (error) {
      this.diagnosticLogger(
        'segment.request-failed',
        diagnosticErrorProperties(error),
      );
      this.logger.error('[voice] GPT Transcribe segment request failed.', {
        durationMs: request.durationMs,
        error: diagnosticErrorProperties(error),
        requestId: request.requestId,
        sequence: request.sequence,
      });
      throw new Error(
        error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'OpenAI voice transcription timed out.'
          : 'TroCode could not reach voice transcription.',
        { cause: error },
      );
    }

    let responseBody: unknown;
    try {
      responseBody = await readBoundedJson(response);
    } catch (error) {
      this.diagnosticLogger(
        'segment.response-invalid',
        diagnosticErrorProperties(error),
      );
      throw new Error('Voice transcription returned an invalid response.', {
        cause: error,
      });
    }
    if (!response.ok) {
      const detail = apiErrorMessage(responseBody);
      this.diagnosticLogger('segment.rejected', { status: response.status });
      throw new Error(detail || 'OpenAI rejected the voice segment.');
    }

    let parsed: z.infer<typeof HostedTranscriptionResponseSchema>;
    try {
      parsed = this.apiBaseUrl
        ? HostedTranscriptionResponseSchema.parse(responseBody)
        : (() => {
            const provider =
              OpenAITranscriptionResponseSchema.parse(responseBody);
            return {
              audioDurationMs: request.durationMs,
              billedSeconds: request.durationMs / 1_000,
              model: VOICE_MODEL,
              text: provider.text,
            };
          })();
    } catch (error) {
      this.diagnosticLogger(
        'segment.response-invalid',
        diagnosticErrorProperties(error),
      );
      throw new Error('Voice transcription returned an invalid response.', {
        cause: error,
      });
    }
    this.diagnosticLogger('segment.completed', {
      audioDurationMs: parsed.audioDurationMs,
      billedSeconds: parsed.billedSeconds,
      durationMs: Date.now() - startedAt,
      model: VOICE_MODEL,
      requestId: request.requestId,
      sequence: request.sequence,
    });
    return VoiceSegmentTranscriptionSchema.parse({
      ...parsed,
      sequence: request.sequence,
      utteranceId: request.utteranceId,
    });
  }

  private async readCredential(): Promise<string | null> {
    if (this.apiBaseUrl) {
      const accessToken = await this.accessTokenProvider?.();
      this.diagnosticLogger(
        accessToken ? 'credential.available' : 'credential.missing',
        { source: 'hosted-session' },
      );
      return accessToken ?? null;
    }
    if (this.environmentApiKey) {
      this.diagnosticLogger('credential.available', { source: 'environment' });
      return this.environmentApiKey;
    }
    const storedApiKey = await this.credentialStore.read();
    this.diagnosticLogger(
      storedApiKey ? 'credential.available' : 'credential.missing',
      { source: 'encrypted-store' },
    );
    return storedApiKey;
  }

  private async validateTranscriptionAccess(apiKey: string): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(OPENAI_MODEL_URL, {
        headers: { Authorization: `Bearer ${apiKey}` },
        method: 'GET',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'OpenAI voice validation timed out.'
          : 'TroCode could not validate OpenAI GPT Transcribe access.',
      );
    }
    const responseBody = await readBoundedJson(response);
    if (!response.ok) {
      throw new Error(
        apiErrorMessage(responseBody) || 'OpenAI rejected the voice credential.',
      );
    }
    OpenAIModelResponseSchema.parse(responseBody);
  }

  private requestHostedSegment(
    accessToken: string,
    request: z.infer<typeof TranscribeVoiceSegmentRequestSchema>,
    language: PrimaryLanguage,
  ): Promise<Response> {
    return this.fetchImpl(`${this.apiBaseUrl}/v1/openai/audio/transcriptions`, {
      body: JSON.stringify({
        audioBase64: request.audioBase64,
        clientDurationMs: request.durationMs,
        language,
        utteranceId: request.utteranceId,
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Trocode-Request-Id': request.requestId,
      },
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private requestLocalSegment(
    apiKey: string,
    request: z.infer<typeof TranscribeVoiceSegmentRequestSchema>,
    language: PrimaryLanguage,
  ): Promise<Response> {
    const audio = Uint8Array.from(Buffer.from(request.audioBase64, 'base64'));
    const form = new FormData();
    form.set('file', new Blob([audio], { type: 'audio/wav' }), 'segment.wav');
    form.set('model', VOICE_MODEL);
    form.append('languages[]', language);
    return this.fetchImpl(OPENAI_TRANSCRIPTIONS_URL, {
      body: form,
      headers: { Authorization: `Bearer ${apiKey}` },
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? '';
  if (!trimmed) return '';
  const url = new URL(trimmed);
  if (
    url.protocol !== 'https:' &&
    url.hostname !== '127.0.0.1' &&
    url.hostname !== 'localhost'
  ) {
    throw new Error('TROCODE_API_BASE_URL must use HTTPS.');
  }
  return url.toString().replace(/\/+$/, '');
}
