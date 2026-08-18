import assert from 'node:assert/strict';
import test from 'node:test';

import { PLAN_CATALOG, planFor } from '../src/plan-catalog.mjs';

test('defines the API-owned Basic, Pro, and Max entitlements', () => {
  assert.deepEqual(PLAN_CATALOG, {
    basic: {
      dailyMicroUsd: 100_000,
      monthlyMessages: 100,
      monthlyMicroUsd: 500_000,
      responsesPerMinute: 10,
      taskMicroUsd: 100_000,
    },
    max: {
      dailyMicroUsd: 4_000_000,
      monthlyMessages: 3_500,
      monthlyMicroUsd: 20_000_000,
      responsesPerMinute: 60,
      taskMicroUsd: 3_000_000,
    },
    pro: {
      dailyMicroUsd: 1_000_000,
      monthlyMessages: 1_000,
      monthlyMicroUsd: 6_000_000,
      responsesPerMinute: 30,
      taskMicroUsd: 750_000,
    },
  });
});

test('rejects unknown or malformed plan identifiers', () => {
  assert.equal(planFor('pro'), PLAN_CATALOG.pro);
  assert.throws(() => planFor('enterprise'), /Unknown usage plan/u);
  assert.throws(() => planFor(null), /Unknown usage plan/u);
});
