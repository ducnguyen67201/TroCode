export const INFERENCE_MODELS = {
  luna: 'gpt-5.6-luna',
  terra: 'gpt-5.6-terra',
} as const;

export interface ModelCapabilities {
  readonly id: string;
  readonly profiles: readonly string[];
  readonly supportsImages: boolean;
  readonly supportsTools: boolean;
}

export const MODEL_CAPABILITIES: Readonly<Record<string, ModelCapabilities>> =
  Object.freeze({
    [INFERENCE_MODELS.luna]: Object.freeze({
      id: INFERENCE_MODELS.luna,
      profiles: Object.freeze(['standard', 'visual', 'long_response']),
      supportsImages: true,
      supportsTools: true,
    }),
    [INFERENCE_MODELS.terra]: Object.freeze({
      id: INFERENCE_MODELS.terra,
      profiles: Object.freeze(['quality_override']),
      supportsImages: true,
      supportsTools: true,
    }),
  });

export function assertModelSupportsProfile(
  model: string,
  profile: string,
): void {
  const capabilities = MODEL_CAPABILITIES[model];
  if (capabilities && !capabilities.profiles.includes(profile)) {
    throw new Error(`Model ${model} does not support profile ${profile}.`);
  }
}
