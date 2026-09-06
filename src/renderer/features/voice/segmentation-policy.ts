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

export const DEFAULT_VOICE_SEGMENTATION_POLICY: Readonly<VoiceSegmentationPolicy> =
  Object.freeze({
    frameMs: 20,
    speechStartFrames: 3,
    absoluteStartRms: 0.0035,
    absoluteContinueRms: 0.0025,
    startNoiseMultiplier: 1.6,
    continueNoiseMultiplier: 1.25,
    initialNoiseFloorRms: 0.0015,
    maximumNoiseFloorRms: 0.015,
    noiseFloorAlpha: 0.03,
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
