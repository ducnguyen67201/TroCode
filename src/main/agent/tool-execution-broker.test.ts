import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RuntimeToolRegistry } from './runtime-tool-registry';
import { createTaskContract } from './task-contract';
import { ToolExecutionBroker } from './tool-execution-broker';

describe('ToolExecutionBroker', () => {
  it('previews policy without consuming the call ID and enforces the budget on resolve', () => {
    const registry = new RuntimeToolRegistry();
    const broker = new ToolExecutionBroker(registry);
    const call = {
      arguments: JSON.stringify({
        reason: 'Open the site.',
        url: 'https://example.com/',
      }),
      callId: 'call-1',
      name: 'open_url',
    };
    const taskId = randomUUID();
    const goal = createTaskContract('Open the site.');

    expect(broker.preview({ call, goal, taskId }).decision.status).toBe('allowed');
    expect(
      broker.resolve({
        call,
        completedToolCalls: 0,
        goal,
        maxToolCalls: 1,
        taskId,
      }).invocation.callId,
    ).toBe('call-1');
    expect(() =>
      broker.resolve({
        call: { ...call, callId: 'call-2' },
        completedToolCalls: 1,
        goal,
        maxToolCalls: 1,
        taskId,
      }),
    ).toThrow('tool-call limit');
  });

  it('suppresses an exact action after its outcome becomes unknown', () => {
    const broker = new ToolExecutionBroker();
    const taskId = randomUUID();
    const action = {
      action: 'send' as const,
      description: 'Send the exact email.',
      toolId: 'desktop.control' as const,
      operation: 'click',
    };
    broker.markUnknown(taskId, action);
    expect(broker.isUnknown(taskId, action)).toBe(true);
    broker.endTask(taskId);
    expect(broker.isUnknown(taskId, action)).toBe(false);
  });
});
