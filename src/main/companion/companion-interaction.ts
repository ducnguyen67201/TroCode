import {
  CompanionInteractionSchema,
  type AuthStatus,
  type CompanionInteraction,
  type PendingInteraction,
} from '../../shared/contracts';

const HIDDEN_APPROVAL_DETAIL_KEYS = new Set([
  'button',
  'command',
  'count',
  'declaredconsequence',
  'observationfingerprint',
  'observationid',
  'x',
  'y',
]);

function bounded(value: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function boundedOr(value: string, maximum: number, fallback: string): string {
  return bounded(value, maximum) || fallback;
}

function detailLabel(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function isAuthenticatedCompanionSession(status: AuthStatus): boolean {
  return status.state === 'signed_in' && status.user !== null;
}

export function toCompanionInteraction(
  interaction: PendingInteraction,
  side: 'left' | 'right',
): CompanionInteraction {
  const base = {
    id: interaction.id,
    prompt: boundedOr(
      interaction.prompt,
      1_000,
      'TroCode needs your input.',
    ),
    side,
    taskId: interaction.taskId,
  } as const;

  if (interaction.kind === 'clarification') {
    return CompanionInteractionSchema.parse({
      ...base,
      kind: 'clarification',
      ...(interaction.choices
        ? {
            choices: interaction.choices.slice(0, 9).map((choice, index) => ({
              id: boundedOr(choice.id, 100, `choice-${index + 1}`),
              label: boundedOr(choice.label, 240, `Option ${index + 1}`),
            })),
          }
        : {}),
    });
  }

  let hasMoreDetails = false;
  const details: Array<{ label: string; value: string }> = [];
  for (const [key, rawValue] of Object.entries(
    interaction.action.parameters ?? {},
  )) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (HIDDEN_APPROVAL_DETAIL_KEYS.has(normalizedKey)) {
      continue;
    }
    if (details.length >= 10) {
      hasMoreDetails = true;
      continue;
    }

    const fullValue = Array.isArray(rawValue)
      ? rawValue.join(', ')
      : rawValue;
    const value = bounded(fullValue, 2_000);
    if (value !== fullValue.trim()) hasMoreDetails = true;
    if (!value) continue;
    details.push({
      label: detailLabel(key).slice(0, 80) || 'Detail',
      value,
    });
  }

  return CompanionInteractionSchema.parse({
    ...base,
    action: {
      description: boundedOr(
        interaction.action.description,
        1_000,
        'Review this action.',
      ),
      details,
      hasMoreDetails,
      label: detailLabel(interaction.action.action).slice(0, 120),
      ...(interaction.action.target?.trim()
        ? { target: bounded(interaction.action.target, 500) }
        : {}),
    },
    actionDigest: interaction.actionDigest,
    consequence: boundedOr(
      interaction.consequence,
      1_000,
      'This action changes something outside TroCode.',
    ),
    expiresAt: interaction.expiresAt,
    kind: 'approval',
  });
}
