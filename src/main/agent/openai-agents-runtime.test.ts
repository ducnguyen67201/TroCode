import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { OpenAIAgentsRuntime } from './openai-agents-runtime';
import { createTaskContract } from './task-contract';

function rejectedProviderResponse(): Response {
  return new Response(
    JSON.stringify({ error: { message: 'Rejected before inference.' } }),
    { headers: { 'Content-Type': 'application/json' }, status: 400 },
  );
}

describe('OpenAIAgentsRuntime', () => {
  it('uses the hosted Responses stream with one SDK-owned request and no retries', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => rejectedProviderResponse());
    const accessTokenProvider = vi.fn(async () => 'hosted-access-token');
    const readLocalCredential = vi.fn(async () => null);
    const runtime = new OpenAIAgentsRuntime({
      accessTokenProvider,
      apiBaseUrl: 'https://api.trocode.test/',
      credentialStore: { read: readLocalCredential },
      fetchImpl,
    });
    const taskId = randomUUID();

    await expect(
      runtime.runTask({
        callbacks: {
          beforeModel: () => [],
          executeTool: async () => 'unused',
        },
        contract: createTaskContract('Answer directly.'),
        maxTurns: 4,
        request: 'Answer directly.',
        taskId,
        tools: [
          {
            type: 'function',
            name: 'echo',
            description: 'Echo one value.',
            strict: true,
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: { value: { type: 'string' } },
              required: ['value'],
            },
          },
        ],
      }),
    ).rejects.toThrow('Rejected before inference');

    expect(accessTokenProvider).toHaveBeenCalledOnce();
    expect(readLocalCredential).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, request] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.trocode.test/v1/openai/responses');
    const headers = new Headers(request?.headers);
    expect(headers.get('authorization')).toBe('Bearer hosted-access-token');
    expect(headers.get('x-trocode-task-id')).toBe(taskId);
    expect(headers.get('x-trocode-request-id')).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      max_output_tokens: 4_000,
      model: 'gpt-5.6-luna',
      parallel_tool_calls: false,
      store: false,
      stream: true,
    });
    await runtime.end(taskId);
  });

  it('fails before dispatch when neither hosted auth nor an API key is available', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const runtime = new OpenAIAgentsRuntime({
      credentialStore: { read: vi.fn(async () => null) },
      environmentApiKey: '',
      fetchImpl,
    });

    await expect(
      runtime.runTask({
        callbacks: {
          beforeModel: () => [],
          executeTool: async () => 'unused',
        },
        contract: createTaskContract('Answer directly.'),
        maxTurns: 4,
        request: 'Answer directly.',
        taskId: randomUUID(),
        tools: [],
      }),
    ).rejects.toThrow('Connect an OpenAI API key');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
