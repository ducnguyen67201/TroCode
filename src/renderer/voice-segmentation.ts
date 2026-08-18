export interface VoiceSegmentationPolicy {
  absoluteContinueRms: number;
  absoluteStartRms: number;
  continueNoiseMultiplier: number;
  frameMs: number;
  hardBoundaryOverlapMs: number;
  hardSegmentMs: number;
  initialNoiseFloorRms: number;
  maximumNoiseFloorRms: number;
  maximumSegments: number;
  maximumUtteranceMs: number;
  minimumSpeechMs: number;
  noiseFloorAlpha: number;
  outputSampleRate: number;
  preRollMs: number;
  silenceBoundaryMs: number;
  speechStartFrames: number;
  startNoiseMultiplier: number;
  trailingSpeechPaddingMs: number;
  uploadConcurrency: number;
}

export const DEFAULT_VOICE_SEGMENTATION_POLICY: Readonly<VoiceSegmentationPolicy> = Object.freeze({
  frameMs: 20,
  speechStartFrames: 3,
  absoluteStartRms: 0.015,
  absoluteContinueRms: 0.01,
  startNoiseMultiplier: 3,
  continueNoiseMultiplier: 1.8,
  initialNoiseFloorRms: 0.005,
  maximumNoiseFloorRms: 0.025,
  noiseFloorAlpha: 0.05,
  minimumSpeechMs: 300,
  preRollMs: 300,
  trailingSpeechPaddingMs: 200,
  silenceBoundaryMs: 700,
  hardSegmentMs: 12_000,
  hardBoundaryOverlapMs: 300,
  maximumUtteranceMs: 60_000,
  maximumSegments: 32,
  outputSampleRate: 16_000,
  uploadConcurrency: 2,
});
export type VoiceSegmentBoundary = 'hard' | 'release' | 'silence';

export interface VoicePcmFrame {
  samples: Float32Array;
  sampleRate: number;
}

export interface FinalizedVoiceSegment {
  boundary: VoiceSegmentBoundary;
  durationMs: number;
  overlapWithPrevious: boolean;
  sampleRate: number;
  samples: Float32Array;
  sequence: number;
  speechDurationMs: number;
}

export interface SegmenterUpdate {
  limitReached: boolean;
  segments: FinalizedVoiceSegment[];
}

interface BufferedFrame {
  samples: Float32Array;
  speech: boolean;
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let squareSum = 0;
  for (const sample of samples) squareSum += sample * sample;
  return Math.sqrt(squareSum / samples.length);
}

function frameDurationMs(frame: BufferedFrame, sampleRate: number): number {
  return (frame.samples.length / sampleRate) * 1_000;
}

function copyFrames(frames: readonly BufferedFrame[]): Float32Array {
  const length = frames.reduce((total, frame) => total + frame.samples.length, 0);
  const result = new Float32Array(length);
  let offset = 0;
  for (const frame of frames) {
    result.set(frame.samples, offset);
    offset += frame.samples.length;
  }
  return result;
}

function takeFrameSuffix(
  frames: readonly BufferedFrame[],
  durationMs: number,
  sampleRate: number,
): BufferedFrame[] {
  const requiredSamples = Math.round((durationMs / 1_000) * sampleRate);
  let remaining = requiredSamples;
  const suffix: BufferedFrame[] = [];

  for (let index = frames.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const frame = frames[index];
    if (!frame) continue;
    if (frame.samples.length <= remaining) {
      suffix.unshift({ samples: frame.samples.slice(), speech: frame.speech });
      remaining -= frame.samples.length;
      continue;
    }

    suffix.unshift({
      samples: frame.samples.slice(frame.samples.length - remaining),
      speech: frame.speech,
    });
    remaining = 0;
  }

  return suffix;
}

export class VoiceSegmenter {
  readonly #policy: Readonly<VoiceSegmentationPolicy>;
  #sampleRate: number | null = null;
  #noiseFloorRms: number;
  #preRoll: BufferedFrame[] = [];
  #segmentFrames: BufferedFrame[] = [];
  #speechStarted = false;
  #candidateSpeechFrames = 0;
  #silenceMs = 0;
  #speechDurationMs = 0;
  #speechDurationSinceBoundaryMs = 0;
  #hardBoundaryElapsedMs = 0;
  #capturedMs = 0;
  #sequence = 0;
  #nextSegmentOverlaps = false;
  #limitReached = false;

  constructor(
    policy: Readonly<VoiceSegmentationPolicy> = DEFAULT_VOICE_SEGMENTATION_POLICY,
  ) {
    this.#policy = policy;
    this.#noiseFloorRms = policy.initialNoiseFloorRms;
  }

  get capturedDurationMs(): number {
    return this.#capturedMs;
  }

