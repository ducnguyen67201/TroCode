import type { InferenceProfileId } from './inference-contracts';
import { INFERENCE_MODELS } from './model-catalog';

export interface InferenceProfile {
  id: InferenceProfileId;
  maxOutputTokens: 2_000 | 4_000;
  model: string;
  reasoningEffort: 'low';
  verbosity: 'low';
}

export function selectInferenceProfile(input: {
  hasCurrentImage: boolean;
  qualityOverride: boolean;
  requestLength: number;
}): InferenceProfile {
  if (input.qualityOverride) {
    return {
      id: 'quality_override',
      maxOutputTokens: 4_000,
      model: INFERENCE_MODELS.terra,
      reasoningEffort: 'low',
      verbosity: 'low',
    };
  }
  if (input.hasCurrentImage) {
    return {
      id: 'visual',
      maxOutputTokens: 2_000,
      model: INFERENCE_MODELS.luna,
      reasoningEffort: 'low',
      verbosity: 'low',
    };
  }
  if (input.requestLength > 2_500) {
    return {
      id: 'long_response',
      maxOutputTokens: 4_000,
      model: INFERENCE_MODELS.luna,
      reasoningEffort: 'low',
      verbosity: 'low',
    };
  }
  return {
    id: 'standard',
    maxOutputTokens: 2_000,
    model: INFERENCE_MODELS.luna,
    reasoningEffort: 'low',
    verbosity: 'low',
  };
}
