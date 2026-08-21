import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { compileOutcomeContract } from './outcome-contract';
import { assertCompletionDecision, createCompletionDecision } from './outcome-verifier';

describe('outcome verifier', () => {
  it('passes a direct answer with a final assistant output', () => {
    const contract = compileOutcomeContract('Explain photosynthesis.');
    const decision = createCompletionDecision(contract, [], 'Plants convert light into energy.');
    expect(assertCompletionDecision(contract, [], decision)).toEqual(decision);
  });

  it('rejects an application claim without trusted fresh observation evidence', () => {
    const contract = compileOutcomeContract('Open Chrome.');
    const decision = createCompletionDecision(contract, [], 'Chrome is open.');
    expect(() => assertCompletionDecision(contract, [], decision)).toThrow(
      'chrome-surface-visible',
    );
  });

  it('accepts the matching application observation evidence', () => {
    const contract = compileOutcomeContract('Open Chrome.');
    const evidence = [
      {
        id: randomUUID(),
        runId: randomUUID(),
        criterionId: 'chrome-surface-visible',
        source: 'fresh_observation' as const,
        status: 'supports' as const,
        observationId: randomUUID(),
        observationFingerprint: 'a'.repeat(64),
        summary: 'Trusted CUA identity matched one visible Chrome surface.',
        createdAt: new Date().toISOString(),
      },
    ];
    const decision = createCompletionDecision(contract, evidence, 'Chrome is open.');
    expect(assertCompletionDecision(contract, evidence, decision)).toEqual(decision);
  });

  it('uses the newest trusted evidence after a recoverable retry', () => {
    const contract = compileOutcomeContract('Open Chrome.');
    const runId = randomUUID();
    const evidence = [
      {
        id: randomUUID(), runId, criterionId: 'chrome-surface-visible',
        source: 'fresh_observation' as const, status: 'unknown' as const,
        observationId: randomUUID(), observationFingerprint: 'a'.repeat(64),
        summary: 'The first observation was ambiguous.', createdAt: new Date().toISOString(),
      },
      {
        id: randomUUID(), runId, criterionId: 'chrome-surface-visible',
        source: 'fresh_observation' as const, status: 'supports' as const,
        observationId: randomUUID(), observationFingerprint: 'b'.repeat(64),
        summary: 'A later fresh observation confirmed Chrome.', createdAt: new Date().toISOString(),
      },
    ];
    const decision = createCompletionDecision(contract, evidence, 'Chrome is open.');
    expect(assertCompletionDecision(contract, evidence, decision)).toEqual(decision);
  });
});
