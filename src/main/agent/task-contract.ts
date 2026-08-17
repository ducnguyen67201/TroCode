import { randomUUID } from 'node:crypto';

import {
  GoalSpecSchema,
  HOST_ALWAYS_CONFIRM_ACTIONS,
  type GoalSpec,
  type SensitiveAction,
  type TaskBehavior,
} from '../../shared/contracts';

export interface CompiledTaskIntent {
  behavior: TaskBehavior;
  objective: string;
  successDescription: string;
}

export const HOST_APPROVAL_POLICY: readonly SensitiveAction[] =
  HOST_ALWAYS_CONFIRM_ACTIONS;

/**
 * Builds the host-owned execution contract from a model-produced semantic intent.
 * The model never grants tools, approvals, resource scope, or execution limits.
 */
export function createTaskContract(
  originalRequest: string,
  intent: CompiledTaskIntent,
): GoalSpec {
  const alwaysConfirm = [...HOST_APPROVAL_POLICY];
  return GoalSpecSchema.parse({
    schemaVersion: 2,
    id: randomUUID(),
    originalRequest,
    behavior: intent.behavior,
    objective: intent.objective,
    successCriteria: [
      {
        description: intent.successDescription,
        verifier:
          intent.behavior === 'act'
            ? 'Verify the outcome from a fresh observation or a direct tool result.'
            : 'Return a grounded response that directly satisfies the request.',
      },
    ],
    approvalPolicy: { alwaysConfirm },
    limits: {
      maxSteps:
        intent.behavior === 'act' ? 30 : intent.behavior === 'guide' ? 24 : 12,
      maxMinutes:
        intent.behavior === 'act' || intent.behavior === 'guide' ? 10 : 5,
    },
  });
}

export function taskBehavior(goal: GoalSpec): TaskBehavior {
  return goal.behavior;
}

export function taskApprovalPolicy(): readonly SensitiveAction[] {
  return HOST_APPROVAL_POLICY;
}
