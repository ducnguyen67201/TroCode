import type { VoicePcmFrame } from './voice-segmentation';

export interface VoiceCapturePipelineOptions {
  onFrame(frame: VoicePcmFrame): void;
  signal?: AbortSignal;
}

interface VoiceCaptureDependencies {
  createAudioContext?(): AudioContext;
  createWorkletNode?(context: AudioContext): AudioWorkletNode;
  getUserMedia?(constraints: MediaStreamConstraints): Promise<MediaStream>;
  workletUrl?: URL;
}

function abortError(): DOMException {
  return new DOMException('Voice capture was cancelled.', 'AbortError');
}

export class VoiceCapturePipeline {
  #context: AudioContext | null;
  #gain: GainNode | null;
  #node: AudioWorkletNode | null;
  #source: MediaStreamAudioSourceNode | null;
  #stream: MediaStream | null;
  #stopped = false;

  private constructor(
    context: AudioContext,
    gain: GainNode,
    node: AudioWorkletNode,
    source: MediaStreamAudioSourceNode,
    stream: MediaStream,
  ) {
    this.#context = context;
    this.#gain = gain;
    this.#node = node;
    this.#source = source;
    this.#stream = stream;
  }

  static async open(
    { onFrame, signal }: VoiceCapturePipelineOptions,
    dependencies: VoiceCaptureDependencies = {},
  ): Promise<VoiceCapturePipeline> {
    if (signal?.aborted) throw abortError();
    const getUserMedia =
      dependencies.getUserMedia ??
      ((constraints: MediaStreamConstraints) =>
        navigator.mediaDevices.getUserMedia(constraints));
    const stream = await getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    if (signal?.aborted) {
      for (const track of stream.getTracks()) track.stop();
      throw abortError();
    }

    const context = (dependencies.createAudioContext ??
      (() => new AudioContext()))();
    let source: MediaStreamAudioSourceNode | null = null;
    let node: AudioWorkletNode | null = null;
    let gain: GainNode | null = null;
    try {
      await context.audioWorklet.addModule(
        (
          dependencies.workletUrl ??
          new URL('./voice-capture-processor.worklet.js', import.meta.url)
        ).toString(),
      );
      if (signal?.aborted) throw abortError();
      source = context.createMediaStreamSource(stream);
      node = (dependencies.createWorkletNode ??
        ((audioContext) =>
          new AudioWorkletNode(audioContext, 'trocode-voice-capture')))(context);
      gain = context.createGain();
      gain.gain.value = 0;
      node.port.onmessage = (event: MessageEvent<unknown>) => {
        if (!event.data || typeof event.data !== 'object') return;
        const data = event.data as Record<string, unknown>;
        if (
          !(data.samples instanceof ArrayBuffer) ||
          typeof data.sampleRate !== 'number' ||
          !Number.isFinite(data.sampleRate) ||
          data.sampleRate <= 0
        ) {
          return;
        }
        onFrame({
          sampleRate: data.sampleRate,
          samples: new Float32Array(data.samples),
        });
      };
      source.connect(node);
      node.connect(gain);
      gain.connect(context.destination);
      if (context.state === 'suspended') await context.resume();
      if (signal?.aborted) throw abortError();
      return new VoiceCapturePipeline(context, gain, node, source, stream);
    } catch (error) {
      if (node) node.port.onmessage = null;
      node?.disconnect();
      source?.disconnect();
      gain?.disconnect();
      for (const track of stream.getTracks()) track.stop();
      await context.close().catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    if (this.#node) this.#node.port.onmessage = null;
    this.#node?.disconnect();
    this.#source?.disconnect();
    this.#gain?.disconnect();
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    const context = this.#context;
    this.#node = null;
    this.#source = null;
    this.#gain = null;
    this.#stream = null;
    this.#context = null;
    if (context && context.state !== 'closed') {
      await context.close().catch(() => undefined);
    }
  }
}

export function openVoiceCapture(
  options: VoiceCapturePipelineOptions,
): Promise<VoiceCapturePipeline> {
  return VoiceCapturePipeline.open(options);
}
