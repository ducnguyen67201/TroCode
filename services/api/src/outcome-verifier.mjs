function supportsVerifier(criterion, evidence) {
  if (criterion.id !== evidence.criterionId) return false;
  const source = evidence.source;
  switch (criterion.verifier.kind) {
    case 'assistant_output': return source === 'assistant_output';
    case 'application_surface': return source === 'fresh_observation' && evidence.observationId && evidence.observationFingerprint;
    case 'browser_semantic': return source === 'browser_dom' || source === 'fresh_observation';
    case 'filesystem_effect': return source === 'filesystem';
    case 'tool_effect': return source === 'tool_result';
    case 'semantic_judge': return source === 'semantic_judge';
    default: return false;
  }
}

export function verifyOutcomeContract({ contract, evidence, assistantOutput }) {
  const criterionResults = contract.criteria.map((criterion) => {
    const matches = evidence.filter((item) => supportsVerifier(criterion, item));
    let state = 'pending';
    if (criterion.verifier.kind === 'assistant_output' && assistantOutput.trim()) state = 'passed';
    else if (matches.at(-1)?.status === 'contradicts') state = 'failed';
    else if (matches.at(-1)?.status === 'supports') state = 'passed';
    else if (matches.at(-1)?.status === 'unknown') state = 'unknown';
    return { criterionId: criterion.id, evidenceIds: matches.map((item) => item.id), state };
  });
  return {
    complete: contract.criteria.every((criterion) =>
      !criterion.required || criterionResults.find((result) => result.criterionId === criterion.id)?.state === 'passed'),
    contractRevision: contract.revision,
    criterionResults,
  };
}

export class OutcomeVerifier {
  constructor({ judgeWithModel = null } = {}) {
    this.judgeWithModel = judgeWithModel;
  }

  async verify(input) {
    const deterministic = verifyOutcomeContract(input);
    const pendingSemantic = input.contract.criteria.filter((criterion) =>
      criterion.verifier.kind === 'semantic_judge' &&
      deterministic.criterionResults.find((result) => result.criterionId === criterion.id)?.state !== 'passed');
    if (pendingSemantic.length === 0 || !this.judgeWithModel) return deterministic;
    const judgments = await this.judgeWithModel({
      assistantOutput: input.assistantOutput,
      criteria: pendingSemantic,
      tools: [],
    });
    const evidence = [...input.evidence, ...judgments];
    return verifyOutcomeContract({ ...input, evidence });
  }
}
