import { createHash } from 'node:crypto';

import { z } from 'zod';

/** Local-only protocol between Electron main and the bundled SDK process. */
export const LOCAL_AGENT_PROTOCOL_VERSION = 7 as const;
export const LOCAL_AGENT_SDK_VERSION = '0.17.0' as const;
export const LOCAL_AGENT_ROOT_ID = 'tro.root' as const;

export const LocalAgentCapabilitySchema = z.enum([
  'sessions',
  'compaction',
  'dynamicTools',
  'durableToolCheckpoints',
  'steering',
  'cancellation',
  'catalogValidation',
]);

export const LOCAL_AGENT_CAPABILITIES = [
  'sessions',
  'compaction',
  'dynamicTools',
  'durableToolCheckpoints',
  'steering',
  'cancellation',
  'catalogValidation',
] as const satisfies readonly z.infer<typeof LocalAgentCapabilitySchema>[];

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const UuidSchema = z.string().uuid();
const JsonObjectSchema = z.record(z.string().min(1).max(200), z.unknown());
const AgentItemSchema = z.record(z.string().min(1).max(200), z.unknown());
const SequenceSchema = z.number().int().nonnegative();
const BoundedMessageSchema = z.string().trim().min(1).max(8_000);

export const LocalRuntimeToolSpecSchema = z
  .object({
    completionRequired: z.boolean().optional(),
    toolId: z.string().regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/u),
    modelName: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/u),
    description: z.string().trim().min(1).max(20_000),
    inputSchema: JsonObjectSchema,
    operations: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
    driverCatalogDigest: DigestSchema.nullable().default(null),
  })
  .strict();

export const RequiredInitialToolCallSchema = z.object({
  modelName: LocalRuntimeToolSpecSchema.shape.modelName,
  arguments: JsonObjectSchema,
}).strict();

export const LocalToolExecutionResultSchema = z.object({
  status: z.enum(['completed', 'failed', 'unknown', 'cancelled']),
  recovery: z.literal('observe').optional(),
  summary: z.string().trim().min(1).max(1_000),
  data: JsonObjectSchema.nullable().default(null),
  imageDataUrl: z.string().max(40_000_000).nullable().default(null),
}).strict();

export const LocalRuntimeCapabilitiesSchema = z
  .object({
    protocolVersion: z.literal(LOCAL_AGENT_PROTOCOL_VERSION),
    protocolDigest: DigestSchema,
    sdkVersion: z.literal(LOCAL_AGENT_SDK_VERSION),
    graphVersion: DigestSchema,
    capabilities: z.array(LocalAgentCapabilitySchema).max(32),
  })
  .strict();

const RequestIdentitySchema = z.object({ requestId: UuidSchema });
const TurnIdentitySchema = RequestIdentitySchema.extend({
  threadId: UuidSchema,
  turnId: UuidSchema,
  agentId: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/u),
  parentAgentId: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/u).nullable().default(null),
  delegationId: UuidSchema.nullable().default(null),
  graphVersion: DigestSchema,
  sequence: SequenceSchema,
});

