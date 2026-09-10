import { z } from 'zod';

import { validateClassroomUrl } from './classroom-url-policy';

export const LESSON_LIMITS = {
  bytes: 65_536,
  steps: 8,
  resources: 8,
  minutes: 30,
  modelsPerStep: 8,
  observationsPerStep: 16,
  actionsPerStep: 20,
  totalModels: 64,
  totalActions: 160,
} as const;
const id = z.uuid();
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const text = z
  .string()
  .min(1)
  .max(4000)
  .refine((value) => value.trim() === value, 'Remove surrounding whitespace.');
export const LessonModeSchema = z.enum(['open', 'explain', 'demonstrate', 'practice', 'check']);
export const LessonStatusSchema = z.enum([
  'received',
  'preparing',
  'running',
  'waiting_for_student',
  'paused',
  'blocked',
  'stopped',
  'failed',
  'unknown',
  'expired',
  'finished',
]);
export const LessonReasonSchema = z.enum([
  'device_busy',
  'permission_required',
  'unsupported',
  'resource_unavailable',
  'surface_unverified',
  'outcome_unknown',
  'network_unavailable',
  'student_stop',
  'session_ended',
  'access_changed',
  'expired',
  'budget_exhausted',
  'runtime_failed',
  'existing_work',
  'restart',
  'opted_out',
]);
export const LessonSurfaceSchema = z.object({
  kind: z.enum(['current_window', 'resource_app']),
  navigation: z.enum(['student', 'tro']),
}).strict();
export const LessonResourceSchema = z.discriminatedUnion('kind', [
  z.object({ id, kind: z.literal('current_screen'), title: z.string().min(1).max(240).refine((value) => value.trim() === value) }).strict(),
  z
    .object({
      id,
      kind: z.literal('assignment'),
      title: z
        .string()
        .min(1)
        .max(240)
        .refine((value) => value.trim() === value),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal('source_text'),
      title: z
        .string()
        .min(1)
        .max(240)
        .refine((value) => value.trim() === value),
      sourceVersionId: id,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal('web'),
      title: z
        .string()
        .min(1)
        .max(240)
        .refine((value) => value.trim() === value),
      url: z.string().max(2000),
      origin: z.string().max(2000),
    })
    .strict(),
]);
export const LessonStepSchema = z
  .object({
    id,
    mode: LessonModeSchema,
    objective: text,
    instruction: text,
    resourceId: id,
    surface: LessonSurfaceSchema.optional(),
    criterionIds: z
      .array(
        z
          .string()
          .min(1)
          .max(120)
          .refine((value) => value.trim() === value),
      )
      .max(40),
    demonstration: z.object({ exampleDescription: text, expectedResult: text }).strict().nullable(),
  })
  .strict();
export const ClassroomLessonPlanSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    targetRunId: id,
    activityVersionId: id,
    title: z
      .string()
      .min(1)
      .max(240)
      .refine((value) => value.trim() === value),
    objective: text,
    language: z.enum(['en', 'vi']),
    resources: z.array(LessonResourceSchema).min(1).max(8),
    steps: z.array(LessonStepSchema).min(1).max(8),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (new TextEncoder().encode(JSON.stringify(plan)).length > LESSON_LIMITS.bytes) fail('Lesson is too large.');
    if (
      new Set(plan.resources.map((r) => r.id)).size !== plan.resources.length ||
      new Set(plan.steps.map((s) => s.id)).size !== plan.steps.length
    )
      fail('Lesson IDs must be unique.');
    for (const resource of plan.resources) {
      if (resource.kind === 'current_screen' && plan.schemaVersion < 3) fail('Current screen requires lesson plan version 3.');
      if (resource.kind === 'web' && !validateClassroomUrl(resource.url, resource.origin))
        fail('Enter a valid public HTTPS material URL.');
    }
    for (const step of plan.steps) {
      if (step.mode === 'open' && plan.schemaVersion < 2) fail('Opening material requires lesson plan version 2.');
      if (step.mode === 'open' && step.criterionIds.length) fail('Opening material has no assessment criteria.');
      const resource = plan.resources.find((r) => r.id === step.resourceId);
      if (!resource) fail('Select a material for every step.');
      if ((plan.schemaVersion === 3) !== Boolean(step.surface)) fail('Only version 3 steps require a desktop surface.');
      if (step.surface?.kind === 'resource_app' && !['source_text', 'web'].includes(resource?.kind ?? ''))
        fail('Select a class file or website to open externally.');
      if (plan.schemaVersion === 3 && step.mode === 'open' && step.surface?.kind !== 'resource_app')
        fail('An open step requires a class file or website.');
      if ((step.mode === 'demonstrate') !== Boolean(step.demonstration))
        fail('Only demonstration steps require an explicit example.');
      if (plan.schemaVersion < 3 && step.mode === 'demonstrate' && resource?.kind !== 'web') fail('Demonstrations require a browser exercise.');
      if (new Set(step.criterionIds).size !== step.criterionIds.length) fail('Criterion IDs must be unique.');
    }
  });