  get limitReached(): boolean {
    return this.#limitReached;
  }

  push(frame: VoicePcmFrame): SegmenterUpdate {
    if (this.#limitReached) return { limitReached: true, segments: [] };
    if (!Number.isFinite(frame.sampleRate) || frame.sampleRate <= 0) {
      throw new Error('Voice frame sample rate must be positive.');
    }
    if (frame.samples.length === 0) return { limitReached: false, segments: [] };
    if (this.#sampleRate !== null && this.#sampleRate !== frame.sampleRate) {
      throw new Error('Voice frame sample rate changed during an utterance.');
    }
    this.#sampleRate = frame.sampleRate;

    const remainingMs = this.#policy.maximumUtteranceMs - this.#capturedMs;
    if (remainingMs <= 0) {
      this.#limitReached = true;
      return { limitReached: true, segments: [] };
    }

    const maximumSamples = Math.floor((remainingMs / 1_000) * frame.sampleRate);
    const samples = frame.samples.slice(0, maximumSamples);
    if (samples.length === 0) {
      this.#limitReached = true;
      return { limitReached: true, segments: [] };
    }

    const durationMs = (samples.length / frame.sampleRate) * 1_000;
    this.#capturedMs += durationMs;
    const energy = rms(samples);
    const startThreshold = Math.max(
      this.#policy.absoluteStartRms,
      this.#noiseFloorRms * this.#policy.startNoiseMultiplier,
    );
    const continueThreshold = Math.max(
      this.#policy.absoluteContinueRms,
      this.#noiseFloorRms * this.#policy.continueNoiseMultiplier,
    );

    const emitted: FinalizedVoiceSegment[] = [];
    if (!this.#speechStarted) {
      this.#noiseFloorRms = Math.min(
        this.#policy.maximumNoiseFloorRms,
        (1 - this.#policy.noiseFloorAlpha) * this.#noiseFloorRms +
          this.#policy.noiseFloorAlpha * energy,
      );
      this.#candidateSpeechFrames =
        energy >= startThreshold ? this.#candidateSpeechFrames + 1 : 0;
      this.#preRoll.push({ samples, speech: energy >= startThreshold });
      this.#trimPreRoll();

      if (this.#candidateSpeechFrames >= this.#policy.speechStartFrames) {
        this.#speechStarted = true;
        this.#segmentFrames = this.#preRoll;
        this.#preRoll = [];
        this.#speechDurationMs = this.#segmentFrames
          .filter((item) => item.speech)
          .reduce(
            (total, item) => total + frameDurationMs(item, frame.sampleRate),
            0,
          );
        this.#speechDurationSinceBoundaryMs = this.#speechDurationMs;
        this.#hardBoundaryElapsedMs = this.#speechDurationMs;
        this.#silenceMs = 0;
      }
    } else {
      const isSpeech = energy >= continueThreshold;
      this.#segmentFrames.push({ samples, speech: isSpeech });
      this.#hardBoundaryElapsedMs += durationMs;
      if (isSpeech) {
        this.#speechDurationMs += durationMs;
        this.#speechDurationSinceBoundaryMs += durationMs;
        this.#silenceMs = 0;
      } else {
        this.#silenceMs += durationMs;
      }

      if (this.#silenceMs >= this.#policy.silenceBoundaryMs) {
        if (
          this.#speechDurationSinceBoundaryMs >=
          this.#policy.minimumSpeechMs
        ) {
          const finalized = this.#finalizeNaturalBoundary();
          if (finalized) emitted.push(finalized);
        } else {
          this.#resetPending();
        }
      } else if (this.#hardBoundaryElapsedMs >= this.#policy.hardSegmentMs) {
        const finalized = this.#finalizeHardBoundary();
        if (finalized) emitted.push(finalized);
      }
    }

    if (
      this.#capturedMs >= this.#policy.maximumUtteranceMs ||
      this.#sequence >= this.#policy.maximumSegments
    ) {
      this.#limitReached = true;
    }

    return { limitReached: this.#limitReached, segments: emitted };
  }

  finish(): SegmenterUpdate {
    if (
      !this.#speechStarted ||
      this.#speechDurationSinceBoundaryMs < this.#policy.minimumSpeechMs
    ) {
      this.#resetPending();
      return { limitReached: this.#limitReached, segments: [] };
    }

    const segment = this.#makeSegment('release', this.#segmentFrames);
    this.#resetPending();
    return { limitReached: this.#limitReached, segments: segment ? [segment] : [] };
  }

  #trimPreRoll(): void {
    if (this.#sampleRate === null) return;
    const maximumSamples = Math.round(
      (this.#policy.preRollMs / 1_000) * this.#sampleRate,
    );
    let totalSamples = this.#preRoll.reduce(
      (total, frame) => total + frame.samples.length,
      0,
    );
    while (this.#preRoll.length > 0 && totalSamples > maximumSamples) {
      const first = this.#preRoll[0];
      if (!first) break;
      const excess = totalSamples - maximumSamples;
      if (first.samples.length <= excess) {
        this.#preRoll.shift();
        totalSamples -= first.samples.length;
      } else {
        this.#preRoll[0] = {
          samples: first.samples.slice(excess),
          speech: first.speech,
        };
        totalSamples -= excess;
      }
    }
  }

  #finalizeNaturalBoundary(): FinalizedVoiceSegment | null {
    if (this.#sampleRate === null) return null;
    const trailingFrames = takeFrameSuffix(
      this.#segmentFrames,
      this.#silenceMs,
      this.#sampleRate,
    );
    const trailingSampleCount = trailingFrames.reduce(
      (total, frame) => total + frame.samples.length,
      0,
    );
    const keepTrailingSamples = Math.round(
      (this.#policy.trailingSpeechPaddingMs / 1_000) * this.#sampleRate,
    );
    const totalSamples = this.#segmentFrames.reduce(
      (total, frame) => total + frame.samples.length,
      0,
    );
    const keepSamples = Math.max(
      0,
      totalSamples - Math.max(0, trailingSampleCount - keepTrailingSamples),
    );
    const flattened = copyFrames(this.#segmentFrames).slice(0, keepSamples);
    const segment = this.#makeSegment('silence', [
      { samples: flattened, speech: true },
    ]);
    this.#resetPending();
    return segment;
  }

  #finalizeHardBoundary(): FinalizedVoiceSegment | null {
    if (this.#sampleRate === null) return null;
    const segment = this.#makeSegment('hard', this.#segmentFrames);
    const overlapFrames = takeFrameSuffix(
      this.#segmentFrames,
      this.#policy.hardBoundaryOverlapMs,
      this.#sampleRate,
    );
    this.#segmentFrames = overlapFrames;
    this.#speechStarted = true;
    this.#candidateSpeechFrames = this.#policy.speechStartFrames;
    this.#silenceMs = 0;
    this.#speechDurationMs = overlapFrames.reduce(
      (total, frame) =>
        total + (frame.speech ? frameDurationMs(frame, this.#sampleRate ?? 1) : 0),
      0,
    );
    this.#speechDurationSinceBoundaryMs = 0;
    this.#hardBoundaryElapsedMs = 0;
    this.#nextSegmentOverlaps = true;
    return segment;
  }

  #makeSegment(
    boundary: VoiceSegmentBoundary,
    frames: readonly BufferedFrame[],
  ): FinalizedVoiceSegment | null {
    if (this.#sampleRate === null || this.#sequence >= this.#policy.maximumSegments) {
      return null;
    }
    const samples = copyFrames(frames);
    if (samples.length === 0) return null;
    const durationMs = (samples.length / this.#sampleRate) * 1_000;
    const segment: FinalizedVoiceSegment = {
      boundary,
      durationMs,
      overlapWithPrevious: this.#nextSegmentOverlaps,
      sampleRate: this.#sampleRate,
      samples,
      sequence: this.#sequence,
      speechDurationMs: this.#speechDurationMs,
    };
    this.#sequence += 1;
    return segment;
  }

  #resetPending(): void {
    this.#preRoll = [];
    this.#segmentFrames = [];
    this.#speechStarted = false;
    this.#candidateSpeechFrames = 0;
    this.#silenceMs = 0;
    this.#speechDurationMs = 0;
    this.#speechDurationSinceBoundaryMs = 0;
    this.#hardBoundaryElapsedMs = 0;
    this.#nextSegmentOverlaps = false;
  }
}

export interface EncodedPcm16Wav {
  bytes: Uint8Array;
  durationMs: number;
  sampleRate: 16_000;
}

export function encodePcm16Wav(
  samples: Float32Array,
  inputSampleRate: number,
  maximumInputMs = 15_000,
): EncodedPcm16Wav {
  if (samples.length === 0) throw new Error('Cannot encode empty voice audio.');
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
    throw new Error('Voice input sample rate must be positive.');
  }
  const inputDurationMs = (samples.length / inputSampleRate) * 1_000;
  if (inputDurationMs > maximumInputMs + 1) {
    throw new Error('Voice segment exceeds the encoding duration limit.');
  }

  const outputSampleRate = 16_000 as const;
  const outputLength = Math.max(
    1,
    Math.round((samples.length * outputSampleRate) / inputSampleRate),
  );
  const bytes = new Uint8Array(44 + outputLength * 2);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + outputLength * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, outputSampleRate, true);
  view.setUint32(28, outputSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, outputLength * 2, true);

