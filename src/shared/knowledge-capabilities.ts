import { z } from 'zod';

export const KnowledgeCapabilitiesSchema = z.object({
  classroomBroadcasts: z.object({ contractVersion: z.literal(1) }).optional(),
  classroomLessons: z.object({ contractVersion: z.literal(1) }).optional(),
  classroomGuidance: z.object({ contractVersion: z.literal(1) }).optional(),
  knowledgeSpaces: z.object({
    enabled: z.boolean(),
    contractVersion: z.literal(2),
  }),
});

export const ClassroomAccountRoleSchema = z.enum(['unassigned', 'teacher', 'student']);
