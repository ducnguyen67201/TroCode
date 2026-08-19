import type { MembershipStatus } from '../shared/contracts';

export type AppEntryGate = 'membership' | 'permissions' | 'workspace';

export function membershipAllowsAccess(status: MembershipStatus | null): boolean {
  return status?.state === 'active' || status?.state === 'bypassed';
}

export function appEntryGate(input: {
  languageSetupComplete: boolean;
  membershipStatus: MembershipStatus | null;
}): AppEntryGate {
  if (!membershipAllowsAccess(input.membershipStatus)) return 'membership';
  return input.languageSetupComplete ? 'workspace' : 'permissions';
}

export function formatMembershipExpiry(
  expiresAt: string | null,
  locale?: string,
  timeZone?: string,
): string | null {
  if (!expiresAt) return null;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone,
    year: 'numeric',
  }).format(new Date(expiresAt));
}
