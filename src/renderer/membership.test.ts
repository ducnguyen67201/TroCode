import { describe, expect, it } from 'vitest';

import type { MembershipStatus } from '../shared/contracts';

import {
  formatMembershipExpiry,
  membershipAllowsAccess,
} from './membership';

function membershipStatus(
  overrides: Partial<MembershipStatus> = {},
): MembershipStatus {
  return {
    expiresAt: null,
    referenceCode: 'TRC-AAAA-BBBB-CCCC',
    required: true,
    state: 'inactive',
    summary: 'Inactive.',
    ...overrides,
  };
}

describe('membership presentation policy', () => {
  it('admits active production memberships and local development bypasses', () => {
    expect(
      membershipAllowsAccess(membershipStatus({ state: 'active' })),
    ).toBe(true);
    expect(
      membershipAllowsAccess(
        membershipStatus({ required: false, state: 'bypassed' }),
      ),
    ).toBe(true);
  });

  it.each(['inactive', 'expired', 'error'] as const)(
    'keeps %s memberships behind the gate',
    (state) => {
      expect(membershipAllowsAccess(membershipStatus({ state }))).toBe(false);
    },
  );

  it('formats a membership expiry for the user locale', () => {
    expect(
      formatMembershipExpiry('2026-09-15T08:00:00.000Z', 'en-US', 'UTC'),
    ).toBe('September 15, 2026');
    expect(formatMembershipExpiry(null, 'en-US', 'UTC')).toBeNull();
  });
});
