import type { GoalSpec, ProposedAction } from '../../shared/contracts';

import { taskApprovalPolicy } from './task-contract';

export type ActionRiskLevel = 'routine' | 'sensitive';

export interface ActionRisk {
  level: ActionRiskLevel;
  reason: string;
}

const ROUTINE_DESKTOP_ACTIONS: ReadonlySet<ProposedAction['action']> = new Set([
  'click_element',
  'type_text',
  'press_key',
  'scroll',
  'drag',
]);

const SENSITIVE_CUE_PATTERN =
  /\b(?:approve|authorization|buy|checkout|credential|delete|install|log\s*in|password|pay|permission|purchase|send|submit|upload)\b/iu;

function declaredConsequence(action: ProposedAction): string | undefined {
  const value = action.parameters?.declaredConsequence;
  return typeof value === 'string' ? value : undefined;
}

function riskText(action: ProposedAction): string {
  const structuredRiskText = Object.entries(action.parameters ?? {})
    .filter(([name]) =>
      [
        'ariaLabel',
        'controlLabel',
        'href',
        'role',
        'visibleText',
      ].includes(name),
    )
    .flatMap(([, value]) => value);
  return [
    action.description,
    action.target,
    ...structuredRiskText,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .slice(0, 120_000);
}

/** Pure, monotonic classifier: untrusted context can raise risk, never grant authority. */
export function classifyActionRisk(
  goal: GoalSpec,
  action: ProposedAction,
): ActionRisk {
  const alwaysConfirm = taskApprovalPolicy() as readonly string[];
  const consequence = declaredConsequence(action);
  if (
    alwaysConfirm.includes(action.action) ||
    (consequence !== undefined && alwaysConfirm.includes(consequence))
  ) {
    return {
      level: 'sensitive',
      reason: 'The normalized action declares a consequential effect.',
    };
  }

  if (
    action.toolId === 'desktop.control' &&
    ROUTINE_DESKTOP_ACTIONS.has(action.action) &&
    (goal.schemaVersion !== 5 || goal.autonomyMode === 'strict')
  ) {
    return {
      level: 'sensitive',
      reason: 'Strict autonomy confirms every desktop mutation.',
    };
  }

  if (
    action.toolId === 'desktop.control' &&
    (action.parameters?.targetOpaque === 'true' ||
      action.parameters?.observationStale === 'true' ||
      SENSITIVE_CUE_PATTERN.test(riskText(action)))
  ) {
    return {
      level: 'sensitive',
      reason: 'Host-visible context raised this desktop action to sensitive.',
    };
  }

  return { level: 'routine', reason: 'The action is routine and in scope.' };
}
