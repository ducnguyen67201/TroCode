import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { VoiceService, type VoiceCredentialStore } from './voice-service';

const TEST_API_KEY = `sk-test-${'a'.repeat(32)}`;

function wavBase64(durationMs = 300): string {
  const dataBytes = Math.round((durationMs / 1_000) * 16_000 * 2);
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes.toString('base64');
}

function segmentRequest() {
  return {
    audioBase64: wavBase64(),
    durationMs: 300,
    requestId: randomUUID(),
    sequence: 2,
    utteranceId: randomUUID(),
  };
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

function providerResponse(text = 'open YouTube'): Response {
  return new Response(
    JSON.stringify({
      languages: [{ code: 'en' }],
      text,
    }),
    { headers: { 'Content-Type': 'application/json' }, status: 200 },
  );
}

describe('VoiceService', () => {
  it('uses the hosted session and never reads the local provider key', async () => {
    const { store, read } = memoryStore(TEST_API_KEY);
    const accessToken = `tro_live_${'a'.repeat(43)}`;
    const request = segmentRequest();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          audioDurationMs: 300,
          billedSeconds: 0.3,
          model: 'whisper-1',
          text: 'open YouTube',
          usageSource: 'actual',
        }),
        { status: 200 },
      ),
    );
    const service = new VoiceService({
      accessTokenProvider: vi.fn(async () => accessToken),
      apiBaseUrl: 'http://127.0.0.1:8080',
      credentialStore: store,
      fetchImpl,
      preferencesService: {
        getPrimaryLanguage: vi.fn(async () => 'vi' as const),
      },
    });

    await expect(service.getStatus()).resolves.toMatchObject({
      model: 'gpt-transcribe',
      state: 'ready',
    });
    await expect(service.transcribeSegment(request)).resolves.toMatchObject({
      model: 'whisper-1',
      sequence: request.sequence,
      text: 'open YouTube',
      utteranceId: request.utteranceId,
    });
    expect(read).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/openai/audio/transcriptions',
      expect.objectContaining({
        body: JSON.stringify({
          audioBase64: request.audioBase64,
          clientDurationMs: 300,
          language: 'vi',
          utteranceId: request.utteranceId,
        }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Trocode-Request-Id': request.requestId,
          'X-Trocode-Transcription-Contract': '2',
        },
      }),
    );
  });

  it('surfaces hosted string and object access errors', async () => {
    for (const error of [
      'Enter a valid access code to use TroCode.',
      { message: 'Your session expired.' },
    ]) {
      const service = new VoiceService({
        accessTokenProvider: vi.fn(async () => `tro_live_${'a'.repeat(43)}`),
        apiBaseUrl: 'http://127.0.0.1:8080',
        credentialStore: memoryStore().store,
        fetchImpl: vi.fn<typeof fetch>(async () =>
          new Response(JSON.stringify({ error }), { status: 403 }),
        ),
      });
      await expect(service.transcribeSegment(segmentRequest())).rejects.toThrow(
        typeof error === 'string' ? error : error.message,
      );
    }
  });

  it('sends local audio as bounded gpt-transcribe multipart form data', async () => {
    const request = segmentRequest();
    const fetchImpl = vi.fn<typeof fetch>(async () => providerResponse());
    const service = new VoiceService({
      credentialStore: memoryStore(TEST_API_KEY).store,
      environmentApiKey: '',
      fetchImpl,
      preferencesService: {
        getPrimaryLanguage: vi.fn(async () => 'en' as const),
      },
    });
    await expect(service.transcribeSegment(request)).resolves.toEqual({
      audioDurationMs: 300,
      billedSeconds: 0.3,
      model: 'gpt-transcribe',
      sequence: 2,
      text: 'open YouTube',
      utteranceId: request.utteranceId,
    });
    const [url, options] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(options?.headers).toEqual({ Authorization: `Bearer ${TEST_API_KEY}` });
    expect(options?.body).toBeInstanceOf(FormData);
    const form = options?.body as FormData;
    expect(form.get('model')).toBe('gpt-transcribe');
    expect(form.getAll('languages[]')).toEqual(['en']);
    expect(form.get('language')).toBeNull();
    expect(form.get('response_format')).toBeNull();
    expect(form.get('temperature')).toBeNull();
    expect((form.get('file') as File).type).toBe('audio/wav');
  });

  it('validates GPT Transcribe model access before storing a local key', async () => {
    const { store, write } = memoryStore();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ id: 'gpt-transcribe' }), { status: 200 }),
    );
    const service = new VoiceService({
      credentialStore: store,
      environmentApiKey: '',
      fetchImpl,
    });
    await expect(service.configure({ apiKey: TEST_API_KEY })).resolves.toMatchObject(
      { model: 'gpt-transcribe', state: 'ready' },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models/gpt-transcribe',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        method: 'GET',
      }),
    );
    expect(write).toHaveBeenCalledWith(TEST_API_KEY);
  });

  it('does not persist a rejected local key', async () => {
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

  it('requires a credential and never retries malformed responses', async () => {
    const missing = new VoiceService({
      credentialStore: memoryStore().store,
      environmentApiKey: '',
      fetchImpl: vi.fn(),
    });
    await expect(missing.transcribeSegment(segmentRequest())).rejects.toThrow(
      'OPENAI_API_KEY is missing',
    );

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ text: 42 }), { status: 200 }),
    );
    const malformed = new VoiceService({
      credentialStore: memoryStore(TEST_API_KEY).store,
      environmentApiKey: '',
      fetchImpl,
    });
    await expect(malformed.transcribeSegment(segmentRequest())).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('normalizes an ambiguous timeout and never retries it', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    const service = new VoiceService({
      credentialStore: memoryStore(TEST_API_KEY).store,
      environmentApiKey: '',
      fetchImpl,
    });
    await expect(service.transcribeSegment(segmentRequest())).rejects.toThrow(
      'timed out',
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
