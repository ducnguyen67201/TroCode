import { describe, expect, it } from 'vitest';

import type { TaskEvent, TaskSnapshot } from '../shared/contracts';

import { createInsightsSummary } from './insights';

function createSnapshot(
  overrides: Partial<TaskSnapshot> & Pick<TaskSnapshot, 'phase' | 'taskId'>,
): TaskSnapshot {
  const now = '2026-08-15T08:00:00.000Z';
  return {
    approvalGrant: null,
    createdAt: now,
    goal: null,
    lastEvent: null,
    messages: [],
    pendingInteraction: null,
    progress: null,
    queuedSteering: [],
    request: 'Complete a useful task',
    updatedAt: now,
    ...overrides,
  };
}

function createEvent(
  overrides: Partial<TaskEvent> & Pick<TaskEvent, 'eventId' | 'taskId'>,
): TaskEvent {
  return {
    artifacts: [],
    nextActions: [],
    phase: 'acting',
    status: 'success',
    summary: 'Observed a lifecycle transition.',
    timestamp: '2026-08-15T08:00:00.000Z',
    ...overrides,
  };
}

describe('createInsightsSummary', () => {
  it('returns an honest zero state', () => {
    const summary = createInsightsSummary(
      [],
      [],
      new Date('2026-08-15T12:00:00.000Z'),
    );

    expect(summary.taskCount).toBe(0);
    expect(summary.eventCount).toBe(0);
    expect(summary.completionRate).toBe(0);
    expect(summary.capabilityUsage).toEqual([]);
    expect(summary.activityDays).toHaveLength(42);
  });

  it('deduplicates activity and summarizes completed tasks', () => {
    const completedTask = createSnapshot({
      taskId: '11111111-1111-4111-8111-111111111111',
      phase: 'completed',
      progress: { currentStep: 3, maxSteps: 12 },
      goal: {
        approvals: { alwaysConfirm: ['send'] },
        capabilities: ['browser', 'conversation'],
        domain: 'research',
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        interactionMode: 'mixed',
        limits: { maxMinutes: 15, maxSteps: 12 },
        objective: 'Research the subject',
        originalRequest: 'Research the subject for me',
        scope: { allowedApps: [], allowedDomains: [], allowedPaths: [] },
        successCriteria: [
          { description: 'Return findings', verifier: 'Findings are present' },
        ],
      },
    });
    const failedTask = createSnapshot({
      taskId: '22222222-2222-4222-8222-222222222222',
      phase: 'failed',
      goal: {
        approvals: { alwaysConfirm: [] },
        capabilities: ['browser'],
        domain: 'general',
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        interactionMode: 'act',
        limits: { maxMinutes: 10, maxSteps: 6 },
        objective: 'Open a page',
        originalRequest: 'Open a page for me',
        scope: { allowedApps: [], allowedDomains: [], allowedPaths: [] },
        successCriteria: [
          { description: 'Page is open', verifier: 'Observe the page' },
        ],
      },
    });
    const event = createEvent({
      eventId: '33333333-3333-4333-8333-333333333333',
      taskId: completedTask.taskId,
    });

    const summary = createInsightsSummary(
      [completedTask, failedTask, completedTask],
      [event, event],
      new Date('2026-08-15T12:00:00.000Z'),
    );

    expect(summary.taskCount).toBe(2);
    expect(summary.finishedTasks).toBe(2);
    expect(summary.completedTasks).toBe(1);
    expect(summary.completionRate).toBe(50);
    expect(summary.eventCount).toBe(1);
    expect(summary.stepsObserved).toBe(3);
    expect(summary.capabilityUsage).toEqual([
      { capability: 'browser', count: 2, percentage: 100 },
      { capability: 'conversation', count: 1, percentage: 50 },
    ]);
    expect(summary.currentStreak).toBe(1);
  });
});
