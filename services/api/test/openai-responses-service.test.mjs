import assert from 'node:assert/strict';
import test from 'node:test';

import { ModelCatalog } from '../src/model-catalog.mjs';
import {
  OpenAiResponsesService,
  parseProviderUsage,
} from '../src/openai-responses-service.mjs';

test('provider usage parser rejects negative/missing usage and preserves known details', () => {
  assert.equal(parseProviderUsage({ output: [] }, 'gpt-5.6-luna'), null);
  assert.deepEqual(
    parseProviderUsage(
      {
        id: 'response-1',
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 50, cache_write_tokens: 10 },
          output_tokens: 20,
          output_tokens_details: { reasoning_tokens: 5 },
        },
      },
      'gpt-5.6-luna',
    ),
    {
      cacheWriteTokens: 10,
      cachedInputTokens: 50,
      inputTokens: 100,
      model: 'gpt-5.6-luna',
      outputTokens: 20,
      reasoningTokens: 5,
      responseId: 'response-1',
      source: 'actual',
    },
  );
  assert.throws(
    () =>
      parseProviderUsage(
        { usage: { input_tokens: -1, output_tokens: 0 } },
        'gpt-5.6-luna',
      ),
    /nonnegative/,
  );
});

test('responses service reserves before dispatch and settles actual provider usage', async () => {
  const calls = [];
  const budgetService = {
    reserve: async () => calls.push('reserve'),
    markDispatched: async () => calls.push('dispatch'),
    settle: async () => calls.push('settle'),
    markUncertain: async () => calls.push('uncertain'),
    release: async () => calls.push('release'),
  };
  const service = new OpenAiResponsesService({
    budgetService,
    catalog: new ModelCatalog(),
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          id: 'response-1',
          output: [],
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
        { status: 200 },
      ),
    openAiApiKey: 'secret',
  });
  const result = await service.execute({
    body: {
      input: [],
      instructions: 'stable',
      max_output_tokens: 2_000,
      model: 'gpt-5.6-luna',
      tools: [],
    },
    requestId: '11111111-1111-4111-8111-111111111112',
    safetyIdentifier: 'safe',
    taskId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
  });
  assert.deepEqual(calls, ['reserve', 'dispatch', 'settle']);
  assert.equal(result.headers['X-Trocode-Usage-Source'], 'actual');
});
