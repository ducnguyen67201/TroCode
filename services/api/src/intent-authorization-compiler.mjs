import { createHash } from 'node:crypto';

import { IntentAuthorizationContractSchema } from './agent-runtime-contracts.mjs';

const SAFE_DEFAULTS_PATTERN = /\b(?:make\s+(?:it|them)\s+up|choose\s+(?:reasonable|sensible|safe)\s+details|use\s+(?:the\s+)?defaults?|you\s+decide|whatever\s+(?:works|is\s+reasonable))\b/iu;
const CREATE_PATTERN = /\b(?:add|book|build|create|draft|make|schedule|write)\b/iu;
const UPDATE_PATTERN = /\b(?:change|edit|fill|fix|implement|modify|refactor|replace|update)\b/iu;
const RENAME_PATTERN = /\brename\b/iu;
const MOVE_PATTERN = /\bmove\b/iu;
const COMMENT_PATTERN = /\b(?:add|leave|write)\s+(?:a\s+)?comment\b/iu;
const WORKSPACE_MUTATION_PATTERN = /\b(?:add|build|change|commit|create|edit|fix|implement|modify|refactor|rename|replace|update|write)\b/iu;
const WORKSPACE_COMMAND_PATTERN = /\b(?:build|check|compile|inspect|lint|run|test|typecheck|verify)\b/iu;

function resourceKindsFor(request) {
  const resources = [];
  const add = (kind, pattern) => {
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

function grantId(effectKind, resourceKinds) {
  const resourceDigest = createHash('sha256')
    .update([...resourceKinds].sort().join(','))
    .digest('hex')
    .slice(0, 12);
  return `${effectKind}-${resourceDigest}`.replaceAll('_', '-');
}

function normalizedContract(grants, revision) {
  return IntentAuthorizationContractSchema.parse({
    schemaVersion: 1,
    revision,
    source: 'user_instruction',
    grants: grants
      .map((grant) => ({ ...grant, resourceKinds: [...grant.resourceKinds].sort() }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

export function compileIntentAuthorization(originalRequest, { executionProfile = 'everyday', revision = 1, enabled = true } = {}) {
  const request = originalRequest.trim();
  if (!enabled) return normalizedContract([], revision);
  const resources = resourceKindsFor(request);
  const applicationResources = executionProfile === 'workspace'
    ? resources.filter((resource) => resource !== 'workspace_file')
    : resources;
  const permitsSafeDefaults = SAFE_DEFAULTS_PATTERN.test(request);
  const grants = [];
  const add = (effectKind, resourceKinds) => {
    if (resourceKinds.length === 0) return;
    const id = grantId(effectKind, resourceKinds);
    if (!grants.some((grant) => grant.id === id)) {
      grants.push({ id, effectKind, resourceKinds, permitsSafeDefaults });
    }
  };
  if (CREATE_PATTERN.test(request)) add('create_resource', applicationResources);
  if (UPDATE_PATTERN.test(request)) add('update_resource', applicationResources);
  if (RENAME_PATTERN.test(request)) add('rename_resource', applicationResources);
  if (MOVE_PATTERN.test(request)) add('move_resource', applicationResources);
  if (COMMENT_PATTERN.test(request)) add('add_comment', ['comment']);
  if (executionProfile === 'workspace') {
    if (WORKSPACE_MUTATION_PATTERN.test(request)) add('workspace_write', ['workspace_file']);
    if (WORKSPACE_MUTATION_PATTERN.test(request) || WORKSPACE_COMMAND_PATTERN.test(request)) {
      add('workspace_command', ['workspace_repository']);
    }
  }
  return normalizedContract(grants, revision);
}

export function intentAuthorizationDigest(contract) {
  const normalized = normalizedContract(
    contract.grants.map((grant) => ({ ...grant })),
    contract.revision,
  );
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
