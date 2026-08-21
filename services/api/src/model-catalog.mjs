const TOKENS_PER_MILLION = 1_000_000n;
const MAX_TOKEN_COUNT = 2_000_000_000;

function freezeEntry(entry) {
  return Object.freeze({ ...entry });
}

export const DEFAULT_CATALOG_VERSION = '2026-08-20';

export const MODEL_CATALOG = Object.freeze({
  'gpt-5.6-luna': freezeEntry({
    cachedInputMicroUsdPerMillion: 20_000,
    cacheWriteMicroUsdPerMillion: 250_000,
    inputMicroUsdPerMillion: 200_000,
    outputMicroUsdPerMillion: 1_200_000,
  }),
  'gpt-5.6-terra': freezeEntry({
    cachedInputMicroUsdPerMillion: 200_000,
    cacheWriteMicroUsdPerMillion: 2_500_000,
    inputMicroUsdPerMillion: 2_000_000,
    outputMicroUsdPerMillion: 12_000_000,
  }),
  'gpt-5.6-sol': freezeEntry({
    cachedInputMicroUsdPerMillion: 500_000,
    cacheWriteMicroUsdPerMillion: 6_250_000,
    inputMicroUsdPerMillion: 5_000_000,
    outputMicroUsdPerMillion: 30_000_000,
  }),
});

function tokenCount(name, value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TOKEN_COUNT) {
    throw new Error(`${name} must be a bounded nonnegative integer.`);
  }
  return value;
}

function ceilingDivide(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

export class ModelCatalog {
  constructor({ entries = MODEL_CATALOG, version = DEFAULT_CATALOG_VERSION } = {}) {
    if (!version || typeof version !== 'string') {
      throw new Error('A price catalog version is required.');
    }
    this.entries = entries;
    this.version = version;
  }

  has(model) {
    return Object.hasOwn(this.entries, model);
  }

  priceFor(model) {
    const entry = this.entries[model];
    if (!entry) throw new Error(`Model ${model} is not in the price catalog.`);
    return entry;
  }

  calculateUsageCost(usage) {
    const inputTokens = tokenCount('inputTokens', usage.inputTokens);
    const cachedInputTokens = tokenCount(
      'cachedInputTokens',
      usage.cachedInputTokens,
    );
    const cacheWriteTokens = tokenCount(
      'cacheWriteTokens',
      usage.cacheWriteTokens,
    );
    const outputTokens = tokenCount('outputTokens', usage.outputTokens);
    if (cachedInputTokens + cacheWriteTokens > inputTokens) {
      throw new Error('Cached and cache-write tokens cannot exceed input tokens.');
    }
    const price = this.priceFor(usage.model);
    const longContext = inputTokens > 272_000;
    const inputMultiplier = longContext ? 2n : 1n;
    const outputNumeratorMultiplier = longContext ? 3n : 2n;
    const outputDenominatorMultiplier = 2n;
    const ordinaryInputTokens =
      inputTokens - cachedInputTokens - cacheWriteTokens;
    const numerator =
      BigInt(ordinaryInputTokens) * BigInt(price.inputMicroUsdPerMillion) * inputMultiplier +
      BigInt(cachedInputTokens) *
        BigInt(price.cachedInputMicroUsdPerMillion) * inputMultiplier +
      BigInt(cacheWriteTokens) *
        BigInt(price.cacheWriteMicroUsdPerMillion) * inputMultiplier +
      BigInt(outputTokens) * BigInt(price.outputMicroUsdPerMillion) * outputNumeratorMultiplier / outputDenominatorMultiplier;
    const microUsd = ceilingDivide(numerator, TOKENS_PER_MILLION);
    if (microUsd > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Calculated usage cost exceeds the supported range.');
    }
    return Number(microUsd);
  }

  estimateResponsesReservation(body) {
    const serializedInput = JSON.stringify(body.input ?? []);
    const serializedTools = JSON.stringify(body.tools ?? []);
    const serializedInstructions = String(body.instructions ?? '');
    const imageCount = (serializedInput.match(/"input_image"/gu) ?? []).length;
    const serializedCharacters =
      serializedInput.length +
      serializedTools.length +
      serializedInstructions.length;
    const estimatedTextTokens = Math.ceil(serializedCharacters / 3) + 1_024;
    const inputTokens = Math.min(
      MAX_TOKEN_COUNT,
      estimatedTextTokens + imageCount * 20_000,
    );
    return {
      imageCount,
      inputTokens,
      microUsd: this.calculateUsageCost({
        cacheWriteTokens: 0,
        cachedInputTokens: 0,
        inputTokens,
        model: body.model,
        outputTokens: body.max_output_tokens,
      }),
      outputTokens: body.max_output_tokens,
    };
  }
}
