import {
  ProposedActionSchema,
  type GoalSpec,
  type ProposedAction,
} from '../../shared/contracts';

export { ProposedActionSchema };
export type { ProposedAction };

export interface PolicyDecision {
  status: 'allowed' | 'needs_approval' | 'denied';
  summary: string;
  nextActions: string[];
}

function hostnameMatchesAllowedDomain(
  hostname: string,
  allowedDomains: readonly string[],
): boolean {
  return allowedDomains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

function isTargetInScope(goal: GoalSpec, action: ProposedAction): boolean {
  if (action.action !== 'open_url' || !action.target) return true;
  if (goal.scope.allowedDomains.length === 0) return false;

  try {
    const url = new URL(action.target);
    return hostnameMatchesAllowedDomain(url.hostname, goal.scope.allowedDomains);
  } catch {
    return false;
  }
}

export function evaluateAction(
  goal: GoalSpec,
  proposedAction: ProposedAction,
): PolicyDecision {
  const action = ProposedActionSchema.parse(proposedAction);

  if (!goal.capabilities.includes(action.capability)) {
    return {
      status: 'denied',
      summary: `Capability ${action.capability} is outside this goal's grant.`,
      nextActions: ['Re-plan using an allowed capability.'],
    };
  }

  if (!isTargetInScope(goal, action)) {
    return {
      status: 'denied',
      summary: 'The proposed target is outside the goal resource scope.',
      nextActions: ['Ask the user to expand the domain or resource scope.'],
    };
  }

  if (goal.approvals.alwaysConfirm.includes(action.action as never)) {
    return {
      status: 'needs_approval',
      summary: `${action.description} requires explicit user approval.`,
      nextActions: ['Present a scoped approval request to the user.'],
    };
  }

  return {
    status: 'allowed',
    summary: action.description,
    nextActions: ['Execute once, then observe and verify the result.'],
  };
}
