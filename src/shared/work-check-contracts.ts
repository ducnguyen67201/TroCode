import { z } from 'zod';

export const WORK_CHECK_LIMITS = {
  criteria: 40,
  evidence: 27,
  files: 20,
  entries: 200,
  depth: 10,
  fileCharacters: 20_000,
  totalCharacters: 100_000,
  fileBytes: 5 * 1024 * 1024,
  referenceCharacters: 12_000,
} as const;

export const CriterionCheckSchema = z
  .object({
    criterionId: z.string().trim().min(1).max(80),
    outcome: z.enum(['looks_met', 'needs_work', 'not_verified']),
    explanation: z.string().trim().min(1).max(600),
    evidenceIds: z.array(z.string().min(1).max(80)).max(8),
  })
  .strict();
export const WorkCheckDecisionSchema = z
  .object({
    criteria: z.array(CriterionCheckSchema).max(WORK_CHECK_LIMITS.criteria),
    summary: z.string().trim().min(1).max(1_200),
  })
  .strict();
export const WorkCheckEvidenceSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.enum(['screen', 'file', 'reference']),
    label: z.string().min(1).max(255),
    capturedAt: z.string().datetime(),
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
  })
  .strict();
export const WorkCheckCoverageSchema = z
  .object({
    kind: z.enum(['screen', 'saved_files', 'none']),
    partial: z.boolean(),
    notes: z.array(z.string().max(240)).max(20),
  })
  .strict();
export const WorkCheckReportSchema = z
  .object({
    checkId: z.string().uuid(),
    taskId: z.string().uuid(),
    attemptId: z.string().uuid(),
    activityVersionId: z.string().uuid(),
    checkedAt: z.string().datetime(),
    overall: z.enum(['looks_ready', 'needs_work', 'incomplete_context']),
    criteria: z
      .array(
        CriterionCheckSchema.extend({ title: z.string().max(240).optional() }),
      )
      .max(WORK_CHECK_LIMITS.criteria),
    summary: z.string().trim().min(1).max(1_200),
    coverage: WorkCheckCoverageSchema,
    evidence: z.array(WorkCheckEvidenceSchema).max(WORK_CHECK_LIMITS.evidence),
  })
  .strict();
export const WorkCheckProjectionSchema = z
  .object({
    phase: z.enum(['checking', 'checked', 'failed', 'cancelled', 'unknown']),
    report: WorkCheckReportSchema.nullable(),
    message: z.string().max(1_200).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.phase === 'checked') !== (value.report !== null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Only a checked result has a report.',
        path: ['report'],
      });
    }
  });
export const WorkCheckPanelSchema = z
  .object({
    language: z.enum(['en', 'vi']).optional(),
    policyNotice: z.string().max(600).nullable().optional(),
    assignmentTitle: z.string().min(1).max(240),
    projection: WorkCheckProjectionSchema.nullable(),
    busy: z.boolean(),
    canCheck: z.boolean(),
    canReview: z.boolean(),
    needsWorkspace: z.boolean(),
    submissionFiles: z
      .array(
        z
          .object({
            displayName: z.string().max(255),
            byteSize: z.number().nonnegative(),
          })
          .strict(),
      )
      .max(100)
      .nullable(),
    sync: z.enum(['pending', 'synced', 'unknown']).nullable(),
  })
  .strict();
export const WorkCheckActionSchema = z.enum([
  'start_assignment',
  'check_again',
  'choose_check_workspace',
  'send_for_review',
  'choose_submission_files',
  'confirm_submit_files',
  'stop_check',
]);
export type WorkCheckAction = z.infer<typeof WorkCheckActionSchema>;
export type WorkCheckDecision = z.infer<typeof WorkCheckDecisionSchema>;
export type WorkCheckEvidence = z.infer<typeof WorkCheckEvidenceSchema>;
export type WorkCheckCoverage = z.infer<typeof WorkCheckCoverageSchema>;
export type WorkCheckReport = z.infer<typeof WorkCheckReportSchema>;
export type WorkCheckProjection = z.infer<typeof WorkCheckProjectionSchema>;
