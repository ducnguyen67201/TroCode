import assert from 'node:assert/strict';
import test from 'node:test';

import { PLAN_CATALOG, planFor } from '../src/plan-catalog.mjs';

test('defines the API-owned Free, Basic, Pro, and Max entitlements', () => {
  assert.deepEqual(PLAN_CATALOG, {
    free: {
      dailyMicroUsd: 250_000,
      weeklyMessages: 25,
      monthlyPriceCents: 0,
      monthlyMicroUsd: 1_000_000,
      providerCallsPerTurn: 40,
      responsesPerMinute: 15,
      taskMicroUsd: 100_000,
    },
    basic: {
      dailyMicroUsd: 1_000_000,
      weeklyMessages: 300,
      monthlyPriceCents: 2_000,
      monthlyMicroUsd: 8_000_000,
      providerCallsPerTurn: 40,
      responsesPerMinute: 30,
      taskMicroUsd: 750_000,
    },
    pro: {
      dailyMicroUsd: 3_000_000,
      weeklyMessages: 750,
      monthlyPriceCents: 5_000,
      monthlyMicroUsd: 20_000_000,
      providerCallsPerTurn: 40,
      responsesPerMinute: 45,
      taskMicroUsd: 2_000_000,
    },
    max: {
      dailyMicroUsd: 8_000_000,
      weeklyMessages: 1_875,
      monthlyPriceCents: 10_000,
      monthlyMicroUsd: 45_000_000,
      providerCallsPerTurn: 40,
      responsesPerMinute: 60,
      taskMicroUsd: 5_000_000,
    },
  });
});

test('resolves Free and rejects unknown or malformed plan identifiers', () => {
  assert.equal(planFor('free'), PLAN_CATALOG.free);
  assert.equal(planFor('pro'), PLAN_CATALOG.pro);
  assert.throws(() => planFor('enterprise'), /Unknown usage plan/u);
  assert.throws(() => planFor('__proto__'), /Unknown usage plan/u);
  assert.throws(() => planFor(null), /Unknown usage plan/u);
});
