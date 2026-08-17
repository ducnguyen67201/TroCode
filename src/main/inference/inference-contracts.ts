import { z } from 'zod';

export const InferenceLaneSchema = z.enum([
  'responses',
  'realtime_transcription',
  'speech',
]);

export const InferenceProfileIdSchema = z.enum([
  'standard',
  'visual',
  'long_response',
  'quality_override',
]);

export const ProviderUsageSchema = z
  .object({
    cacheWriteTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    model: z.string().trim().min(1).max(200),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    responseId: z.string().trim().min(1).max(500).optional(),
    source: z.enum(['actual', 'estimated']),
  })
  .superRefine((usage, context) => {
    if (usage.cachedInputTokens + usage.cacheWriteTokens > usage.inputTokens) {
      context.addIssue({
        code: 'custom',
        message: 'Cached and cache-write tokens cannot exceed input tokens.',
      });
    }
    if ((usage.reasoningTokens ?? 0) > usage.outputTokens) {
      context.addIssue({
        code: 'custom',
        message: 'Reasoning tokens cannot exceed output tokens.',
      });
    }
  });

export const DispatchDispositionSchema = z.enum([
  'rejected_before_inference',
  'completed',
  'ambiguous',
  'cancelled',
]);

export const InferenceCallMetadataSchema = z.object({
  durationMs: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  lane: InferenceLaneSchema,
  requestId: z.string().uuid(),
  sampleOrdinal: z.number().int().positive(),
  taskId: z.string().min(1).max(500),
  usage: ProviderUsageSchema.nullable(),
});

export type DispatchDisposition = z.infer<typeof DispatchDispositionSchema>;
export type InferenceCallMetadata = z.infer<
  typeof InferenceCallMetadataSchema
>;
export type InferenceProfileId = z.infer<typeof InferenceProfileIdSchema>;
export type ProviderUsage = z.infer<typeof ProviderUsageSchema>;
