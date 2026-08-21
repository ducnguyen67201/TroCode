import assert from 'node:assert/strict';
import test from 'node:test';

import { deterministicOutcomeContract } from '../src/outcome-compiler.mjs';
import { verifyOutcomeContract } from '../src/outcome-verifier.mjs';

test('Chrome completion stays incomplete without fresh surface evidence', () => {
  const contract = deterministicOutcomeContract('Open Chrome for me.');
  const incomplete = verifyOutcomeContract({ assistantOutput: 'Done.', contract, evidence: [] });
  assert.equal(incomplete.complete, false);
  const complete = verifyOutcomeContract({
    assistantOutput: 'Chrome is open.',
    contract,
    evidence: [{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      criterionId: 'chrome-surface-visible',
      source: 'fresh_observation',
      status: 'supports',
      observationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      observationFingerprint: 'a'.repeat(64),
    }],
  });
  assert.equal(complete.complete, true);
});

test('Workspace completion requires a trusted local operation', () => {
  const contract = deterministicOutcomeContract(
    'Implement the requested fix.',
    'workspace',
  );
  assert.equal(
    verifyOutcomeContract({ assistantOutput: 'Done.', contract, evidence: [] }).complete,
    false,
  );
  const criterion = contract.criteria.find((item) => item.id === 'workspace-mutated');
  assert.ok(criterion);
  assert.equal(verifyOutcomeContract({
    assistantOutput: 'Implemented and verified the fix.',
    contract,
    evidence: [{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      criterionId: criterion.id,
      source: 'filesystem',
      status: 'supports',
    }],
  }).complete, true);
});

test('newer trusted evidence supersedes a recoverable unknown result', () => {
  const contract = deterministicOutcomeContract('Open Chrome for me.');
  const base = {
    criterionId: 'chrome-surface-visible',
    source: 'fresh_observation',
    observationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    observationFingerprint: 'a'.repeat(64),
  };
  const result = verifyOutcomeContract({
    assistantOutput: 'Chrome is open.',
    contract,
    evidence: [
      { ...base, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'unknown' },
      { ...base, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'supports' },
    ],
  });
  assert.equal(result.complete, true);
});
