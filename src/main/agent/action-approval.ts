import { createHash } from 'node:crypto';

import {
  ProposedActionSchema,
  type ProposedAction,
} from '../../shared/contracts';

import { toolIdentityForAction } from './runtime-tool-registry';

function normalizeParameters(
  parameters: ProposedAction['parameters'],
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(parameters ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export function createActionDigest(
  input: unknown,
  intentRevision: number | null = null,
): string {
  const action = ProposedActionSchema.parse(input);
  const identity = toolIdentityForAction(action);
  const normalizedAction = {
    action: action.action,
    operation: identity.operation,
    toolId: identity.toolId,
    description: action.description,
    effect: action.effect ?? null,
    intentRevision,
    parameters: normalizeParameters(action.parameters),
    target: action.target ?? null,
  };

  return createHash('sha256')
    .update(JSON.stringify(normalizedAction))
    .digest('hex');
}