const RuntimeInitializeSchema = RequestIdentitySchema.extend({
  kind: z.literal('runtime.initialize'),
  apiBaseUrl: z.string().url(),
  requiredCapabilities: z.array(LocalAgentCapabilitySchema).max(32),
  expected: LocalRuntimeCapabilitiesSchema,
}).strict();
const RuntimeValidateCatalogSchema = RequestIdentitySchema.extend({
  kind: z.literal('runtime.validateCatalog'),
  catalogDigest: DigestSchema,
  tools: z.array(LocalRuntimeToolSpecSchema).max(128),
}).strict();
const CredentialReplaceSchema = RequestIdentitySchema.extend({
  kind: z.literal('runtime.replaceCredential'), credential: z.string().min(1).max(16_384),
}).strict();
const CredentialClearSchema = RequestIdentitySchema.extend({ kind: z.literal('runtime.clearCredential') }).strict();
const TurnStartSchema = TurnIdentitySchema.extend({
  kind: z.literal('turn.start'), agentTurnId: UuidSchema, request: BoundedMessageSchema,
  requiredInitialTool: RequiredInitialToolCallSchema.nullable(),
  prefetchedInitialToolResult: LocalToolExecutionResultSchema.nullable().default(null),
  model: z.string().trim().min(1).max(100), maxTurns: z.number().int().positive().max(100),
  toolCatalogDigest: DigestSchema, tools: z.array(LocalRuntimeToolSpecSchema).max(128),
}).strict();
const TurnResumeSchema = TurnStartSchema.omit({
  kind: true,
  request: true,
  prefetchedInitialToolResult: true,
}).extend({
  kind: z.literal('turn.resume'), checkpoint: z.string().min(2).max(10_000_000),
  checkpointRevision: z.number().int().positive(), pendingCallId: z.string().trim().min(1).max(255).nullable(),
  pendingToolDisposition: z.enum(['recheck', 'reobserve', 'replay']).nullable(),
}).strict();
const TurnSteerSchema = TurnIdentitySchema.extend({ kind: z.literal('turn.steer'), instruction: BoundedMessageSchema }).strict();
const TurnCancelSchema = TurnIdentitySchema.extend({
  kind: z.literal('turn.cancel'),
  reason: z.enum(['stop_button', 'focused_escape', 'replacement', 'sign_out', 'shutdown']),
}).strict();
const SessionReadResultSchema = TurnIdentitySchema.extend({
  kind: z.literal('session.read.result'), responseTo: UuidSchema,
  revision: z.number().int().nonnegative(), items: z.array(AgentItemSchema).max(10_000),
}).strict();
const SessionAppendResultSchema = TurnIdentitySchema.extend({
  kind: z.literal('session.append.result'), responseTo: UuidSchema,
  revision: z.number().int().nonnegative(), replayed: z.boolean(),
}).strict();
const SessionReplaceResultSchema = TurnIdentitySchema.extend({
  kind: z.literal('session.replace.result'), responseTo: UuidSchema,
  revision: z.number().int().nonnegative(), replayed: z.boolean(),
}).strict();
const CheckpointCommitResultSchema = TurnIdentitySchema.extend({
  kind: z.literal('checkpoint.commit.result'), responseTo: UuidSchema,
  checkpointRevision: z.number().int().positive(), replayed: z.boolean(),
}).strict();
const ToolExecuteResultSchema = TurnIdentitySchema.extend({
  kind: z.literal('tool.execute.result'), responseTo: UuidSchema, result: LocalToolExecutionResultSchema,
}).strict();
const RuntimeShutdownSchema = RequestIdentitySchema.extend({ kind: z.literal('runtime.shutdown') }).strict();

export const LocalAgentHostMessageSchema = z.discriminatedUnion('kind', [
  RuntimeInitializeSchema, RuntimeValidateCatalogSchema, CredentialReplaceSchema, CredentialClearSchema, TurnStartSchema,
  TurnResumeSchema, TurnSteerSchema, TurnCancelSchema, SessionReadResultSchema,
  SessionAppendResultSchema, SessionReplaceResultSchema, CheckpointCommitResultSchema, ToolExecuteResultSchema,
  RuntimeShutdownSchema,
]);

