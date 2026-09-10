import { z } from 'zod';

import { LessonHistoryEntrySchema, LessonStepSchema } from './classroom-lesson-contracts';

/** Host-built task context. Document content never grants execution authority. */
export const LessonExecutionContextSchema = z.object({
  version: z.literal(1),
  lessonId: z.uuid(),
  step: LessonStepSchema,
  mode: z.enum(['open', 'explain', 'demonstrate', 'practice', 'check', 'help']),
  language: z.string(),
  resource: z.object({
    handle: z.uuid(),
    title: z.string(),
    kind: z.string(),
    content: z.string().max(16000),
    contentTrust: z.literal('untrusted'),
    truncated: z.boolean(),
    nextOrdinal: z.number().int().nonnegative().nullable(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }).strict(),
  history: z.array(LessonHistoryEntrySchema).max(4),
  controlConsent: z.boolean(),
  maxModelTurns: z.number().int().positive(),
}).strict();

export type LessonExecutionContext = z.infer<typeof LessonExecutionContextSchema>;

export const LessonResourceReadSchema = z.object({
  handle: z.uuid(),
  ordinal: z.number().int().nonnegative().nullable(),
  offset: z.number().int().nonnegative(),
}).strict();

export const LessonResourceExcerptSchema = z.object({
  handle: z.uuid(),
  ordinal: z.number().int().nonnegative().nullable(),
  content: z.string().max(16000),
  contentTrust: z.literal('untrusted'),
  nextOffset: z.number().int().nonnegative().nullable(),
  nextOrdinal: z.number().int().nonnegative().nullable(),
}).strict();
