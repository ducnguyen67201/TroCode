import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { CompanionNarrationService } from './companion-narration-service';

function audioStream(bytes = [1, 2, 3]) {
  return {
    body: new Response(Uint8Array.from(bytes)).body as ReadableStream<Uint8Array>,
    mimeType: 'audio/mpeg' as const,
    providerStatus: 200,
  };
}

describe('companion narration service', () => {
  it('publishes a system descriptor and waits for its terminal report', async () => {
    const publish = vi.fn();
    const service = new CompanionNarrationService({
      publish,
      ttsService: { isConfigured: () => false, stream: vi.fn() },
    });
    const handle = service.begin('Follow this step');

    expect(handle.descriptor).toEqual({
      id: handle.id,
      source: 'system',
      text: 'Follow this step',
    });
    expect(publish).toHaveBeenCalledWith(handle.descriptor);
    service.report({ id: handle.id, phase: 'ended', source: 'system' });
    await expect(handle.completion).resolves.toEqual({
      phase: 'ended',
      source: 'system',
    });
    expect(publish).toHaveBeenLastCalledWith(null);
  });

  it('serves configured speech through one private GET after a non-consuming HEAD', async () => {
    const id = randomUUID();
    const stream = vi.fn(async () => audioStream());
    const service = new CompanionNarrationService({
      publish: vi.fn(),
      ttsService: { isConfigured: () => true, stream },
      uuid: () => id,
    });
    const handle = service.begin('Use the visible filter');

    const head = await service.handleRequest(
      new Request(handle.descriptor.source === 'elevenlabs' ? handle.descriptor.mediaUrl : '', {
        method: 'HEAD',
      }),
    );
    expect(head.status).toBe(200);
    expect(stream).not.toHaveBeenCalled();

    const first = await service.handleRequest(
      new Request(handle.descriptor.source === 'elevenlabs' ? handle.descriptor.mediaUrl : ''),
    );
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(
      Uint8Array.from([1, 2, 3]),
    );
    const second = await service.handleRequest(
      new Request(handle.descriptor.source === 'elevenlabs' ? handle.descriptor.mediaUrl : ''),
    );
    expect(second.status).toBe(404);
    handle.cancel();
  });

  it('keeps waiting through ElevenLabs fallback until system speech ends', async () => {
    const id = randomUUID();
    const service = new CompanionNarrationService({
      publish: vi.fn(),
      ttsService: { isConfigured: () => true, stream: vi.fn() },
      uuid: () => id,
    });
    const handle = service.begin('Open the first result');
    let settled = false;
    void handle.completion.then(() => {
      settled = true;
    });

    service.report({
      id,
      phase: 'fallback_started',
      reason: 'startup_timeout',
      source: 'elevenlabs',
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    service.report({ id, phase: 'ended', source: 'system' });
    await expect(handle.completion).resolves.toMatchObject({
      phase: 'ended',
      source: 'system',
    });
  });

  it('rejects expired and malformed tickets without calling the provider', async () => {
    let now = 100;
    const stream = vi.fn();
    const service = new CompanionNarrationService({
      now: () => now,
      publish: vi.fn(),
      ticketTtlMs: 10,
      ttsService: { isConfigured: () => true, stream },
    });
    const handle = service.begin('Choose the inbox label');
    now = 111;
    const expired = await service.handleRequest(
      new Request(handle.descriptor.source === 'elevenlabs' ? handle.descriptor.mediaUrl : ''),
    );
    const malformed = await service.handleRequest(
      new Request(`trocode-audio://speech/${randomUUID()}?token=secret`),
    );
    expect(expired.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(stream).not.toHaveBeenCalled();
    handle.cancel();
  });
});
