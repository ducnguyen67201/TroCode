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
  it('uses the hosted session for realtime calls without a provider key', async () => {
    const { store, read } = memoryStore(TEST_API_KEY);
    const accessToken = `tro_live_${'a'.repeat(43)}`;
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response('v=0\r\nanswer', { status: 200 }),
    );
    const service = new VoiceService({
      accessTokenProvider: vi.fn(async () => accessToken),
      apiBaseUrl: 'http://127.0.0.1:8080',
      credentialStore: store,
      fetchImpl,
    });

    await expect(service.getStatus()).resolves.toMatchObject({ state: 'ready' });
    await expect(
      service.createCall({ offerSdp: 'v=0\r\noffer' }),
    ).resolves.toEqual({ answerSdp: 'v=0\r\nanswer' });
    expect(read).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/openai/realtime/calls',
      expect.objectContaining({
        body: JSON.stringify({ language: 'en', offerSdp: 'v=0\r\noffer' }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }),
    );
    await expect(
      service.configure({ apiKey: TEST_API_KEY }),
    ).rejects.toThrow('managed by the hosted service');
  });

  it('enables voice automatically from an injected environment key', async () => {
    const { store, read } = memoryStore();
    const service = new VoiceService({
      credentialStore: store,
      environmentApiKey: TEST_API_KEY,
      fetchImpl: vi.fn(),
    });

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'ready',
      model: 'gpt-realtime-whisper',
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
      model: 'gpt-realtime-whisper',
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
    const diagnosticLogger = vi.fn();
    const service = new VoiceService({
      credentialStore: store,
      diagnosticLogger,
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
    expect(diagnosticLogger).toHaveBeenCalledWith(
      'client-secret.response',
      { ok: false, status: 401 },
    );
    expect(diagnosticLogger).toHaveBeenCalledWith(
      'client-secret.rejected',
      { status: 401 },
    );
  });

  it('validates realtime transcription access before saving the key', async () => {
    const { store } = memoryStore(TEST_API_KEY);
    const diagnosticLogger = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      successfulSecretResponse(),
    );
    const service = new VoiceService({
      credentialStore: store,
      diagnosticLogger,
      environmentApiKey: '',
      fetchImpl,
    });

    await expect(service.configure({ apiKey: TEST_API_KEY })).resolves.toEqual({
      state: 'ready',
      provider: 'openai',
      model: 'gpt-realtime-whisper',
      summary: 'OpenAI realtime transcription is configured.',
    });

    const request = fetchImpl.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({
      Authorization: `Bearer ${TEST_API_KEY}`,
    });
    expect(request?.body).toContain('gpt-realtime-whisper');
    expect(request?.body).toContain('"language":"en"');
    expect(diagnosticLogger.mock.calls.map(([event]) => event)).toEqual([
      'configure.start',
      'client-secret.request-start',
      'client-secret.response',
      'client-secret.ready',
      'configure.ready',
    ]);
    expect(diagnosticLogger).toHaveBeenCalledWith(
      'client-secret.response',
      { ok: true, status: 200 },
    );
  });

  it('creates the realtime call answer in the main process', async () => {
    const { store } = memoryStore(TEST_API_KEY);
    const diagnosticLogger = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('v=0\r\nanswer', { status: 200 }));
    const service = new VoiceService({
      credentialStore: store,
      diagnosticLogger,
      environmentApiKey: '',
      fetchImpl,
      preferencesService: {
        getPrimaryLanguage: vi.fn(async () => 'vi' as const),
      },
    });

    await expect(
      service.createCall({ offerSdp: 'v=0\r\noffer' }),
    ).resolves.toEqual({
      answerSdp: 'v=0\r\nanswer',
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://api.openai.com/v1/realtime/calls',
      expect.objectContaining({
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        method: 'POST',
      }),
    );
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(request?.body).toBeInstanceOf(FormData);
    const formData = request?.body as FormData;
    expect(formData.get('sdp')).toBe('v=0\r\noffer');
    expect(JSON.parse(String(formData.get('session')))).toEqual({
      type: 'transcription',
      audio: {
        input: {
          noise_reduction: { type: 'far_field' },
          transcription: {
            language: 'vi',
            model: 'gpt-realtime-whisper',
          },
          turn_detection: null,
        },
      },
    });
    expect(diagnosticLogger.mock.calls.map(([event]) => event)).toEqual([
      'call.create-start',
      'credential.available',
      'call.request-start',
      'call.response',
      'call.ready',
    ]);
    expect(diagnosticLogger).toHaveBeenCalledWith('call.request-start', {
      language: 'vi',
      model: 'gpt-realtime-whisper',
      timeoutMs: 15_000,
    });
  });

  it('preserves the underlying realtime call transport failure cause', async () => {
    const { store } = memoryStore(TEST_API_KEY);
    const cause = new Error('connection reset');
    Object.assign(cause, { code: 'ECONNRESET' });
    const diagnosticLogger = vi.fn();
    const logger = { error: vi.fn() };
    const service = new VoiceService({
      credentialStore: store,
      diagnosticLogger,
      environmentApiKey: '',
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(new TypeError('fetch failed', { cause })),
      logger,
    });

    await expect(
      service.createCall({ offerSdp: 'v=0\r\noffer' }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        cause: expect.objectContaining({
          code: 'ECONNRESET',
          message: 'connection reset',
        }),
        message: 'fetch failed',
        name: 'TypeError',
      }),
    });
    expect(diagnosticLogger).toHaveBeenCalledWith(
      'call.request-failed',
      {
        errorMessage: 'fetch failed',
        errorName: 'TypeError',
      },
    );
    expect(logger.error).toHaveBeenCalledWith(
      '[voice] OpenAI Realtime call request failed.',
      {
        error: {
          cause: {
            code: 'ECONNRESET',
            message: 'connection reset',
            name: 'Error',
          },
          message: 'fetch failed',
          name: 'TypeError',
        },
      },
    );
  });
});
