import type { ProposedAction } from '../shared/contracts';

const INTERNAL_PARAMETER_KEYS = new Set([
  'declaredconsequence',
  'observationfingerprint',
  'observationid',
]);

export interface ApprovalDetail {
  key: string;
  label: string;
  payload: boolean;
  value: string;
}

function labelFor(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[_-]+/gu, ' ')
    .trim();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function approvalDetails(
  parameters: ProposedAction['parameters'],
): ApprovalDetail[] {
  return Object.entries(parameters ?? {}).flatMap(([key, rawValue]) => {
    const normalizedKey = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
    if (INTERNAL_PARAMETER_KEYS.has(normalizedKey)) return [];
    const value = Array.isArray(rawValue) ? rawValue.join('\n\n') : rawValue;
    if (!value.trim()) return [];
    return [
      {
        key,
        label: labelFor(key) || 'Detail',
        payload: ['command', 'commands', 'diff'].includes(normalizedKey),
        value,
      },
    ];
  });
}
