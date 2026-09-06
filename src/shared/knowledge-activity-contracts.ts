import { z } from 'zod';

import { isPublicClassroomHostname } from './classroom-url-policy';

export const AppLanguageSchema = z.enum(['en', 'vi']);

export const ActivityGuidancePolicySchema = z.object({
  answerReveal: z.enum(['allowed', 'after_attempt', 'never']),
  hintMode: z.enum(['direct', 'guided', 'socratic']),
  maxHintLevel: z.number().int().min(0).max(5),
});

export const ActivityCriterionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(2_000),
  tags: z.array(z.string().trim().min(1).max(80)).max(20),
});

export const ClassroomOriginSchema = z
  .string()
  .trim()
  .url()
  .max(2_000)
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        !isPublicClassroomHostname(url.hostname) ||
        url.origin !== value
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Use an exact HTTPS origin without credentials or a path.',
        });
      }
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Use a valid HTTPS origin.',
      });
    }
  });

export const SaveKnowledgeActivityRequestSchema = z.object({
  spaceId: z.string().uuid(),
  clientId: z.string().uuid(),
  definition: z.object({
    title: z.string().trim().min(1).max(240),
    objective: z.string().trim().min(1).max(4_000),
    instructions: z.string().trim().min(1).max(24_000),
    launchTarget: z.enum(['none', 'workspace', 'current_surface']),
    guidancePolicy: ActivityGuidancePolicySchema,
    criteria: z.array(ActivityCriterionSchema).max(40),
    completionPolicy: z.object({
      requiresSubmission: z.boolean(),
      requiresFacilitatorConfirmation: z.boolean(),
    }),
    sessionPolicy: z
      .object({
        allowedOrigins: z.array(ClassroomOriginSchema).max(20),
        allowRoomJoin: z.boolean(),
      })
      .default({ allowedOrigins: [], allowRoomJoin: false }),
  }),
  sourceVersionIds: z.array(z.string().uuid()).max(200),
});
export const PrepareKnowledgeActivityRequestSchema = z.object({
  spaceId: z.string().uuid(),
  requestId: z.string().uuid(),
  description: z.string().trim().min(1).max(12_000),
  language: AppLanguageSchema,
  sourceVersionIds: z.array(z.string().uuid()).max(200),
});
export const PreparedKnowledgeActivitySchema =
  SaveKnowledgeActivityRequestSchema.shape.definition.pick({
    title: true,
    objective: true,
    instructions: true,
    criteria: true,
  }).strict();

