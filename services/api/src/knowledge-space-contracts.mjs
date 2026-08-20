import { z } from 'zod';

export const KNOWLEDGE_LIMITS = Object.freeze({
  activityCriteria: 40,
  activityInstructionsChars: 24_000,
  dashboardPage: 500,
  evidencePerSession: 20,
  filesPerBatch: 100,
  fileBytes: 25 * 1024 * 1024,
  folderBytes: 250 * 1024 * 1024,
  searchCharacters: 12_000,
  searchResults: 6,
});

export const UuidSchema = z.string().uuid();
export const SpaceRoleSchema = z.enum(['owner', 'facilitator', 'participant']);
export const SourceRoleSchema = z.enum([
  'reference',
  'instructions',
  'rubric',
  'starter',
  'submission',
]);
export const SourceVersionStateSchema = z.enum([
  'pending_upload',
  'processing',
  'ready',
  'failed',
]);
export const ActivityStateSchema = z.enum(['draft', 'published', 'archived']);
export const RunModeSchema = z.enum(['live', 'async', 'hybrid']);
export const RunStateSchema = z.enum(['draft', 'open', 'closed', 'archived']);
export const AttemptStateSchema = z.enum([
  'assigned',
  'in_progress',
  'blocked',
  'submitted',
  'completed',
  'withdrawn',
]);
export const WorkSessionStateSchema = z.enum([
  'created',
  'active',
  'paused',
  'completed',
  'cancelled',
  'failed',
]);
export const GuidancePolicySchema = z.object({
  answerReveal: z.enum(['allowed', 'after_attempt', 'never']).default('allowed'),
  hintMode: z.enum(['direct', 'guided', 'socratic']).default('guided'),
  maxHintLevel: z.number().int().min(0).max(5).default(3),
});
export const CriterionSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/u),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(2_000).default(''),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
});
export const ActivityDefinitionSchema = z.object({
  title: z.string().trim().min(1).max(240),
  objective: z.string().trim().min(1).max(4_000),
  instructions: z
    .string()
    .trim()
    .min(1)
    .max(KNOWLEDGE_LIMITS.activityInstructionsChars),
  launchTarget: z.enum(['none', 'workspace', 'current_surface']),
  guidancePolicy: GuidancePolicySchema.default({
    answerReveal: 'allowed',
    hintMode: 'guided',
    maxHintLevel: 3,
  }),
  criteria: z.array(CriterionSchema).max(KNOWLEDGE_LIMITS.activityCriteria).default([]),
  completionPolicy: z
    .object({
      requiresSubmission: z.boolean().default(false),
      requiresFacilitatorConfirmation: z.boolean().default(false),
    })
    .default({
      requiresFacilitatorConfirmation: false,
      requiresSubmission: false,
    }),
});

export const CreateSpaceSchema = z.object({
  clientId: UuidSchema,
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().max(4_000).default(''),
  purposeLabel: z.string().trim().max(120).nullable().default(null),
}).strict();
export const UpdateSpaceSchema = CreateSpaceSchema.omit({ clientId: true }).partial().strict();
export const CreateGroupSchema = z.object({
  clientId: UuidSchema,
  name: z.string().trim().min(1).max(240),
}).strict();
export const CreateInviteSchema = z.object({
  clientId: UuidSchema,
  groupId: UuidSchema.nullable().default(null),
  role: z.enum(['facilitator', 'participant']),
  maxUses: z.number().int().min(1).max(10_000),
  expiresAt: z.string().datetime().nullable().default(null),
}).strict();
export const RedeemInviteSchema = z.object({ code: z.string().trim().min(8).max(128) }).strict();

export const UploadFileSchema = z.object({
  clientId: UuidSchema,
  relativePath: z.string().trim().min(1).max(2_000),
  displayName: z.string().trim().min(1).max(255),
  mediaType: z.enum(['text/plain', 'text/markdown', 'application/pdf']),
  byteSize: z.number().int().positive().max(KNOWLEDGE_LIMITS.fileBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  role: SourceRoleSchema,
}).strict();
export const InitiateUploadSchema = z.object({
  files: z.array(UploadFileSchema).min(1).max(KNOWLEDGE_LIMITS.filesPerBatch),
}).strict().superRefine((value, context) => {
  const bytes = value.files.reduce((total, file) => total + file.byteSize, 0);
  if (bytes > KNOWLEDGE_LIMITS.folderBytes) {
    context.addIssue({ code: 'custom', message: 'Upload batch is too large.', path: ['files'] });
  }
});
export const CompleteUploadSchema = z.object({
  clientId: UuidSchema,
  sourceVersionId: UuidSchema,
}).strict();
export const CommitSubmissionSchema = z.object({ clientId: UuidSchema }).strict();

export const SaveActivityDraftSchema = z.object({
  clientId: UuidSchema,
  definition: ActivityDefinitionSchema,
  sourceVersionIds: z.array(UuidSchema).max(200).default([]),
}).strict();
export const PublishActivitySchema = z.object({ clientId: UuidSchema }).strict();
export const RunTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('group'), groupId: UuidSchema }).strict(),
  z.object({ kind: z.literal('participants'), userIds: z.array(z.string().trim().min(1).max(255)).min(1).max(2_000) }).strict(),
]);
export const CreateRunSchema = z.object({
  clientId: UuidSchema,
  activityVersionId: UuidSchema,
  mode: RunModeSchema,
  opensAt: z.string().datetime().nullable().default(null),
  closesAt: z.string().datetime().nullable().default(null),
  target: RunTargetSchema,
  insightPolicy: z.enum(['explicit_and_operational', 'evidence_candidates']).default('explicit_and_operational'),
}).strict().superRefine((run, context) => {
  if (run.opensAt && run.closesAt && run.opensAt >= run.closesAt) {
    context.addIssue({ code: 'custom', message: 'Run close time must follow open time.', path: ['closesAt'] });
  }
});
export const AttemptAcknowledgeSchema = z.object({
  policyVersion: z.string().trim().min(1).max(64),
}).strict();
export const RequestHelpSchema = z.object({ clientId: UuidSchema }).strict();
export const CreateWorkSessionSchema = z.object({
  clientId: UuidSchema,
  taskId: UuidSchema,
  launchKind: z.enum(['none', 'workspace', 'current_surface']),
}).strict();
export const UpdateWorkSessionSchema = z.object({
  state: WorkSessionStateSchema,
  helpRequested: z.boolean().optional(),
  hintLevel: z.number().int().min(0).max(5).optional(),
}).strict();
export const RecordEvidenceSchema = z.object({
  clientId: UuidSchema,
  workSessionId: UuidSchema,
  criterionId: z.string().trim().min(1).max(80),
  tag: z.string().trim().min(1).max(80),
  provenance: z.enum(['participant', 'host', 'agent_candidate', 'facilitator']),
  resultCode: z.enum(['observed', 'passed', 'failed', 'blocked', 'needs_review']),
}).strict();
export const SearchKnowledgeSchema = z.object({
  query: z.string().trim().min(2).max(1_000),
  limit: z.number().int().min(1).max(KNOWLEDGE_LIMITS.searchResults).default(KNOWLEDGE_LIMITS.searchResults),
}).strict();

export const CursorPageSchema = z.object({
  cursor: z.string().trim().min(1).max(512).nullable(),
  items: z.array(z.unknown()),
});

export function publicValidationError(error) {
  if (!(error instanceof z.ZodError)) return null;
  return {
    code: 'invalid_request',
    error: 'Request data is invalid.',
    issues: error.issues.slice(0, 12).map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
