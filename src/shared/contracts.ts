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

export const TaskBehaviorSchema = z.enum(['answer', 'guide', 'act']);

export const RuntimeToolIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/u);

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

export const HOST_ALWAYS_CONFIRM_ACTIONS = [
  ...SensitiveActionSchema.options,
] as const;

export const ProposedActionSchema = z.object({
  action: SensitiveActionSchema.or(
    z.enum([
      'answer',
      'guide',
      'observe_screen',
      'open_url',
      'click_element',
      'type_text',
      'press_key',
      'scroll',
      'drag',
      'read_file',
    ]),
  ),
  toolId: RuntimeToolIdSchema.optional(),
  operation: z.string().trim().min(1).max(100).optional(),
  /** @deprecated Read only for persisted v1 tasks. Policy does not use it. */
  capability: CapabilitySchema.optional(),
  description: z.string().min(1),
  target: z.string().optional(),
  parameters: z
    .record(
      z.string().min(1).max(100),
      z.union([
        z.string().max(100_000),
        z.array(z.string().max(8_000)).max(100),
      ]),
    )
    .refine((parameters) => Object.keys(parameters).length <= 64, {
      message: 'An action cannot contain more than 64 parameters.',
    })
    .optional(),
});

export const SuccessCriterionSchema = z.object({
  description: z.string().min(1),
  verifier: z.string().min(1),
});

export const LegacyTaskContractV2Schema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().uuid(),
  originalRequest: z.string().min(2).max(8_000),
  behavior: TaskBehaviorSchema,
  objective: z.string().min(2),
  successCriteria: z.array(SuccessCriterionSchema).min(1),
  approvalPolicy: z.object({
    alwaysConfirm: z.array(SensitiveActionSchema),
  }),
  limits: z.object({
    maxSteps: z.number().int().positive().max(200),
    maxMinutes: z.number().int().positive().max(120),
  }),

  // Accepted only so existing persisted records remain readable. New task
  // contracts do not emit these fields and policy never consults them.
  domain: DomainSchema.optional(),
  interactionMode: InteractionModeSchema.optional(),
  capabilities: z.array(CapabilitySchema).min(1).optional(),
  scope: z
    .object({
      allowedApps: z.array(z.string()),
      allowedDomains: z.array(z.string()),
      allowedPaths: z.array(z.string()),
    })
    .optional(),
  approvals: z
    .object({
      alwaysConfirm: z.array(SensitiveActionSchema),
    })
    .optional(),
});

export const AgentTaskContractV3Schema = z.object({
  schemaVersion: z.literal(3),
  id: z.string().uuid(),
  originalRequest: z.string().min(2).max(8_000),
  approvalPolicy: z.object({
    alwaysConfirm: z.array(SensitiveActionSchema),
  }),
  limits: z.object({
    maxToolCalls: z.number().int().positive().max(200),
    maxMinutes: z.number().int().positive().max(120),
  }),
});

export const AgentTaskContractV4Schema = z.object({
  schemaVersion: z.literal(4),
  id: z.string().uuid(),
  originalRequest: z.string().min(2).max(8_000),
  approvalPolicy: z.object({
    alwaysConfirm: z.array(SensitiveActionSchema),
  }),
  limits: z.object({
    maxImages: z.number().int().positive().max(100),
    maxMicroUsd: z.number().int().positive().max(20_000_000),
    maxMinutes: z.number().int().positive().max(120),
    maxModelSamples: z.number().int().positive().max(200),
    maxToolCalls: z.number().int().positive().max(200),
  }),
});

function normalizeLegacyGoal(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const goal = value as Record<string, unknown>;
  if (goal.schemaVersion !== undefined && goal.schemaVersion !== 2) {
    return goal;
  }
  const legacyMode = goal.interactionMode;
  const behavior =
    goal.behavior ??
    (legacyMode === 'mixed' ? 'act' : legacyMode);
  return {
    ...goal,
    schemaVersion: 2,
    behavior,
    approvalPolicy: { alwaysConfirm: [...HOST_ALWAYS_CONFIRM_ACTIONS] },
  };
}

export const TaskContractSchema = z.preprocess(
  normalizeLegacyGoal,
  z.union([
    LegacyTaskContractV2Schema,
    AgentTaskContractV3Schema,
    AgentTaskContractV4Schema,
  ]),
);

/** @deprecated Use TaskContractSchema for new code. */
export const GoalSpecSchema = TaskContractSchema;

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
  tool: z
    .object({
      toolId: RuntimeToolIdSchema,
      operation: z.string().trim().min(1).max(100),
    })
    .optional(),
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