  const ratio = inputSampleRate / outputSampleRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const leftIndex = Math.min(samples.length - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    const left = samples[leftIndex] ?? 0;
    const right = samples[rightIndex] ?? left;
    const interpolated = left + (right - left) * fraction;
    const clamped = Math.max(-1, Math.min(1, interpolated));
    const pcm = clamped < 0 ? Math.round(clamped * 32_768) : Math.round(clamped * 32_767);
    view.setInt16(44 + index * 2, pcm, true);
  }

  return {
    bytes,
    durationMs: (outputLength / outputSampleRate) * 1_000,
    sampleRate: outputSampleRate,
  };
}

export interface TranscriptSegmentResult {
  overlapWithPrevious: boolean;
  sequence: number;
  text: string;
}

type TranscriptOutcome =
  | { ok: true; result: TranscriptSegmentResult }
  | { ok: false; error: Error };

function normalizedToken(token: string): string {
  return token
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
}

export function joinTranscriptSegments(
  previous: string,
  current: string,
  overlapWithPrevious: boolean,
): string {
  const previousText = previous.trim();
  const currentText = current.trim();
  if (!previousText) return currentText;
  if (!currentText) return previousText;
  if (!overlapWithPrevious) return `${previousText} ${currentText}`;

  const previousTokens = previousText.split(/\s+/u);
  const currentTokens = currentText.split(/\s+/u);
  const maximum = Math.min(12, previousTokens.length, currentTokens.length);
  let overlap = 0;
  for (let size = maximum; size >= 2; size -= 1) {
    const previousSuffix = previousTokens
      .slice(-size)
      .map(normalizedToken);
    const currentPrefix = currentTokens.slice(0, size).map(normalizedToken);
    if (
      previousSuffix.every(
        (token, index) => token.length > 0 && token === currentPrefix[index],
      )
    ) {
      overlap = size;
      break;
    }
  }

  return [previousText, currentTokens.slice(overlap).join(' ')]
    .filter(Boolean)
    .join(' ');
}

