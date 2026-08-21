import { z } from 'zod';

export const AGENT_RUNTIME_PROTOCOL_VERSION = 2;

export const ActionEffectKindSchema = z.enum([
  'none', 'create_resource', 'update_resource', 'rename_resource', 'move_resource',
  'add_comment', 'workspace_write', 'workspace_command', 'send_communication',
  'delete_or_archive', 'unexpected_overwrite', 'publish', 'deploy', 'merge',
  'financial_or_trade', 'authentication_or_credential', 'system_permission',
  'install', 'sensitive_transfer', 'unknown',
]);

export const ResourceKindSchema = z.enum([
  'application', 'calendar_event', 'comment', 'document',
  'download', 'email', 'form_submission', 'generic_private_resource',
  'generic_public_resource', 'issue', 'message', 'pull_request', 'spreadsheet',
  'spreadsheet_row', 'workspace_file', 'workspace_repository',
]);

export const ActionEffectSchema = z.object({
  kind: ActionEffectKindSchema,
  resourceKind: ResourceKindSchema.nullable(),
  reversibility: z.enum(['none', 'reversible', 'destructive', 'unknown']),
  externality: z.enum(['local', 'cloud_private', 'external', 'public', 'unknown']),
  communication: z.enum(['none', 'draft', 'send', 'invite', 'notify', 'unknown']),
  overwrite: z.enum(['none', 'requested', 'unexpected', 'unknown']),
  sensitiveDataTransfer: z.union([z.boolean(), z.literal('unknown')]),
}).strict().superRefine((effect, context) => {
  if ((effect.kind === 'none') !== (effect.resourceKind === null)) {
    context.addIssue({
      code: 'custom',
      message: 'Effect-free actions require a null resource; side effects require a resource.',
      path: ['resourceKind'],
    });
  }
  if (
    effect.kind === 'none' &&
    (effect.reversibility !== 'none' || effect.externality !== 'local' ||
      effect.communication !== 'none' ||
      effect.overwrite !== 'none' || effect.sensitiveDataTransfer !== false)
  ) {
    context.addIssue({ code: 'custom', message: 'An effect-free action must use neutral effect metadata.' });
  }
  const communicates = ['send', 'invite', 'notify'].includes(effect.communication);
  if (communicates !== (effect.kind === 'send_communication')) {
    context.addIssue({ code: 'custom', message: 'Communication effects require matching send metadata.', path: ['communication'] });
  }
});

export const AuthorizationSourceSchema = z.enum([
  'routine', 'user_instruction', 'exact_approval', 'none',
]);

export const AutoAuthorizableEffectKindSchema = z.enum([
  'create_resource', 'update_resource', 'rename_resource', 'move_resource',
  'add_comment', 'workspace_write', 'workspace_command',
]);

export const HOST_ALWAYS_CONFIRM_EFFECTS = Object.freeze([
  'send_communication', 'delete_or_archive', 'unexpected_overwrite', 'publish',
  'deploy', 'merge', 'financial_or_trade', 'authentication_or_credential',
  'system_permission', 'install', 'sensitive_transfer', 'unknown',
]);

export const IntentAuthorizationGrantSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  effectKind: AutoAuthorizableEffectKindSchema,
  resourceKinds: z.array(ResourceKindSchema).min(1).max(20),
  permitsSafeDefaults: z.boolean(),
}).strict();

export const IntentAuthorizationContractSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().positive().max(10_000),
  source: z.literal('user_instruction'),
  grants: z.array(IntentAuthorizationGrantSchema).max(30),
}).strict().superRefine((contract, context) => {
  const ids = new Set();
  for (const [index, grant] of contract.grants.entries()) {
    if (ids.has(grant.id)) {
      context.addIssue({ code: 'custom', message: 'Intent grant IDs must be unique.', path: ['grants', index, 'id'] });
    }
    ids.add(grant.id);
    if (new Set(grant.resourceKinds).size !== grant.resourceKinds.length) {
      context.addIssue({ code: 'custom', message: 'Intent grant resource kinds must be unique.', path: ['grants', index, 'resourceKinds'] });
    }
  }
});

