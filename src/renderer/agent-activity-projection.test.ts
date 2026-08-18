import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { AgentActivityUpdate } from '../shared/contracts';

import { acceptAgentActivity } from './agent-activity-projection';

function activity(taskId: string, sequence: number): AgentActivityUpdate {
  return {
    activityId: randomUUID(),
    kind: 'status',
    sequence,
    summary: 'Working.',
    taskId,
    timestamp: new Date().toISOString(),
  };
}

describe('acceptAgentActivity', () => {
  it('rejects cross-task and out-of-order activity', () => {
    const taskId = randomUUID();
    const sequences = new Map<string, number>();

    expect(acceptAgentActivity(activity(taskId, 0), null, sequences)).toBe(false);
    expect(acceptAgentActivity(activity(randomUUID(), 0), taskId, sequences)).toBe(
      false,
    );
    expect(acceptAgentActivity(activity(taskId, 1), taskId, sequences)).toBe(true);
    expect(acceptAgentActivity(activity(taskId, 1), taskId, sequences)).toBe(false);
    expect(acceptAgentActivity(activity(taskId, 0), taskId, sequences)).toBe(false);
    expect(acceptAgentActivity(activity(taskId, 2), taskId, sequences)).toBe(true);
  });
});
