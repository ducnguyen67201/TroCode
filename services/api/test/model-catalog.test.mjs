import assert from 'node:assert/strict';
import test from 'node:test';

import { ModelCatalog } from '../src/model-catalog.mjs';

test('model catalog calculates exact integer micro-USD including cache lanes', () => {
  const catalog = new ModelCatalog();
  assert.equal(
    catalog.calculateUsageCost({
      cacheWriteTokens: 100,
      cachedInputTokens: 400,
      inputTokens: 1_000,
      model: 'gpt-5.6-luna',
      outputTokens: 200,
    }),
    373,
  );
  assert.throws(
    () =>
      catalog.calculateUsageCost({
        cacheWriteTokens: 700,
        cachedInputTokens: 400,
        inputTokens: 1_000,
        model: 'gpt-5.6-luna',
        outputTokens: 0,
      }),
    /cannot exceed input tokens/,
  );
});

test('reservation estimation prices output caps and current images conservatively', () => {
  const estimate = new ModelCatalog().estimateResponsesReservation({
    input: [
      {
        output: [{ type: 'input_image', image_url: 'data:image/jpeg;base64,aA==' }],
        type: 'function_call_output',
      },
    ],
    instructions: 'stable',
    max_output_tokens: 2_000,
    model: 'gpt-5.6-luna',
    tools: [],
  });
  assert.equal(estimate.imageCount, 1);
  assert(estimate.inputTokens >= 20_000);
  assert(estimate.microUsd > 2_400);
});
