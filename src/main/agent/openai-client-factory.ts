import { randomUUID } from 'node:crypto';

import OpenAI from 'openai';

import type { VoiceCredentialStore } from '../voice/voice-service';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export interface OpenAIClientFactoryOptions {
  accessTokenProvider?: () => Promise<string | null>;
  apiBaseUrl?: string;
  credentialStore: Pick<VoiceCredentialStore, 'read'>;
  environmentApiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  uuid?: () => string;
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/u, '') ?? '';
  if (!trimmed) return '';
  const url = new URL(trimmed);
  if (
    url.protocol !== 'https:' &&
    url.hostname !== '127.0.0.1' &&
    url.hostname !== 'localhost'
  ) {
    throw new Error('TROCODE_API_BASE_URL must use HTTPS.');
  }
  return url.toString().replace(/\/+$/u, '');
}

export class OpenAIClientFactory {
  private readonly apiBaseUrl: string;

  constructor(private readonly options: OpenAIClientFactoryOptions) {
    this.apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  }

  async create(taskId: string): Promise<OpenAI> {
    const credential = this.apiBaseUrl
      ? await this.options.accessTokenProvider?.()
      : this.options.environmentApiKey?.trim() ||
        process.env.OPENAI_API_KEY?.trim() ||
        (await this.options.credentialStore.read());
    if (!credential) {
      throw new Error(
        this.apiBaseUrl
          ? 'Sign in with Google before starting the task.'
          : 'Connect an OpenAI API key before starting the task.',
      );
    }

    return new OpenAI({
      apiKey: credential,
      baseURL: this.apiBaseUrl
        ? `${this.apiBaseUrl}/v1/openai`
        : OPENAI_BASE_URL,
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('X-Trocode-Request-Id', (this.options.uuid ?? randomUUID)());
        headers.set('X-Trocode-Task-Id', taskId);
        return (this.options.fetchImpl ?? fetch)(url, { ...init, headers });
      },
      maxRetries: 0,
      timeout: this.options.timeoutMs ?? 45_000,
    });
  }
}
