import {
  GoalSpecSchema,
  ProposedActionSchema,
  type GoalSpec,
  type ProposedAction,
} from '../../shared/contracts';

import {
  defaultRuntimeToolRegistry,
  type RuntimeToolRegistry,
} from './runtime-tool-registry';
import { taskApprovalMode, taskApprovalPolicy } from './task-contract';

export { ProposedActionSchema };
export type { ProposedAction };

export type PolicyDecision =
  | {
      status: 'allowed';
      authorization: 'not_required' | 'task_preapproved';
      summary: string;
      nextActions: string[];
    }
  | {
      status: 'needs_approval';
      summary: string;
      nextActions: string[];
    }
  | {
      status: 'denied';
      terminal?: boolean;
      summary: string;
      nextActions: string[];
    };

const APPROVAL_PATTERN = /\bapprov(?:e|al|ed|ing)\b/iu;
const INTERNAL_APPROVAL_LABEL_PATTERN =
  /\b(?:approve exact action|deny exact action|approval control|approval dialog)\b/iu;
const TROCODE_PATTERN = /\btro\s*code\b/iu;
const HOST_APPROVAL_DESKTOP_OPERATIONS: ReadonlySet<string> = new Set([
  'click',
  'drag',
  'type_text',
  'keypress',
]);

function declaredConsequence(action: ProposedAction): string | undefined {
  const value = action.parameters?.declaredConsequence;
  return typeof value === 'string' ? value : undefined;
}

function isTroCodeApprovalUiAction(action: ProposedAction): boolean {
  if (action.toolId !== 'desktop.control') return false;

  const actionText = [action.description, action.target]
    .filter((value): value is string => Boolean(value))
    .join(' ');
  const referencesApprovalControl = APPROVAL_PATTERN.test(actionText);
  return (
    (referencesApprovalControl && TROCODE_PATTERN.test(actionText)) ||
    INTERNAL_APPROVAL_LABEL_PATTERN.test(actionText)
  );
}

function requiresApproval(action: ProposedAction): boolean {
  const alwaysConfirm = taskApprovalPolicy() as readonly string[];
  const consequence = declaredConsequence(action);
  return (
    (action.toolId === 'desktop.control' &&
      Boolean(
        action.operation &&
          HOST_APPROVAL_DESKTOP_OPERATIONS.has(action.operation),
      )) ||
    alwaysConfirm.includes(action.action) ||
    Boolean(
      action.toolId === 'desktop.control' &&
        consequence &&
        alwaysConfirm.includes(consequence),
    )
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

  if (!isTargetAdmissible(action)) {
    return {
      status: 'denied',
      summary: 'The proposed browser target is not an admissible public HTTPS URL.',
      nextActions: ['Choose a public HTTPS target without embedded credentials.'],
    };
  }

  if (isTroCodeApprovalUiAction(action)) {
    return {
      status: 'denied',
      terminal: true,
      summary:
        'TroCode stopped an approval loop. The agent cannot operate TroCode approval controls.',
      nextActions: [
        'Only the user can approve or deny a consequential action from the approval card.',
      ],
    };
  }

  if (requiresApproval(action)) {
    if (taskApprovalMode(goal) === 'fully_approved') {
      return {
        status: 'allowed',
        authorization: 'task_preapproved',
        summary: `${action.description} is pre-authorized by the task approval mode.`,
        nextActions: ['Execute once, then observe and verify the result.'],
      };
    }
    return {
      status: 'needs_approval',
      summary: `${action.description} requires explicit user approval.`,
      nextActions: ['Present a scoped approval request to the user.'],
    };
  }

  return {
    status: 'allowed',
    authorization: 'not_required',
    summary: action.description,
    nextActions: ['Execute once, then observe and verify the result.'],
  };
}
