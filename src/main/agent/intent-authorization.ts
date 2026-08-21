import { createHash } from 'node:crypto';

import {
  IntentAuthorizationContractSchema,
  type ActionEffect,
  type AutoAuthorizableEffectKind,
  type ExecutionProfile,
  type IntentAuthorizationContract,
  type IntentAuthorizationGrant,
  type ResourceKind,
} from '../../shared/contracts';

const SAFE_DEFAULTS_PATTERN =
  /\b(?:make\s+(?:it|them)\s+up|choose\s+(?:reasonable|sensible|safe)\s+details|use\s+(?:the\s+)?defaults?|you\s+decide|whatever\s+(?:works|is\s+reasonable))\b/iu;
const CREATE_PATTERN = /\b(?:add|book|build|create|draft|make|schedule|write)\b/iu;
const UPDATE_PATTERN = /\b(?:change|edit|fill|fix|implement|modify|refactor|replace|update)\b/iu;
const RENAME_PATTERN = /\brename\b/iu;
const MOVE_PATTERN = /\bmove\b/iu;
const COMMENT_PATTERN = /\b(?:add|leave|write)\s+(?:a\s+)?comment\b/iu;
const WORKSPACE_MUTATION_PATTERN =
  /\b(?:add|build|change|commit|create|edit|fix|implement|modify|refactor|rename|replace|update|write)\b/iu;
const WORKSPACE_COMMAND_PATTERN =
  /\b(?:build|check|compile|inspect|lint|run|test|typecheck|verify)\b/iu;

interface CompileIntentAuthorizationOptions {
  executionProfile?: ExecutionProfile;
  revision?: number;
}

export interface IntentAuthorizationValidation {
  issues: string[];
  valid: boolean;
}

function resourceKindsFor(request: string): ResourceKind[] {
  const resources: ResourceKind[] = [];
  const add = (kind: ResourceKind, pattern: RegExp): void => {
    if (pattern.test(request) && !resources.includes(kind)) resources.push(kind);
  };
  add('calendar_event', /\b(?:appointment|calendar|event|meeting)\b/iu);
  add('spreadsheet_row', /\b(?:row|rows)\b/iu);
  add('spreadsheet', /\b(?:sheet|spreadsheet|workbook)\b/iu);
  add('document', /\b(?:doc|document|page|report)\b/iu);
  add('comment', /\bcomment\b/iu);
  add('issue', /\bissue\b/iu);
  add('pull_request', /\b(?:pull\s+request|\bpr\b)\b/iu);
  add('workspace_file', /\b(?:code|file|files|repository|repo|workspace)\b/iu);
  return resources;
}

function grantId(
  effectKind: AutoAuthorizableEffectKind,
  resourceKinds: readonly ResourceKind[],
): string {
  const resourceDigest = createHash('sha256')
    .update([...resourceKinds].sort().join(','))
    .digest('hex')
    .slice(0, 12);
  return `${effectKind}-${resourceDigest}`.replaceAll('_', '-');
}

function normalizedContract(
  grants: IntentAuthorizationGrant[],
  revision: number,
): IntentAuthorizationContract {
  return IntentAuthorizationContractSchema.parse({
    schemaVersion: 1,
    revision,
    source: 'user_instruction',
    grants: grants.map((grant) => ({
      ...grant,
      resourceKinds: [...grant.resourceKinds].sort(),
    })).sort((left, right) => left.id.localeCompare(right.id)),
  });
}

/**
 * Compiles bounded, reversible effect classes from authenticated user text.
 * The result carries no target, path, URL, account, recipient, or permission.
 */
export function compileIntentAuthorization(
  originalRequest: string,
  options: CompileIntentAuthorizationOptions = {},
): IntentAuthorizationContract {
  const request = originalRequest.trim();
  const resources = resourceKindsFor(request);
  const applicationResources =
    options.executionProfile === 'workspace'
      ? resources.filter((resource) => resource !== 'workspace_file')
      : resources;
  const permitsSafeDefaults = SAFE_DEFAULTS_PATTERN.test(request);
  const grants: IntentAuthorizationGrant[] = [];
  const add = (
    effectKind: AutoAuthorizableEffectKind,
    resourceKinds: ResourceKind[],
  ): void => {
    if (resourceKinds.length === 0) return;
    const id = grantId(effectKind, resourceKinds);
    if (grants.some((grant) => grant.id === id)) return;
    grants.push({ id, effectKind, resourceKinds, permitsSafeDefaults });
  };

  if (CREATE_PATTERN.test(request)) add('create_resource', applicationResources);
  if (UPDATE_PATTERN.test(request)) add('update_resource', applicationResources);
  if (RENAME_PATTERN.test(request)) add('rename_resource', applicationResources);
  if (MOVE_PATTERN.test(request)) add('move_resource', applicationResources);
  if (COMMENT_PATTERN.test(request)) add('add_comment', ['comment']);

  if (options.executionProfile === 'workspace') {
    if (WORKSPACE_MUTATION_PATTERN.test(request)) {
      add('workspace_write', ['workspace_file']);
    }
    if (
      WORKSPACE_MUTATION_PATTERN.test(request) ||
      WORKSPACE_COMMAND_PATTERN.test(request)
    ) {
      add('workspace_command', ['workspace_repository']);
    }
  }

  return normalizedContract(grants, options.revision ?? 1);
}

export function validateIntentAuthorizationContract(
  input: unknown,
): IntentAuthorizationValidation {
  const parsed = IntentAuthorizationContractSchema.safeParse(input);
  return parsed.success
    ? { valid: true, issues: [] }
    : {
        valid: false,
        issues: parsed.error.issues.map((issue) => issue.message),
      };
}

export function intentAuthorizationDigest(
  contract: IntentAuthorizationContract,
): string {
  const normalized = normalizedContract(
    contract.grants.map((grant) => ({ ...grant })),
    contract.revision,
  );
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
}

export function matchesIntentAuthorization(
  contract: IntentAuthorizationContract,
  effect: ActionEffect,
): boolean {
  if (
    !effect.resourceKind ||
    effect.reversibility !== 'reversible' ||
    !['local', 'cloud_private'].includes(effect.externality) ||
    !['none', 'draft'].includes(effect.communication) ||
    !['none', 'requested'].includes(effect.overwrite) ||
    effect.sensitiveDataTransfer !== false
  ) {
    return false;
  }
  return contract.grants.some(
    (grant) =>
      grant.effectKind === effect.kind &&
      grant.resourceKinds.includes(effect.resourceKind as ResourceKind),
  );
}
