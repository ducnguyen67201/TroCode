import { createHash } from 'node:crypto';

import {
  OutcomeContractSchema,
  type OutcomeContract,
  type OutcomeCriterion,
  type OutcomeVerifier,
} from '../../shared/contracts';

const OPEN_CHROME_REQUEST = /\b(?:open|launch|start)\s+(?:google\s+)?chrome\b/iu;
const AUTHORITY_FIELD_PATTERN = /(?:path|url|domain|approval|capabilit|permission|limit)/iu;

export interface OutcomeContractValidation {
  valid: boolean;
  issues: string[];
}

export function criterionVerifierDigest(verifier: OutcomeVerifier): string {
  return createHash('sha256')
    .update(JSON.stringify(verifier))
    .digest('hex');
}

/**
 * Compiles the deterministic baseline that is safe before a model compiler is
 * available. It describes requested outcomes and never grants execution scope.
 */
export function compileOutcomeContract(originalRequest: string): OutcomeContract {
  const criteria: OutcomeCriterion[] = [
    {
      id: 'assistant-output',
      description: 'Return a bounded user-facing answer that addresses the request.',
      required: true,
      verifier: {
        kind: 'assistant_output',
        constraints: ['The output must be non-empty and user-facing.'],
      },
    },
  ];
  if (OPEN_CHROME_REQUEST.test(originalRequest)) {
    criteria.push({
      id: 'chrome-surface-visible',
      description: 'A fresh trusted observation confirms a visible Chrome surface.',
      required: true,
      verifier: { kind: 'application_surface', application: 'chrome' },
    });
  }
  return OutcomeContractSchema.parse({
    schemaVersion: 1,
    revision: 1,
    completionMode: 'all_required',
    criteria,
  });
}

export function validateOutcomeContract(
  originalRequest: string,
  input: unknown,
): OutcomeContractValidation {
  const parsed = OutcomeContractSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => issue.message),
    };
  }
  const issues: string[] = [];
  for (const criterion of parsed.data.criteria) {
    if (
      criterion.verifier.kind === 'application_surface' &&
      !/\bchrome\b/iu.test(originalRequest)
    ) {
      issues.push('Chrome surface verification is unrelated to the original request.');
    }
    if (
      criterion.verifier.kind === 'semantic_judge' &&
      AUTHORITY_FIELD_PATTERN.test(criterion.verifier.rubric)
    ) {
      issues.push('Semantic rubrics cannot grant paths, permissions, capabilities, or limits.');
    }
  }
  return { valid: issues.length === 0, issues };
}

export function addToolEffectObligation(
  contract: OutcomeContract,
  toolId: string,
  operation: string,
  description: string,
): OutcomeContract {
  const verifier = OutcomeVerifierForTool(toolId, operation);
  const id = `effect-${criterionVerifierDigest(verifier).slice(0, 16)}`;
  if (contract.criteria.some((criterion) => criterion.id === id)) return contract;
  return OutcomeContractSchema.parse({
    ...contract,
    revision: contract.revision + 1,
    criteria: [
      ...contract.criteria,
      {
        id,
        description: description.slice(0, 2_000),
        required: true,
        verifier,
      },
    ],
  });
}

export function addApplicationSurfaceObligation(
  contract: OutcomeContract,
  application: 'chrome',
): OutcomeContract {
  const id = `${application}-surface-visible`;
  if (contract.criteria.some((criterion) => criterion.id === id)) return contract;
  return OutcomeContractSchema.parse({
    ...contract,
    revision: contract.revision + 1,
    criteria: [
      ...contract.criteria,
      {
        id,
        description: 'A fresh trusted observation confirms a visible Chrome surface.',
        required: true,
        verifier: { kind: 'application_surface', application },
      },
    ],
  });
}

function OutcomeVerifierForTool(
  toolId: string,
  operation: string,
): OutcomeVerifier {
  return {
    kind: 'tool_effect',
    toolId,
    operation,
  };
}

export function sameOutcomeCriterion(
  left: OutcomeCriterion,
  right: OutcomeCriterion,
): boolean {
  return (
    left.id === right.id &&
    criterionVerifierDigest(left.verifier) === criterionVerifierDigest(right.verifier)
  );
}