export const RuntimeToolIdSchema = z.string().trim().min(3).max(100)
  .regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/u);

export const AgentRunStateSchema = z.enum([
  'queued',
  'compiling_outcomes',
  'planning',
  'awaiting_worker',
  'executing_tool',
  'awaiting_input',
  'awaiting_approval',
  'verifying',
  'recovering',
  'completed',
  'blocked',
  'failed',
  'cancelled',
  'expired',
]);

export const AgentToolInvocationStateSchema = z.enum([
  'requested',
  'delivered',
  'executing',
  'confirmed',
  'failed',
  'denied',
  'not_executed',
  'unknown',
  'cancelled',
  'expired',
]);

export const OutcomeVerifierSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('assistant_output'), constraints: z.array(z.string().trim().min(1).max(500)).max(20) }).strict(),
  z.object({ kind: z.literal('application_surface'), application: z.literal('chrome') }).strict(),
  z.object({ kind: z.literal('browser_semantic'), assertion: z.string().trim().min(1).max(2_000) }).strict(),
  z.object({ kind: z.literal('filesystem_effect'), assertion: z.string().trim().min(1).max(2_000) }).strict(),
  z.object({ kind: z.literal('tool_effect'), toolId: RuntimeToolIdSchema, operation: z.string().trim().min(1).max(100) }).strict(),
  z.object({ kind: z.literal('semantic_judge'), rubric: z.string().trim().min(1).max(4_000) }).strict(),
]);

export const OutcomeCriterionSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  description: z.string().trim().min(1).max(2_000),
  required: z.boolean(),
  verifier: OutcomeVerifierSchema,
}).strict();

export const OutcomeContractSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().positive().max(10_000),
  completionMode: z.literal('all_required'),
  criteria: z.array(OutcomeCriterionSchema).min(1).max(20),
}).strict().superRefine((contract, context) => {
  const ids = new Set();
  for (const [index, criterion] of contract.criteria.entries()) {
    if (ids.has(criterion.id)) {
      context.addIssue({ code: 'custom', message: 'Outcome criterion IDs must be unique.', path: ['criteria', index, 'id'] });
    }
    ids.add(criterion.id);
  }
  if (!contract.criteria.some((criterion) => criterion.required)) {
    context.addIssue({ code: 'custom', message: 'At least one criterion must be required.', path: ['criteria'] });
  }
});

export const SubmitAgentRunSchema = z.object({
  clientTaskId: z.string().uuid(),
  taskId: z.string().uuid(),
  request: z.string().trim().min(2).max(8_000),
  autonomyMode: z.enum(['balanced', 'strict']).default('balanced'),
  executionProfile: z.enum(['everyday', 'workspace']).default('everyday'),
  workspaceSelectionId: z.string().uuid().nullable().default(null),
}).strict().superRefine((value, context) => {
  if ((value.executionProfile === 'workspace') !== Boolean(value.workspaceSelectionId)) {
    context.addIssue({ code: 'custom', message: 'Workspace runs require a selection ID.', path: ['workspaceSelectionId'] });
  }
});

export const AgentRunEventSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  sequence: z.number().int().positive(),
  type: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(1_000),
  outcomeRevision: z.number().int().positive().optional(),
  outcomes: z.array(z.object({
    criterionId: z.string().trim().min(1).max(80),
    required: z.boolean(),
    status: z.enum(['pending', 'passed', 'failed', 'unknown']),
    verifierKind: z.enum([
      'assistant_output', 'application_surface', 'browser_semantic',
      'filesystem_effect', 'tool_effect', 'semantic_judge',
    ]),
  }).strict()).max(20).optional(),
  createdAt: z.string().datetime(),
}).strict();

export const DesktopWorkerCapabilitiesSchema = z.object({
  protocolVersion: z.literal(AGENT_RUNTIME_PROTOCOL_VERSION),
  schemaDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  tools: z.array(z.object({
    toolId: RuntimeToolIdSchema,
    operations: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
  }).strict()).max(100),
}).strict();

