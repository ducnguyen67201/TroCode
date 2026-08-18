import { describe, expect, it, vi } from 'vitest';

import { VoiceCapturePipeline } from './voice-capture';

function harness() {
  const track = { stop: vi.fn() };
  const stream = {
    getTracks: () => [track],
  } as unknown as MediaStream;
  const source = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as MediaStreamAudioSourceNode;
  const gain = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: { value: 1 },
  } as unknown as GainNode;
  const port = { onmessage: null } as unknown as MessagePort;
  const node = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    port,
  } as unknown as AudioWorkletNode;
  const context = {
    audioWorklet: { addModule: vi.fn(async () => undefined) },
    close: vi.fn(async () => undefined),
    createGain: vi.fn(() => gain),
    createMediaStreamSource: vi.fn(() => source),
    destination: {},
    resume: vi.fn(async () => undefined),
    state: 'running',
  } as unknown as AudioContext;
  return { context, gain, node, port, source, stream, track };
}

describe('VoiceCapturePipeline', () => {
  it('loads the own-origin worklet, forwards frames, and keeps audio inaudible', async () => {
    const values = harness();
    const onFrame = vi.fn();
    const pipeline = await VoiceCapturePipeline.open(
      { onFrame },
      {
        createAudioContext: () => values.context,
        createWorkletNode: () => values.node,
        getUserMedia: async () => values.stream,
        workletUrl: new URL('https://app.test/voice.worklet.js'),
      },
    );
    const samples = new Float32Array([0.1, -0.1]);
    values.port.onmessage?.(
      new MessageEvent('message', {
        data: { sampleRate: 16_000, samples: samples.buffer },
      }),
    );
    expect(onFrame).toHaveBeenCalledWith({
      sampleRate: 16_000,
      samples: expect.any(Float32Array),
    });
    expect(values.gain.gain.value).toBe(0);
    expect(values.source.connect).toHaveBeenCalledWith(values.node);
    await pipeline.stop();
    await pipeline.stop();
    expect(values.track.stop).toHaveBeenCalledOnce();
    expect(values.context.close).toHaveBeenCalledOnce();
    expect(values.node.disconnect).toHaveBeenCalledOnce();
  });

  it('stops a permission result when cancellation happened while awaiting it', async () => {
    const values = harness();
    const controller = new AbortController();
    let resolveStream: (stream: MediaStream) => void = () => undefined;
    const opened = VoiceCapturePipeline.open(
      { onFrame: vi.fn(), signal: controller.signal },
      {
        createAudioContext: () => values.context,
        createWorkletNode: () => values.node,
        getUserMedia: () =>
          new Promise((resolve) => {
            resolveStream = resolve;
          }),
      },
    );
    controller.abort();
    resolveStream(values.stream);
    await expect(opened).rejects.toMatchObject({ name: 'AbortError' });
    expect(values.track.stop).toHaveBeenCalledOnce();
    expect(values.context.audioWorklet.addModule).not.toHaveBeenCalled();
  });
});
