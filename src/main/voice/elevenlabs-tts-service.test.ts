import { describe, expect, it, vi } from 'vitest';

import { ElevenLabsTtsService } from './elevenlabs-tts-service';

describe('ElevenLabs TTS service', () => {
  it('uses the hosted speech endpoint without exposing the provider key', async () => {
    const accessToken = `tro_live_${'a'.repeat(43)}`;
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    );
    const service = new ElevenLabsTtsService({
      accessTokenProvider: vi.fn(async () => accessToken),
      apiBaseUrl: 'http://127.0.0.1:8080',
      fetchImpl,
    });

    expect(service.isConfigured()).toBe(true);
    await expect(service.synthesize('Xin chào')).resolves.toEqual({
      dataBase64: 'AQID',
      mimeType: 'audio/mpeg',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:8080/v1/elevenlabs/speech'),
      expect.objectContaining({
        body: JSON.stringify({ text: 'Xin chào' }),
        headers: expect.objectContaining({
          Authorization: `Bearer ${accessToken}`,
        }),
      }),
    );
  });

  it('stays disabled until both server-side credentials are configured', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new ElevenLabsTtsService({ fetchImpl });

    expect(service.isConfigured()).toBe(false);
    await expect(service.synthesize('Hello')).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the low-latency multilingual model and returns bounded MP3 data', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(Uint8Array.from([1, 2, 3, 4]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    );
    const service = new ElevenLabsTtsService({
      apiKey: 'eleven-test-key',
      voiceId: 'voice/test id',
      fetchImpl,
    });

    await expect(service.synthesize('  Xin chào  ')).resolves.toEqual({
      dataBase64: 'AQIDBA==',
      mimeType: 'audio/mpeg',
    });
    expect(service.isConfigured()).toBe(true);
    const [url, request] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toContain('/voice%2Ftest%20id?output_format=mp3_44100_128');
    expect(request?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'xi-api-key': 'eleven-test-key',
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      text: 'Xin chào',
      model_id: 'eleven_flash_v2_5',
    });
  });

  it('does not expose provider response text when synthesis fails', async () => {
    const logger = { warn: vi.fn() };
    const service = new ElevenLabsTtsService({
      apiKey: 'eleven-test-key',
      voiceId: 'voice-id',
      fetchImpl: vi.fn<typeof fetch>(async () =>
        new Response('secret provider response', { status: 401 }),
      ),
      logger,
    });

    await expect(service.synthesize('Hello')).rejects.toThrow(
      'ElevenLabs returned HTTP 401',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      '[voice:tts] synthesis failed',
      { error: 'ElevenLabs returned HTTP 401.' },
    );
  });
});
