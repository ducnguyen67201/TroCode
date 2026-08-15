import { createHash } from 'node:crypto';

import {
  ProposedActionSchema,
  type ProposedAction,
} from '../../shared/contracts';

function normalizeParameters(
  parameters: ProposedAction['parameters'],
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(parameters ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export function createActionDigest(input: unknown): string {
  const action = ProposedActionSchema.parse(input);
  const normalizedAction = {
    action: action.action,
    capability: action.capability,
    description: action.description,
    parameters: normalizeParameters(action.parameters),
    target: action.target ?? null,
  };

  return createHash('sha256')
    .update(JSON.stringify(normalizedAction))
    .digest('hex');
}
