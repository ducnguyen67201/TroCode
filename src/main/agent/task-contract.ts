import { randomUUID } from 'node:crypto';

import {
  AgentTaskContractV5Schema,
  HOST_ALWAYS_CONFIRM_ACTIONS,
  type AgentTaskContract,
  type ApprovalMode,
  type GoalSpec,
  type SensitiveAction,
  type TaskBehavior,
} from '../../shared/contracts';

export const HOST_APPROVAL_POLICY: readonly SensitiveAction[] =
  HOST_ALWAYS_CONFIRM_ACTIONS;

export const DEFAULT_MAX_TOOL_CALLS = 30;
export const DEFAULT_MAX_TASK_MINUTES = 10;
export const DEFAULT_MAX_MODEL_SAMPLES = 40;
export const DEFAULT_MAX_IMAGES = 20;
export const DEFAULT_MAX_TASK_MICRO_USD = 500_000;

/**
 * Creates the host-owned execution contract for a new agent turn.
 * Model-produced semantics never grant tools, approvals, or resource scope.
 */
export function createTaskContract(
  originalRequest: string,
  approvalMode: ApprovalMode = 'ask_every_time',
): AgentTaskContract {
  return AgentTaskContractV5Schema.parse({
    schemaVersion: 5,
    id: randomUUID(),
    originalRequest,
    approvalPolicy: { alwaysConfirm: [...HOST_APPROVAL_POLICY] },
    approvalMode,
    limits: {
      maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
      maxMinutes: DEFAULT_MAX_TASK_MINUTES,
      maxModelSamples: DEFAULT_MAX_MODEL_SAMPLES,
      maxImages: DEFAULT_MAX_IMAGES,
      maxMicroUsd: DEFAULT_MAX_TASK_MICRO_USD,
    },
  });
}

export function taskApprovalPolicy(): readonly SensitiveAction[] {
  return HOST_APPROVAL_POLICY;
}

export function taskMaxToolCalls(goal: GoalSpec): number {
  return goal.schemaVersion === 3 ||
    goal.schemaVersion === 4 ||
    goal.schemaVersion === 5
    ? goal.limits.maxToolCalls
    : goal.limits.maxSteps;
}

export function taskMaxModelSamples(goal: GoalSpec): number {
  return goal.schemaVersion === 4 || goal.schemaVersion === 5
    ? goal.limits.maxModelSamples
    : DEFAULT_MAX_MODEL_SAMPLES;
}

export function taskApprovalMode(goal: GoalSpec): ApprovalMode {
  return goal.schemaVersion === 5 ? goal.approvalMode : 'ask_every_time';
}

/** @deprecated Only use when presenting a persisted v2 task. */
export function legacyTaskBehavior(goal: GoalSpec): TaskBehavior | null {
  return goal.schemaVersion === 2 ? goal.behavior : null;
}
