import { describe, expect, it, vi } from 'vitest';

import type {
  TaskEvent,
  TaskHistory,
  TaskSnapshot,
  TaskUpdate,
} from '../../shared/contracts';

import { TaskHistoryService } from './task-history-service';
import type { TaskHistoryStore } from './task-history-store';

const taskId = '11111111-1111-4111-8111-111111111111';
const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const timestamp = '2026-08-16T06:00:00.000Z';

function createUpdate(): TaskUpdate {
  const event: TaskEvent = {
    artifacts: [],
    eventId,
    nextActions: [],
    phase: 'completed',
    status: 'success',
    summary: 'Task completed.',
    taskId,
    timestamp,
  };
  const snapshot: TaskSnapshot = {
    approvalGrant: null,
    createdAt: '2026-08-16T05:00:00.000Z',
    goal: null,
    lastEvent: event,
    messages: [],
    outcomes: null,
    pendingInteraction: null,
    phase: 'completed',
    progress: null,
    queuedSteering: [],
    runtimeResume: null,
    request: 'Complete the task',
    taskId,
    updatedAt: timestamp,
  };
  return { event, snapshot };
}

const EMPTY_POSTGRES_HISTORY: TaskHistory = {
  events: [],
  persistence: {
    mode: 'postgres',
    summary: 'Task history is saved to PostgreSQL.',
  },
  snapshots: [],
};

function createStore(history: TaskHistory = EMPTY_POSTGRES_HISTORY) {
  return {
    close: vi.fn(async () => undefined),
    initialize: vi.fn(async () => undefined),
    load: vi.fn(async (): Promise<TaskHistory> => history),
    save: vi.fn(async () => undefined),
  } satisfies TaskHistoryStore;
}

describe('TaskHistoryService', () => {
  it('serializes validated updates for the current signed-in owner', async () => {
    const store = createStore();
    const service = new TaskHistoryService({ store });
    await service.start();
    service.setCurrentOwner('google-user-1');

    const update = createUpdate();
    service.recordTaskUpdate(update);
    await service.shutdown();

    expect(store.initialize).toHaveBeenCalledOnce();
    expect(store.save).toHaveBeenCalledWith('google-user-1', update);
    expect(store.close).toHaveBeenCalledOnce();
  });

  it('captures the owner at event time so sign-out cannot reassign a write', async () => {
    const store = createStore();
    const service = new TaskHistoryService({ store });
    await service.start();
    service.setCurrentOwner('first-user');
    service.recordTaskUpdate(createUpdate());
    service.setCurrentOwner('second-user');

    await service.load('second-user');

    expect(store.save).toHaveBeenCalledWith('first-user', expect.anything());
    expect(store.load).toHaveBeenCalledWith('second-user');
  });

  it('falls back to session-only history when PostgreSQL is not configured', async () => {
    const service = new TaskHistoryService({ store: null });

    await expect(service.load('google-user-1')).resolves.toMatchObject({
      events: [],
      persistence: { mode: 'session_only' },
      snapshots: [],
    });
  });

  it('does not let a failed write block later updates or shutdown', async () => {
    const onError = vi.fn();
    const store = createStore();
    store.save
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(undefined);
    const service = new TaskHistoryService({ onError, store });
    await service.start();
    service.setCurrentOwner('google-user-1');

    service.recordTaskUpdate(createUpdate());
    service.recordTaskUpdate({
      ...createUpdate(),
      event: {
        ...createUpdate().event,
        eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      snapshot: {
        ...createUpdate().snapshot,
        lastEvent: {
          ...createUpdate().event,
          eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      },
    });
    await service.shutdown();

    expect(store.save).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledOnce();
    expect(store.close).toHaveBeenCalledOnce();
  });
});
