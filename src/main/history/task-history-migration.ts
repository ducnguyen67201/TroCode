import { isDeepStrictEqual } from 'node:util';

import {
  AgentTaskContractV5Schema,
  AgentTaskContractV6Schema,
  AutonomyModeSchema,
  ExecutionProfileSchema,
  HOST_ALWAYS_CONFIRM_ACTIONS,
  TaskContractSchema,
  TaskSnapshotSchema,
  WorkspaceIdentitySchema,
  type AgentTaskContract,
  type GoalSpec,
  type TaskSnapshot,
} from '../../shared/contracts';

const V5_MIGRATION_DEFAULTS = Object.freeze({
  maxImages: 20,
  maxMicroUsd: 500_000,
  maxMinutes: 10,
  maxModelSamples: 40,
  maxToolCalls: 30,
});

export interface PersistedTaskSnapshotMigration {
  changed: boolean;
  snapshot: TaskSnapshot;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Persisted task contract must be an object.');
  }
  return value as Record<string, unknown>;
}

function numberField(
  value: unknown,
  fallback: number,
): number {
  return typeof value === 'number' ? value : fallback;
}

function currentApprovalPolicy() {
  return { alwaysConfirm: [...HOST_ALWAYS_CONFIRM_ACTIONS] };
}

function repairV5(value: unknown): AgentTaskContract {
  const goal = record(value);
  const limits = record(goal.limits);
  const workspace = goal.workspace === undefined
    ? null
    : WorkspaceIdentitySchema.nullable().parse(goal.workspace);
  const workspaceRuntime = workspace !== null;

  const v5 = AgentTaskContractV5Schema.parse({
    ...goal,
    approvalPolicy: goal.approvalPolicy ?? currentApprovalPolicy(),
    autonomyMode: AutonomyModeSchema.parse(goal.autonomyMode ?? 'balanced'),
    executionProfile: ExecutionProfileSchema.parse(
      goal.executionProfile ?? (workspaceRuntime ? 'workspace' : 'everyday'),
    ),
    limits: {
      maxImages: numberField(limits.maxImages, V5_MIGRATION_DEFAULTS.maxImages),
      maxMicroUsd: numberField(
        limits.maxMicroUsd,
        V5_MIGRATION_DEFAULTS.maxMicroUsd,
      ),
      maxMinutes: numberField(limits.maxMinutes, V5_MIGRATION_DEFAULTS.maxMinutes),
      maxModelSamples: numberField(
        limits.maxModelSamples,
        V5_MIGRATION_DEFAULTS.maxModelSamples,
      ),
      maxToolCalls: numberField(
        limits.maxToolCalls ?? limits.maxSteps,
        V5_MIGRATION_DEFAULTS.maxToolCalls,
      ),
    },
    runtimeKind: 'openai_agents',
    schemaVersion: 5,
    workspace,
  });
  return AgentTaskContractV6Schema.parse({
    ...v5,
    activity: null,
    schemaVersion: 6,
  });
}

function migrateGoal(value: unknown): GoalSpec {
  const goal = record(value);
  if (goal.schemaVersion === 5) {
    return repairV5(goal);
  }
  if (goal.schemaVersion === 6) {
    return AgentTaskContractV6Schema.parse(goal);
  }
  return TaskContractSchema.parse(goal);
}

/**
 * Forward-only read repair for persisted task contracts. Unknown shapes fail
 * closed; only previously supported contracts and transitional V5 records are
 * upgraded into the current runtime contract.
 */
export function migratePersistedTaskSnapshot(
  input: unknown,
): PersistedTaskSnapshotMigration {
  const persisted = record(input);
  const goal = persisted.goal === null ? null : migrateGoal(persisted.goal);
  const snapshot = TaskSnapshotSchema.parse({
    ...persisted,
    goal,
    runtimeResume: null,
  });
  return {
    changed: !isDeepStrictEqual(input, snapshot),
    snapshot,
  };
}
