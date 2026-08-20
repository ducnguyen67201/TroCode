import {
  GoalSpecSchema,
  ProposedActionSchema,
  type GoalSpec,
  type ProposedAction,
} from '../../shared/contracts';

import { classifyActionRisk } from './action-risk-classifier';
import {
  defaultRuntimeToolRegistry,
  type RuntimeToolRegistry,
} from './runtime-tool-registry';

export { ProposedActionSchema };
export type { ProposedAction };

export interface PolicyDecision {
  terminal?: boolean;
  status: 'allowed' | 'needs_approval' | 'denied';
  summary: string;
  nextActions: string[];
}

const APPROVAL_PATTERN = /\bapprov(?:e|al|ed|ing)\b/iu;
const INTERNAL_APPROVAL_LABEL_PATTERN =
  /\b(?:approve exact action|deny exact action|approval control|approval dialog)\b/iu;
const TROCODE_PATTERN = /\btro(?:\s*code)?\b/iu;

function isTroApprovalUiAction(action: ProposedAction): boolean {
  if (action.toolId !== 'desktop.control' && action.toolId !== 'computer.control') {
    return false;
  }

  const actionText = [
    action.description,
    action.target,
    typeof action.parameters?.application === 'string'
      ? action.parameters.application
      : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ');
  const referencesApprovalControl = APPROVAL_PATTERN.test(actionText);
  return (
    (referencesApprovalControl && TROCODE_PATTERN.test(actionText)) ||
    INTERNAL_APPROVAL_LABEL_PATTERN.test(actionText)
  );
}

function isTargetAdmissible(action: ProposedAction): boolean {
  if (action.action !== 'open_url' || !action.target) return true;

  try {
    const url = new URL(action.target);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !isPublicHostname(url.hostname)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isPublicHostname(hostname: string): boolean {
  const normalized = hostname
    .toLocaleLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '');
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.lan') ||
    normalized === 'host.docker.internal' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    (normalized.includes(':') &&
      (normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe80:')))
  ) {
    return false;
  }
  const octets = normalized.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) {
    return true;
  }
  const [first = 0, second = 0] = octets;
  return !(
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function evaluateAction(
  goal: GoalSpec,
  proposedAction: ProposedAction,
  toolRegistry: Pick<RuntimeToolRegistry, 'supports'> = defaultRuntimeToolRegistry,
): PolicyDecision {
  GoalSpecSchema.parse(goal);
  const action = ProposedActionSchema.parse(proposedAction);
  if (!toolRegistry.supports(action)) {
    return {
      status: 'denied',
      summary: 'The requested runtime tool operation is unavailable.',
      nextActions: ['Choose an operation exposed by the current runtime.'],
    };
  }

  if (action.toolId === 'activity.signal') {
    const activity = goal.schemaVersion === 6 ? goal.activity : null;
    const criterionId = action.parameters?.criterionId;
    const tag = action.parameters?.tag;
    const criterion = activity?.activity.criteria.find(
      (item) => item.id === criterionId,
    );
    if (
      !activity ||
      activity.insightPolicy !== 'evidence_candidates' ||
      !activity.policyAcknowledged ||
      action.operation !== 'record' ||
      action.action !== 'record_activity_signal' ||
      action.target !== activity.attemptId ||
      typeof tag !== 'string' ||
      !criterion?.tags.includes(tag)
    ) {
      return {
        status: 'denied',
        summary: 'Activity evidence is outside the pinned Attempt policy.',
        nextActions: ['Continue without recording inferred evidence.'],
      };
    }
  }

  if (!isTargetAdmissible(action)) {
    return {
      status: 'denied',
      summary: 'The proposed browser target is not an admissible public HTTPS URL.',
      nextActions: ['Choose a public HTTPS target without embedded credentials.'],
    };
  }

  if (isTroApprovalUiAction(action)) {
    return {
      status: 'denied',
      terminal: true,
      summary:
        'Tro stopped an approval loop. The agent cannot operate Tro approval controls.',
      nextActions: [
        'Only the user can approve or deny a consequential action from the approval card.',
      ],
    };
  }

  const risk = classifyActionRisk(goal, action);
  if (risk.level === 'sensitive') {
    return {
      status: 'needs_approval',
      summary: `${action.description} requires explicit user approval. ${risk.reason}`,
      nextActions: ['Present a scoped approval request to the user.'],
    };
  }

  return {
    status: 'allowed',
    summary: action.description,
    nextActions: ['Execute once, then observe and verify the result.'],
  };
}
