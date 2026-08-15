import { z } from 'zod';

export const DomainSchema = z.enum([
  'education',
  'productivity',
  'coding',
  'research',
  'business',
  'creative',
  'general',
]);

export const InteractionModeSchema = z.enum([
  'answer',
  'guide',
  'act',
  'mixed',
]);

export const CapabilitySchema = z.enum([
  'conversation',
  'web_search',
  'browser',
  'computer_use',
  'filesystem',
  'terminal',
  'code_editor',
  'documents',
  'email',
  'calendar',
  'connectors',
  'media',
]);

export const SensitiveActionSchema = z.enum([
  'login',
  'send',
  'submit',
  'upload',
  'download',
  'delete',
  'purchase',
  'install',
  'run_command',
  'write_file',
]);

export const ProposedActionSchema = z.object({
  action: SensitiveActionSchema.or(
    z.enum([
      'answer',
      'guide',
      'observe_screen',
      'open_url',
      'click_element',
      'type_text',
      'read_file',
    ]),
  ),
  capability: CapabilitySchema,
  description: z.string().min(1),
  target: z.string().optional(),
  parameters: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional(),
});

export const SuccessCriterionSchema = z.object({
  description: z.string().min(1),
  verifier: z.string().min(1),
});

export const GoalSpecSchema = z.object({
  id: z.string().uuid(),
  originalRequest: z.string().min(2).max(8_000),
  domain: DomainSchema,
  interactionMode: InteractionModeSchema,
  objective: z.string().min(2),
  successCriteria: z.array(SuccessCriterionSchema).min(1),
  capabilities: z.array(CapabilitySchema).min(1),
  scope: z.object({
    allowedApps: z.array(z.string()),
    allowedDomains: z.array(z.string()),
    allowedPaths: z.array(z.string()),
  }),
  approvals: z.object({
    alwaysConfirm: z.array(SensitiveActionSchema),
  }),
  limits: z.object({
    maxSteps: z.number().int().positive().max(200),
    maxMinutes: z.number().int().positive().max(120),
  }),
});

export const TaskPhaseSchema = z.enum([
  'idle',
  'interpreting',
  'clarifying',
  'ready',
  'awaiting_input',
  'awaiting_approval',
  'planning',
  'observing',
  'acting',
  'verifying',
  'paused',
  'blocked',
  'completed',
  'failed',
  'cancelled',
]);

export const TaskEventSchema = z.object({
  eventId: z.string().uuid(),
  taskId: z.string().uuid(),
  phase: TaskPhaseSchema,
  timestamp: z.string().datetime(),
  status: z.enum(['success', 'warning', 'error']),
  summary: z.string().min(1),
  nextActions: z.array(z.string()),
  artifacts: z.array(z.string()),
});

const PendingInteractionBaseSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  prompt: z.string().min(1).max(2_000),
  createdAt: z.string().datetime(),
});

export const ClarificationInteractionSchema =
  PendingInteractionBaseSchema.extend({
    kind: z.literal('clarification'),
    choices: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          label: z.string().min(1).max(500),
        }),
      )
      .max(12)
      .optional(),
  });

export const ApprovalInteractionSchema = PendingInteractionBaseSchema.extend({
  kind: z.literal('approval'),
  expiresAt: z.string().datetime(),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  action: ProposedActionSchema,
  consequence: z.string().min(1).max(2_000),
});

export const PendingInteractionSchema = z.discriminatedUnion('kind', [
  ClarificationInteractionSchema,
  ApprovalInteractionSchema,
]);

export const TaskMessageSchema = z.object({
  messageId: z.string().uuid(),
  taskId: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system']),
  kind: z.enum([
    'request',
    'clarification',
    'answer',
    'approval_request',
    'approval_decision',
    'steering',
    'status',
  ]),
  text: z.string().min(1).max(8_000),
  timestamp: z.string().datetime(),
});

export const TaskProgressSchema = z.object({
  currentStep: z.number().int().nonnegative(),
  maxSteps: z.number().int().positive().max(200),
});

export const TaskSnapshotSchema = z.object({
  taskId: z.string().uuid(),
  request: z.string().min(2),
  phase: TaskPhaseSchema,
  goal: GoalSpecSchema.nullable(),
  messages: z.array(TaskMessageSchema).max(200),
  pendingInteraction: PendingInteractionSchema.nullable(),
  progress: TaskProgressSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastEvent: TaskEventSchema.nullable(),
});

export const SubmitTaskRequestSchema = z.object({
  text: z.string().trim().min(2).max(8_000),
});

export const CancelTaskRequestSchema = z.object({
  taskId: z.string().uuid(),
});

export const StartTaskRequestSchema = z.object({
  taskId: z.string().uuid(),
});

export const RespondToInteractionRequestSchema = z.object({
  taskId: z.string().uuid(),
  interactionId: z.string().uuid(),
  kind: z.literal('answer'),
  text: z.string().trim().min(1).max(8_000),
});

export const DecideApprovalRequestSchema = z.object({
  taskId: z.string().uuid(),
  interactionId: z.string().uuid(),
  kind: z.literal('approval'),
  decision: z.enum(['approve', 'deny']),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

export const RequestTaskInputSchema = z.object({
  taskId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(2_000),
  choices: ClarificationInteractionSchema.shape.choices,
});

export const RequestApprovalSchema = z.object({
  taskId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(2_000),
  consequence: z.string().trim().min(1).max(2_000),
  action: ProposedActionSchema,
});

export const SteerTaskRequestSchema = z.object({
  taskId: z.string().uuid(),
  instruction: z.string().trim().min(1).max(8_000),
});

export const TaskUpdateSchema = z.object({
  event: TaskEventSchema,
  snapshot: TaskSnapshotSchema,
});

export const CuaStatusSchema = z.object({
  state: z.enum(['disconnected', 'permission_required', 'ready', 'error']),
  available: z.boolean(),
  platform: z.enum(['darwin', 'win32', 'linux', 'unsupported']),
  version: z.string().optional(),
  permissions: z
    .object({
      accessibility: z.boolean(),
      screenRecording: z.boolean(),
    })
    .optional(),
  summary: z.string(),
  nextActions: z.array(z.string()),
});

export type Capability = z.infer<typeof CapabilitySchema>;
export type CuaStatus = z.infer<typeof CuaStatusSchema>;
export type DecideApprovalRequest = z.infer<
  typeof DecideApprovalRequestSchema
>;
export type Domain = z.infer<typeof DomainSchema>;
export type GoalSpec = z.infer<typeof GoalSpecSchema>;
export type InteractionMode = z.infer<typeof InteractionModeSchema>;
export type PendingInteraction = z.infer<typeof PendingInteractionSchema>;
export type ProposedAction = z.infer<typeof ProposedActionSchema>;
export type RespondToInteractionRequest = z.infer<
  typeof RespondToInteractionRequestSchema
>;
export type SensitiveAction = z.infer<typeof SensitiveActionSchema>;
export type StartTaskRequest = z.infer<typeof StartTaskRequestSchema>;
export type SteerTaskRequest = z.infer<typeof SteerTaskRequestSchema>;
export type SubmitTaskRequest = z.infer<typeof SubmitTaskRequestSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;
export type TaskMessage = z.infer<typeof TaskMessageSchema>;
export type TaskPhase = z.infer<typeof TaskPhaseSchema>;
export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;
