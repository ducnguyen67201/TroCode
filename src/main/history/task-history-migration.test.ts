import { describe, expect, it } from 'vitest';

import { HOST_ALWAYS_CONFIRM_ACTIONS } from '../../shared/contracts';

import { migratePersistedTaskSnapshot } from './task-history-migration';

const taskId = '11111111-1111-4111-8111-111111111111';
const contractId = '22222222-2222-4222-8222-222222222222';
const timestamp = '2026-08-16T06:00:00.000Z';

function snapshot(goal: unknown, runtimeResume: unknown = null): unknown {
  return {
    approvalGrant: null,
    createdAt: timestamp,
    goal,
    lastEvent: null,
    messages: [],
    pendingInteraction: null,
    phase: 'completed',
    progress: null,
    queuedSteering: [],
    request: 'Complete the saved task',
    runtimeResume,
    taskId,
    updatedAt: timestamp,
  };
}

const approvalPolicy = {
  alwaysConfirm: [...HOST_ALWAYS_CONFIRM_ACTIONS],
};

describe('migratePersistedTaskSnapshot', () => {
  it.each([
    {
      goal: {
        approvalPolicy,
        behavior: 'act',
        id: contractId,
        limits: { maxMinutes: 6, maxSteps: 12 },
        objective: 'Complete the saved task',
        originalRequest: 'Complete the saved task',
        schemaVersion: 2,
        successCriteria: [{ description: 'Done', verifier: 'Observe completion' }],
      },
      label: 'V2',
      limits: {
        maxMinutes: 6,
        maxSteps: 12,
      },
    },
    {
      goal: {
        approvalPolicy,
        id: contractId,
        limits: { maxMinutes: 7, maxToolCalls: 13 },
        originalRequest: 'Complete the saved task',
        schemaVersion: 3,
      },
      label: 'V3',
      limits: {
        maxMinutes: 7,
        maxToolCalls: 13,
      },
    },
    {
      goal: {
        approvalPolicy,
        id: contractId,
        limits: {
          maxImages: 8,
          maxMicroUsd: 90_000,
          maxMinutes: 8,
          maxModelSamples: 14,
          maxToolCalls: 9,
        },
        originalRequest: 'Complete the saved task',
        schemaVersion: 4,
      },
      label: 'V4',
      limits: {
        maxImages: 8,
        maxMicroUsd: 90_000,
        maxMinutes: 8,
        maxModelSamples: 14,
        maxToolCalls: 9,
      },
    },
  ])('keeps supported $label goals historical and non-executable', ({ goal, limits }) => {
    const result = migratePersistedTaskSnapshot(snapshot(goal));

    expect(result.changed).toBe(false);
    expect(result.snapshot.goal).toMatchObject({
      limits,
      schemaVersion: goal.schemaVersion,
    });
    expect(result.snapshot.runtimeResume).toBeNull();
  });

  it('repairs transitional V5 goals that predate runtime fields', () => {
    const result = migratePersistedTaskSnapshot(snapshot({
      approvalPolicy,
      id: contractId,
      limits: {
        maxImages: 8,
        maxMicroUsd: 90_000,
        maxMinutes: 8,
        maxModelSamples: 14,
        maxToolCalls: 9,
      },
      originalRequest: 'Complete the saved task',
      schemaVersion: 5,
    }));

    expect(result.snapshot.goal).toMatchObject({
      autonomyMode: 'balanced',
      executionProfile: 'everyday',
      runtimeKind: 'openai_agents',
      schemaVersion: 6,
      activity: null,
      workspace: null,
    });
  });

  it('moves a persisted Codex Workspace snapshot onto the backend SDK runtime', () => {
    const workspace = {
      canonicalPath: '/tmp/workspace',
      displayName: 'workspace',
      selectedAt: timestamp,
      selectionId: '33333333-3333-4333-8333-333333333333',
    };
    const current = snapshot({
      approvalPolicy,
      autonomyMode: 'strict',
      executionProfile: 'workspace',
      id: contractId,
      limits: {
        maxImages: 8,
        maxMicroUsd: 90_000,
        maxMinutes: 8,
        maxModelSamples: 14,
        maxToolCalls: 9,
      },
      originalRequest: 'Complete the saved task',
      runtimeKind: 'codex_app_server',
      schemaVersion: 5,
      workspace,
    }, {
      kind: 'codex_app_server',
      runtimeVersion: '0.146.0',
      threadId: 'current-thread',
      workspaceSelectionId: workspace.selectionId,
    });

    const result = migratePersistedTaskSnapshot(current);

    expect(result.changed).toBe(true);
    expect(result.snapshot.goal).toMatchObject({
      activity: null,
      executionProfile: 'workspace',
      runtimeKind: 'openai_agents',
      schemaVersion: 6,
      workspace,
    });
    expect(result.snapshot.runtimeResume).toBeNull();
  });

  it('rejects unknown contracts instead of inventing executable intent', () => {
    expect(() => migratePersistedTaskSnapshot(snapshot({
      id: contractId,
      originalRequest: 'Complete the saved task',
      schemaVersion: 99,
    }))).toThrow();
  });
});
