import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { OpenAIAgentsRuntime } from './openai-agents-runtime';
import { createTaskContract } from './task-contract';

function rejectedProviderResponse(): Response {
  return new Response(
    JSON.stringify({ error: { message: 'Rejected before inference.' } }),
    { headers: { 'Content-Type': 'application/json' }, status: 400 },
  );
}

const TEST_CLIENT_TURN_ID = '11111111-1111-4111-8111-111111111111';
const TEST_AGENT_TURN_ID = '22222222-2222-4222-8222-222222222222';

async function hostedRejectedProviderResponse(
  url: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (String(url).endsWith('/v1/agent-turns')) {
    const body = JSON.parse(String(init?.body)) as {
      clientTurnId: string;
      taskId: string;
    };
    return new Response(
      JSON.stringify({
        ...body,
        id: TEST_AGENT_TURN_ID,
      }),
      { headers: { 'Content-Type': 'application/json' }, status: 201 },
    );
  }
  return rejectedProviderResponse();
}

function modelRequest(fetchImpl: ReturnType<typeof vi.fn>) {
  return fetchImpl.mock.calls.find(([url]) =>
    String(url).endsWith('/v1/openai/responses'),
  );
}

describe('OpenAIAgentsRuntime', () => {
  it('uses the hosted Responses stream with one SDK-owned request and no retries', async () => {
    const fetchImpl = vi.fn<typeof fetch>(hostedRejectedProviderResponse);
    const accessTokenProvider = vi.fn(async () => 'hosted-access-token');
    const runtime = new OpenAIAgentsRuntime({
      accessTokenProvider,
      apiBaseUrl: 'https://api.trocode.test/',
      fetchImpl,
    });
    const taskId = randomUUID();

    await expect(
      runtime.runTask({
        callbacks: {
          billableUserTurnIds: () => [TEST_CLIENT_TURN_ID],
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
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, request] = modelRequest(fetchImpl) ?? [];
    expect(String(url)).toBe('https://api.trocode.test/v1/openai/responses');
    const headers = new Headers(request?.headers);
    expect(headers.get('authorization')).toBe('Bearer hosted-access-token');
    expect(headers.get('x-trocode-task-id')).toBe(taskId);
    expect(headers.get('x-trocode-agent-turn-id')).toBe(TEST_AGENT_TURN_ID);
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

  it('fails before dispatch when the hosted TroCode service is not configured', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const runtime = new OpenAIAgentsRuntime({
      accessTokenProvider: vi.fn(async () => 'unused-token'),
      apiBaseUrl: '',
      fetchImpl,
    });

    await expect(
      runtime.runTask({
        callbacks: {
          billableUserTurnIds: () => [TEST_CLIENT_TURN_ID],
          beforeModel: () => [],
          executeTool: async () => 'unused',
        },
        contract: createTaskContract('Answer directly.'),
        maxTurns: 4,
        request: 'Answer directly.',
        taskId: randomUUID(),
        tools: [],
      }),
    ).rejects.toThrow('TroCode model service is not configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('activates strict visible walkthrough instructions only for explicit tutoring intent', async () => {
    const fetchImpl = vi.fn<typeof fetch>(hostedRejectedProviderResponse);
    const runtime = new OpenAIAgentsRuntime({
      accessTokenProvider: vi.fn(async () => 'hosted-access-token'),
      apiBaseUrl: 'https://api.trocode.test/',
      fetchImpl,
    });
    const taskId = randomUUID();

    await expect(
      runtime.runTask({
        callbacks: {
          billableUserTurnIds: () => [TEST_CLIENT_TURN_ID],
          beforeModel: () => [],
          executeTool: async () => 'unused',
        },
        contract: createTaskContract('Guide me through this exercise.'),
        maxTurns: 4,
        request: 'Guide me through this exercise.',
        taskId,
        tools: [],
      }),
    ).rejects.toThrow('Rejected before inference');

    const [, request] = modelRequest(fetchImpl) ?? [];
    const body = JSON.parse(String(request?.body)) as { instructions: string };
    expect(body.instructions).toContain(
      'Trusted host walkthrough mode is active.',
    );
    expect(body.instructions).toContain(
      'Start each visible step with a fresh observe_desktop call',
    );
    expect(body.instructions).toContain(
      'Never provide an upfront answer dump',
    );
    await runtime.end(taskId);
  });

  it('keeps ordinary explanations on the direct-answer instruction path', async () => {
    const fetchImpl = vi.fn<typeof fetch>(hostedRejectedProviderResponse);
    const runtime = new OpenAIAgentsRuntime({
      accessTokenProvider: vi.fn(async () => 'hosted-access-token'),
      apiBaseUrl: 'https://api.trocode.test/',
      fetchImpl,
    });
    const taskId = randomUUID();

    await expect(
      runtime.runTask({
        callbacks: {
          billableUserTurnIds: () => [TEST_CLIENT_TURN_ID],
          beforeModel: () => [],
          executeTool: async () => 'unused',
        },
        contract: createTaskContract('Explain this exercise.'),
        maxTurns: 4,
        request: 'Explain this exercise.',
        taskId,
        tools: [],
      }),
    ).rejects.toThrow('Rejected before inference');

    const [, request] = modelRequest(fetchImpl) ?? [];
    const body = JSON.parse(String(request?.body)) as { instructions: string };
    expect(body.instructions).not.toContain(
      'Trusted host walkthrough mode is active.',
    );
    await runtime.end(taskId);
  });

  it('sends Workspace turns through the hosted SDK path with local shell and patch tools', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'trocode-runtime-'));
    const fetchImpl = vi.fn<typeof fetch>(hostedRejectedProviderResponse);
    const runtime = new OpenAIAgentsRuntime({
      accessTokenProvider: vi.fn(async () => 'hosted-access-token'),
      apiBaseUrl: 'https://api.trocode.test/',
      fetchImpl,
    });
    const taskId = randomUUID();
    try {
      await expect(
        runtime.runTask({
          callbacks: {
            billableUserTurnIds: () => [TEST_CLIENT_TURN_ID],
            beforeModel: () => [],
            executeTool: async () => 'unused',
            requestApproval: async () => false,
          },
          contract: createTaskContract('Fix the tests.', {
            executionProfile: 'workspace',
            workspace: {
              selectionId: randomUUID(),
              canonicalPath: root,
              displayName: path.basename(root),
              selectedAt: '2026-08-18T00:00:00.000Z',
            },
          }),
          maxTurns: 4,
          request: 'Fix the tests.',
          taskId,
          tools: [],
        }),
      ).rejects.toThrow('Rejected before inference');

      const [, request] = modelRequest(fetchImpl) ?? [];
      const body = JSON.parse(String(request?.body)) as {
        instructions: string;
        tools: Array<{ type: string }>;
      };
      expect(body.instructions).toContain(root);
      expect(body.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'shell' }),
          expect.objectContaining({ type: 'apply_patch' }),
        ]),
      );
    } finally {
      await runtime.end(taskId);
      await rm(root, { force: true, recursive: true });
    }
  });
});
