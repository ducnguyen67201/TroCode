import { createHash } from 'node:crypto';

import { OutcomeContractSchema } from './agent-runtime-contracts.mjs';

const OPEN_CHROME_REQUEST = /\b(?:open|launch|start)\s+(?:google\s+)?chrome\b/iu;
const WORKSPACE_MUTATION_REQUEST =
  /\b(?:add|change|create|delete|edit|fix|implement|modify|refactor|remove|rename|update|write)\b/iu;

export function verifierDigest(verifier) {
  return createHash('sha256').update(JSON.stringify(verifier)).digest('hex');
}

export function deterministicOutcomeContract(request, executionProfile = 'everyday') {
  const criteria = [{
    id: 'assistant-output',
    description: 'Return a bounded user-facing answer that addresses the request.',
    required: true,
    verifier: {
      kind: 'assistant_output',
      constraints: ['The output must be non-empty and user-facing.'],
    },
  }];
  if (OPEN_CHROME_REQUEST.test(request)) {
    criteria.push({
      id: 'chrome-surface-visible',
      description: 'A fresh trusted observation confirms a visible Chrome surface.',
      required: true,
      verifier: { kind: 'application_surface', application: 'chrome' },
    });
  }
  if (executionProfile === 'workspace') {
    const mutation = WORKSPACE_MUTATION_REQUEST.test(request);
    criteria.push({
      id: mutation ? 'workspace-mutated' : 'workspace-inspected',
      description: mutation
        ? 'A trusted local Workspace operation produced and verified the requested change.'
        : 'A trusted local Workspace operation inspected the selected repository.',
      required: true,
      verifier: {
        kind: 'filesystem_effect',
        assertion: mutation
          ? 'A verified file write or successful workspace command materially advanced the requested change.'
          : 'A verified workspace read or successful command grounded the response in the selected repository.',
      },
    });
  }
  return OutcomeContractSchema.parse({
    schemaVersion: 1,
    revision: 1,
    completionMode: 'all_required',
    criteria,
  });
}

export class OutcomeCompiler {
  constructor({ compileWithModel = null } = {}) {
    this.compileWithModel = compileWithModel;
  }

  async compile({ request, executionProfile, availableVerifierKinds }) {
    const deterministic = deterministicOutcomeContract(request, executionProfile);
    if (!this.compileWithModel || executionProfile === 'everyday') return deterministic;
    const candidate = OutcomeContractSchema.parse(await this.compileWithModel({
      request,
      executionProfile,
      availableVerifierKinds,
      tools: [],
    }));
    const allowed = new Set(availableVerifierKinds);
    if (candidate.criteria.some((criterion) => !allowed.has(criterion.verifier.kind))) {
      throw new Error('Outcome compiler selected an unavailable verifier kind.');
    }
    return candidate;
  }
}
