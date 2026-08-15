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

export const TaskSnapshotSchema = z.object({
  taskId: z.string().uuid(),
  request: z.string().min(2),
  phase: TaskPhaseSchema,
  goal: GoalSpecSchema.nullable(),
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
export type Domain = z.infer<typeof DomainSchema>;
export type GoalSpec = z.infer<typeof GoalSpecSchema>;
export type InteractionMode = z.infer<typeof InteractionModeSchema>;
export type SensitiveAction = z.infer<typeof SensitiveActionSchema>;
export type SubmitTaskRequest = z.infer<typeof SubmitTaskRequestSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;
export type TaskPhase = z.infer<typeof TaskPhaseSchema>;
export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;
