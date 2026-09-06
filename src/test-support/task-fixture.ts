import type { TaskSnapshot } from '../shared/contracts';

export function taskFixture(
  overrides: Partial<TaskSnapshot> = {},
): TaskSnapshot {
  return {
    createdAt: '2026-09-06T01:00:00.000Z',
    updatedAt: '2026-09-06T01:01:00.000Z',
    goal: null,
    lastEvent: null,
    messages: [],
    pendingInteraction: null,
    phase: 'acting',
    progress: null,
    queuedSteering: [],
    request: 'Test task',
    runtimeResume: null,
    taskId: '11111111-1111-4111-8111-111111111111',
    ...overrides,
  };
}
