import {
  CompletionDecisionSchema,
  type CompletionDecision,
  type CriterionResult,
  type OutcomeContract,
  type OutcomeCriterion,
  type OutcomeEvidence,
} from '../../shared/contracts';

function evidenceMatchesVerifier(
  criterion: OutcomeCriterion,
  evidence: OutcomeEvidence,
): boolean {
  if (criterion.id !== evidence.criterionId) return false;
  switch (criterion.verifier.kind) {
    case 'assistant_output':
      return evidence.source === 'assistant_output';
    case 'application_surface':
      return (
        evidence.source === 'fresh_observation' &&
        Boolean(evidence.observationId && evidence.observationFingerprint)
      );
    case 'browser_semantic':
      return evidence.source === 'browser_dom' || evidence.source === 'fresh_observation';
    case 'filesystem_effect':
      return evidence.source === 'filesystem';
    case 'tool_effect':
      return evidence.source === 'tool_result';
    case 'semantic_judge':
      return evidence.source === 'semantic_judge';
  }
}

function criterionResult(
  criterion: OutcomeCriterion,
  evidence: readonly OutcomeEvidence[],
  summary: string,
): CriterionResult {
  const relevant = evidence.filter((item) => evidenceMatchesVerifier(criterion, item));
  const evidenceIds = relevant.map((item) => item.id);
  if (criterion.verifier.kind === 'assistant_output' && summary.trim().length > 0) {
    return { criterionId: criterion.id, status: 'passed', evidenceIds };
  }
  const latest = relevant.at(-1);
  if (latest?.status === 'contradicts') return { criterionId: criterion.id, status: 'failed', evidenceIds };
  if (latest?.status === 'supports') return { criterionId: criterion.id, status: 'passed', evidenceIds };
  if (latest?.status === 'unknown') return { criterionId: criterion.id, status: 'unknown', evidenceIds };
  return { criterionId: criterion.id, status: 'pending', evidenceIds };
}

export function createCompletionDecision(
  contract: OutcomeContract,
  evidence: readonly OutcomeEvidence[],
  summary: string,
): CompletionDecision {
  return CompletionDecisionSchema.parse({
    summary,
    contractRevision: contract.revision,
    criterionResults: contract.criteria.map((criterion) =>
      criterionResult(criterion, evidence, summary),
    ),
  });
}

export function assertCompletionDecision(
  contract: OutcomeContract,
  evidence: readonly OutcomeEvidence[],
  input: unknown,
): CompletionDecision {
  const decision = CompletionDecisionSchema.parse(input);
  if (decision.contractRevision !== contract.revision) {
    throw new Error('Completion decision does not match the current outcome revision.');
  }
  const expected = createCompletionDecision(contract, evidence, decision.summary);
  if (JSON.stringify(decision.criterionResults) !== JSON.stringify(expected.criterionResults)) {
    throw new Error('Completion decision criterion results do not match trusted evidence.');
  }
  const results = new Map(
    decision.criterionResults.map((result) => [result.criterionId, result]),
  );
  const incomplete = contract.criteria.find(
    (criterion) => criterion.required && results.get(criterion.id)?.status !== 'passed',
  );
  if (incomplete) {
    throw new Error(`Required outcome criterion is not verified: ${incomplete.id}.`);
  }
  return decision;
}