export const DesktopInvocationEnvelopeSchema = z.object({
  protocolVersion: z.literal(AGENT_RUNTIME_PROTOCOL_VERSION),
  schemaDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  invocationId: z.string().uuid(),
  runId: z.string().uuid(),
  callId: z.string().trim().min(1).max(255),
  toolId: RuntimeToolIdSchema,
  operation: z.string().trim().min(1).max(100),
  effect: ActionEffectSchema,
  intentRevision: z.number().int().positive().max(10_000),
  approvalRequired: z.boolean(),
  authorizationSource: AuthorizationSourceSchema,
  consequential: z.boolean(),
  input: z.record(z.string().min(1).max(100), z.unknown()),
  obligations: z.array(z.object({
    criterionId: z.string().trim().min(1).max(80),
    verifierKind: z.enum(['application_surface', 'browser_semantic', 'filesystem_effect', 'tool_effect']),
  }).strict()).max(20).default([]),
  expiresAt: z.string().datetime(),
}).strict().superRefine((invocation, context) => {
  if (invocation.consequential !== (invocation.effect.kind !== 'none')) {
    context.addIssue({ code: 'custom', message: 'Invocation consequence must match its typed effect.', path: ['consequential'] });
  }
  if (invocation.authorizationSource === 'exact_approval' && !invocation.approvalRequired) {
    context.addIssue({ code: 'custom', message: 'Exact approval metadata must remain approval-required.', path: ['approvalRequired'] });
  }
});

export const DesktopExecutionGrantSchema = z.object({
  invocationId: z.string().uuid(),
  effect: ActionEffectSchema,
  intentRevision: z.number().int().positive().max(10_000),
  approvalRequired: z.boolean(),
  authorizationSource: AuthorizationSourceSchema,
  consequential: z.boolean(),
}).strict().superRefine((grant, context) => {
  if (grant.consequential !== (grant.effect.kind !== 'none')) {
    context.addIssue({ code: 'custom', message: 'Consequence must match the normalized effect.', path: ['consequential'] });
  }
  if (grant.authorizationSource === 'none') {
    context.addIssue({ code: 'custom', message: 'Execution requires a host authorization source.', path: ['authorizationSource'] });
  }
  if (grant.authorizationSource === 'routine' && grant.effect.kind !== 'none') {
    context.addIssue({ code: 'custom', message: 'Routine authorization is effect-free.', path: ['authorizationSource'] });
  }
  if (grant.authorizationSource === 'user_instruction' && grant.effect.kind === 'none') {
    context.addIssue({ code: 'custom', message: 'Instruction authorization requires a reversible side effect.', path: ['authorizationSource'] });
  }
  if (grant.approvalRequired !== (grant.authorizationSource === 'exact_approval')) {
    context.addIssue({ code: 'custom', message: 'Only an exact approval may mark an executing action approval-required.', path: ['approvalRequired'] });
  }
});

export const DesktopInvocationResultSchema = z.object({
  invocationId: z.string().uuid(),
  status: z.enum(['confirmed', 'failed', 'denied', 'not_executed', 'unknown', 'cancelled']),
  summary: z.string().trim().min(1).max(1_000),
  data: z.record(z.string().min(1).max(100), z.unknown()).optional(),
  visual: z.object({
    dataBase64: z.string().min(1).max(40_000_000),
    detail: z.literal('original'),
    mimeType: z.enum(['image/jpeg', 'image/png']),
    observationId: z.string().uuid(),
  }).strict().optional(),
  evidence: z.array(z.object({
    criterionId: z.string().trim().min(1).max(80),
    source: z.enum(['tool_result', 'fresh_observation', 'browser_dom', 'filesystem']),
    status: z.enum(['supports', 'contradicts', 'unknown']),
    observationId: z.string().uuid().optional(),
    observationFingerprint: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
    summary: z.string().trim().min(1).max(1_000),
  }).strict()).max(20).default([]),
}).strict();

export const SteeringRequestSchema = z.object({
  clientTurnId: z.string().uuid(),
  instruction: z.string().trim().min(1).max(8_000),
}).strict();

export const ApprovalDecisionSchema = z.object({
  interactionId: z.string().uuid(),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  decision: z.enum(['approve', 'deny']),
}).strict();
