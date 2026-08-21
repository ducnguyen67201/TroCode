import type { GoalSpec, ProposedAction } from '../../shared/contracts';

import { createActionDigest } from './action-approval';
import { effectFreeAction, resolveActionEffect } from './action-effect';
import type { AgentToolCall, ResolvedToolInvocation } from './agent-contracts';
import type { DesktopObservation } from './execution-contracts';
import { evaluateAction, type PolicyDecision } from './policy';
import {
  defaultRuntimeToolRegistry,
  type RuntimeToolRegistry,
} from './runtime-tool-registry';

export interface ResolveToolRequest {
  call: AgentToolCall;
  completedToolCalls: number;
  goal: GoalSpec;
  latestObservation?: DesktopObservation;
  maxToolCalls: number;
  taskId: string;
}

export interface ToolPolicyPreview {
  decision: PolicyDecision;
  invocation: ResolvedToolInvocation;
}

/** Trusted normalization, budget, policy, and unknown-outcome boundary. */
export class ToolExecutionBroker {
  private readonly unknownActionDigests = new Map<string, Set<string>>();

  constructor(
    private readonly registry: Pick<
      RuntimeToolRegistry,
      'endTask' | 'preview' | 'resolve' | 'supports'
    > = defaultRuntimeToolRegistry,
  ) {}

  preview(request: Omit<ResolveToolRequest, 'completedToolCalls' | 'maxToolCalls'>): ToolPolicyPreview {
    const invocation = this.registry.preview(request.call, {
      goal: request.goal,
      taskId: request.taskId,
      latestObservation: request.latestObservation,
    });
    return {
      decision: this.policy(request.taskId, request.goal, invocation),
      invocation,
    };
  }

  resolve(request: ResolveToolRequest): ToolPolicyPreview {
    if (request.completedToolCalls >= request.maxToolCalls) {
      throw new Error('The task reached its tool-call limit.');
    }
    const invocation = this.registry.resolve(request.call, {
      goal: request.goal,
      taskId: request.taskId,
      latestObservation: request.latestObservation,
    });
    return {
      decision: this.policy(request.taskId, request.goal, invocation),
      invocation,
    };
  }

  markUnknown(taskId: string, action: ProposedAction): void {
    const digests = this.unknownActionDigests.get(taskId) ?? new Set<string>();
    digests.add(createActionDigest(action));
    this.unknownActionDigests.set(taskId, digests);
  }

  isUnknown(taskId: string, action: ProposedAction): boolean {
    return Boolean(
      this.unknownActionDigests
        .get(taskId)
        ?.has(createActionDigest(action)),
    );
  }

  endTask(taskId: string): void {
    this.unknownActionDigests.delete(taskId);
    this.registry.endTask(taskId);
  }

  private policy(
    taskId: string,
    goal: GoalSpec,
    invocation: ResolvedToolInvocation,
  ): PolicyDecision {
    if (invocation.action && this.isUnknown(taskId, invocation.action)) {
      const effect = resolveActionEffect(invocation.action);
      return {
        status: 'denied',
        effect,
        authorizationSource: 'none',
        approvalRequired: false,
        consequential: true,
        summary:
          'This exact action previously had an unknown outcome and will not be repeated.',
        nextActions: ['Inspect the target before starting a new task.'],
      };
    }
    if (!invocation.action) {
      return {
        status: 'allowed',
        effect: effectFreeAction(),
        authorizationSource: 'routine',
        approvalRequired: false,
        consequential: false,
        summary: 'The tool call has no external side effect.',
        nextActions: ['Execute the bounded tool call once.'],
      };
    }
    return evaluateAction(goal, invocation.action, this.registry);
  }
}