export const ActionApprovalGrantSchema = z.object({
  interactionId: z.string().uuid(),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  action: ProposedActionSchema,
  approvedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

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

export const LegacyTaskProgressSchema = z.object({
  currentStep: z.number().int().nonnegative(),
  maxSteps: z.number().int().positive().max(200),
});

export const AgentTaskProgressSchema = z.object({
  kind: z.literal('tool_calls'),
  completed: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(200),
});

export const TaskProgressSchema = z.union([
  LegacyTaskProgressSchema,
  AgentTaskProgressSchema,
]);

export const SteeringInstructionSchema = z.object({
  id: z.string().uuid(),
  instruction: z.string().min(1).max(8_000),
  createdAt: z.string().datetime(),
  requiresGoalReview: z.literal(true),
});

export const TaskSnapshotSchema = z
  .object({
    taskId: z.string().uuid(),
    request: z.string().min(2).max(8_000),
    phase: TaskPhaseSchema,
    goal: GoalSpecSchema.nullable(),
    messages: z.array(TaskMessageSchema).max(200),
    pendingInteraction: PendingInteractionSchema.nullable(),
    approvalGrant: ActionApprovalGrantSchema.nullable(),
    progress: TaskProgressSchema.nullable(),
    queuedSteering: z.array(SteeringInstructionSchema).max(50),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    lastEvent: TaskEventSchema.nullable(),
  })
  .superRefine((snapshot, context) => {
    const mismatchedMessage = snapshot.messages.some(
      (message) => message.taskId !== snapshot.taskId,
    );
    if (mismatchedMessage) {
      context.addIssue({
        code: 'custom',
        message: 'Task messages must belong to the snapshot task.',
        path: ['messages'],
      });
    }
    if (
      snapshot.pendingInteraction &&
      snapshot.pendingInteraction.taskId !== snapshot.taskId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The pending interaction must belong to the snapshot task.',
        path: ['pendingInteraction', 'taskId'],
      });
    }
    if (snapshot.lastEvent && snapshot.lastEvent.taskId !== snapshot.taskId) {
      context.addIssue({
        code: 'custom',
        message: 'The latest event must belong to the snapshot task.',
        path: ['lastEvent', 'taskId'],
      });
    }
  });

export const SubmitTaskRequestSchema = z.object({
  text: z.string().trim().min(2).max(8_000),
});

export const GetUsageBudgetRequestSchema = z.object({
  taskId: z.string().uuid().optional(),
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

export const ConsumeApprovalGrantRequestSchema = z.object({
  taskId: z.string().uuid(),
  action: ProposedActionSchema,
});

export const SteerTaskRequestSchema = z.object({
  taskId: z.string().uuid(),
  instruction: z.string().trim().min(1).max(8_000),
});

export const TaskUpdateSchema = z
  .object({
    event: TaskEventSchema,
    snapshot: TaskSnapshotSchema,
  })
  .superRefine((update, context) => {
    if (
      update.event.taskId !== update.snapshot.taskId ||
      update.event.eventId !== update.snapshot.lastEvent?.eventId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Task update event and snapshot do not match.',
      });
    }
  });

export const TaskHistorySchema = z.object({
  events: z.array(TaskEventSchema),
  persistence: z.object({
    mode: z.enum(['postgres', 'session_only']),
    summary: z.string().min(1).max(500),
  }),
  snapshots: z.array(TaskSnapshotSchema),
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

export const SystemPermissionSchema = z.enum([
  'accessibility',
  'microphone',
  'screen_recording',
]);

export const PrimaryLanguageSchema = z.enum([
  'ar',
  'de',
  'en',
  'es',
  'fr',
  'hi',
  'id',
  'it',
  'ja',
  'ko',
  'ms',
  'nl',
  'pl',
  'pt',
  'ru',
  'th',
  'tr',
  'uk',
  'vi',
  'zh',
]);

export const AppLanguageSchema = z.enum(['en', 'vi']);

export const AppPreferencesSchema = z.object({
  appLanguage: AppLanguageSchema.default('en'),
  muteSystemAudioWhileSpeaking: z.boolean().default(false),
  primaryLanguage: PrimaryLanguageSchema.nullable(),
});

export const UpdateAppPreferencesRequestSchema = z.object({
  appLanguage: AppLanguageSchema.default('en'),
  muteSystemAudioWhileSpeaking: z.boolean().default(false),
  primaryLanguage: PrimaryLanguageSchema,
});

export const SetVoiceAudioDuckingRequestSchema = z.object({
  active: z.boolean(),
});

export const AppUpdateStatusSchema = z
  .object({
    currentVersion: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(1_000),
    phase: z.enum([
      'unsupported',
      'idle',
      'checking',
      'downloading',
      'ready',
      'installing',
      'up_to_date',
      'error',
    ]),
    targetVersion: z.string().trim().min(1).max(100).nullable(),
  })
  .superRefine((status, context) => {
    if (
      (status.phase === 'ready' || status.phase === 'installing') &&
      !status.targetVersion
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A downloaded update must include its target version.',
        path: ['targetVersion'],
      });
    }
  });