export const LessonEnvelopeSchema = z
  .object({
    lessonId: id,
    sessionId: id,
    sequence: revision,
    contractVersion: z.literal(1),
    plan: ClassroomLessonPlanSchema,
    planDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    state: z.enum(['active', 'stopped']),
    serverTime: z.string().datetime({ offset: true }),
  })
  .strict();
export const LessonCommitSchema = z.object({ clientId: id, plan: ClassroomLessonPlanSchema }).strict();
export const LessonReceiptSchema = z
  .object({ clientId: id, lesson: LessonEnvelopeSchema, newlyCreated: z.boolean() })
  .strict();
export const LessonBindingSchema = z.object({ spaceId: id, sessionId: id }).strict();
export const LessonDraftSchema = z
  .object({
    draftId: id,
    ownerId: z.string().min(1),
    binding: LessonBindingSchema,
    revision,
    plan: ClassroomLessonPlanSchema,
    digest: z.string(),
    expiresAt: z.string(),
    state: z.enum(['prepared', 'sending', 'sent', 'stale', 'expired', 'cancelled', 'failed', 'unknown']),
    receipt: LessonReceiptSchema.nullable(),
  })
  .strict();
export const LessonClaimSchema = z
  .object({
    executionId: id,
    lessonId: id,
    planDigest: z.string(),
    userId: z.string(),
    anchorAttemptId: id,
    targetAttemptId: id,
    clientStartId: id,
    clientInstanceId: id,
    ownedByThisRequest: z.boolean(),
  })
  .strict();
export const LessonStepClaimSchema = z
  .object({
    executionId: id,
    stepId: id,
    attemptNumber: revision,
    taskId: id,
    workSessionId: id,
    purpose: z.enum(['work', 'help', 'check']),
    ownedByThisRequest: z.boolean(),
  })
  .strict();
export const LessonCriterionOutcomeSchema = z
  .object({
    criterionId: z.string().min(1).max(120),
    outcome: z.enum(['observed', 'needs_revision', 'insufficient_evidence']),
  })
  .strict();
export const LessonReportSchema = z
  .object({
    reportId: id,
    criterionOutcomes: z.array(LessonCriterionOutcomeSchema).max(40).default([]),
    revision,
    stepId: id.nullable(),
    status: LessonStatusSchema,
    reasonCode: LessonReasonSchema.nullable(),
    actionCount: revision,
    modelRequestCount: revision,
  })
  .strict();
export const LessonCheckResultSchema = z
  .array(
    z
      .object({
        criterionId: z.string().max(120),
        outcome: z.enum(['observed', 'needs_revision', 'insufficient_evidence']),
        explanation: text,
        evidenceLocator: z.string().max(1000).nullable(),
      })
      .strict(),
  )
  .max(40);
export const LessonContinueSchema = z
  .object({
    lessonId: id,
    expectedRevision: revision,
    action: z.enum(['next', 'continue_explanation', 'question', 'check', 'pause', 'resume', 'stop', 'start']),
    text: text.optional(),
  })
  .strict();
export const LessonMaterialSchema = z
  .object({
    resource: LessonResourceSchema,
    text: z.string().max(65_536),
    chunks: z
      .array(z.object({ ordinal: revision, body: z.string().max(12000), locator: z.unknown() }).strict())
      .max(20),
    nextOrdinal: revision.nullable(),
  })
  .strict();
export const LessonContextSchema = z
  .object({
    maxPlanVersion: z.number().int().min(1).max(3).optional(),
    sessionId: id,
    targetRunId: id,
    activityVersionId: id,
    title: z.string(),
    instructions: z.string(),
    allowedOrigins: z.array(z.string()),
    criteria: z.array(z.object({ id: z.string(), title: z.string(), description: z.string() }).passthrough()),
    sources: z.array(z.object({ sourceVersionId: id, title: z.string() }).strict()),
    launchTarget: z.enum(['none', 'workspace', 'current_surface']),
    answerReveal: z.enum(['allowed', 'after_attempt', 'never']),
  })
  .strict();
