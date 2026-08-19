import assert from 'node:assert/strict';
import test from 'node:test';

import { PLAN_CATALOG, planFor } from '../src/plan-catalog.mjs';

test('defines the API-owned Basic, Pro, and Max entitlements', () => {
  assert.deepEqual(PLAN_CATALOG, {
    basic: {
      activeRuns: 5,
      dailyMicroUsd: 1_000_000,
      monthlyMessages: 1_200,
      monthlyPriceCents: 2_000,
      monthlyMicroUsd: 8_000_000,
      groupParticipants: 200,
      knowledgeQueriesPerMinute: 60,
      providerCallsPerTurn: 40,
      responsesPerMinute: 30,
      spaceCount: 3,
      spaceStorageBytes: 1_073_741_824,
      uploadFilesPerBatch: 50,
      uploadInitiatesPerMinute: 20,
      taskMicroUsd: 750_000,
    },
    max: {
      activeRuns: 100,
      dailyMicroUsd: 8_000_000,
      monthlyMessages: 7_500,
      monthlyPriceCents: 10_000,
      monthlyMicroUsd: 45_000_000,
      groupParticipants: 2_000,
      knowledgeQueriesPerMinute: 360,
      providerCallsPerTurn: 40,
      responsesPerMinute: 60,
      spaceCount: 100,
      spaceStorageBytes: 107_374_182_400,
      uploadFilesPerBatch: 100,
      uploadInitiatesPerMinute: 120,
      taskMicroUsd: 5_000_000,
    },
    pro: {
      activeRuns: 25,
      dailyMicroUsd: 3_000_000,
      monthlyMessages: 3_000,
      monthlyPriceCents: 5_000,
      monthlyMicroUsd: 20_000_000,
      groupParticipants: 1_000,
      knowledgeQueriesPerMinute: 180,
      providerCallsPerTurn: 40,
      responsesPerMinute: 45,
      spaceCount: 20,
      spaceStorageBytes: 21_474_836_480,
      uploadFilesPerBatch: 100,
      uploadInitiatesPerMinute: 60,
      taskMicroUsd: 2_000_000,
    },
  });
});

test('rejects unknown or malformed plan identifiers', () => {
  assert.equal(planFor('pro'), PLAN_CATALOG.pro);
  assert.throws(() => planFor('enterprise'), /Unknown usage plan/u);
  assert.throws(() => planFor(null), /Unknown usage plan/u);
});
