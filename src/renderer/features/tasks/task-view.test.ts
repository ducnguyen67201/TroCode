import { describe, expect, it } from 'vitest';

import type { TaskSnapshot } from '../../../shared/contracts';

import { taskView } from './task-view';

const snapshot: TaskSnapshot = {
  taskId: 'task',
  request: 'Help',
  phase: 'acting',
  goal: null,
  messages: [],
  pendingInteraction: null,
  progress: null,
  queuedSteering: [],
  runtimeResume: null,
  createdAt: '2026-09-06T00:00:00Z',
  updatedAt: '2026-09-06T00:00:00Z',
  lastEvent: null,
};

describe('task view projection', () => {
  it('presents an empty workspace without a live task', () => {
    const view = taskView(null, 'en');
    expect(view.hero.state).toBe('empty');
    expect(view.hasLiveTask).toBe(false);
    expect(view.taskPhase).toBe('No active task');
  });

  it('prioritizes clarification above a running task', () => {
    const interaction = {
      id: 'question',
      taskId: 'task',
      prompt: 'Which file?',
      createdAt: snapshot.createdAt,
      kind: 'clarification' as const,
    };
    const view = taskView(
      { ...snapshot, pendingInteraction: interaction },
      'en',
    );
    expect(view.hero.state).toBe('interaction');
    expect(view.pendingClarification).toEqual(interaction);
  });

  it('distinguishes active and terminal task presentation', () => {
    expect(taskView(snapshot, 'en').hero.state).toBe('active');
    const view = taskView({ ...snapshot, phase: 'completed' }, 'en');
    expect(view.hero.state).toBe('terminal');
    expect(view.hasLiveTask).toBe(false);
  });
});
