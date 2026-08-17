import { describe, expect, it } from 'vitest';

import {
  TaskSnapshotSchema,
  type TaskEvent,
  type TaskSnapshot,
} from '../shared/contracts';

import { createHistoryEntries } from './history';

function createSnapshot(
  taskId: string,
  phase: TaskSnapshot['phase'],
  updatedAt: string,
): TaskSnapshot {
  return {
    approvalGrant: null,
    createdAt: '2026-08-16T01:00:00.000Z',
    goal: null,
    lastEvent: null,
    messages: [],
    pendingInteraction: null,
    phase,
    progress: null,
    queuedSteering: [],
    request: `Request ${taskId}`,
    taskId,
    updatedAt,
  };
}

function createEvent(
  eventId: string,
  taskId: string,
  timestamp: string,
): TaskEvent {
  return {
    artifacts: [],
    eventId,
    nextActions: [],
    phase: 'completed',
    status: 'success',
    summary: 'Task completed.',
    taskId,
    timestamp,
  };
}

function completedSnapshot(goal: unknown) {
  const timestamp = '2026-08-17T05:00:00.000Z';
  return TaskSnapshotSchema.parse({
    taskId: '11111111-1111-4111-8111-111111111111',
    request: 'Complete the task',
    phase: 'completed',
    goal,
    messages: [],
    pendingInteraction: null,
    approvalGrant: null,
    progress: { currentStep: 1, maxSteps: 12 },
    queuedSteering: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    lastEvent: null,
  });
}

describe('createHistoryEntries', () => {
  it('includes only terminal tasks and sorts the newest outcome first', () => {
    const older = createSnapshot(
      '11111111-1111-4111-8111-111111111111',
      'completed',
      '2026-08-16T02:00:00.000Z',
    );
    const active = createSnapshot(
      '22222222-2222-4222-8222-222222222222',
      'acting',
      '2026-08-16T04:00:00.000Z',
    );
    const newer = createSnapshot(
      '33333333-3333-4333-8333-333333333333',
      'failed',
      '2026-08-16T03:00:00.000Z',
    );

    const entries = createHistoryEntries([older, active, newer], []);

    expect(entries.map((entry) => entry.snapshot.taskId)).toEqual([
      newer.taskId,
      older.taskId,
    ]);
  });

  it('deduplicates task events and orders activity chronologically', () => {
    const snapshot = createSnapshot(
      '11111111-1111-4111-8111-111111111111',
      'cancelled',
      '2026-08-16T04:00:00.000Z',
    );
    const later = createEvent(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      snapshot.taskId,
      '2026-08-16T03:00:00.000Z',
    );
    const earlier = createEvent(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      snapshot.taskId,
      '2026-08-16T02:00:00.000Z',
    );

    const [entry] = createHistoryEntries(
      [snapshot, snapshot],
      [later, earlier, later],
    );

    expect(entry?.events.map((event) => event.eventId)).toEqual([
      earlier.eventId,
      later.eventId,
    ]);
  });
});

describe('task history view model', () => {
  it('shows v2 behavior without exposing a capability grant', () => {
    const snapshot = completedSnapshot({
      schemaVersion: 2,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      originalRequest: 'Create a beat in GarageBand',
      behavior: 'act',
      objective: 'Create a beat in GarageBand',
      successCriteria: [
        { description: 'A beat is playable', verifier: 'Observe playback' },
      ],
      approvalPolicy: { alwaysConfirm: ['write_file'] },
      limits: { maxMinutes: 10, maxSteps: 30 },
    });

    expect(createHistoryEntries([snapshot], [])).toMatchObject([
      { behavior: 'act', objective: 'Create a beat in GarageBand' },
    ]);
  });

  it('normalizes persisted v1 history into the same behavior view', () => {
    const snapshot = completedSnapshot({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      originalRequest: 'Research the subject for me',
      domain: 'research',
      interactionMode: 'mixed',
      objective: 'Research the subject',
      successCriteria: [
        { description: 'Return findings', verifier: 'Findings are present' },
      ],
      capabilities: ['browser', 'conversation'],
      scope: { allowedApps: [], allowedDomains: [], allowedPaths: [] },
      approvals: { alwaysConfirm: ['send'] },
      limits: { maxMinutes: 15, maxSteps: 12 },
    });

    expect(snapshot.goal).toMatchObject({ schemaVersion: 2, behavior: 'act' });
    expect(createHistoryEntries([snapshot], [])[0]).toMatchObject({
      behavior: 'act',
      objective: 'Research the subject',
    });
  });
});
