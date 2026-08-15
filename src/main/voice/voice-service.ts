import { z } from 'zod';

import {
  ConfigureVoiceRequestSchema,
  CreateVoiceCallRequestSchema,
  VoiceCallAnswerSchema,
  VoiceStatusSchema,
  type VoiceCallAnswer,
  type PrimaryLanguage,
  type VoiceStatus,
} from '../../shared/contracts';
import type { AppPreferencesService } from '../preferences/app-preferences-service';

const OPENAI_REALTIME_CLIENT_SECRETS_URL =
  'https://api.openai.com/v1/realtime/client_secrets';
const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const VOICE_MODEL = 'gpt-realtime-whisper' as const;
const CLIENT_SECRET_TTL_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 15_000;

const OpenAIClientSecretResponseSchema = z.object({
  expires_at: z.number().int().positive(),
  value: z.string().min(1).max(2_048),
});

const OpenAIErrorResponseSchema = z.object({
  error: z
    .object({
      message: z.string().min(1).max(2_000),
    })
    .optional(),
});

export interface VoiceCredentialStore {
  read(): Promise<string | null>;
  write(apiKey: string): Promise<void>;
}

type VoiceDiagnosticProperties = Record<
  string,
  string | number | boolean
>;

type VoiceDiagnosticLogger = (
  event: string,
  properties?: VoiceDiagnosticProperties,
) => void;

interface VoiceServiceOptions {
  credentialStore: VoiceCredentialStore;
  diagnosticLogger?: VoiceDiagnosticLogger;
  environmentApiKey?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, 'error'>;
  preferencesService?: Pick<AppPreferencesService, 'getPrimaryLanguage'>;
}

const SECRET_PATTERN = /\b(?:ek|sk)[-_][a-z0-9._-]+/gi;

function defaultVoiceDiagnosticLogger(
  event: string,
  properties: VoiceDiagnosticProperties = {},
): void {
  if (process.env.NODE_ENV === 'test') return;
  const details =
    Object.keys(properties).length > 0
      ? ` ${JSON.stringify(properties)}`
      : '';
  console.info(`[voice:main] ${event}${details}`);
}

function diagnosticErrorProperties(
  error: unknown,
): VoiceDiagnosticProperties {
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
    state: 'ready',
    provider: 'openai',
    model: VOICE_MODEL,
    summary: 'OpenAI realtime transcription is configured.',
  });
}

function transcriptionSessionConfig(
  language: PrimaryLanguage,
): Record<string, unknown> {
  return {
    type: 'transcription',
    audio: {
      input: {
        noise_reduction: { type: 'far_field' },
        transcription: {
          language,
          model: VOICE_MODEL,
        },
        turn_detection: null,
      },
    },
  };
}

function errorCode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('code' in value)) {
    return undefined;
  }

  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function serializeVoiceError(error: unknown): {
  cause?: { code?: string; message: string; name?: string };
  message: string;
  name?: string;
} {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const serialized: {
    cause?: { code?: string; message: string; name?: string };
    message: string;
    name?: string;
  } = {
    message: error.message,
    name: error.name,
  };

  const cause = error.cause;
  if (cause instanceof Error) {
    serialized.cause = {
      code: errorCode(cause),
      message: cause.message,
      name: cause.name,
    };
  } else if (cause !== undefined) {
    serialized.cause = {
      code: errorCode(cause),
      message: String(cause),
    };
  }

  return serialized;
}

