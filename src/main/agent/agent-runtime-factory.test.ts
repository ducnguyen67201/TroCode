import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntime } from './agent-runtime';
import { AgentRuntimeFactory } from './agent-runtime-factory';
import { createTaskContract } from './task-contract';

function runtime(kind: AgentRuntime['kind']): AgentRuntime {
  return {
    kind,
    continueTask: vi.fn(),
    end: vi.fn(),
    runTask: vi.fn(),
  };
}

describe('AgentRuntimeFactory', () => {
  it('routes only from the host-compiled contract', () => {
    const openai = runtime('openai_agents');
    const codex = runtime('codex_app_server');
    const factory = new AgentRuntimeFactory({
      codexAppServer: codex,
      openaiAgents: openai,
    });
    const workspace = {
      selectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      canonicalPath: '/tmp/project',
      displayName: 'project',
      selectedAt: '2026-08-18T00:00:00.000Z',
    };

    expect(factory.forContract(createTaskContract('Answer me.'))).toBe(openai);
    expect(
      factory.forContract(
        createTaskContract('Fix tests.', {
          executionProfile: 'workspace',
          workspace,
        }),
      ),
    ).toBe(codex);
  });

  it('fails closed when a selected runtime is unavailable', () => {
    const factory = new AgentRuntimeFactory({
      openaiAgents: runtime('openai_agents'),
    });
    expect(() =>
      factory.forContract(
        createTaskContract('Fix tests.', {
          executionProfile: 'workspace',
          workspace: {
            selectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            canonicalPath: '/tmp/project',
            displayName: 'project',
            selectedAt: '2026-08-18T00:00:00.000Z',
          },
        }),
      ),
    ).toThrow('not available');
  });
});
