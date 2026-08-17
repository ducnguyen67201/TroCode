import { randomUUID } from 'node:crypto';

import {
  AgentTaskContractV3Schema,
  HOST_ALWAYS_CONFIRM_ACTIONS,
  type AgentTaskContract,
  type GoalSpec,
  type SensitiveAction,
  type TaskBehavior,
} from '../../shared/contracts';

export const HOST_APPROVAL_POLICY: readonly SensitiveAction[] =
  HOST_ALWAYS_CONFIRM_ACTIONS;

export const DEFAULT_MAX_TOOL_CALLS = 30;
export const DEFAULT_MAX_TASK_MINUTES = 10;

/**
 * Creates the host-owned execution contract for a new agent turn.
 * Model-produced semantics never grant tools, approvals, or resource scope.
 */
export function createTaskContract(originalRequest: string): AgentTaskContract {
  return AgentTaskContractV3Schema.parse({
    schemaVersion: 3,
    id: randomUUID(),
    originalRequest,
    approvalPolicy: { alwaysConfirm: [...HOST_APPROVAL_POLICY] },
    limits: {
      maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
      maxMinutes: DEFAULT_MAX_TASK_MINUTES,
    },
  });
}

export function taskApprovalPolicy(): readonly SensitiveAction[] {
  return HOST_APPROVAL_POLICY;
}

export function taskMaxToolCalls(goal: GoalSpec): number {
  return goal.schemaVersion === 3
    ? goal.limits.maxToolCalls
    : goal.limits.maxSteps;
}

/** @deprecated Only use when presenting a persisted v2 task. */
export function legacyTaskBehavior(goal: GoalSpec): TaskBehavior | null {
  return goal.schemaVersion === 2 ? goal.behavior : null;
}
