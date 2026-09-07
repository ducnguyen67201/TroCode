import { z } from 'zod';

import {
  ClassroomBroadcastDraftSchema,
  LocalGuidanceStartJournalSchema,
  TaskSnapshotSchema,
  TaskUpdateSchema,
  TeacherClassroomBindingSchema,
} from '../../shared/contracts';

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const AgentItemSchema = z.record(z.string().min(1).max(200), z.unknown());
const RequiredInitialToolCallSchema = z.object({
  modelName: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/u),
  arguments: z.record(z.string().min(1).max(200), z.unknown()),
}).strict();
const LegacyWalkthroughStateSchema = z.object({
  completedSteps: z.number().int().nonnegative(),
  enabled: z.boolean(),
  expectedOutcome: z.string().max(160).optional(),
  phase: z.enum(['needs_observation', 'needs_guidance']),
}).passthrough();

export const LocalCheckpointSchema = z.object({
  revision: z.number().int().positive(),
  agentTurnId: z.string().uuid(),
  state: z.string().min(2).max(10_000_000),
  pendingCallId: z.string().trim().min(1).max(255).nullable(),
  model: z.string().trim().min(1).max(100),
  toolCatalogDigest: DigestSchema,
  sdkVersion: z.string().trim().min(1).max(100),
  graphVersion: DigestSchema,
  protocolDigest: DigestSchema,
  requiredInitialTool: RequiredInitialToolCallSchema.nullable().default(null),
  /** Legacy protocol v5 field. New Agent checkpoints never write it. */
  walkthroughState: LegacyWalkthroughStateSchema.optional(),
}).strict();

export const LocalSessionSchema = z.object({
  revision: z.number().int().nonnegative(),
  items: z.array(AgentItemSchema).max(10_000),
  appliedOperations: z.record(z.string().min(1).max(255), DigestSchema),
}).strict();

export const LocalThreadStateSchema = z.object({
  schemaVersion: z.literal(1),
  ownerId: z.string().trim().min(1).max(255),
  snapshot: TaskSnapshotSchema,
  session: LocalSessionSchema,
  checkpoint: LocalCheckpointSchema.nullable(),
  classroomLessonId: z.string().uuid().nullable().default(null),
    teacherClassroom: TeacherClassroomBindingSchema.nullable().default(null),
    broadcastRevision: z.number().int().nonnegative().default(0),
    broadcastDrafts: z.array(ClassroomBroadcastDraftSchema).max(20).default([]),
    studentGuidance: LocalGuidanceStartJournalSchema.nullable().default(null),
  }).strict();

export const InvocationStatusSchema = z.enum([
  'checkpointed',
  'executing',
  'completed',
  'failed',
  'unknown',
  'cancelled-before-dispatch',
]);

export const LocalInvocationSchema = z.object({
  callId: z.string().trim().min(1).max(255),
  idempotencyDigest: DigestSchema,
  toolId: z.string().regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/u),
  operation: z.string().trim().min(1).max(100),
  status: InvocationStatusSchema,
  result: z.object({
    status: z.enum(['completed', 'failed', 'unknown', 'cancelled']),
    summary: z.string().trim().min(1).max(1_000),
    data: z.record(z.string().min(1).max(200), z.unknown()).nullable(),
    imageDataUrl: z.string().max(40_000_000).nullable(),
  }).strict().nullable(),
  updatedAt: z.string().datetime(),
}).strict();

export const LocalInvocationJournalSchema = z.object({
  schemaVersion: z.literal(1),
  records: z.array(LocalInvocationSchema).max(10_000),
}).strict();

export const LocalThreadIndexSchema = z.object({
  schemaVersion: z.literal(1),
  threads: z.array(z.object({
    threadId: z.string().uuid(),
    ownerId: z.string().trim().min(1).max(255),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }).strict()).max(10_000),
}).strict();

export const LocalEventFrameSchema = z.object({
  schemaVersion: z.literal(1),
  update: TaskUpdateSchema,
}).strict();

export type LocalCheckpoint = z.infer<typeof LocalCheckpointSchema>;
export type LocalThreadState = z.infer<typeof LocalThreadStateSchema>;
export type LocalInvocation = z.infer<typeof LocalInvocationSchema>;
export type LocalInvocationJournal = z.infer<typeof LocalInvocationJournalSchema>;
export type LocalThreadIndex = z.infer<typeof LocalThreadIndexSchema>;
