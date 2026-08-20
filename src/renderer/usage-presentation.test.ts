import { describe, expect, it } from 'vitest';

import type { UsageBudgetSnapshot } from '../shared/contracts';

import {
  accountPlan,
  planTitle,
  remainingUsagePercent,
} from './usage-presentation';

function budget(
  overrides: Partial<UsageBudgetSnapshot> = {},
): UsageBudgetSnapshot {
  return {
    actualMicroUsd: 2_000_000,
    daily: {
      limitMicroUsd: 3_000_000,
      remainingMicroUsd: 2_000_000,
      reservedMicroUsd: 0,
      settledMicroUsd: 1_000_000,
    },
    enforcementMode: 'enforce',
    estimatedMicroUsd: 0,
    messages: {
      limit: 750,
      periodEndsAt: '2026-08-24T00:00:00.000Z',
      periodStartsAt: '2026-08-17T00:00:00.000Z',
      remaining: 600,
      used: 150,
    },
    monthEndsAt: '2026-09-01T00:00:00.000Z',
    monthly: {
      limitMicroUsd: 20_000_000,
      remainingMicroUsd: 12_000_000,
      reservedMicroUsd: 0,
      settledMicroUsd: 8_000_000,
    },
    periodStartsAt: '2026-08-01T00:00:00.000Z',
    plan: 'pro',
    pricing: { currency: 'usd', monthlyCents: 5_000 },
    source: 'hosted',
    task: {
      limitMicroUsd: 2_000_000,
      remainingMicroUsd: 1_000_000,
      reservedMicroUsd: 0,
      settledMicroUsd: 1_000_000,
    },
    warningThresholdMicroUsd: 16_000_000,
    ...overrides,
  };
}

describe('usage presentation', () => {
  it('uses the account entitlement and defaults new accounts to Free', () => {
    expect(accountPlan('max', 'basic')).toBe('max');
    expect(accountPlan(null, 'basic')).toBe('basic');
    expect(accountPlan(null, null)).toBe('free');
    expect(planTitle('free')).toBe('Tro Free');
    expect(planTitle('max')).toBe('Tro Max');
  });

  it('shows the remaining percentage for the weekly message allowance', () => {
    expect(remainingUsagePercent(budget())).toBe(80);
    expect(
      remainingUsagePercent(
        budget({
          messages: {
            limit: 750,
            periodEndsAt: '2026-08-24T00:00:00.000Z',
            periodStartsAt: '2026-08-17T00:00:00.000Z',
            remaining: 38,
            used: 712,
          },
        }),
      ),
    ).toBe(5);
  });

  it('does not invent a percentage for an unmetered local snapshot', () => {
    expect(
      remainingUsagePercent(
        budget({
          messages: {
            limit: 0,
            periodEndsAt: '2026-08-24T00:00:00.000Z',
            periodStartsAt: '2026-08-17T00:00:00.000Z',
            remaining: 0,
            used: 0,
          },
          monthly: {
            limitMicroUsd: 0,
            remainingMicroUsd: 0,
            reservedMicroUsd: 0,
            settledMicroUsd: 0,
          },
          plan: null,
          pricing: null,
          source: 'local_advisory',
        }),
      ),
    ).toBeNull();
  });
});
