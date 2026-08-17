import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { OpenAIResponsesGateway } from './openai-responses-gateway';

describe('OpenAIResponsesGateway', () => {
  it('parses sanitized usage details and sends bounded request metadata', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'response-1',
          model: 'gpt-5.6-luna',
          output: [
            {
              content: [{ text: 'Done.', type: 'output_text' }],
              role: 'assistant',
              type: 'message',
            },
          ],
          usage: {
            input_tokens: 100,
            input_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 },
            output_tokens: 20,
            output_tokens_details: { reasoning_tokens: 5 },
          },
        }),
        { status: 200 },
      ),
    );
    const requestId = randomUUID();
    const result = await new OpenAIResponsesGateway(fetchImpl).call({
      credential: 'credential',
      imageCount: 0,
      input: [],
      instructions: 'Stable instructions',
      profile: {
        id: 'standard',
        maxOutputTokens: 2_000,
        model: 'gpt-5.6-luna',
        reasoningEffort: 'low',
        verbosity: 'low',
      },
      requestId,
      responsesUrl: 'https://api.example.test/v1/responses',
      sampleOrdinal: 1,
      taskId: randomUUID(),
      tools: [],
    });
    expect(result.metadata.usage).toMatchObject({
      cachedInputTokens: 60,
      cacheWriteTokens: 10,
      reasoningTokens: 5,
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      'X-Trocode-Request-Id': requestId,
    });
  });

  it('marks timeouts and 5xx responses ambiguous without retrying', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Unavailable' } }), {
        status: 503,
      }),
    );
    const gateway = new OpenAIResponsesGateway(fetchImpl);
    await expect(
      gateway.call({
        credential: 'credential',
        imageCount: 0,
        input: [],
        instructions: 'Stable',
        profile: {
          id: 'standard',
          maxOutputTokens: 2_000,
          model: 'gpt-5.6-luna',
          reasoningEffort: 'low',
          verbosity: 'low',
        },
        requestId: randomUUID(),
        responsesUrl: 'https://api.example.test/v1/responses',
        sampleOrdinal: 1,
        taskId: randomUUID(),
        tools: [],
      }),
    ).rejects.toMatchObject({ disposition: 'ambiguous', status: 503 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
