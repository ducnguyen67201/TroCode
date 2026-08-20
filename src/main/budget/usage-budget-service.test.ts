import { describe, expect, it, vi } from 'vitest';

import { UsageBudgetService } from './usage-budget-service';

describe('UsageBudgetService', () => {
  it('labels unhosted development as local advisory instead of inventing spend', async () => {
    const value = await new UsageBudgetService('', async () => null).get();
    expect(value).toMatchObject({
      actualMicroUsd: 0,
      source: 'local_advisory',
    });
  });

  it('authenticates and validates hosted sanitized snapshots', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          actualMicroUsd: 1_000,
          daily: { limitMicroUsd: 2_000_000, remainingMicroUsd: 1_999_000, reservedMicroUsd: 0, settledMicroUsd: 1_000 },
          enforcementMode: 'enforce',
          estimatedMicroUsd: 0,
          messages: {
            limit: 750,
            periodEndsAt: '2026-08-24T00:00:00.000Z',
            periodStartsAt: '2026-08-17T00:00:00.000Z',
            remaining: 749,
            used: 1,
          },
          monthEndsAt: '2026-09-01T00:00:00.000Z',
          monthly: { limitMicroUsd: 20_000_000, remainingMicroUsd: 19_999_000, reservedMicroUsd: 0, settledMicroUsd: 1_000 },
          periodStartsAt: '2026-08-01T00:00:00.000Z',
          plan: 'pro',
          pricing: { currency: 'usd', monthlyCents: 5_000 },
          task: { limitMicroUsd: 500_000, remainingMicroUsd: 499_000, reservedMicroUsd: 0, settledMicroUsd: 1_000 },
          warningThresholdMicroUsd: 16_000_000,
        }),
        { status: 200 },
      ),
    );
    const value = await new UsageBudgetService(
      'https://api.example.test',
      async () => 'session-token',
      fetchImpl,
    ).get('11111111-1111-4111-8111-111111111111');
    expect(value.source).toBe('hosted');
    expect(value.plan).toBe('pro');
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: 'Bearer session-token',
    });
  });
});