export const VoiceStatusSchema = z.object({
  state: z.enum(['not_configured', 'ready', 'unavailable', 'error']),
  provider: z.literal('openai'),
  model: z.literal('gpt-realtime-whisper'),
  summary: z.string().min(1),
});

export const CompanionStateSchema = z.enum([
  'idle',
  'guiding',
  'listening',
  'processing',
  'sending',
  'working',
  'completed',
  'error',
]);

export const PresentationStateSchema = z.enum([
  'ready',
  'listening',
  'thinking',
  'working',
  'needs_attention',
  'done',
  'error',
]);

const UsageBudgetPeriodSchema = z.object({
  limitMicroUsd: z.number().int().nonnegative(),
  remainingMicroUsd: z.number().int().nonnegative(),
  reservedMicroUsd: z.number().int().nonnegative(),
  settledMicroUsd: z.number().int().nonnegative(),
});

export const UsageBudgetSnapshotSchema = z.object({
  actualMicroUsd: z.number().int().nonnegative(),
  daily: UsageBudgetPeriodSchema,
  enforcementMode: z.enum(['observe', 'enforce']),
  estimatedMicroUsd: z.number().int().nonnegative(),
  monthEndsAt: z.string().datetime(),
  monthly: UsageBudgetPeriodSchema,
  periodStartsAt: z.string().datetime(),
  source: z.enum(['hosted', 'local_advisory']),
  task: UsageBudgetPeriodSchema,
  warningThresholdMicroUsd: z.number().int().nonnegative(),
});

export const CompanionVoiceActivitySchema = z.object({
  appLanguage: AppLanguageSchema.default('en'),
  phase: z.enum([
    'requesting_permission',
    'connecting',
    'listening',
    'processing',
  ]),
  transcript: z.string().max(8_000),
});

export const CompanionPositionSchema = z.object({
  x: z.number().int().min(0).max(100_000),
  y: z.number().int().min(0).max(100_000),
});

export const CompanionGuidanceSchema = z.object({
  message: z.string().trim().min(1).max(240),
  playback: z.enum(['playing', 'paused']).default('playing'),
  side: z.enum(['left', 'right']),
  target: z.string().trim().min(1).max(80).optional(),
});

export const CompanionSpeechSchema = z.object({
  id: z.string().uuid(),
  dataBase64: z
    .string()
    .min(1)
    .max(7_000_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  mimeType: z.literal('audio/mpeg'),
});

export const ConfigureVoiceRequestSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20)
    .max(500)
    .refine((value) => value.startsWith('sk-'), {
      message: 'Enter a valid OpenAI API key.',
    }),
});

export const RecordVoiceTranscriptRequestSchema = z.object({
  text: z.string().trim().min(1).max(8_000),
});

export const CreateVoiceCallRequestSchema = z.object({
  offerSdp: z.string().min(1).max(200_000),
});

export const VoiceCallAnswerSchema = z.object({
  answerSdp: z.string().min(1).max(200_000),
});

export const VoiceDiagnosticSchema = z.object({
  error: z.object({
    message: z.string().min(1).max(2_000),
    name: z.string().min(1).max(200).optional(),
  }),
  step: z.enum([
    'client_session',
    'data_channel',
    'microphone',
    'peer_connection',
    'realtime_call',
    'remote_description',
  ]),
});

export const VoiceShortcutEventSchema = z.object({
  action: z.enum(['pressed', 'released']),
  source: z.literal('global'),
});

export const AuthUserSchema = z.object({
  id: z.string().min(1).max(255),
  email: z.string().email().max(320),
  name: z.string().min(1).max(255),
});

export const AuthStatusSchema = z.object({
  state: z.enum(['signed_out', 'signed_in', 'error']),
  configured: z.boolean(),
  user: AuthUserSchema.nullable(),
  summary: z.string().min(1).max(1_000),
});