const RuntimeReadySchema = RequestIdentitySchema.extend({ kind: z.literal('runtime.ready'), runtime: LocalRuntimeCapabilitiesSchema }).strict();
const RuntimeCatalogValidatedSchema = RequestIdentitySchema.extend({
  kind: z.literal('runtime.catalogValidated'),
  acceptedModelNames: z.array(LocalRuntimeToolSpecSchema.shape.modelName).max(128),
  rejected: z.array(z.object({
    message: z.string().trim().min(1).max(1_000),
    modelName: LocalRuntimeToolSpecSchema.shape.modelName,
    toolId: LocalRuntimeToolSpecSchema.shape.toolId,
  }).strict()).max(128),
}).strict();
const RuntimeFatalSchema = RequestIdentitySchema.extend({
  kind: z.literal('runtime.fatal'), code: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/u),
  message: z.string().trim().min(1).max(1_000),
}).strict();
export const LocalTurnEventKindSchema = z.enum([
  'lifecycle', 'assistant_delta', 'tool_requested', 'tool_started', 'tool_completed',
  'tool_failed', 'tool_unknown', 'model_request_started', 'model_request_completed',
  'model_request_rejected', 'model_request_failed',
]);
const TurnEventSchema = TurnIdentitySchema.extend({
  kind: z.literal('turn.event'), event: LocalTurnEventKindSchema,
  summary: z.string().min(1).max(2_000), data: JsonObjectSchema.nullable().default(null),
}).strict();
const SessionReadSchema = TurnIdentitySchema.extend({
  kind: z.literal('session.read'), limit: z.number().int().positive().max(10_000).nullable(),
}).strict();
const SessionAppendSchema = TurnIdentitySchema.extend({
  kind: z.literal('session.append'), expectedRevision: z.number().int().nonnegative(),
  operationId: z.string().trim().min(1).max(255), operationDigest: DigestSchema,
  items: z.array(AgentItemSchema).max(2_000),
}).strict();
const SessionReplaceSchema = TurnIdentitySchema.extend({
  kind: z.literal('session.replace'), expectedRevision: z.number().int().nonnegative(),
  operationId: z.string().trim().min(1).max(255), operationDigest: DigestSchema,
  expectedSuffix: z.array(AgentItemSchema).max(10_000), replacement: z.array(AgentItemSchema).max(10_000),
}).strict();
const CheckpointCommitSchema = TurnIdentitySchema.extend({
  kind: z.literal('checkpoint.commit'), expectedRevision: z.number().int().nonnegative(),
  checkpoint: z.string().min(2).max(10_000_000), pendingCallId: z.string().trim().min(1).max(255).nullable(),
  sdkVersion: z.literal(LOCAL_AGENT_SDK_VERSION), protocolDigest: DigestSchema,
}).strict();
const ToolExecuteSchema = TurnIdentitySchema.extend({
  kind: z.literal('tool.execute'), callId: z.string().trim().min(1).max(255),
  toolId: LocalRuntimeToolSpecSchema.shape.toolId, modelName: LocalRuntimeToolSpecSchema.shape.modelName,
  operation: z.string().trim().min(1).max(100), arguments: JsonObjectSchema,
  catalogDigest: DigestSchema, driverCatalogDigest: DigestSchema.nullable(), idempotencyDigest: DigestSchema,
}).strict();
const TurnTerminalSchema = TurnIdentitySchema.extend({
  kind: z.literal('turn.terminal'), status: z.enum(['completed', 'failed', 'cancelled', 'unknown']),
  finalOutput: z.string().max(8_000).nullable(), errorCode: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/u).nullable(),
  message: z.string().trim().min(1).max(1_000),
}).strict();

export const LocalAgentChildMessageSchema = z.discriminatedUnion('kind', [
  RuntimeReadySchema, RuntimeCatalogValidatedSchema, RuntimeFatalSchema, TurnEventSchema,
  SessionReadSchema, SessionAppendSchema, SessionReplaceSchema, CheckpointCommitSchema,
  ToolExecuteSchema, TurnTerminalSchema,
]);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const LOCAL_AGENT_PROTOCOL_DIGEST = createHash('sha256')
  .update(stableJson({
    capabilities: LOCAL_AGENT_CAPABILITIES,
    childSchema: z.toJSONSchema(LocalAgentChildMessageSchema),
    hostSchema: z.toJSONSchema(LocalAgentHostMessageSchema),
    protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION,
    sdkVersion: LOCAL_AGENT_SDK_VERSION,
  }))
  .digest('hex');

export type LocalAgentCapability = z.infer<typeof LocalAgentCapabilitySchema>;
export type LocalAgentHostMessage = z.infer<typeof LocalAgentHostMessageSchema>;
export type LocalAgentChildMessage = z.infer<typeof LocalAgentChildMessageSchema>;
export type LocalRuntimeCapabilities = z.infer<typeof LocalRuntimeCapabilitiesSchema>;
export type LocalRuntimeCatalogValidation = z.infer<typeof RuntimeCatalogValidatedSchema>;
export type LocalRuntimeToolSpec = z.infer<typeof LocalRuntimeToolSpecSchema>;
export type PendingToolResumeDisposition = Extract<
  z.infer<typeof TurnResumeSchema>['pendingToolDisposition'],
  string
>;
export type RequiredInitialToolCall = z.infer<typeof RequiredInitialToolCallSchema>;
export type LocalToolExecutionResult = z.infer<typeof LocalToolExecutionResultSchema>;
export type LocalTurnEventKind = z.infer<typeof LocalTurnEventKindSchema>;
