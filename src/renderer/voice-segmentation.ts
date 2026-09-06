import { rms } from './features/voice/audio-level';
import {
  DEFAULT_VOICE_SEGMENTATION_POLICY,
  type VoiceSegmentationPolicy,
} from './features/voice/segmentation-policy';

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

function frameDurationMs(frame: BufferedFrame, sampleRate: number): number {
  return (frame.samples.length / sampleRate) * 1_000;
}

function copyFrames(frames: readonly BufferedFrame[]): Float32Array {
  const length = frames.reduce(
    (total, frame) => total + frame.samples.length,
    0,
  );
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
    if (frame.samples.length === 0)
      return { limitReached: false, segments: [] };
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
      const isCandidateSpeech = energy >= startThreshold;
      if (!isCandidateSpeech) {
        this.#noiseFloorRms = Math.min(
          this.#policy.maximumNoiseFloorRms,
          (1 - this.#policy.noiseFloorAlpha) * this.#noiseFloorRms +
            this.#policy.noiseFloorAlpha * energy,
        );
      }
      this.#candidateSpeechFrames = isCandidateSpeech
        ? this.#candidateSpeechFrames + 1
        : 0;
      this.#preRoll.push({ samples, speech: isCandidateSpeech });
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
          this.#speechDurationSinceBoundaryMs >= this.#policy.minimumSpeechMs
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
    return {
      limitReached: this.#limitReached,
      segments: segment ? [segment] : [],
    };
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
        total +
        (frame.speech ? frameDurationMs(frame, this.#sampleRate ?? 1) : 0),
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
    if (
      this.#sampleRate === null ||
      this.#sequence >= this.#policy.maximumSegments
    ) {
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

export {
  encodePcm16Wav,
  normalizeVoiceSamples,
  type EncodedPcm16Wav,
  type NormalizedVoiceSamples,
} from './features/voice/pcm-encoding';
export { SegmentUploadQueue } from './features/voice/segment-upload-queue';
export {
  joinTranscriptSegments,
  OrderedTranscriptAssembler,
  type TranscriptSegmentResult,
} from './features/voice/transcript-assembler';

export {
  DEFAULT_VOICE_SEGMENTATION_POLICY,
  type VoiceSegmentationPolicy,
} from './features/voice/segmentation-policy';
