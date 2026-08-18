import assert from 'node:assert/strict';
import test from 'node:test';

import { ModelCatalog } from '../src/model-catalog.mjs';
import {
  OpenAiResponsesService,
  parseProviderUsage,
  parseStreamingProviderUsage,
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

test('streaming usage parser reads the completed Responses event', () => {
  const stream = [
    'event: response.output_text.delta',
    'data: {"type":"response.output_text.delta","delta":"Hi"}',
    '',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"id":"response-stream","model":"gpt-5.6-luna","usage":{"input_tokens":80,"output_tokens":12}}}',
    '',
    'data: [DONE]',
  ].join('\n');
  assert.deepEqual(parseStreamingProviderUsage(stream, 'gpt-5.6-luna'), {
    cacheWriteTokens: 0,
    cachedInputTokens: 0,
    inputTokens: 80,
    model: 'gpt-5.6-luna',
    outputTokens: 12,
    reasoningTokens: 0,
    responseId: 'response-stream',
    source: 'actual',
  });
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

test('responses service forwards SSE incrementally and settles completed usage', async () => {
  const calls = [];
  const budgetService = {
    reserve: async () => calls.push('reserve'),
    markDispatched: async () => calls.push('dispatch'),
    settle: async () => calls.push('settle'),
    markUncertain: async () => calls.push('uncertain'),
    release: async () => calls.push('release'),
  };
  const payload = [
    'event: response.output_text.delta',
    'data: {"type":"response.output_text.delta","delta":"Hi"}',
    '',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"id":"response-stream","model":"gpt-5.6-luna","usage":{"input_tokens":100,"output_tokens":20}}}',
    '',
  ].join('\n');
  const service = new OpenAiResponsesService({
    budgetService,
    catalog: new ModelCatalog(),
    fetchImpl: async () =>
      new Response(payload, {
        headers: { 'Content-Type': 'text/event-stream' },
        status: 200,
      }),
    openAiApiKey: 'secret',
  });
  const result = await service.executeStream({
    body: {
      input: [],
      instructions: 'stable',
      max_output_tokens: 2_000,
      model: 'gpt-5.6-luna',
      stream: true,
      tools: [],
    },
    requestId: '11111111-1111-4111-8111-111111111113',
    safetyIdentifier: 'safe',
    taskId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
  });
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk);

  assert.equal(Buffer.concat(chunks).toString('utf8'), payload);
  assert.deepEqual(calls, ['reserve', 'dispatch', 'settle']);
});

test('responses service marks malformed streamed usage uncertain without breaking delivered chunks', async () => {
  const calls = [];
  const budgetService = {
    reserve: async () => calls.push('reserve'),
    markDispatched: async () => calls.push('dispatch'),
    settle: async () => calls.push('settle'),
    markUncertain: async () => calls.push('uncertain'),
    release: async () => calls.push('release'),
  };
  const payload = [
    'event: response.output_text.delta',
    'data: {"type":"response.output_text.delta","delta":"Hi"}',
    '',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"id":"response-stream","model":"gpt-5.6-luna","usage":{"input_tokens":-1,"output_tokens":20}}}',
    '',
  ].join('\n');
  const service = new OpenAiResponsesService({
    budgetService,
    catalog: new ModelCatalog(),
    fetchImpl: async () =>
      new Response(payload, {
        headers: { 'Content-Type': 'text/event-stream' },
        status: 200,
      }),
    openAiApiKey: 'secret',
  });
  const result = await service.executeStream({
    body: {
      input: [],
      instructions: 'stable',
      max_output_tokens: 2_000,
      model: 'gpt-5.6-luna',
      stream: true,
      tools: [],
    },
    requestId: '11111111-1111-4111-8111-111111111114',
    safetyIdentifier: 'safe',
    taskId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
  });
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk);

  assert.equal(Buffer.concat(chunks).toString('utf8'), payload);
  assert.deepEqual(calls, ['reserve', 'dispatch', 'uncertain']);
});

test('stream cancellation marks dispatched usage uncertain and does not retry', async () => {
  const calls = [];
  let fetchCalls = 0;
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
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              Buffer.from(
                'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n',
              ),
            );
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' }, status: 200 },
      );
    },
    openAiApiKey: 'secret',
  });
  const result = await service.executeStream({
    body: {
      input: [],
      instructions: 'stable',
      max_output_tokens: 2_000,
      model: 'gpt-5.6-luna',
      stream: true,
      tools: [],
    },
    requestId: '11111111-1111-4111-8111-111111111115',
    safetyIdentifier: 'safe',
    taskId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
  });
  const iterator = result.stream[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.return();

  assert.equal(fetchCalls, 1);
  assert.deepEqual(calls, ['reserve', 'dispatch', 'uncertain']);
});

test('streaming pre-inference rejection releases while provider failure stays uncertain', async () => {
  for (const [status, expected] of [
    [400, 'release'],
    [500, 'uncertain'],
  ]) {
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
      fetchImpl: async () => new Response('{}', { status }),
      openAiApiKey: 'secret',
    });
    const result = await service.executeStream({
      body: {
        input: [],
        instructions: 'stable',
        max_output_tokens: 2_000,
        model: 'gpt-5.6-luna',
        stream: true,
        tools: [],
      },
      requestId: `11111111-1111-4111-8111-111111111${status}`,
      safetyIdentifier: 'safe',
      taskId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
    });

    assert.equal(result.status, status);
    assert.deepEqual(calls, ['reserve', 'dispatch', expected]);
  }
});

test('stream dispatch and content-type failures are uncertain and never retried', async () => {
  for (const failureKind of ['dispatch', 'content-type']) {
    const calls = [];
    let fetchCalls = 0;
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
      fetchImpl: async () => {
        fetchCalls += 1;
        if (failureKind === 'dispatch') throw new Error('timeout');
        return new Response('{}', {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      },
      openAiApiKey: 'secret',
    });

    await assert.rejects(
      service.executeStream({
        body: {
          input: [],
          instructions: 'stable',
          max_output_tokens: 2_000,
          model: 'gpt-5.6-luna',
          stream: true,
          tools: [],
        },
        requestId:
          failureKind === 'dispatch'
            ? '11111111-1111-4111-8111-111111111116'
            : '11111111-1111-4111-8111-111111111117',
        safetyIdentifier: 'safe',
        taskId: '11111111-1111-4111-8111-111111111111',
        userId: 'user-1',
      }),
    );

    assert.equal(fetchCalls, 1);
    assert.deepEqual(calls, ['reserve', 'dispatch', 'uncertain']);
  }
});
