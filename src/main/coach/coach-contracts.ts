import { z } from 'zod';

import {
  ActivityContextSchema,
  WorkCheckDecisionSchema,
  CoachProgressSchema,
  MAX_COACH_SEQUENCE_STEPS,
  MAX_COACH_SPEECH_CHARACTERS,
  type CoachProgress,
} from '../../shared/contracts';

export const NormalizedPointSchema = z.object({
  x: z.number().int().min(0).max(1_000),
  y: z.number().int().min(0).max(1_000),
}).strict();

export const CoachSequenceStepSchema = z.object({
  hook: z.string().trim().min(1).max(50),
  instruction: z.string().trim().min(1).max(90),
  reason: z.string().trim().min(1).max(90),
  expectedOutcome: z.string().trim().min(1).max(160),
  target: z.string().trim().min(1).max(80),
  point: NormalizedPointSchema,
}).strict();

export const CoachDecisionSchema = z.discriminatedUnion('kind', [
  WorkCheckDecisionSchema.extend({kind: z.literal('work_check')}),
  z.object({
    kind: z.literal('answer'),
    text: z.string().trim().min(1).max(1_200),
    language: z.enum(['en', 'vi']),
  }).strict(),
  z.object({
    kind: z.literal('coach_sequence'),
    language: z.enum(['en', 'vi']),
    observationId: z.string().uuid(),
    observationFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    steps: z.array(CoachSequenceStepSchema).min(1).max(MAX_COACH_SEQUENCE_STEPS),
  }).strict(),
  z.object({
    kind: z.literal('complete'),
    recap: z.string().trim().min(1).max(240),
  }).strict(),
]).superRefine((decision, context) => {
  if (decision.kind !== 'coach_sequence') return;
  for (const [index, step] of decision.steps.entries()) {
    const spokenLength = [step.hook, step.instruction, step.reason]
      .join(' ')
      .length;
    if (spokenLength > MAX_COACH_SPEECH_CHARACTERS) {
      context.addIssue({
        code: 'custom',
        message: `Coach speech must stay under ${MAX_COACH_SPEECH_CHARACTERS} characters per step.`,
        path: ['steps', index],
      });
    }
  }
});

export const CoachRuntimeStartSchema = z.object({
    explanation: z
      .object({
        guidanceId: z.string().uuid(),
        broadcastId: z.string().uuid(),
        teacherInstruction: z.string().max(4_000),
        language: z.enum(['en', 'vi']),
        contextMode: z.enum(['screen_if_permitted', 'text_only']),
        expiresAt: z.string().datetime(),
        startedAt: z.string().datetime(),
        modelRequests: z.number().int().min(0).max(8),
        observations: z.number().int().min(0).max(16),
      })
      .strict()
      .optional(),
    taskId: z.string().uuid(),
  request: z.string().trim().min(2).max(8_000),
  activity: ActivityContextSchema.nullable(),
  requiresObservation: z.boolean(),
  priorProgress: CoachProgressSchema.nullable(),
}).strict();

export type CoachDecision = z.infer<typeof CoachDecisionSchema>;
export type CoachRuntimeStart = z.infer<typeof CoachRuntimeStartSchema>;
export { CoachProgressSchema };
export type { CoachProgress };
