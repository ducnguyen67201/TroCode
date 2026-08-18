import { z } from 'zod';

export const CodexRequestIdSchema = z.union([
  z.string().trim().min(1).max(255),
  z.number().int().nonnegative(),
]);

export const CodexResponseEnvelopeSchema = z
  .object({
    id: CodexRequestIdSchema,
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number().int(),
        message: z.string().trim().min(1).max(2_000),
        data: z.unknown().optional(),
      })
      .optional(),
  })
  .superRefine((response, context) => {
    if ((response.result === undefined) === (response.error === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'A Codex response must contain exactly one of result or error.',
      });
    }
  });

export const CodexMethodEnvelopeSchema = z.object({
  id: CodexRequestIdSchema.optional(),
  method: z.string().trim().min(1).max(200),
  params: z.unknown().optional(),
});

export const CodexInitializeResponseSchema = z.object({
  userAgent: z.string().trim().min(1).max(500),
  codexHome: z.string().trim().min(1).max(4_096),
  platformFamily: z.string().trim().min(1).max(100),
  platformOs: z.string().trim().min(1).max(100),
});

export const CodexThreadResponseSchema = z.object({
  thread: z.object({ id: z.string().trim().min(1).max(255) }).passthrough(),
}).passthrough();

export const CodexTurnStartResponseSchema = z.object({
  turn: z.object({ id: z.string().trim().min(1).max(255) }).passthrough(),
});

export const CodexTurnSteerResponseSchema = z.object({
  turnId: z.string().trim().min(1).max(255),
});

const ThreadTurnItemSchema = z.object({
  id: z.string().trim().min(1).max(255),
  type: z.string().trim().min(1).max(100),
}).passthrough();

export const CodexAgentMessageDeltaSchema = z.object({
  method: z.literal('item/agentMessage/delta'),
  params: z.object({
    threadId: z.string().trim().min(1).max(255),
    turnId: z.string().trim().min(1).max(255),
    itemId: z.string().trim().min(1).max(255),
    delta: z.string().max(2_000),
  }),
});

export const CodexPlanUpdatedSchema = z.object({
  method: z.literal('turn/plan/updated'),
  params: z.object({
    threadId: z.string().trim().min(1).max(255),
    turnId: z.string().trim().min(1).max(255),
    explanation: z.string().max(1_000).nullable(),
    plan: z.array(
      z.object({
        step: z.string().trim().min(1).max(500),
        status: z.enum(['pending', 'inProgress', 'completed']),
      }),
    ).max(20),
  }),
});

export const CodexItemLifecycleSchema = z.object({
  method: z.enum(['item/started', 'item/completed']),
  params: z.object({
    threadId: z.string().trim().min(1).max(255),
    turnId: z.string().trim().min(1).max(255),
    item: ThreadTurnItemSchema,
  }).passthrough(),
});

export const CodexTurnCompletedSchema = z.object({
  method: z.literal('turn/completed'),
  params: z.object({
    threadId: z.string().trim().min(1).max(255),
    turn: z.object({
      id: z.string().trim().min(1).max(255),
      status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']),
      error: z.unknown().nullable().optional(),
    }).passthrough(),
  }),
});

export const CodexWarningSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('warning'),
    params: z
      .object({
        threadId: z.string().trim().min(1).max(255).nullable(),
        message: z.string().trim().min(1).max(1_000),
      })
      .passthrough(),
  }),
  z.object({
    method: z.enum(['configWarning', 'deprecationNotice']),
    params: z
      .object({
        summary: z.string().trim().min(1).max(1_000),
        details: z.string().max(2_000).nullable(),
      })
      .passthrough(),
  }),
]);

const ScopedRequestSchema = z.object({
  threadId: z.string().trim().min(1).max(255),
  turnId: z.string().trim().min(1).max(255),
  itemId: z.string().trim().min(1).max(255),
});

export const CodexCommandApprovalRequestSchema = z.object({
  id: CodexRequestIdSchema,
  method: z.literal('item/commandExecution/requestApproval'),
  params: ScopedRequestSchema.extend({
    approvalId: z.string().trim().min(1).max(255).nullable().optional(),
    command: z.string().max(20_000).nullable().optional(),
    cwd: z.string().max(4_096).nullable().optional(),
    reason: z.string().max(1_000).nullable().optional(),
  }).passthrough(),
});

export const CodexFileApprovalRequestSchema = z.object({
  id: CodexRequestIdSchema,
  method: z.literal('item/fileChange/requestApproval'),
  params: ScopedRequestSchema.extend({
    reason: z.string().max(1_000).nullable().optional(),
    grantRoot: z.string().max(4_096).nullable().optional(),
  }).passthrough(),
});

export const CodexPermissionsApprovalRequestSchema = z.object({
  id: CodexRequestIdSchema,
  method: z.literal('item/permissions/requestApproval'),
  params: ScopedRequestSchema.extend({
    cwd: z.string().trim().min(1).max(4_096),
    reason: z.string().max(1_000).nullable(),
    permissions: z.object({
      network: z.object({ enabled: z.boolean().nullable() }).nullable(),
      fileSystem: z.unknown().nullable(),
    }),
  }),
});

export const CodexUserInputRequestSchema = z.object({
  id: CodexRequestIdSchema,
  method: z.literal('item/tool/requestUserInput'),
  params: ScopedRequestSchema.extend({
    questions: z.array(
      z.object({
        id: z.string().trim().min(1).max(255),
        header: z.string().max(200),
        question: z.string().trim().min(1).max(2_000),
        isOther: z.boolean(),
        isSecret: z.boolean(),
        options: z.array(
          z.object({
            label: z.string().trim().min(1).max(500),
            description: z.string().max(1_000),
          }),
        ).max(12).nullable(),
      }),
    ).min(1).max(3),
  }),
});

export type CodexMethodEnvelope = z.infer<typeof CodexMethodEnvelopeSchema>;
export type CodexRequestId = z.infer<typeof CodexRequestIdSchema>;
