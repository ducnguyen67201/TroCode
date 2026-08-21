import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReliabilityReport } from './agent-reliability-benchmark.mjs';

const result = (overrides = {}) => ({
  completed: true,
  verified: true,
  recovered: true,
  faultInjected: true,
  unplannedUserIntervention: false,
  plannedUserIntervention: false,
  approvalCount: 1,
  unnecessaryApprovals: 0,
  hardConfirmBypasses: 0,
  duplicateConsequentialActions: 0,
  costMicroUsd: 100,
  durationMs: 1_000,
  ...overrides,
});

test('reliability benchmark rejects false completion and duplicate effects', () => {
  const report = buildReliabilityReport(
    [result({ verified: false }), result()],
    [result(), result({ verified: false, duplicateConsequentialActions: 1 })],
  );
  assert.equal(report.passed, false);
  assert.equal(report.gates.falseCompletions, false);
  assert.equal(report.gates.duplicateConsequentialActions, false);
});

test('reliability benchmark passes verified recovery with zero duplicate effects', () => {
  assert.equal(buildReliabilityReport([result()], [result()]).passed, true);
});

test('reliability benchmark rejects hard-confirm bypass and approval churn', () => {
  const report = buildReliabilityReport(
    [result({ approvalCount: 5, unnecessaryApprovals: 5 })],
    [result({ approvalCount: 4, unnecessaryApprovals: 4, hardConfirmBypasses: 1 })],
  );
  assert.equal(report.gates.hardConfirmBypasses, false);
  assert.equal(report.gates.unnecessaryApprovals, false);
  assert.equal(report.passed, false);
});