export const LessonFeedSchema = z
  .object({
    maxPlanVersion: z.number().int().min(1).max(3).optional(),
    sessionId: id,
    sessionState: z.string(),
    serverTime: z.string(),
    maxSequence: revision,
    items: z.array(LessonEnvelopeSchema).max(100),
    stoppedIds: z.array(id).max(100),
  })
  .strict();
export const LessonProgressSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            criterionOutcomes: z.array(LessonCriterionOutcomeSchema).max(40),
            userId: z.string(),
            status: z.string(),
            stepId: id.nullable(),
            device: z
              .object({
                build: z.string(),
                ready: z.boolean(),
                lessonsVersion: z.number().int(),
                connected: z.boolean(),
                lastSeenAt: z.string().nullable(),
              })
              .strict()
              .nullable(),
            reasonCode: z.string().nullable(),
            receivedAt: z.string().nullable(),
            updatedAt: z.string().nullable(),
          })
          .strict(),
      )
      .max(100),
    counts: z.record(z.string(), z.number().int().min(0)),
    nextCursor: z.string().nullable(),
  })
  .strict();
export const LessonHistoryEntrySchema = z.object({
  stepId: id,
  resourceId: id,
  mode: z.enum(['open', 'explain', 'demonstrate', 'practice', 'check', 'help']),
  question: z.string().max(2000).nullable(),
  text: z.string().max(4000),
}).strict();
export const LessonLocalStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    ownerId: z.string(),
    anchorAttemptId: id,
    envelope: LessonEnvelopeSchema,
    revision,
    status: LessonStatusSchema,
    reasonCode: LessonReasonSchema.nullable(),
    claim: LessonClaimSchema.nullable(),
    clientStartId: id,
    clientInstanceId: id,
    childModelLimit: z.number().int().min(1).max(8).default(6),
    stepIndex: revision,
    stepBudgets: z
      .record(z.string(), z.object({ models: revision, actions: revision, observations: revision }).strict())
      .default({}),
    attempts: z.record(z.string(), revision),
    child: LessonStepClaimSchema.nullable(),
    pendingChild: z
      .object({ taskId: id, stepId: id, attemptNumber: revision, purpose: z.enum(['work', 'help', 'check']) })
      .strict()
      .nullable(),
    phase: z.string().max(240),
    text: z.string().max(16000),
    teachingProgress: z.object({ disposition: z.enum(['continue', 'step_finished']), round: revision }).strict().optional(),
    desktopControlConsent: z.boolean().default(false), // Legacy journal field; never used as execution authority.
    history: z.array(LessonHistoryEntrySchema).max(12).default([]),
    feedback: LessonCheckResultSchema,
    actionCount: revision,
    modelRequestCount: revision,
    observationCount: revision,
    effect: z.enum(['none', 'dispatching', 'confirmed', 'unknown']),
    material: LessonMaterialSchema.nullable(),
    pendingReports: z.array(LessonReportSchema).max(100),
  })
  .strict();
export const LessonViewSchema = z
  .object({
    active: LessonLocalStateSchema.nullable(),
    pending: z.array(LessonEnvelopeSchema).max(5),
    autoRunConsent: z.boolean(),
    error: z.string().nullable(),
  })
  .strict();
export type LessonMode = z.infer<typeof LessonModeSchema>;
export type LessonStatus = z.infer<typeof LessonStatusSchema>;
export type LessonReason = z.infer<typeof LessonReasonSchema>;
export type LessonResource = z.infer<typeof LessonResourceSchema>;
export type LessonStep = z.infer<typeof LessonStepSchema>;
export type ClassroomLessonPlan = z.infer<typeof ClassroomLessonPlanSchema>;
export type LessonEnvelope = z.infer<typeof LessonEnvelopeSchema>;
export type LessonDraft = z.infer<typeof LessonDraftSchema>;
export type LessonClaim = z.infer<typeof LessonClaimSchema>;
export type LessonStepClaim = z.infer<typeof LessonStepClaimSchema>;
export type LessonReport = z.input<typeof LessonReportSchema>;
export type LessonLocalState = z.infer<typeof LessonLocalStateSchema>;
export type LessonView = z.infer<typeof LessonViewSchema>;
export type LessonMaterial = z.infer<typeof LessonMaterialSchema>;
export type LessonContext = z.infer<typeof LessonContextSchema>;
export type LessonProgress = z.infer<typeof LessonProgressSchema>;

export const LessonFileSchema = z.object({
  sourceVersionId: id, name: z.string().min(1).max(2000), mediaType: z.string().min(1).max(200),
  byteSize: z.number().int().min(1).max(25 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  download: z.object({ url: z.url(), expiresInSeconds: z.number().int().positive() }).strict(),
}).strict();
export type LessonFile = z.infer<typeof LessonFileSchema>;
