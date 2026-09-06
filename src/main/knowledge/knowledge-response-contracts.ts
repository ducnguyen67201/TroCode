import { z } from 'zod';

export const InitiateResponseSchema = z.object({
  uploads: z
    .array(
      z.object({
        sourceId: z.string().uuid(),
        sourceVersionId: z.string().uuid(),
        state: z.enum(['pending_upload', 'processing', 'ready', 'failed']),
        upload: z
          .object({
            url: z.string().url(),
            expiresInSeconds: z.number().int().positive(),
            headers: z.record(z.string(), z.string()),
          })
          .nullable(),
      }),
    )
    .max(100),
});
export const CompleteResponseSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(['processing', 'ready']),
});
export const WorkSessionSchema = z.object({
  id: z.string().uuid(),
  state: z.enum([
    'created',
    'active',
    'paused',
    'completed',
    'cancelled',
    'failed',
  ]),
  taskId: z.string().uuid(),
  launchKind: z.enum(['none', 'workspace', 'current_surface']),
  purpose: z.enum(['work', 'help', 'check']),
  createdAt: z.string().datetime(),
});
export const KnowledgeSearchResponseSchema = z.object({
  results: z
    .array(
      z.object({
        sourceTitle: z.string().max(255),
        role: z.enum(['reference', 'instructions', 'rubric', 'starter']),
        locator: z.record(z.string(), z.unknown()),
        snippet: z.string().max(4_000),
        score: z.number().finite(),
      }),
    )
    .max(6),
  truncated: z.boolean(),
});
export const ActivityEvidenceResponseSchema = z.object({
  id: z.string().uuid(),
  criterionId: z.string().max(80),
  tag: z.string().max(80),
  provenance: z.enum(['participant', 'host', 'agent_candidate', 'facilitator']),
  resultCode: z.enum([
    'observed',
    'passed',
    'failed',
    'blocked',
    'needs_review',
  ]),
  createdAt: z.string().datetime(),
});
export const ActivityStarterFilesSchema = z.object({
  files: z
    .array(
      z.object({
        byteSize: z
          .number()
          .int()
          .positive()
          .max(25 * 1024 * 1024),
        mediaType: z.enum(['text/plain', 'text/markdown', 'application/pdf']),
        relativePath: z.string().trim().min(1).max(2_000),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        sourceVersionId: z.string().uuid(),
        download: z.object({
          expiresInSeconds: z.number().int().positive().max(300),
          url: z.string().url(),
        }),
      }),
    )
    .max(100),
});

export type InitiateUploadResponse = z.infer<typeof InitiateResponseSchema>;
export type HostedWorkSession = z.infer<typeof WorkSessionSchema>;
export type KnowledgeSearchResponse = z.infer<
  typeof KnowledgeSearchResponseSchema
>;
export type ActivityStarterFiles = z.infer<typeof ActivityStarterFilesSchema>;
