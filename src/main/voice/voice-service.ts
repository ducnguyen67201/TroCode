import { z } from 'zod';

import {
  ConfigureVoiceRequestSchema,
  VoiceSessionSchema,
  VoiceStatusSchema,
  type VoiceSession,
  type VoiceStatus,
} from '../../shared/contracts';

const OPENAI_REALTIME_CLIENT_SECRETS_URL =
  'https://api.openai.com/v1/realtime/client_secrets';
const VOICE_MODEL = 'gpt-4o-mini-transcribe' as const;
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

interface VoiceServiceOptions {
  credentialStore: VoiceCredentialStore;
  environmentApiKey?: string;
  fetchImpl?: typeof fetch;
}

function readyStatus(): VoiceStatus {
  return VoiceStatusSchema.parse({
    state: 'ready',
    provider: 'openai',
    model: VOICE_MODEL,
    summary: 'OpenAI realtime transcription is configured.',
  });
}

export class VoiceService {
  private readonly credentialStore: VoiceCredentialStore;

  private readonly environmentApiKey?: string;

  private readonly fetchImpl: typeof fetch;

  constructor({
    credentialStore,
    environmentApiKey = process.env.OPENAI_API_KEY,
    fetchImpl = fetch,
  }: VoiceServiceOptions) {
    this.credentialStore = credentialStore;
    this.environmentApiKey = environmentApiKey?.trim() || undefined;
    this.fetchImpl = fetchImpl;
  }

  async getStatus(): Promise<VoiceStatus> {
    try {
      const apiKey = await this.readApiKey();
      if (apiKey) return readyStatus();

      return VoiceStatusSchema.parse({
        state: 'not_configured',
        provider: 'openai',
        model: VOICE_MODEL,
        summary: 'OPENAI_API_KEY is missing from Doppler. Add it and restart TroCode.',
      });
    } catch {
      return VoiceStatusSchema.parse({
        state: 'error',
        provider: 'openai',
        model: VOICE_MODEL,
        summary: 'TroCode could not read the encrypted voice credential.',
      });
    }
  }

  async configure(input: unknown): Promise<VoiceStatus> {
    const { apiKey } = ConfigureVoiceRequestSchema.parse(input);

    // Validate model access before persisting the credential. The returned
    // short-lived secret is intentionally discarded.
    await this.requestClientSecret(apiKey);
    await this.credentialStore.write(apiKey);
    return readyStatus();
  }

  async createSession(): Promise<VoiceSession> {
    const apiKey = await this.readApiKey();
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY is missing from Doppler. Add it and restart TroCode.',
      );
    }

    return this.requestClientSecret(apiKey);
  }

  private async readApiKey(): Promise<string | null> {
    if (this.environmentApiKey) return this.environmentApiKey;
    return this.credentialStore.read();
  }

  private async requestClientSecret(apiKey: string): Promise<VoiceSession> {
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
          session: {
            type: 'transcription',
            audio: {
              input: {
                noise_reduction: { type: 'far_field' },
                transcription: {
                  model: VOICE_MODEL,
                },
                turn_detection: null,
              },
            },
          },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'OpenAI voice connection timed out.'
          : 'TroCode could not reach OpenAI voice.',
      );
    }

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
      throw new Error(detail || 'OpenAI rejected the voice connection.');
    }

    const secret = OpenAIClientSecretResponseSchema.parse(responseBody);
    return VoiceSessionSchema.parse({
      clientSecret: secret.value,
      expiresAt: secret.expires_at,
      model: VOICE_MODEL,
    });
  }
}