export class VoiceService {
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
    credentialStore,
    diagnosticLogger = defaultVoiceDiagnosticLogger,
    environmentApiKey = process.env.OPENAI_API_KEY,
    fetchImpl = fetch,
    logger = console,
    preferencesService = {
      getPrimaryLanguage: async () => 'en',
    },
  }: VoiceServiceOptions) {
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
      const apiKey = await this.readApiKey();
      if (apiKey) {
        this.diagnosticLogger('status.ready');
        return readyStatus();
      }

      this.diagnosticLogger('status.not-configured');
      return VoiceStatusSchema.parse({
        state: 'not_configured',
        provider: 'openai',
        model: VOICE_MODEL,
        summary: 'OPENAI_API_KEY is missing from Doppler. Add it and restart TroCode.',
      });
    } catch (error) {
      this.diagnosticLogger(
        'status.failed',
        diagnosticErrorProperties(error),
      );
      return VoiceStatusSchema.parse({
        state: 'error',
        provider: 'openai',
        model: VOICE_MODEL,
        summary: 'TroCode could not read the encrypted voice credential.',
      });
    }
  }

  async configure(input: unknown): Promise<VoiceStatus> {
    this.diagnosticLogger('configure.start');
    const { apiKey } = ConfigureVoiceRequestSchema.parse(input);

    // Validate model access before persisting the credential. The returned
    // short-lived secret is intentionally discarded.
    const language = await this.preferencesService.getPrimaryLanguage();
    await this.validateRealtimeAccess(apiKey, language);
    await this.credentialStore.write(apiKey);
    this.diagnosticLogger('configure.ready');
    return readyStatus();
  }

  async createCall(input: unknown): Promise<VoiceCallAnswer> {
    this.diagnosticLogger('call.create-start');
    const apiKey = await this.readApiKey();
    if (!apiKey) {
      this.diagnosticLogger('call.missing-credential');
      throw new Error(
        'OPENAI_API_KEY is missing from Doppler. Add it and restart TroCode.',
      );
    }

    const { offerSdp } = CreateVoiceCallRequestSchema.parse(input);
    const language = await this.preferencesService.getPrimaryLanguage();
    return this.requestRealtimeCall(apiKey, offerSdp, language);
  }

  private async readApiKey(): Promise<string | null> {
    if (this.environmentApiKey) {
      this.diagnosticLogger('credential.available', {
        source: 'environment',
      });
      return this.environmentApiKey;
    }
    const storedApiKey = await this.credentialStore.read();
    this.diagnosticLogger(
      storedApiKey ? 'credential.available' : 'credential.missing',
      { source: 'encrypted-store' },
    );
    return storedApiKey;
  }

  private async validateRealtimeAccess(
    apiKey: string,
    language: PrimaryLanguage,
  ): Promise<void> {
    this.diagnosticLogger('client-secret.request-start', {
      model: VOICE_MODEL,
      language,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    let response: Response;
    try {
      response = await this.fetchImpl(OPENAI_REALTIME_CLIENT_SECRETS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expires_after: {
            anchor: 'created_at',
            seconds: CLIENT_SECRET_TTL_SECONDS,
          },
          session: transcriptionSessionConfig(language),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.diagnosticLogger(
        'client-secret.request-failed',
        diagnosticErrorProperties(error),
      );
      throw new Error(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'OpenAI voice connection timed out.'
          : 'TroCode could not reach OpenAI voice.',
      );
    }

    this.diagnosticLogger('client-secret.response', {
      ok: response.ok,
      status: response.status,
    });

    const responseText = await response.text();
    let responseBody: unknown;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = null;
    }

    if (!response.ok) {
      const apiError = OpenAIErrorResponseSchema.safeParse(responseBody);
      const detail = apiError.success
        ? apiError.data.error?.message
        : undefined;
      this.diagnosticLogger('client-secret.rejected', {
        status: response.status,
      });
      throw new Error(detail || 'OpenAI rejected the voice connection.');
    }

    OpenAIClientSecretResponseSchema.parse(responseBody);
    this.diagnosticLogger('client-secret.ready', {
      model: VOICE_MODEL,
    });
  }

  private async requestRealtimeCall(
    apiKey: string,
    offerSdp: string,
    language: PrimaryLanguage,
  ): Promise<VoiceCallAnswer> {
    this.diagnosticLogger('call.request-start', {
      model: VOICE_MODEL,
      language,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    const formData = new FormData();
    formData.set('sdp', offerSdp);
    formData.set(
      'session',
      JSON.stringify(transcriptionSessionConfig(language)),
    );

    let response: Response;
    try {
      response = await this.fetchImpl(OPENAI_REALTIME_CALLS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.diagnosticLogger(
        'call.request-failed',
        diagnosticErrorProperties(error),
      );
      this.logger.error('[voice] OpenAI Realtime call request failed.', {
        error: serializeVoiceError(error),
      });
      throw new Error(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'OpenAI voice connection timed out.'
          : 'TroCode could not reach OpenAI voice.',
        { cause: error },
      );
    }

    this.diagnosticLogger('call.response', {
      ok: response.ok,
      status: response.status,
    });

    const responseText = await response.text();
    if (!response.ok) {
      let responseBody: unknown;
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = null;
      }

      const apiError = OpenAIErrorResponseSchema.safeParse(responseBody);
      const detail = apiError.success
        ? apiError.data.error?.message
        : undefined;
      this.diagnosticLogger('call.rejected', {
        status: response.status,
      });
      throw new Error(
        detail || 'OpenAI rejected the realtime voice connection.',
      );
    }

    this.diagnosticLogger('call.ready', {
      model: VOICE_MODEL,
    });
    return VoiceCallAnswerSchema.parse({
      answerSdp: responseText,
    });
  }
}
