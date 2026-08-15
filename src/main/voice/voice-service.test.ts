import { describe, expect, it, vi } from 'vitest';

import {
  VoiceService,
  type VoiceCredentialStore,
} from './voice-service';

const TEST_API_KEY = `sk-test-${'a'.repeat(32)}`;

function successfulSecretResponse(): Response {
  return new Response(
    JSON.stringify({
      expires_at: 2_000_000_000,
      value: 'ek_test_secret',
    }),
    { status: 200 },
  );
}

function memoryStore(initial: string | null = null): {
  store: VoiceCredentialStore;
  read: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
} {
  let value = initial;
  const read = vi.fn(async () => value);
  const write = vi.fn(async (nextValue: string) => {
    value = nextValue;
  });
  return { store: { read, write }, read, write };
}

describe('VoiceService', () => {
  it('enables voice automatically from an injected environment key', async () => {
    const { store, read } = memoryStore();
    const service = new VoiceService({
      credentialStore: store,
      environmentApiKey: TEST_API_KEY,
      fetchImpl: vi.fn(),
    });

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'ready',
      model: 'gpt-4o-mini-transcribe',
      summary: 'OpenAI realtime transcription is configured.',
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('reports that voice needs configuration without a credential', async () => {
    const { store } = memoryStore();
    const service = new VoiceService({
      credentialStore: store,
      environmentApiKey: '',
      fetchImpl: vi.fn(),
    });

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'not_configured',
      model: 'gpt-4o-mini-transcribe',
    });
  });

  it('validates a key before storing it', async () => {
    const { store, write } = memoryStore();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      successfulSecretResponse(),
    );
    const service = new VoiceService({
      credentialStore: store,
      environmentApiKey: '',
      fetchImpl,
    });

    await expect(service.configure({ apiKey: TEST_API_KEY })).resolves.toMatchObject({
      state: 'ready',
    });
    expect(write).toHaveBeenCalledWith(TEST_API_KEY);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('does not store a rejected key', async () => {
    const { store, write } = memoryStore();
    const service = new VoiceService({
      credentialStore: store,
      environmentApiKey: '',
      fetchImpl: vi.fn<typeof fetch>(async () =>
        new Response(
          JSON.stringify({ error: { message: 'Invalid API key.' } }),
          { status: 401 },
        ),
      ),
    });

    await expect(service.configure({ apiKey: TEST_API_KEY })).rejects.toThrow(
      'Invalid API key.',
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('mints a short-lived transcription secret without exposing the API key', async () => {
    const { store } = memoryStore(TEST_API_KEY);
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      successfulSecretResponse(),
    );
    const service = new VoiceService({
      credentialStore: store,
      environmentApiKey: '',
      fetchImpl,
    });

    await expect(service.createSession()).resolves.toEqual({
      clientSecret: 'ek_test_secret',
      expiresAt: 2_000_000_000,
      model: 'gpt-4o-mini-transcribe',
    });

    const request = fetchImpl.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({
      Authorization: `Bearer ${TEST_API_KEY}`,
    });
    expect(request?.body).toContain('gpt-4o-mini-transcribe');
  });
});