export const MembershipStatusSchema = z.object({
  state: z.enum(['bypassed', 'inactive', 'active', 'expired', 'error']),
  required: z.boolean(),
  referenceCode: z.string().regex(/^TRC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/),
  expiresAt: z.string().datetime().nullable(),
  summary: z.string().min(1).max(1_000),
});

export const ActivateMembershipRequestSchema = z.object({
  code: z.string().trim().min(40).max(4_096),
});

export type Capability = z.infer<typeof CapabilitySchema>;
export type ActionApprovalGrant = z.infer<typeof ActionApprovalGrantSchema>;
export type AppLanguage = z.infer<typeof AppLanguageSchema>;
export type AppPreferences = z.infer<typeof AppPreferencesSchema>;
export type AppUpdateStatus = z.infer<typeof AppUpdateStatusSchema>;
export type AuthStatus = z.infer<typeof AuthStatusSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type ActivateMembershipRequest = z.infer<
  typeof ActivateMembershipRequestSchema
>;
export type CompanionPosition = z.infer<typeof CompanionPositionSchema>;
export type CompanionState = z.infer<typeof CompanionStateSchema>;
export type PresentationState = z.infer<typeof PresentationStateSchema>;
export type CompanionVoiceActivity = z.infer<
  typeof CompanionVoiceActivitySchema
>;
export type CompanionGuidance = z.infer<typeof CompanionGuidanceSchema>;
export type CompanionSpeech = z.infer<typeof CompanionSpeechSchema>;
export type ConfigureVoiceRequest = z.infer<
  typeof ConfigureVoiceRequestSchema
>;
export type CreateVoiceCallRequest = z.infer<
  typeof CreateVoiceCallRequestSchema
>;
export type CuaStatus = z.infer<typeof CuaStatusSchema>;
export type ConsumeApprovalGrantRequest = z.infer<
  typeof ConsumeApprovalGrantRequestSchema
>;
export type DecideApprovalRequest = z.infer<
  typeof DecideApprovalRequestSchema
>;
export type Domain = z.infer<typeof DomainSchema>;
export type GoalSpec = z.infer<typeof GoalSpecSchema>;
export type GetUsageBudgetRequest = z.infer<
  typeof GetUsageBudgetRequestSchema
>;
export type TaskContract = z.infer<typeof TaskContractSchema>;
export type AgentTaskContract = z.infer<typeof AgentTaskContractV4Schema>;
export type InteractionMode = z.infer<typeof InteractionModeSchema>;
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>;
export type PendingInteraction = z.infer<typeof PendingInteractionSchema>;
export type PrimaryLanguage = z.infer<typeof PrimaryLanguageSchema>;
export type ProposedAction = z.infer<typeof ProposedActionSchema>;
export type RecordVoiceTranscriptRequest = z.infer<
  typeof RecordVoiceTranscriptRequestSchema
>;
export type RespondToInteractionRequest = z.infer<
  typeof RespondToInteractionRequestSchema
>;
export type RuntimeToolId = z.infer<typeof RuntimeToolIdSchema>;
export type SensitiveAction = z.infer<typeof SensitiveActionSchema>;
export type SetVoiceAudioDuckingRequest = z.infer<
  typeof SetVoiceAudioDuckingRequestSchema
>;
export type StartTaskRequest = z.infer<typeof StartTaskRequestSchema>;
export type SteeringInstruction = z.infer<typeof SteeringInstructionSchema>;
export type SystemPermission = z.infer<typeof SystemPermissionSchema>;
export type SteerTaskRequest = z.infer<typeof SteerTaskRequestSchema>;
export type SubmitTaskRequest = z.infer<typeof SubmitTaskRequestSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;
export type TaskBehavior = z.infer<typeof TaskBehaviorSchema>;
export type TaskHistory = z.infer<typeof TaskHistorySchema>;
export type TaskMessage = z.infer<typeof TaskMessageSchema>;
export type TaskPhase = z.infer<typeof TaskPhaseSchema>;
export type TaskProgress = z.infer<typeof TaskProgressSchema>;
export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;
export type UsageBudgetSnapshot = z.infer<typeof UsageBudgetSnapshotSchema>;
export type UpdateAppPreferencesRequest = z.infer<
  typeof UpdateAppPreferencesRequestSchema
>;
export type VoiceCallAnswer = z.infer<typeof VoiceCallAnswerSchema>;
export type VoiceDiagnostic = z.infer<typeof VoiceDiagnosticSchema>;
export type VoiceShortcutEvent = z.infer<typeof VoiceShortcutEventSchema>;
export type VoiceStatus = z.infer<typeof VoiceStatusSchema>;
