import { z } from 'zod';

import {
  ClassroomLessonPlanSchema,
  LessonBindingSchema,
  LessonContinueSchema,
  type LessonContext,
  type LessonDraft,
  type LessonMaterial,
  type LessonProgress,
  type LessonView,
} from './classroom-lesson-contracts';

export const LessonPrepareInputSchema = z
  .object({ binding: LessonBindingSchema, plan: ClassroomLessonPlanSchema })
  .strict();
export const LessonConfirmInputSchema = z
  .object({ draftId: z.uuid(), revision: z.number().int().min(1), digest: z.string().regex(/^[a-f0-9]{64}$/u) })
  .strict();
export const LessonContextInputSchema = LessonBindingSchema.extend({ runId: z.uuid() }).strict();
export const LessonProgressInputSchema = LessonBindingSchema.extend({
  lessonId: z.uuid(),
  cursor: z.string().max(200).optional(),
}).strict();
export const LessonMaterialAckSchema = z
  .object({ lessonId: z.uuid(), revision: z.number().int().min(0), resourceId: z.uuid() })
  .strict();
export const LessonMaterialPageSchema = z
  .object({ lessonId: z.uuid(), resourceId: z.uuid(), ordinal: z.number().int().min(0) })
  .strict();
export const LESSON_CHANNELS = {
  cancelDraft: 'classroom-lesson:cancel-draft',
  recoverDraft: 'classroom-lesson:recover-draft',
  context: 'classroom-lesson:context',
  prepare: 'classroom-lesson:prepare',
  confirm: 'classroom-lesson:confirm',
  draft: 'classroom-lesson:draft',
  reconcile: 'classroom-lesson:reconcile',
  view: 'classroom-lesson:view',
  changed: 'classroom-lesson:changed',
  continue: 'classroom-lesson:continue',
  consent: 'classroom-lesson:consent',
  materialPage: 'classroom-lesson:material-page',
  materialAck: 'classroom-lesson:material-ack',
  progress: 'classroom-lesson:progress',
  stop: 'classroom-lesson:stop',
  prepared: 'classroom-lesson:prepared',
} as const;
export interface ClassroomLessonDesktopApi {
  cancelDraft(input: { draftId: string }): Promise<LessonDraft>;
  recoverDraft(): Promise<LessonDraft | null>;
  context(input: z.infer<typeof LessonContextInputSchema>): Promise<LessonContext>;
  prepare(input: z.infer<typeof LessonPrepareInputSchema>): Promise<LessonDraft>;
  confirm(input: z.infer<typeof LessonConfirmInputSchema>): Promise<LessonDraft>;
  draft(input: { draftId: string }): Promise<LessonDraft>;
  reconcile(input: { draftId: string }): Promise<LessonDraft>;
  view(): Promise<LessonView>;
  continue(input: z.infer<typeof LessonContinueSchema>): Promise<LessonView>;
  consent(input: { enabled: boolean }): Promise<LessonView>;
  materialPage(input: z.infer<typeof LessonMaterialPageSchema>): Promise<LessonMaterial>;
  materialAck(input: z.infer<typeof LessonMaterialAckSchema>): Promise<void>;
  progress(input: z.infer<typeof LessonProgressInputSchema>): Promise<LessonProgress>;
  stop(input: z.infer<typeof LessonProgressInputSchema>): Promise<void>;
  onChange(listener: (view: LessonView) => void): () => void;
  onPrepared(listener: (draftId: string) => void): () => void;
}
