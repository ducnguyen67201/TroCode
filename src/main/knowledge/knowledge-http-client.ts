import type { z } from 'zod';

export class KnowledgeSpaceRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'KnowledgeSpaceRequestError';
  }
}

export class KnowledgeHttpClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly accessTokenProvider: () => Promise<string | null>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async request<T>(path: string, init: RequestInit, schema: z.ZodType<T>, authenticated = true): Promise<T> {
    const baseUrl = this.apiBaseUrl.trim().replace(/\/+$/u, '');
    if (!baseUrl) throw new Error('Knowledge Spaces require the hosted TroCode service.');
    const token = authenticated ? await this.accessTokenProvider() : null;
    if (authenticated && !token) throw new Error('Sign in to use Knowledge Spaces.');
    const response = await this.fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: init.signal ?? AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as {
        code?: unknown;
        error?: unknown;
      } | null;
      const code =
        typeof detail?.code === 'string' && detail.code.length <= 80 ? detail.code : 'knowledge_request_failed';
      const message =
        typeof detail?.error === 'string' && detail.error.length <= 500
          ? detail.error
          : `Class workspaces returned HTTP ${response.status}.`;
      throw new KnowledgeSpaceRequestError(message, response.status, code);
    }
    return schema.parse(await response.json());
  }
}
