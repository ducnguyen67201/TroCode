import { describe, expect, it } from 'vitest';

import type { TaskEvent, TaskSnapshot } from '../shared/contracts';

import { createInsightsSummary, createLearningFocus } from './insights';

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
    outcomes: overrides.outcomes ?? null,
    pendingInteraction: null,
    progress: null,
    queuedSteering: [],
    request: 'Complete a useful task',
    updatedAt: now,
    ...overrides,
    runtimeResume: overrides.runtimeResume ?? null,
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
    expect(summary.toolUsage).toEqual([]);
    expect(summary.legacyBehaviorUsage).toEqual([]);
    expect(summary.activityDays).toHaveLength(42);
  });

  it('deduplicates activity and summarizes completed tasks', () => {
    const completedTask = createSnapshot({
      taskId: '11111111-1111-4111-8111-111111111111',
      phase: 'completed',
      progress: { currentStep: 3, maxSteps: 12 },
      goal: {
        schemaVersion: 2,
        behavior: 'act',
        approvalPolicy: { alwaysConfirm: ['send'] },
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
        schemaVersion: 2,
        behavior: 'act',
        approvalPolicy: { alwaysConfirm: [] },
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
    expect(summary.legacyBehaviorUsage).toEqual([
      { behavior: 'act', count: 2, percentage: 100 },
    ]);
    expect(summary.toolUsage).toEqual([]);
    expect(summary.currentStreak).toBe(1);
  });

  it('summarizes v3 tool-call progress and trusted tool event IDs', () => {
    const task = createSnapshot({
      taskId: '11111111-1111-4111-8111-111111111111',
      phase: 'completed',
      progress: { kind: 'tool_calls', completed: 2, limit: 30 },
      goal: {
        schemaVersion: 3,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        originalRequest: 'Open Gmail.',
        approvalPolicy: { alwaysConfirm: ['send'] },
        limits: { maxMinutes: 10, maxToolCalls: 30 },
      },
    });
    const event = createEvent({
      eventId: '33333333-3333-4333-8333-333333333333',
      taskId: task.taskId,
      phase: 'verifying',
      tool: { toolId: 'desktop.observe', operation: 'observe' },
    });

    const summary = createInsightsSummary([task], [event]);
    expect(summary.stepsObserved).toBe(2);
    expect(summary.toolUsage).toEqual([
      { toolId: 'desktop.observe', count: 1, percentage: 100 },
    ]);
    expect(summary.legacyBehaviorUsage).toEqual([]);
  });
});

describe('createLearningFocus', () => {
  it('does not invent a learning challenge without academic evidence', () => {
    const task = createSnapshot({
      phase: 'failed',
      request: 'Open the calendar and schedule a meeting',
      taskId: '11111111-1111-4111-8111-111111111111',
    });

    expect(createLearningFocus([task])).toBeNull();
  });

  it('does not treat an operational task failure as student difficulty', () => {
    const task = createSnapshot({
      phase: 'failed',
      request: 'Submit my math assignment',
      taskId: '11111111-1111-4111-8111-111111111111',
    });

    expect(createLearningFocus([task])).toBeNull();
  });

  it('turns an academic help request into a practical learning focus', () => {
    const task = createSnapshot({
      phase: 'completed',
      request: 'Help me understand quadratic equations for my math assignment',
      taskId: '11111111-1111-4111-8111-111111111111',
    });

    expect(createLearningFocus([task])).toEqual({
      recommendation:
        'Work through one smaller example step by step, explain why each operation is valid, then retry the assignment problem.',
      topic: 'Help me understand quadratic equations for my math assignment',
    });
  });

  it('recognizes a learning task that needed multiple support turns', () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    const task = createSnapshot({
      messages: [
        {
          kind: 'clarification',
          messageId: '22222222-2222-4222-8222-222222222222',
          role: 'assistant',
          taskId,
          text: 'Which part of the essay is unclear?',
          timestamp: '2026-08-15T08:01:00.000Z',
        },
        {
          kind: 'answer',
          messageId: '33333333-3333-4333-8333-333333333333',
          role: 'user',
          taskId,
          text: 'I need to make the evidence support the thesis.',
          timestamp: '2026-08-15T08:02:00.000Z',
        },
      ],
      phase: 'completed',
      request: 'Review my literature essay',
      taskId,
    });

    expect(createLearningFocus([task])?.recommendation).toBe(
      'Outline the claim, evidence, and explanation first; draft one paragraph, then revise it with feedback.',
    );
  });

  it('keeps the displayed task topic concise', () => {
    const task = createSnapshot({
      phase: 'blocked',
      request: `Help me with my chemistry assignment about ${'covalent bonding '.repeat(15)}`,
      taskId: '11111111-1111-4111-8111-111111111111',
    });

    const focus = createLearningFocus([task]);
    expect(focus?.topic.endsWith('…')).toBe(true);
    expect(focus?.topic.length).toBeLessThanOrEqual(140);
  });
});
