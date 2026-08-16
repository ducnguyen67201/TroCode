import type { MembershipStatus } from '../shared/contracts';

export function membershipAllowsAccess(status: MembershipStatus | null): boolean {
  return status?.state === 'active' || status?.state === 'bypassed';
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