export class OrderedTranscriptAssembler {
  readonly #outcomes = new Map<number, TranscriptOutcome>();

  addSuccess(result: TranscriptSegmentResult): void {
    this.#outcomes.set(result.sequence, { ok: true, result });
  }

  addFailure(sequence: number, error: Error): void {
    this.#outcomes.set(sequence, { ok: false, error });
  }

  get outcomes(): ReadonlyMap<number, TranscriptOutcome> {
    return this.#outcomes;
  }

  provisionalTranscript(): string {
    let transcript = '';
    for (let sequence = 0; ; sequence += 1) {
      const outcome = this.#outcomes.get(sequence);
      if (!outcome?.ok) break;
      transcript = joinTranscriptSegments(
        transcript,
        outcome.result.text,
        outcome.result.overlapWithPrevious,
      );
    }
    return transcript;
  }

  completeTranscript(expectedSegmentCount: number): string | null {
    if (expectedSegmentCount <= 0 || this.#outcomes.size < expectedSegmentCount) {
      return null;
    }
    let transcript = '';
    for (let sequence = 0; sequence < expectedSegmentCount; sequence += 1) {
      const outcome = this.#outcomes.get(sequence);
      if (!outcome?.ok) return null;
      transcript = joinTranscriptSegments(
        transcript,
        outcome.result.text,
        outcome.result.overlapWithPrevious,
      );
    }
    return transcript;
  }
}

interface QueueEntry<Input, Output> {
  input: Input;
  reject: (error: unknown) => void;
  resolve: (output: Output) => void;
}

export class SegmentUploadQueue<Input, Output> {
  readonly #worker: (input: Input) => Promise<Output>;
  readonly #concurrency: number;
  readonly #pending: Array<QueueEntry<Input, Output>> = [];
  #active = 0;

  constructor(
    worker: (input: Input) => Promise<Output>,
    concurrency = DEFAULT_VOICE_SEGMENTATION_POLICY.uploadConcurrency,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('Upload concurrency must be a positive integer.');
    }
    this.#worker = worker;
    this.#concurrency = concurrency;
  }

  get activeCount(): number {
    return this.#active;
  }

  get pendingCount(): number {
    return this.#pending.length;
  }

  enqueue(input: Input): Promise<Output> {
    return new Promise<Output>((resolve, reject) => {
      this.#pending.push({ input, reject, resolve });
      this.#drain();
    });
  }

  cancelPending(error: Error = new Error('Segment upload was cancelled.')): void {
    for (const entry of this.#pending.splice(0)) entry.reject(error);
  }

  #drain(): void {
    while (this.#active < this.#concurrency && this.#pending.length > 0) {
      const entry = this.#pending.shift();
      if (!entry) return;
      this.#active += 1;
      void this.#worker(entry.input)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.#active -= 1;
          this.#drain();
        });
    }
  }
}
