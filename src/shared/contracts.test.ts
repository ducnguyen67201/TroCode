import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  AgentTaskContractV3Schema,
  TaskHistorySchema,
  TaskProgressSchema,
} from './contracts';

function snapshot(goal: Record<string, unknown>, progress: unknown) {
  const taskId = randomUUID();
  const timestamp = '2026-08-17T00:00:00.000Z';
  return {
    taskId,
    request: String(goal.originalRequest),
    phase: 'completed',
    goal,
    messages: [],
    pendingInteraction: null,
    approvalGrant: null,
    progress,
    queuedSteering: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    lastEvent: null,
  };
}

const legacyBase = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  originalRequest: 'Open Gmail for me',
  behavior: 'act',
  objective: 'Open Gmail',
  successCriteria: [{ description: 'Gmail opens', verifier: 'Observe Gmail' }],
  limits: { maxSteps: 12, maxMinutes: 10 },
};

describe('shared task contracts', () => {
  it('parses v3 contract and tool-call progress', () => {
    expect(
      AgentTaskContractV3Schema.parse({
        schemaVersion: 3,
        id: randomUUID(),
        originalRequest: 'Write a chord progression.',
        approvalPolicy: { alwaysConfirm: ['send', 'delete'] },
        limits: { maxToolCalls: 30, maxMinutes: 10 },
      }),
    ).not.toHaveProperty('behavior');
    expect(
      TaskProgressSchema.parse({ kind: 'tool_calls', completed: 2, limit: 30 }),
    ).toEqual({ kind: 'tool_calls', completed: 2, limit: 30 });
  });

  it('loads mixed persisted v1, v2, and v3 history', () => {
    const history = TaskHistorySchema.parse({
      events: [],
      persistence: { mode: 'postgres', summary: 'Saved.' },
      snapshots: [
        snapshot(
          {
            ...legacyBase,
            interactionMode: 'mixed',
            capabilities: ['browser'],
            approvals: { alwaysConfirm: ['send'] },
          },
          { currentStep: 1, maxSteps: 12 },
        ),
        snapshot(
          {
            ...legacyBase,
            schemaVersion: 2,
            approvalPolicy: { alwaysConfirm: ['send'] },
          },
          { currentStep: 2, maxSteps: 12 },
        ),
        snapshot(
          {
            schemaVersion: 3,
            id: randomUUID(),
            originalRequest: 'What is 27 × 14?',
            approvalPolicy: { alwaysConfirm: ['send'] },
            limits: { maxToolCalls: 30, maxMinutes: 10 },
          },
          { kind: 'tool_calls', completed: 0, limit: 30 },
        ),
      ],
    });

    expect(history.snapshots.map((item) => item.goal?.schemaVersion)).toEqual([
      2, 2, 3,
    ]);
  });
});
