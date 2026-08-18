import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { TaskSnapshot } from '../../shared/contracts';

import { canTransition, transitionTask } from './goal-machine';

function createIdleTask(): TaskSnapshot {
  const timestamp = new Date().toISOString();
  return {
    taskId: randomUUID(),
    request: 'Open YouTube',
    phase: 'idle',
    goal: null,
    messages: [],
    pendingInteraction: null,
    approvalGrant: null,
    progress: null,
    queuedSteering: [],
    runtimeResume: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastEvent: null,
  };
}

describe('goal lifecycle', () => {
  it('supports the normal interpret and ready sequence', () => {
    const interpreting = transitionTask(createIdleTask(), 'interpreting', {
      summary: 'Interpreting request.',
    });
    const ready = transitionTask(interpreting, 'ready', {
      summary: 'Goal ready.',
    });

    expect(ready.phase).toBe('ready');
    expect(ready.lastEvent?.summary).toBe('Goal ready.');
  });

  it('rejects transitions that bypass policy and planning', () => {
    expect(() =>
      transitionTask(createIdleTask(), 'acting', {
        summary: 'Unsafe direct action.',
      }),
    ).toThrow('Invalid task transition');
  });

  it('keeps terminal states terminal', () => {
    expect(canTransition('completed', 'planning')).toBe(false);
    expect(canTransition('failed', 'observing')).toBe(false);
    expect(canTransition('cancelled', 'acting')).toBe(false);
  });

  it('allows a running task to ask for input and resume the same model turn', () => {
    expect(canTransition('planning', 'awaiting_input')).toBe(true);
    expect(canTransition('observing', 'awaiting_input')).toBe(true);
    expect(canTransition('acting', 'awaiting_input')).toBe(true);
    expect(canTransition('awaiting_input', 'planning')).toBe(true);
    expect(canTransition('awaiting_input', 'acting')).toBe(false);
  });

  it('resumes planning after an approval decision before optional re-observation', () => {
    expect(canTransition('observing', 'awaiting_approval')).toBe(true);
    expect(canTransition('awaiting_approval', 'planning')).toBe(true);
    expect(canTransition('awaiting_approval', 'acting')).toBe(true);
  });
});
