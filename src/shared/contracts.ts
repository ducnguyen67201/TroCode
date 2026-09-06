export * from './work-check-contracts';

export * from './classroom-broadcast-contracts';
import { z } from 'zod';

import {
  isPublicClassroomHostname,
  validateClassroomUrl,
} from './classroom-url-policy';
import { VOICE_MODES } from './voice-mode';
import { WorkCheckProjectionSchema, WorkCheckPanelSchema, WorkCheckActionSchema } from './work-check-contracts';


export const RuntimeToolIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/u);

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
  'system_permission',
]);

export const ProposedActionSchema = z.object({
  action: SensitiveActionSchema.or(
    z.enum([
      'answer',
      'guide',
      'observe_screen',
      'open_application',
      'open_url',
      'click_element',
      'type_text',
      'press_key',
      'scroll',
      'drag',
      'read_file',
      'record_activity_signal',
    ]),
  ),
  toolId: RuntimeToolIdSchema.optional(),
  operation: z.string().trim().min(1).max(100).optional(),
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

export const AgentRuntimeKindSchema = z.enum(['coach', 'openai_agents_sdk']);

export const ExecutionProfileSchema = z.enum(['everyday', 'workspace']);

export const TaskLimitsSchema = z.object({
  maxImages: z.number().int().positive().max(100),
  maxMicroUsd: z.number().int().positive().max(20_000_000),
  maxMinutes: z.number().int().positive().max(120),
  maxModelSamples: z.number().int().positive().max(200),
  maxToolCalls: z.number().int().positive().max(200),
});

export const WorkspaceIdentitySchema = z.object({
  selectionId: z.string().uuid(),
  canonicalPath: z.string().trim().min(1).max(4_096),
  displayName: z.string().trim().min(1).max(255),
  selectedAt: z.string().datetime(),
});

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

const ClassroomOriginSchema = z
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

const ClassroomPublicUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2_000)
  .superRefine((value, context) => {
    if (!validateClassroomUrl(value)) {
      context.addIssue({
        code: 'custom',
        message: 'Use a public HTTPS URL without credentials.',
      });
    }
  });

export const ClassroomDirectiveSchema = z.discriminatedUnion('kind', [
  // The deployed Run feed may contain these even when the teacher now uses
  // session broadcasts. Reading a legacy notice grants no execution permission.
  z.object({
    id: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    kind: z.literal('explain_assignment'),
    delivery: z.literal('consent_required'),
    instruction: z.string().trim().min(1).max(4_000),
    criterionIds: z.array(z.string().trim().min(1).max(80)).max(40),
    createdAt: z.string().datetime(),
  }),
  z.object({
    id: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    kind: z.literal('exercise'),
    delivery: z.literal('manual_only'),
    instruction: z.string().trim().min(1).max(4_000),
    criterionIds: z.array(z.string().trim().min(1).max(80)).max(40),
    createdAt: z.string().datetime(),
  }),
  z.object({
    id: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    kind: z.literal('open_url'),
    delivery: z.enum(['auto_eligible', 'manual_only']),
    instruction: z.string().trim().min(1).max(4_000),
    criterionIds: z.array(z.string().trim().min(1).max(80)).max(40),
    url: ClassroomPublicUrlSchema,
    origin: ClassroomOriginSchema,
    createdAt: z.string().datetime(),
  }),
]);

export const ActivityContextSchema = z.object({
  attemptId: z.string().uuid(),
  workSessionId: z.string().uuid(),
  activityVersionId: z.string().uuid(),
  runId: z.string().uuid(),
  space: z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(240),
  }),
  activity: z.object({
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
  purpose: z.enum(['work', 'help', 'check']).default('work'),
  currentDirective: ClassroomDirectiveSchema.nullable().default(null),
  insightPolicy: z.enum(['explicit_and_operational', 'evidence_candidates']),
  insightPolicyVersion: z.string().trim().min(1).max(64),
  policyAcknowledged: z.boolean(),
  sourceCatalog: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(255),
        role: z.enum(['reference', 'instructions', 'rubric', 'starter']),
      }),
    )
    .max(200),
  priorProgress: z.object({
    completedCriterionIds: z.array(z.string().trim().min(1).max(80)).max(40),
    sessionCount: z.number().int().nonnegative().max(10_000),
    summary: z.string().trim().min(1).max(4_000),
  }),
});

function validateWorkspaceContract(
  contract: {
    activity: z.infer<typeof ActivityContextSchema> | null;
    executionProfile: z.infer<typeof ExecutionProfileSchema>;
    workspace: z.infer<typeof WorkspaceIdentitySchema> | null;
  },
  context: z.RefinementCtx,
): void {
  const workspaceProfile = contract.executionProfile === 'workspace';
  if (workspaceProfile !== Boolean(contract.workspace)) {
    context.addIssue({
      code: 'custom',
      message:
        'Workspace profile and trusted workspace identity must be selected together.',
      path: ['workspace'],
    });
  }
  if (
    contract.activity?.activity.launchTarget === 'workspace' &&
    !workspaceProfile
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Workspace Activities require a trusted workspace.',
      path: ['activity', 'activity', 'launchTarget'],
    });
  }
  if (
    contract.activity?.activity.launchTarget === 'current_surface' &&
    workspaceProfile
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Current-surface Activities cannot claim Workspace authority.',
      path: ['activity', 'activity', 'launchTarget'],
    });
  }
}

export const TaskRouteSchema = z.enum(['coach', 'agent']);
export const RequestedModeSchema = z.enum(['auto', 'coach', 'agent']);

export const CoachProgressSchema = z.object({
  attemptId: z.string().uuid().nullable(),
  activityVersionId: z.string().uuid().nullable(),
  stepNumber: z.number().int().min(0).max(100),
  expectedOutcome: z.string().trim().max(160).nullable(),
  recap: z.string().trim().max(240).nullable(),
}).strict();

export const AgentTaskContractV10Schema = z
  .object({
    schemaVersion: z.literal(10),
    id: z.string().uuid(),
    originalRequest: z.string().min(2).max(8_000),
    runtimeKind: z.literal('openai_agents_sdk'),
    executionProfile: ExecutionProfileSchema,
    workspace: WorkspaceIdentitySchema.nullable(),
    activity: ActivityContextSchema.nullable(),
    limits: TaskLimitsSchema,
  })
  .strict()
  .superRefine(validateWorkspaceContract);

export const AgentTaskContractV11Schema = z
  .object({
    schemaVersion: z.literal(11),
    id: z.string().uuid(),
    originalRequest: z.string().min(2).max(8_000),
    runtimeKind: AgentRuntimeKindSchema,
    route: TaskRouteSchema,
    executionProfile: ExecutionProfileSchema,
    workspace: WorkspaceIdentitySchema.nullable(),
    activity: ActivityContextSchema.nullable(),
    coachProgress: CoachProgressSchema.nullable(),
    limits: TaskLimitsSchema,
  })
  .strict()
  .superRefine((contract, context) => {
    validateWorkspaceContract(contract, context);
    const expectedRuntime = contract.route === 'coach' ? 'coach' : 'openai_agents_sdk';
    if (contract.runtimeKind !== expectedRuntime) {
      context.addIssue({
        code: 'custom',
        message: 'The selected route and runtime kind must agree.',
        path: ['runtimeKind'],
      });
    }
    if (contract.route === 'coach' && contract.executionProfile === 'workspace') {
      context.addIssue({
        code: 'custom',
        message: 'Coach mode cannot claim Workspace execution authority.',
        path: ['route'],
      });
    }
  });

export const TaskContractSchema = z.union([
  AgentTaskContractV11Schema,
  AgentTaskContractV10Schema,
]);
export const GoalSpecSchema = TaskContractSchema;

export const TaskPhaseSchema = z.enum([
  'idle',
  'interpreting',
  'clarifying',
  'ready',
  'awaiting_input',
  'planning',
  'observing',
  'acting',
  'verifying',
  'paused',
  'awaiting_permission',
  'blocked',
  'completed',
  'failed',
  'cancelled',
]);

export const CancellationSourceSchema = z.enum([
  'stop_button',
  'focused_escape',
  'replacement',
  'sign_out',
  'shutdown',
]);

export const ComputerPermissionSchema = z.enum([
  'accessibility',
  'screen_recording',
]);

const TaskLifecycleActionSchema = z.enum([
  'steer',
  'cancel',
  'respond',
  'open_system_settings',
  'continue_without_computer',
  'retry_as_new_task',
]);

const TaskLifecycleWaitingOnSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('permission'),
    interactionId: z.string().uuid(),
    invocationId: z.string().uuid(),
    requiredPermissions: z.array(ComputerPermissionSchema).min(1).max(2),
    since: z.string().datetime({ offset: true }),
  }).strict(),
  z.object({
    kind: z.literal('input'),
    interactionId: z.string().uuid(),
    prompt: z.string().min(1).max(2_000),
    choices: z.array(z.string().min(1).max(500)).max(12),
    since: z.string().datetime({ offset: true }),
  }).strict(),
]);

export const TaskLifecycleSchema = z.object({
  state: z.enum([
    'queued',
    'compiling_outcomes',
    'planning',
    'running',
    'awaiting_permission',
    'executing_tool',
    'awaiting_input',
    'verifying',
    'recovering',
    'completed',
    'blocked',
    'failed',
    'cancelled',
    'expired',
  ]),
  runVersion: z.number().int().positive(),
  phase: TaskPhaseSchema,
  terminal: z.boolean(),
  availableActions: z.array(TaskLifecycleActionSchema).max(4),
  waitingOn: TaskLifecycleWaitingOnSchema.nullable(),
  failure: z.object({
    stage: z.enum([
      'negotiation',
      'provider_request',
      'provider_dispatch',
      'tool_execution',
      'verification',
      'session',
      'runtime',
    ]),
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(1_000),
    retryable: z.boolean(),
  }).strict().nullable(),
  cancellationSource: CancellationSourceSchema.nullable(),
}).strict();

export const TaskEventSchema = z
  .object({
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
  })
  .strict();

export const AgentActivityKindSchema = z.enum([
  'run_started',
  'status',
  'text_delta',
  'tool_started',
  'tool_completed',
  'plan_updated',
  'run_completed',
  'run_failed',
]);

export const AgentActivityUpdateSchema = z
  .object({
    activityId: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    taskId: z.string().uuid(),
    timestamp: z.string().datetime(),
    kind: AgentActivityKindSchema,
    textDelta: z.string().min(1).max(2_000).optional(),
    summary: z.string().min(1).max(1_000).optional(),
    tool: z
      .object({
        name: z.string().trim().min(1).max(100),
        status: z.enum(['running', 'completed', 'failed']),
      })
      .optional(),
    plan: z
      .array(
        z.object({
          step: z.string().trim().min(1).max(500),
          status: z.enum(['pending', 'in_progress', 'completed']),
        }),
      )
      .max(20)
      .optional(),
  })
  .superRefine((activity, context) => {
    const textEvent = activity.kind === 'text_delta';
    if (textEvent !== Boolean(activity.textDelta)) {
      context.addIssue({
        code: 'custom',
        message: 'Only text-delta activity may carry a text delta.',
        path: ['textDelta'],
      });
    }
    const toolEvent =
      activity.kind === 'tool_started' || activity.kind === 'tool_completed';
    if (toolEvent !== Boolean(activity.tool)) {
      context.addIssue({
        code: 'custom',
        message: 'Tool activity requires matching bounded tool metadata.',
        path: ['tool'],
      });
    }
    if (
      activity.kind === 'tool_started' &&
      activity.tool?.status !== 'running'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A started tool must have running status.',
        path: ['tool', 'status'],
      });
    }
    if (
      activity.kind === 'tool_completed' &&
      activity.tool?.status === 'running'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A completed tool cannot have running status.',
        path: ['tool', 'status'],
      });
    }
    if ((activity.kind === 'plan_updated') !== Boolean(activity.plan)) {
      context.addIssue({
        code: 'custom',
        message: 'Only plan activity may carry a bounded plan.',
        path: ['plan'],
      });
    }
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

export const PendingInteractionSchema = ClarificationInteractionSchema;

export const TaskMessageSchema = z.object({
  messageId: z.string().uuid(),
  taskId: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system']),
  kind: z.enum([
    'request',
    'clarification',
    'answer',
    'response',
    'steering',
    'status',
  ]),
  text: z.string().min(1).max(8_000),
  timestamp: z.string().datetime(),
});

export const AgentTaskProgressSchema = z.object({
  kind: z.literal('tool_calls'),
  completed: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(200),
});

export const TaskProgressSchema = AgentTaskProgressSchema;

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
    workCheck: WorkCheckProjectionSchema.nullable().optional(),
    workSessionSync: z.enum(['pending', 'synced', 'unknown']).nullable().optional(),
    phase: TaskPhaseSchema,
    lifecycle: TaskLifecycleSchema.nullable().optional(),
    goal: GoalSpecSchema.nullable(),
    messages: z.array(TaskMessageSchema).max(200),
    pendingInteraction: PendingInteractionSchema.nullable(),
    progress: TaskProgressSchema.nullable(),
    queuedSteering: z.array(SteeringInstructionSchema).max(50),
    runtimeResume: z
      .object({
        kind: z.literal('local_agents_sdk'),
        threadId: z.string().uuid(),
        runtimeVersion: z.string().trim().min(1).max(100),
        checkpointRevision: z.number().int().positive().nullable(),
      })
      .strict()
      .nullable()
      .default(null),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    lastEvent: TaskEventSchema.nullable(),
  })
  .superRefine((snapshot, context) => {
    const report = snapshot.workCheck?.report;
    const activity = snapshot.goal?.activity;
    if (snapshot.workCheck && (!activity || activity.purpose !== 'check' || (report && (
      report.taskId !== snapshot.taskId || report.attemptId !== activity.attemptId || report.activityVersionId !== activity.activityVersionId
    )))) {
      context.addIssue({code:'custom',message:'Check feedback must belong to this task and assignment version.',path:['workCheck']});
    }
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

export const SubmitTaskRequestSchema = z
  .object({
    text: z.string().trim().min(2).max(8_000),
    requestedMode: RequestedModeSchema.default('auto'),
    screenContext: z.enum(['auto', 'required', 'disabled']).default('auto'),
    executionProfile: ExecutionProfileSchema.default('everyday'),
    workspaceSelectionId: z.string().uuid().nullable().default(null),
    activityAttemptId: z.string().uuid().nullable().default(null),
    activityIntent: z.enum(['work', 'help', 'check']).default('work'),
    teacherClassroomSelectionId: z.string().uuid().nullable().optional(),
  })
  .superRefine((request, context) => {
    if (
      (request.executionProfile === 'workspace') !==
      Boolean(request.workspaceSelectionId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Workspace tasks require a trusted workspace selection.',
        path: ['workspaceSelectionId'],
      });
    }
  });

export const KnowledgeCapabilitiesSchema = z.object({
  classroomBroadcasts: z.object({ contractVersion: z.literal(1) }).optional(),
  classroomGuidance: z.object({ contractVersion: z.literal(1) }).optional(),
  knowledgeSpaces: z.object({
    enabled: z.boolean(),
    contractVersion: z.literal(2),
  }),
});
export const ClassroomAccountRoleSchema = z.enum([
  'unassigned',
  'teacher',
  'student',
]);
export const KnowledgeSpaceSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(240),
  description: z.string().max(4_000),
  purposeLabel: z.string().max(120).nullable(),
  role: z.enum(['owner', 'facilitator', 'participant']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const KnowledgeSpaceListSchema = z.object({
  classroomRole: ClassroomAccountRoleSchema,
  items: z.array(KnowledgeSpaceSummarySchema).max(500),
  nextCursor: z
    .object({ createdAt: z.string().datetime(), id: z.string().uuid() })
    .nullable(),
});
export const CreateKnowledgeSpaceRequestSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().max(4_000).default(''),
  purposeLabel: z.string().trim().max(120).nullable().default(null),
});
export const CreateKnowledgeSpaceResponseSchema = z.object({
  newlyCreated: z.boolean(),
  space: KnowledgeSpaceSummarySchema,
});
export const KnowledgeGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(240),
  participantCount: z.number().int().nonnegative().optional().default(0),
  createdAt: z.string().datetime(),
});
export const KnowledgeGroupListSchema = z.object({
  items: z.array(KnowledgeGroupSchema).max(500),
});
export const CreateKnowledgeGroupRequestSchema = z.object({
  spaceId: z.string().uuid(),
  clientId: z.string().uuid(),
  name: z.string().trim().min(1).max(240),
});
export const KnowledgeSpaceMemberSchema = z.object({
  classroomRole: ClassroomAccountRoleSchema,
  email: z.string().email().max(320),
  joinedAt: z.string().datetime(),
  name: z.string().trim().min(1).max(255),
  role: z.enum(['owner', 'facilitator', 'participant']),
  userId: z.string().trim().min(1).max(255),
});
export const KnowledgeSpaceMemberListSchema = z.object({
  items: z.array(KnowledgeSpaceMemberSchema).max(2_000),
});
export const AddKnowledgeSpaceMembersRequestSchema = z.object({
  spaceId: z.string().uuid(),
  clientId: z.string().uuid(),
  emails: z.array(z.string().trim().email().max(320)).min(1).max(500),
  role: z.enum(['facilitator', 'participant']),
});
export const AddKnowledgeSpaceMembersResultSchema = z.object({
  addedEmails: z.array(z.string().email().max(320)).max(500),
  alreadyMemberEmails: z.array(z.string().email().max(320)).max(500),
  requestedRole: z.enum(['facilitator', 'participant']),
  roleMismatchEmails: z.array(z.string().email().max(320)).max(500),
  spaceId: z.string().uuid(),
  unavailableEmails: z.array(z.string().email().max(320)).max(500),
});
export const CreateKnowledgeInviteRequestSchema = z.object({
  spaceId: z.string().uuid(),
  clientId: z.string().uuid(),
  groupId: z.string().uuid().nullable(),
  role: z.enum(['facilitator', 'participant']),
  maxUses: z.number().int().min(1).max(10_000),
  expiresAt: z.string().datetime().nullable(),
});
export const KnowledgeInviteSchema = z.object({
  id: z.string().uuid(),
  code: z.string().trim().min(8).max(128),
  role: z.enum(['facilitator', 'participant']),
  maxUses: z.number().int().positive(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export const RedeemKnowledgeInviteRequestSchema = z.object({
  code: z.string().trim().min(8).max(128),
});
export const RedeemKnowledgeInviteResponseSchema = z.object({
  spaceId: z.string().uuid(),
  role: z.enum(['owner', 'facilitator', 'participant']),
});
export const KnowledgeSourceSummarySchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().trim().min(1).max(255),
  relativePath: z.string().trim().min(1).max(2_000),
  role: z.enum([
    'reference',
    'instructions',
    'rubric',
    'starter',
    'submission',
  ]),
  createdAt: z.string().datetime(),
  latestVersion: z
    .object({
      id: z.string().uuid(),
      state: z.enum(['pending_upload', 'processing', 'ready', 'failed']),
      mediaType: z.enum(['text/plain', 'text/markdown', 'application/pdf']),
      byteSize: z.number().int().positive(),
      createdAt: z.string().datetime(),
      errorCode: z.string().max(80).nullable(),
    })
    .nullable(),
});
export const KnowledgeSourceListSchema = z.object({
  items: z.array(KnowledgeSourceSummarySchema).max(1_000),
});

export const SelectKnowledgeFilesRequestSchema = z.object({
  role: z.enum([
    'reference',
    'instructions',
    'rubric',
    'starter',
    'submission',
  ]),
  selectionKind: z.enum(['files', 'folder']),
});
export const KnowledgeFilePreviewSchema = z.object({
  displayName: z.string().trim().min(1).max(255),
  relativePath: z.string().trim().min(1).max(2_000),
  mediaType: z.enum(['text/plain', 'text/markdown', 'application/pdf']),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024),
});
export const KnowledgeFileSelectionSchema = z.object({
  selectionId: z.string().uuid(),
  role: z.enum([
    'reference',
    'instructions',
    'rubric',
    'starter',
    'submission',
  ]),
  files: z.array(KnowledgeFilePreviewSchema).min(1).max(100),
  totalBytes: z
    .number()
    .int()
    .positive()
    .max(250 * 1024 * 1024),
});
export const UploadKnowledgeSelectionRequestSchema = z.object({
  spaceId: z.string().uuid(),
  selectionId: z.string().uuid(),
});
export const SubmitKnowledgeSelectionRequestSchema = z.object({
  attemptId: z.string().uuid(),
  selectionId: z.string().uuid(),
});
export const KnowledgeUploadResultSchema = z.object({
  uploaded: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
  cancelled: z.boolean(),
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
export const KnowledgeActivityDraftSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(['draft', 'published', 'archived']),
  definition: SaveKnowledgeActivityRequestSchema.shape.definition,
  updatedAt: z.string().datetime(),
});
export const PublishKnowledgeActivityRequestSchema = z.object({
  spaceId: z.string().uuid(),
  activityId: z.string().uuid(),
  clientId: z.string().uuid(),
});
export const KnowledgeActivityVersionSchema = z.object({
  id: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  publishedAt: z.string().datetime(),
  newlyCreated: z.boolean(),
});
export const PublishedKnowledgeActivitySchema = z.object({
  activityId: z.string().uuid(),
  versionId: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  title: z.string().trim().min(1).max(240),
  objective: z.string().trim().min(1).max(4_000),
  criteria: z.array(ActivityCriterionSchema).max(40),
  allowRoomJoin: z.boolean(),
  allowedOrigins: z.array(ClassroomOriginSchema).max(20),
  publishedAt: z.string().datetime(),
});
export const PublishedKnowledgeActivityListSchema = z.object({
  items: z.array(PublishedKnowledgeActivitySchema).max(500),
});
export const KnowledgeClassSessionActivitySchema = z.object({
  position: z.number().int().nonnegative(),
  runId: z.string().uuid(),
  activityVersionId: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  objective: z.string().trim().min(1).max(4_000),
  criteria: z.array(ActivityCriterionSchema).max(40),
  allowRoomJoin: z.boolean(),
  allowedOrigins: z.array(ClassroomOriginSchema).max(20),
});
export const KnowledgeClassSessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  state: z.enum(['draft', 'open', 'closed', 'archived']),
  activities: z.array(KnowledgeClassSessionActivitySchema).min(1).max(50),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  newlyCreated: z.boolean().optional(),
});
export const KnowledgeClassSessionListSchema = z.object({
  items: z.array(KnowledgeClassSessionSchema).max(500),
});
export const CreateKnowledgeClassSessionRequestSchema = z
  .object({
    spaceId: z.string().uuid(),
    clientId: z.string().uuid(),
    title: z.string().trim().min(1).max(240),
    activityVersionIds: z.array(z.string().uuid()).min(1).max(50),
  })
  .superRefine((session, context) => {
    if (
      new Set(session.activityVersionIds).size !==
      session.activityVersionIds.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A Session cannot contain the same Activity more than once.',
        path: ['activityVersionIds'],
      });
    }
  });
export const CreateKnowledgeRunRequestSchema = z
  .object({
    spaceId: z.string().uuid(),
    clientId: z.string().uuid(),
    activityVersionId: z.string().uuid(),
    mode: z.enum(['live', 'async', 'hybrid']),
    opensAt: z.string().datetime().nullable(),
    closesAt: z.string().datetime().nullable(),
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('group'), groupId: z.string().uuid() }),
      z.object({
        kind: z.literal('participants'),
        userIds: z.array(z.string().trim().min(1).max(255)).min(1).max(2_000),
      }),
      z.object({ kind: z.literal('room') }),
    ]),
    insightPolicy: z.enum(['explicit_and_operational', 'evidence_candidates']),
  })
  .superRefine((run, context) => {
    if (run.target.kind === 'room' && run.mode === 'async') {
      context.addIssue({
        code: 'custom',
        message: 'Room Runs must use live or hybrid mode.',
        path: ['mode'],
      });
    }
  });
export const KnowledgeRunSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(['draft', 'open', 'closed', 'archived']),
  assignmentCount: z.number().int().nonnegative().optional(),
  newlyCreated: z.boolean().optional(),
});
export const AssignedActivitySchema = z.object({
  attemptId: z.string().uuid(),
  state: z.enum([
    'assigned',
    'in_progress',
    'blocked',
    'ready_for_review',
    'submitted',
    'completed',
    'withdrawn',
  ]),
  updatedAt: z.string().datetime(),
  run: z.object({
    id: z.string().uuid(),
    mode: z.enum(['live', 'async', 'hybrid']),
    opensAt: z.string().datetime().nullable(),
    closesAt: z.string().datetime().nullable(),
  }),
  activity: z.object({
    title: z.string().max(240),
    objective: z.string().max(4_000),
  }),
  space: z.object({ id: z.string().uuid(), name: z.string().max(240) }),
});
export const AssignedActivityListSchema = z.object({
  items: z.array(AssignedActivitySchema).max(500),
});
export const HostedAttemptContextSchema = z.object({
  startedAt: z.string().datetime().nullable().optional(),
  attemptId: z.string().uuid(),
  userId: z.string().min(1).max(255),
  state: z.enum([
    'assigned',
    'in_progress',
    'blocked',
    'ready_for_review',
    'submitted',
    'completed',
    'withdrawn',
  ]),
  acknowledgedPolicyVersion: z.string().max(64).nullable(),
  run: z.object({
    id: z.string().uuid(),
    state: z.enum(['draft', 'open', 'closed', 'archived']),
    mode: z.enum(['live', 'async', 'hybrid']),
    opensAt: z.string().datetime().nullable(),
    closesAt: z.string().datetime().nullable(),
    insightPolicy: z.enum(['explicit_and_operational', 'evidence_candidates']),
    insightPolicyVersion: z.string().max(64),
  }),
  space: z.object({ id: z.string().uuid(), name: z.string().max(240) }),
  activityVersionId: z.string().uuid(),
  definition: SaveKnowledgeActivityRequestSchema.shape.definition,
  sourceCatalog: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(255),
        role: z.enum(['reference', 'instructions', 'rubric', 'starter']),
      }),
    )
    .max(200),
  starterAvailable: z.boolean(),
  priorProgress: z.object({
    completedCriterionIds: z.array(z.string().trim().min(1).max(80)).max(40),
    sessionCount: z.number().int().nonnegative().max(10_000),
    summary: z.string().trim().min(1).max(4_000),
  }),
});
export const PrepareActivityStarterRequestSchema = z.object({
  attemptId: z.string().uuid(),
});
export const KnowledgeDashboardSchema = z.object({
  kind: z.enum(['snapshot', 'delta']),
  maxSequence: z.number().int().nonnegative(),
  runState: z.enum(['draft', 'open', 'closed', 'archived']),
  participants: z
    .array(
      z.object({
        id: z.string().max(255),
        attemptId: z.string().uuid(),
        state: z.string().max(40),
        status: z
          .enum([
            'not_joined',
            'lobby',
            'working',
            'needs_help',
            'ready',
            'submitted',
            'completed',
            'withdrawn',
            'left',
            'launch_failed',
          ])
          .optional()
          .default('working'),
        joinedAt: z.string().datetime().nullable().optional().default(null),
        leftAt: z.string().datetime().nullable().optional().default(null),
        updatedAt: z.string().datetime(),
        startedAt: z.string().datetime().nullable().optional(),
        lastCheck: z.object({workSessionId: z.string().uuid(), state: z.string().max(40), updatedAt: z.string().datetime()}).nullable().optional(),
        sessionCount: z.number().int().nonnegative(),
        evidenceCount: z.number().int().nonnegative(),
        helpRequestedAt: z.string().datetime().nullable(),
      }),
    )
    .max(500)
    .optional(),
  events: z
    .array(
      z.object({
        sequence: z.number().int().nonnegative(),
        attemptId: z.string().uuid().nullable().optional().default(null),
        type: z.string().max(80),
        payload: z.record(z.string(), z.unknown()),
        createdAt: z.string().datetime(),
      }),
    )
    .max(1_000)
    .optional(),
  counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  helpQueue: z
    .array(
      z.object({
        id: z.string().max(255),
        attemptId: z.string().uuid(),
        state: z.string().max(40),
        status: z
          .enum([
            'not_joined',
            'lobby',
            'working',
            'needs_help',
            'ready',
            'submitted',
            'completed',
            'withdrawn',
            'left',
            'launch_failed',
          ])
          .optional()
          .default('needs_help'),
        joinedAt: z.string().datetime().nullable().optional().default(null),
        leftAt: z.string().datetime().nullable().optional().default(null),
        updatedAt: z.string().datetime(),
        startedAt: z.string().datetime().nullable().optional(),
        lastCheck: z.object({workSessionId: z.string().uuid(), state: z.string().max(40), updatedAt: z.string().datetime()}).nullable().optional(),
        sessionCount: z.number().int().nonnegative(),
        evidenceCount: z.number().int().nonnegative(),
        helpRequestedAt: z.string().datetime().nullable(),
      }),
    )
    .max(500)
    .optional(),
  patterns: z
    .array(
      z.object({
        criterionId: z.string().max(80),
        participantCount: z.number().int().nonnegative(),
        corroboratedCount: z.number().int().nonnegative(),
        agentCandidateCount: z.number().int().nonnegative(),
      }),
    )
    .max(100)
    .optional(),
  suggestions: z
    .array(
      z.union([
        z.object({
          kind: z.literal('individual_follow_up'),
          participantId: z.string().max(255),
          reason: z.literal('explicit_help_request'),
        }),
        z.object({
          kind: z.literal('group_clarification'),
          criterionId: z.string().max(80),
          participantCount: z.number().int().nonnegative(),
          activeParticipants: z.number().int().nonnegative(),
          confidence: z.enum(['moderate', 'high']),
        }),
        z.object({
          kind: z.literal('review_evidence'),
          criterionId: z.string().max(80),
        }),
      ]),
    )
    .max(500)
    .optional(),
});
export const KnowledgeSpaceIdRequestSchema = z.object({
  spaceId: z.string().uuid(),
});
export const KnowledgeAttemptIdRequestSchema = z.object({
  attemptId: z.string().uuid(),
});
export const AcknowledgeKnowledgeAttemptRequestSchema = z.object({
  attemptId: z.string().uuid(),
  policyVersion: z.string().trim().min(1).max(64),
});
export const RequestKnowledgeAttemptHelpSchema = z.object({
  attemptId: z.string().uuid(),
  clientId: z.string().uuid(),
});
export const SetKnowledgeRunStateRequestSchema = z.object({
  spaceId: z.string().uuid(),
  runId: z.string().uuid(),
  state: z.enum(['open', 'closed']),
});
export const GetKnowledgeDashboardRequestSchema = z.object({
  spaceId: z.string().uuid(),
  runId: z.string().uuid(),
  sinceSequence: z.number().int().nonnegative().optional(),
});

export const CreateKnowledgeRoomCodeRequestSchema = z.object({
  spaceId: z.string().uuid(),
  runId: z.string().uuid(),
  clientId: z.string().uuid(),
  expiresAt: z.string().datetime().nullable().default(null),
  maxUses: z.number().int().min(1).max(2_000).default(200),
});
export const KnowledgeRoomCodeSchema = z.object({
  id: z.string().uuid(),
  code: z.string().trim().min(8).max(32),
  maxUses: z.number().int().min(1).max(2_000),
  usedCount: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  newlyCreated: z.boolean(),
});
export const RevokeKnowledgeRoomCodeRequestSchema = z.object({
  spaceId: z.string().uuid(),
  runId: z.string().uuid(),
});
export const KnowledgeRoomRevocationSchema = z.object({
  revoked: z.boolean(),
  revokedAt: z.string().datetime().nullable(),
});
export const JoinKnowledgeRoomRequestSchema = z.object({
  clientId: z.string().uuid(),
  code: z.string().trim().min(8).max(32),
});
export const JoinClassroomSessionRequestSchema =
  JoinKnowledgeRoomRequestSchema.extend({
    autoOpenConsent: z.boolean().optional(),
  });
export const KnowledgeClassroomSessionSchema = z.object({
  attemptId: z.string().uuid(),
  attemptState: z.enum([
    'assigned',
    'in_progress',
    'blocked',
    'ready_for_review',
    'submitted',
    'completed',
    'withdrawn',
  ]),
  run: z.object({
    id: z.string().uuid(),
    state: z.enum(['draft', 'open', 'closed', 'archived']),
    mode: z.enum(['live', 'async', 'hybrid']),
    status: z.enum(['lobby', 'live', 'ended']),
  }),
  space: z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(240),
  }),
  activityVersionId: z.string().uuid(),
  activity: z.object({
    title: z.string().trim().min(1).max(240),
    objective: z.string().trim().min(1).max(4_000),
    launchTarget: z.enum(['none', 'workspace', 'current_surface']),
    requiresSubmission: z.boolean(),
  }),
  currentDirective: ClassroomDirectiveSchema.nullable(),
  joinedAt: z.string().datetime(),
  leftAt: z.string().datetime().nullable().optional().default(null),
});
export const ClassroomSessionProjectionSchema =
  KnowledgeClassroomSessionSchema.extend({
    role: z.literal('student').default('student'),
    autoOpenConsent: z.boolean(),
  });
export const ClassroomDirectiveNoticeSchema = z.object({
  directive: ClassroomDirectiveSchema,
  status: z.enum(['received', 'opened', 'dismissed', 'open_failed']),
});
export const KnowledgeAttemptMutationRequestSchema = z.object({
  attemptId: z.string().uuid(),
  clientId: z.string().uuid(),
});
export const LeaveKnowledgeClassroomResponseSchema = z.object({
  attemptId: z.string().uuid(),
  leftAt: z.string().datetime(),
});
export const ClassroomDirectiveDraftSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('exercise'),
    instruction: z.string().trim().min(1).max(4_000),
    criterionIds: z.array(z.string().trim().min(1).max(80)).max(40),
  }),
  z.object({
    kind: z.literal('open_url'),
    instruction: z.string().trim().min(1).max(4_000),
    criterionIds: z.array(z.string().trim().min(1).max(80)).max(40),
    url: z.string().trim().url().max(2_000),
  }),
]);
export const CreateClassroomDirectiveRequestSchema = z.object({
  spaceId: z.string().uuid(),
  runId: z.string().uuid(),
  clientId: z.string().uuid(),
  directive: ClassroomDirectiveDraftSchema,
});
export const ClassroomDirectiveListSchema = z.object({
  attemptState: KnowledgeClassroomSessionSchema.shape.attemptState,
  runState: z.enum(['draft', 'open', 'closed', 'archived']),
  items: z.array(ClassroomDirectiveSchema).max(100),
  maxSequence: z.number().int().nonnegative(),
});
export const ClaimClassroomDirectiveRequestSchema = z.object({
  attemptId: z.string().uuid(),
  directiveId: z.string().uuid(),
  clientId: z.string().uuid(),
});
export const ClassroomDirectiveClaimSchema = z.union([
  z.object({ execute: z.literal(false) }),
  z.object({
    execute: z.literal(true),
    url: ClassroomPublicUrlSchema,
    origin: ClassroomOriginSchema,
    claimedAt: z.string().datetime(),
  }),
]);
export const SetClassroomLinkConsentRequestSchema = z.object({
  consent: z.boolean(),
});
export const OpenClassroomDirectiveRequestSchema = z.object({
  directive: ClassroomDirectiveSchema,
});
export const DismissClassroomDirectiveRequestSchema = z.object({
  directiveId: z.string().uuid(),
});
export const ReviewKnowledgeAttemptRequestSchema = z.object({
  spaceId: z.string().uuid(),
  runId: z.string().uuid(),
  attemptId: z.string().uuid(),
  clientId: z.string().uuid(),
  action: z.enum(['complete', 'return']),
});
export const ResolveKnowledgeAttemptHelpRequestSchema = z.object({
  spaceId: z.string().uuid(),
  runId: z.string().uuid(),
  attemptId: z.string().uuid(),
  clientId: z.string().uuid(),
});
export const KnowledgeAttemptTransitionSchema = z.object({
  attemptId: z.string().uuid(),
  state: z.enum([
    'assigned',
    'in_progress',
    'blocked',
    'ready_for_review',
    'submitted',
    'completed',
    'withdrawn',
  ]),
  action: z.enum(['complete', 'return']).optional(),
  readyAt: z.string().datetime().optional(),
  reviewedAt: z.string().datetime().optional(),
  newlyCreated: z.boolean().optional(),
  resolved: z.boolean().optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
});

export const WorkspaceRuntimeAvailabilitySchema = z.object({
  available: z.boolean(),
  runtimeVersion: z.string().trim().min(1).max(100).nullable(),
  summary: z.string().trim().min(1).max(1_000),
});

export const SelectWorkspaceRequestSchema = z.object({}).strict();

export const WorkspaceSelectionSchema = WorkspaceIdentitySchema.omit({
  canonicalPath: true,
}).extend({
  runtime: WorkspaceRuntimeAvailabilitySchema,
});

export const GetUsageBudgetRequestSchema = z.object({
  taskId: z.string().uuid().optional(),
});

export const CancelTaskRequestSchema = z.object({
  taskId: z.string().uuid(),
  source: CancellationSourceSchema.default('stop_button'),
});

export const ResolveComputerPermissionRequestSchema = z
  .object({
    taskId: z.string().uuid(),
    action: z.enum([
      'open_system_settings',
      'continue_without_computer',
      'refresh',
    ]),
  })
  .strict();

export const StartTaskRequestSchema = z.object({
  taskId: z.string().uuid(),
});

export const TaskComposerFocusRequestSchema = z
  .object({
    taskId: z.string().uuid(),
  })
  .strict();

export const RespondToInteractionRequestSchema = z.object({
  taskId: z.string().uuid(),
  interactionId: z.string().uuid(),
  kind: z.literal('answer'),
  text: z.string().trim().min(1).max(8_000),
});

export const RequestTaskInputSchema = z.object({
  taskId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(2_000),
  choices: ClarificationInteractionSchema.shape.choices,
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
    mode: z.enum(['postgres', 'local_encrypted', 'session_only']),
    summary: z.string().min(1).max(500),
  }),
  snapshots: z.array(TaskSnapshotSchema),
});

export const ConnectorCatalogItemSchema = z.object({
  catalogKey: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/u),
  displayName: z.string().min(1).max(100),
  description: z.string().min(1).max(1_000),
  maturity: z.enum(['developer_preview', 'beta', 'stable']),
}).strict();

export const ConnectorConnectionSummarySchema = z.object({
  id: z.string().uuid(),
  catalogKey: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/u),
  status: z.enum(['connecting', 'connected', 'reauthorize', 'contract_changed', 'error', 'disconnected']),
  connectedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();

export const ConnectorListSchema = z.object({
  enabled: z.boolean(),
  catalog: z.array(ConnectorCatalogItemSchema).max(100),
  connections: z.array(ConnectorConnectionSummarySchema).max(100),
}).strict();

export const ConnectorAttemptStatusSchema = z.object({
  attemptId: z.string().uuid(),
  catalogKey: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/u),
  status: z.enum(['pending', 'processing', 'connected', 'denied', 'failed', 'expired']),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export const ConnectConnectorRequestSchema = z.object({
  catalogKey: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/u),
}).strict();

export const ConnectorAttemptRequestSchema = z.object({
  attemptId: z.string().uuid(),
}).strict();

export const DisconnectConnectorRequestSchema = z.object({
  connectionId: z.string().uuid(),
}).strict();

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
export const VoiceModeSchema = z.enum(VOICE_MODES);

export const AppPreferencesSchema = z.object({
  appLanguage: AppLanguageSchema.default('en'),
  classroomPetEnabled: z.boolean().default(true),
  muteSystemAudioWhileSpeaking: z.boolean().default(false),
  primaryLanguage: PrimaryLanguageSchema.nullable(),
  voiceMode: VoiceModeSchema.default('dictation'),
});

export const UpdateAppPreferencesRequestSchema = z.object({
  appLanguage: AppLanguageSchema.default('en'),
  classroomPetEnabled: z.boolean().default(true),
  muteSystemAudioWhileSpeaking: z.boolean().default(false),
  primaryLanguage: PrimaryLanguageSchema,
  voiceMode: VoiceModeSchema.default('dictation'),
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

export const VOICE_TRANSCRIPTION_MODEL = 'gpt-transcribe' as const;
export const LEGACY_VOICE_TRANSCRIPTION_MODEL = 'whisper-1' as const;

export const VoiceStatusSchema = z.object({
  state: z.enum(['not_configured', 'ready', 'unavailable', 'error']),
  provider: z.literal('openai'),
  model: z.literal(VOICE_TRANSCRIPTION_MODEL),
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

export const CompanionHoverSchema = z.boolean();

export const TROCODE_COMPANION_SCHEME = 'trocode-companion' as const;
export const MAX_COMPANION_IMAGE_BYTES = 5 * 1_024 * 1_024;

function isStrictBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const contentLength = value.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index);
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    if (!isDigit && !isUpper && !isLower && code !== 43 && code !== 47) {
      return false;
    }
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) return false;
  }
  return true;
}

const StrictCompanionImageBase64Schema = z
  .string()
  .min(4)
  .max(Math.ceil(MAX_COMPANION_IMAGE_BYTES / 3) * 4)
  .refine(isStrictBase64, 'Image data must be strict base64.')
  .refine((value) => {
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    return (value.length / 4) * 3 - padding <= MAX_COMPANION_IMAGE_BYTES;
  }, 'Image data exceeds 5 MiB.');

export const CompanionImageMimeTypeSchema = z.enum(['image/png', 'image/jpeg']);

export const GenerateCompanionImageRequestSchema = z
  .object({
    imageBase64: StrictCompanionImageBase64Schema,
    mimeType: CompanionImageMimeTypeSchema,
    prompt: z.string().trim().min(1).max(400),
    requestId: z.string().uuid(),
  })
  .strict();

export const ActivateCompanionCandidateRequestSchema = z
  .object({
    candidateId: z.string().uuid(),
  })
  .strict();

export const ActivateSavedCompanionRequestSchema = z
  .object({
    companionId: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();

export const CompanionGenerationQuotaSchema = z
  .object({
    limit: z.literal(5),
    periodEndsAt: z.string().datetime(),
    periodStartsAt: z.string().datetime(),
    remaining: z.number().int().min(0).max(5),
    used: z.number().int().min(0).max(5),
  })
  .strict()
  .superRefine((quota, context) => {
    if (quota.used + quota.remaining !== quota.limit) {
      context.addIssue({
        code: 'custom',
        message:
          'Used and remaining companion generations must equal the limit.',
      });
    }
    if (Date.parse(quota.periodStartsAt) >= Date.parse(quota.periodEndsAt)) {
      context.addIssue({
        code: 'custom',
        message:
          'The companion generation period must have a positive duration.',
      });
    }
  });

const CompanionAssetUrlSchema = z
  .string()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);
    const active = /^\/active\/[0-9a-f]{64}$/u.test(url.pathname);
    const candidate =
      /^\/candidate\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        url.pathname,
      );
    if (
      url.protocol !== `${TROCODE_COMPANION_SCHEME}:` ||
      url.hostname !== 'asset' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.toString() !== value ||
      (!active && !candidate)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Companion assets must use the private Tro companion scheme.',
      });
    }
  });

export const CompanionAppearanceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('default') }).strict(),
  z
    .object({
      assetUrl: CompanionAssetUrlSchema,
      kind: z.literal('custom'),
      revision: z.string().regex(/^[0-9a-f]{64}$/u),
    })
    .strict(),
]);

export const CompanionCandidateSchema = z
  .object({
    assetUrl: CompanionAssetUrlSchema,
    expiresAt: z.string().datetime(),
    id: z.string().uuid(),
  })
  .strict();

export const SavedCompanionSchema = z
  .object({
    assetUrl: CompanionAssetUrlSchema,
    createdAt: z.string().datetime(),
    id: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict()
  .superRefine((companion, context) => {
    if (new URL(companion.assetUrl).pathname !== `/active/${companion.id}`) {
      context.addIssue({
        code: 'custom',
        message: 'A saved companion asset must match its identifier.',
        path: ['assetUrl'],
      });
    }
  });

export const CompanionCustomizationStatusSchema = z
  .object({
    appearance: CompanionAppearanceSchema,
    candidate: CompanionCandidateSchema.nullable(),
    quota: CompanionGenerationQuotaSchema.nullable(),
    savedCompanions: z.array(SavedCompanionSchema).max(50),
    state: z.enum(['available', 'unavailable', 'error']),
    summary: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((status, context) => {
    if (status.state === 'available' && status.quota === null) {
      context.addIssue({
        code: 'custom',
        message: 'Available companion customization requires a quota.',
        path: ['quota'],
      });
    }
    const savedIds = new Set(
      status.savedCompanions.map((companion) => companion.id),
    );
    if (savedIds.size !== status.savedCompanions.length) {
      context.addIssue({
        code: 'custom',
        message: 'Saved companion identifiers must be unique.',
        path: ['savedCompanions'],
      });
    }
    if (
      status.appearance.kind === 'custom' &&
      !savedIds.has(status.appearance.revision)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The active custom companion must be in the saved library.',
        path: ['appearance'],
      });
    }
  });

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

export const PlanIdSchema = z.enum(['free', 'basic', 'pro', 'max']);

export const UsageBudgetSnapshotSchema = z.object({
  actualMicroUsd: z.number().int().nonnegative(),
  daily: UsageBudgetPeriodSchema,
  enforcementMode: z.enum(['observe', 'enforce']),
  estimatedMicroUsd: z.number().int().nonnegative(),
  messages: z.object({
    limit: z.number().int().nonnegative(),
    periodEndsAt: z.string().datetime(),
    periodStartsAt: z.string().datetime(),
    remaining: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
  }),
  monthEndsAt: z.string().datetime(),
  monthly: UsageBudgetPeriodSchema,
  periodStartsAt: z.string().datetime(),
  plan: PlanIdSchema.nullable(),
  pricing: z
    .object({
      currency: z.literal('usd'),
      monthlyCents: z.number().int().nonnegative(),
    })
    .nullable(),
  source: z.enum(['hosted', 'local_advisory']),
  task: UsageBudgetPeriodSchema,
  warningThresholdMicroUsd: z.number().int().nonnegative(),
});

export const CompanionVoiceActivitySchema = z
  .object({
    appLanguage: AppLanguageSchema.default('en'),
    destination: z
      .object({
        kind: z.enum(['application', 'tro_composer', 'task']),
        label: z.string().trim().min(1).max(120),
      })
      .strict(),
    message: z.string().trim().min(1).max(240).optional(),
    mode: VoiceModeSchema,
    phase: z.enum([
      'mode_selected',
      'requesting_permission',
      'listening',
      'processing',
      'committing',
      'complete',
      'error',
    ]),
    transcript: z.string().max(8_000),
  })
  .strict();

export const CompanionPositionSchema = z.object({
  x: z.number().int().min(0).max(100_000),
  y: z.number().int().min(0).max(100_000),
});

const CursorBuddyPositionSchema = z
  .object({
    x: z.number().int().min(-100_000).max(100_000),
    y: z.number().int().min(-100_000).max(100_000),
  })
  .strict();

export const CursorBuddySnapshotSchema = z
  .object({
    phase: z.enum([
      'following',
      'thinking',
      'gliding',
      'demonstrating',
      'explaining',
    ]),
    position: CursorBuddyPositionSchema,
    busy: z.boolean(),
  })
  .strict();

export const CompanionGuidanceVisualSchema = z
  .object({
    companion: CompanionPositionSchema,
    moving: z.boolean(),
    target: z
      .object({
        height: z.number().int().min(1).max(100_000),
        width: z.number().int().min(1).max(100_000),
        x: z.number().int().min(0).max(100_000),
        y: z.number().int().min(0).max(100_000),
      })
      .strict(),
  })
  .strict();

export const TROCODE_AUDIO_SCHEME = 'trocode-audio' as const;

const CompanionSpeechMediaUrlSchema = z
  .string()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);
    const pathMatch =
      /^\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu.exec(
        url.pathname,
      );
    if (
      url.protocol !== `${TROCODE_AUDIO_SCHEME}:` ||
      url.hostname !== 'speech' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !pathMatch
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Speech media URLs must use the private Tro audio scheme.',
      });
    }
  });

const CompanionGuidanceShortcutSchema = z.object({
  available: z.boolean(),
  label: z.string().trim().min(1).max(40),
});

export const CompanionGuidanceShortcutsSchema = z.object({
  back: CompanionGuidanceShortcutSchema,
  pause: CompanionGuidanceShortcutSchema,
  next: CompanionGuidanceShortcutSchema,
});

export const MAX_COACH_SPEECH_CHARACTERS = 160;
export const MAX_COACH_SEQUENCE_STEPS = 8;

export const CompanionCoachCopySchema = z
  .object({
    expectedOutcome: z.string().trim().min(1).max(160),
    hook: z.string().trim().min(1).max(50),
    instruction: z.string().trim().min(1).max(90),
    reason: z.string().trim().min(1).max(90),
  })
  .strict()
  .superRefine((copy, context) => {
    const spokenLength = [copy.hook, copy.instruction, copy.reason].join(' ').length;
    if (spokenLength > MAX_COACH_SPEECH_CHARACTERS) {
      context.addIssue({
        code: 'custom',
        message: 'Coach speech must stay under 160 characters per step.',
      });
    }
  });

export const CompanionGuidanceSchema = z.object({
  coach: CompanionCoachCopySchema.optional(),
  kind: z
    .enum(['action_preview', 'guidance', 'result', 'thinking'])
    .default('guidance'),
  language: AppLanguageSchema.optional(),
  message: z.string().trim().min(1).max(240),
  phase: z.enum(['presenting', 'paused']).default('presenting'),
  playback: z.enum(['playing', 'paused']).default('playing'),
  sequence: z.object({
    current: z.number().int().min(1).max(MAX_COACH_SEQUENCE_STEPS),
    total: z.number().int().min(1).max(MAX_COACH_SEQUENCE_STEPS),
  }).strict().refine(
    ({ current, total }) => current <= total,
    { message: 'The current Coach step cannot exceed the sequence total.' },
  ).optional(),
  shortcuts: CompanionGuidanceShortcutsSchema.optional(),
  side: z.enum(['left', 'right']),
  taskId: z.string().uuid().optional(),
  target: z.string().trim().min(1).max(80).optional(),
});

export const CompanionPetMoodSchema = z.enum([
  'encouraging',
  'waiting',
  'celebrating',
  'thinking',
  'working',
  'verifying',
]);

export const CompanionPetNudgeDraftSchema = z
  .object({
    id: z.string().uuid(),
    language: AppLanguageSchema,
    message: z.string().trim().min(1).max(160),
    mood: CompanionPetMoodSchema,
  })
  .strict();

export const CompanionPetNudgeSchema = CompanionPetNudgeDraftSchema.extend({
  side: z.enum(['left', 'right']),
}).strict();

export const CompanionResponseCardSchema = z
  .object({
    workCheck: WorkCheckPanelSchema.optional(),
    cardId: z.string().uuid(),
    taskId: z.string().uuid(),
    phase: z.enum(['streaming', 'completed']),
    message: z.string().max(8_000),
    side: z.enum(['left', 'right']),
  })
  .strict()
  .superRefine((card, context) => {
    if (card.phase === 'completed' && card.message.trim().length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Completed response cards require a nonempty message.',
        path: ['message'],
      });
    }
  });

export const CompanionResponseActionSchema = z.enum([
  'dismiss',
  'open_task',
  'ask_follow_up',
  'read_aloud',
  'stop_reading',
]).or(WorkCheckActionSchema);

export const CompanionResponseActionRequestSchema = z
  .object({
    action: CompanionResponseActionSchema,
    cardId: z.string().uuid(),
    taskId: z.string().uuid(),
  })
  .strict();

const CompanionInteractionBaseSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(1_000),
  side: z.enum(['left', 'right']),
});

export const CompanionClarificationInteractionSchema =
  CompanionInteractionBaseSchema.extend({
    kind: z.literal('clarification'),
    choices: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(100),
          label: z.string().trim().min(1).max(240),
        }),
      )
      .max(9)
      .optional(),
  });

export const CompanionInteractionSchema = CompanionClarificationInteractionSchema;

export const CompanionSpeechSchema = z.discriminatedUnion('source', [
  z.object({
    id: z.string().uuid(),
    mediaUrl: CompanionSpeechMediaUrlSchema,
    mimeType: z.literal('audio/mpeg'),
    source: z.literal('elevenlabs'),
    text: z.string().trim().min(1).max(240),
  }),
  z.object({
    id: z.string().uuid(),
    source: z.literal('system'),
    text: z.string().trim().min(1).max(240),
  }),
]);

export const CompanionSpeechPlaybackReasonSchema = z.enum([
  'not_configured',
  'provider_error',
  'startup_timeout',
  'autoplay_rejected',
  'decode_error',
  'fallback_error',
]);

export const CompanionSpeechPlaybackReportSchema = z.object({
  id: z.string().uuid(),
  phase: z.enum(['playing', 'fallback_started', 'ended', 'failed']),
  source: z.enum(['elevenlabs', 'system']),
  reason: CompanionSpeechPlaybackReasonSchema.optional(),
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

export const RecordVoiceTranscriptRequestSchema = z
  .object({
    characterCount: z.number().int().min(1).max(8_000),
    destination: z.enum(['application', 'tro_composer', 'task']),
    disposition: z.enum([
      'inserted',
      'delivery_unverified',
      'not_inserted',
      'task_submitted',
      'draft_updated',
    ]),
    mode: VoiceModeSchema,
  })
  .strict();

export const BeginDictationRequestSchema = z
  .object({
    turnId: z.string().uuid(),
  })
  .strict();

export const BeginDictationResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ready'),
      targetApplication: z.string().trim().min(1).max(120),
      turnId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      reason: z.literal('accessibility'),
      status: z.literal('permission_required'),
      summary: z.string().trim().min(1).max(1_000),
      turnId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      reason: z.enum(['no_target', 'platform', 'driver']),
      status: z.literal('unavailable'),
      summary: z.string().trim().min(1).max(1_000),
      turnId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      reason: z.literal('busy'),
      status: z.literal('busy'),
      summary: z.string().trim().min(1).max(1_000),
      turnId: z.string().uuid(),
    })
    .strict(),
]);

export const CommitDictationRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(8_000),
    turnId: z.string().uuid(),
  })
  .strict();

const DictationCommitResultBaseSchema = z.object({
  summary: z.string().trim().min(1).max(1_000),
  targetApplication: z.string().trim().min(1).max(120).optional(),
});

export const DictationCommitResultSchema = z.discriminatedUnion('disposition', [
  DictationCommitResultBaseSchema.extend({
    disposition: z.literal('inserted'),
    reason: z.literal('confirmed'),
  }).strict(),
  DictationCommitResultBaseSchema.extend({
    disposition: z.literal('delivery_unverified'),
    reason: z.enum(['driver_error', 'cancelled']),
  }).strict(),
  DictationCommitResultBaseSchema.extend({
    disposition: z.literal('not_inserted'),
    reason: z.enum([
      'target_changed',
      'driver_refused',
      'driver_error',
      'already_consumed',
      'cancelled',
    ]),
  }).strict(),
]);

export const CancelDictationRequestSchema = z
  .object({
    turnId: z.string().uuid(),
  })
  .strict();

const PcmWavBase64Schema = z
  .string()
  .min(60)
  .max(750_000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/u)
  .refine((value) => value.length % 4 === 0, 'Invalid base64 length.');

export const TranscribeVoiceSegmentRequestSchema = z.object({
  audioBase64: PcmWavBase64Schema,
  durationMs: z.number().int().min(300).max(15_000),
  requestId: z.string().uuid(),
  sequence: z.number().int().min(0).max(31),
  utteranceId: z.string().uuid(),
});

export const VoiceSegmentTranscriptionSchema = z.object({
  audioDurationMs: z.number().int().positive().max(15_000),
  billedSeconds: z.number().finite().nonnegative().max(16),
  model: z.enum([LEGACY_VOICE_TRANSCRIPTION_MODEL, VOICE_TRANSCRIPTION_MODEL]),
  sequence: z.number().int().min(0).max(31),
  text: z.string().trim().max(8_000),
  utteranceId: z.string().uuid(),
});

export const VoiceDiagnosticSchema = z.object({
  error: z.object({
    message: z.string().min(1).max(2_000),
    name: z.string().min(1).max(200).optional(),
  }),
  step: z.enum([
    'audio_context',
    'audio_encode',
    'audio_worklet',
    'microphone',
    'segment_upload',
    'transcription_response',
  ]),
});

export const VoiceShortcutEventSchema = z
  .object({
    action: z.enum(['pressed', 'released']),
    source: z.literal('global'),
  })
  .strict();

export const VoiceModeToggleEventSchema = z
  .object({
    source: z.literal('global'),
  })
  .strict();

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
  referenceCode: z
    .string()
    .regex(/^TRC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    .nullable(),
  expiresAt: z.string().datetime().nullable(),
  plan: PlanIdSchema.nullable().default(null),
  summary: z.string().min(1).max(1_000),
});

export const ActivateMembershipRequestSchema = z.object({
  code: z.string().trim().min(4).max(4_096),
});

export const OrganizationRoleSchema = z.enum(['organizer', 'member']);

export const MAX_ORGANIZATION_HOME_BANNER_BYTES = 750_000;
const MAX_ORGANIZATION_HOME_BANNER_DATA_URL_CHARACTERS = 1_000_032;

export const OrganizationHomeBannerImageDataUrlSchema = z
  .string()
  .min(1)
  .max(MAX_ORGANIZATION_HOME_BANNER_DATA_URL_CHARACTERS)
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u);

export const OrganizationHomeBannerSchema = z
  .object({ imageDataUrl: OrganizationHomeBannerImageDataUrlSchema })
  .strict();

export const OrganizationCapacitySchema = z
  .object({
    assignedSeats: z.number().int().nonnegative(),
    maxSeats: z.number().int().positive(),
    remainingSeats: z.number().int().nonnegative(),
    state: z.enum(['available', 'full']),
  })
  .strict();

export const OrganizationSummarySchema = z
  .object({
    capacity: OrganizationCapacitySchema,
    homeBanner: OrganizationHomeBannerSchema.nullable(),
    id: z.string().uuid(),
    name: z.string().min(1).max(100),
    plan: PlanIdSchema,
    role: OrganizationRoleSchema,
  })
  .strict();

export const OrganizationCurrentResponseSchema = z
  .object({ organization: OrganizationSummarySchema.nullable() })
  .strict();

export const UpdateOrganizationRequestSchema = z.union([
  z.object({ name: z.string().trim().min(1).max(100) }).strict(),
  z
    .object({
      homeBannerImageDataUrl:
        OrganizationHomeBannerImageDataUrlSchema.nullable(),
    })
    .strict(),
]);

export const UpdateOrganizationResponseSchema = z
  .object({ organization: OrganizationSummarySchema })
  .strict();

export const OrganizationMemberSchema = z
  .object({
    createdAt: z.string().datetime(),
    email: z.string().email().max(320),
    id: z.string().uuid(),
    joinedAt: z.string().datetime().nullable(),
    name: z.string().min(1).max(255).nullable(),
    role: OrganizationRoleSchema,
    state: z.enum(['pending', 'active']),
  })
  .strict();

export const OrganizationPageSchema = z
  .object({
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().min(0).max(100_000),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const ListOrganizationMembersRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const OrganizationMemberListSchema = z
  .object({
    items: z.array(OrganizationMemberSchema).max(100),
    organization: OrganizationSummarySchema,
    page: OrganizationPageSchema,
  })
  .strict();

export const AddOrganizationMemberRequestSchema = z
  .object({ email: z.string().trim().email().max(320) })
  .strict();

export const AddOrganizationMemberResponseSchema = z
  .object({
    member: OrganizationMemberSchema,
    newlyCreated: z.boolean(),
    organization: OrganizationSummarySchema,
  })
  .strict();

export const CancelOrganizationMemberRequestSchema = z
  .object({ memberId: z.string().uuid() })
  .strict();

export const CancelOrganizationMemberResponseSchema = z
  .object({
    kind: z.literal('cancelled'),
    memberId: z.string().uuid(),
    organization: OrganizationSummarySchema,
  })
  .strict();

export type AppLanguage = z.infer<typeof AppLanguageSchema>;
export type AppPreferences = z.infer<typeof AppPreferencesSchema>;
export type AppUpdateStatus = z.infer<typeof AppUpdateStatusSchema>;
export type AuthStatus = z.infer<typeof AuthStatusSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type ActivateMembershipRequest = z.infer<
  typeof ActivateMembershipRequestSchema
>;
export type CompanionPosition = z.infer<typeof CompanionPositionSchema>;
export type CursorBuddySnapshot = z.infer<typeof CursorBuddySnapshotSchema>;
export type ActivateCompanionCandidateRequest = z.infer<
  typeof ActivateCompanionCandidateRequestSchema
>;
export type ActivateSavedCompanionRequest = z.infer<
  typeof ActivateSavedCompanionRequestSchema
>;
export type CompanionAppearance = z.infer<typeof CompanionAppearanceSchema>;
export type CompanionCandidate = z.infer<typeof CompanionCandidateSchema>;
export type CompanionCustomizationStatus = z.infer<
  typeof CompanionCustomizationStatusSchema
>;
export type CompanionGenerationQuota = z.infer<
  typeof CompanionGenerationQuotaSchema
>;
export type CompanionImageMimeType = z.infer<
  typeof CompanionImageMimeTypeSchema
>;
export type GenerateCompanionImageRequest = z.infer<
  typeof GenerateCompanionImageRequestSchema
>;
export type SavedCompanion = z.infer<typeof SavedCompanionSchema>;
export type CompanionGuidanceVisual = z.infer<
  typeof CompanionGuidanceVisualSchema
>;
export type CompanionState = z.infer<typeof CompanionStateSchema>;
export type CompanionHover = z.infer<typeof CompanionHoverSchema>;
export type PresentationState = z.infer<typeof PresentationStateSchema>;
export type CompanionVoiceActivity = z.infer<
  typeof CompanionVoiceActivitySchema
>;
export type VoiceMode = z.infer<typeof VoiceModeSchema>;
export type CompanionGuidance = z.infer<typeof CompanionGuidanceSchema>;
export type CompanionCoachCopy = z.infer<typeof CompanionCoachCopySchema>;
export type CompanionPetMood = z.infer<typeof CompanionPetMoodSchema>;
export type CompanionPetNudgeDraft = z.infer<
  typeof CompanionPetNudgeDraftSchema
>;
export type CompanionPetNudge = z.infer<typeof CompanionPetNudgeSchema>;
export type CompanionResponseCard = z.infer<typeof CompanionResponseCardSchema>;
export type CompanionResponseAction = z.infer<
  typeof CompanionResponseActionSchema
>;
export type CompanionResponseActionRequest = z.infer<
  typeof CompanionResponseActionRequestSchema
>;
export type CompanionInteraction = z.infer<typeof CompanionInteractionSchema>;
export type CompanionSpeech = z.infer<typeof CompanionSpeechSchema>;
export type CompanionSpeechPlaybackReason = z.infer<
  typeof CompanionSpeechPlaybackReasonSchema
>;
export type CompanionSpeechPlaybackReport = z.infer<
  typeof CompanionSpeechPlaybackReportSchema
>;
export type ConfigureVoiceRequest = z.infer<typeof ConfigureVoiceRequestSchema>;
export type BeginDictationRequest = z.infer<typeof BeginDictationRequestSchema>;
export type BeginDictationResult = z.infer<typeof BeginDictationResultSchema>;
export type CancelDictationRequest = z.infer<
  typeof CancelDictationRequestSchema
>;
export type CommitDictationRequest = z.infer<
  typeof CommitDictationRequestSchema
>;
export type DictationCommitResult = z.infer<typeof DictationCommitResultSchema>;
export type TranscribeVoiceSegmentRequest = z.infer<
  typeof TranscribeVoiceSegmentRequestSchema
>;
export type CuaStatus = z.infer<typeof CuaStatusSchema>;
export type GoalSpec = z.infer<typeof GoalSpecSchema>;
export type GetUsageBudgetRequest = z.infer<typeof GetUsageBudgetRequestSchema>;
export type TaskContract = z.infer<typeof TaskContractSchema>;
export type AgentTaskContract = z.infer<typeof TaskContractSchema>;
export type AgentTaskContractV10 = z.infer<typeof AgentTaskContractV10Schema>;
export type AgentTaskContractV11 = z.infer<typeof AgentTaskContractV11Schema>;
export type CoachProgress = z.infer<typeof CoachProgressSchema>;
export type TaskRoute = z.infer<typeof TaskRouteSchema>;
export type RequestedMode = z.infer<typeof RequestedModeSchema>;
export type ExecutableAgentTaskContract = AgentTaskContract;
export type ActivityContext = z.infer<typeof ActivityContextSchema>;
export type ClassroomDirective = z.infer<typeof ClassroomDirectiveSchema>;
export type ClassroomDirectiveDraft = z.infer<
  typeof ClassroomDirectiveDraftSchema
>;
export type ClassroomSessionProjection = z.infer<
  typeof ClassroomSessionProjectionSchema
>;
export type ClassroomDirectiveNotice = z.infer<
  typeof ClassroomDirectiveNoticeSchema
>;
export type AgentRuntimeKind = z.infer<typeof AgentRuntimeKindSchema>;
export type ExecutionProfile = z.infer<typeof ExecutionProfileSchema>;
export type AgentActivityKind = z.infer<typeof AgentActivityKindSchema>;
export type AgentActivityUpdate = z.infer<typeof AgentActivityUpdateSchema>;
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>;
export type OrganizationHomeBanner = z.infer<
  typeof OrganizationHomeBannerSchema
>;
export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>;
export type OrganizationCurrentResponse = z.infer<
  typeof OrganizationCurrentResponseSchema
>;
export type UpdateOrganizationRequest = z.infer<
  typeof UpdateOrganizationRequestSchema
>;
export type UpdateOrganizationResponse = z.infer<
  typeof UpdateOrganizationResponseSchema
>;
export type OrganizationMember = z.infer<typeof OrganizationMemberSchema>;
export type OrganizationMemberList = z.infer<
  typeof OrganizationMemberListSchema
>;
export type ListOrganizationMembersRequest = z.infer<
  typeof ListOrganizationMembersRequestSchema
>;
export type AddOrganizationMemberRequest = z.infer<
  typeof AddOrganizationMemberRequestSchema
>;
export type AddOrganizationMemberResponse = z.infer<
  typeof AddOrganizationMemberResponseSchema
>;
export type CancelOrganizationMemberRequest = z.infer<
  typeof CancelOrganizationMemberRequestSchema
>;
export type CancelOrganizationMemberResponse = z.infer<
  typeof CancelOrganizationMemberResponseSchema
>;
export type PlanId = z.infer<typeof PlanIdSchema>;
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
export type TaskComposerFocusRequest = z.infer<
  typeof TaskComposerFocusRequestSchema
>;
export type SteeringInstruction = z.infer<typeof SteeringInstructionSchema>;
export type SystemPermission = z.infer<typeof SystemPermissionSchema>;
export type SteerTaskRequest = z.infer<typeof SteerTaskRequestSchema>;
export type SubmitTaskRequest = z.infer<typeof SubmitTaskRequestSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;
export type TaskHistory = z.infer<typeof TaskHistorySchema>;
export type ConnectorCatalogItem = z.infer<typeof ConnectorCatalogItemSchema>;
export type ConnectorConnectionSummary = z.infer<typeof ConnectorConnectionSummarySchema>;
export type ConnectorList = z.infer<typeof ConnectorListSchema>;
export type ConnectorAttemptStatus = z.infer<typeof ConnectorAttemptStatusSchema>;
export type ConnectConnectorRequest = z.infer<typeof ConnectConnectorRequestSchema>;
export type ConnectorAttemptRequest = z.infer<typeof ConnectorAttemptRequestSchema>;
export type DisconnectConnectorRequest = z.infer<typeof DisconnectConnectorRequestSchema>;
export type TaskMessage = z.infer<typeof TaskMessageSchema>;
export type TaskPhase = z.infer<typeof TaskPhaseSchema>;
export type CancellationSource = z.infer<typeof CancellationSourceSchema>;
export type ComputerPermission = z.infer<typeof ComputerPermissionSchema>;
export type TaskLifecycle = z.infer<typeof TaskLifecycleSchema>;
export type TaskProgress = z.infer<typeof TaskProgressSchema>;
export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;
export type ResolveComputerPermissionRequest = z.infer<
  typeof ResolveComputerPermissionRequestSchema
>;
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;
export type UsageBudgetSnapshot = z.infer<typeof UsageBudgetSnapshotSchema>;
export type UpdateAppPreferencesRequest = z.infer<
  typeof UpdateAppPreferencesRequestSchema
>;
export type WorkspaceIdentity = z.infer<typeof WorkspaceIdentitySchema>;
export type WorkspaceRuntimeAvailability = z.infer<
  typeof WorkspaceRuntimeAvailabilitySchema
>;
export type WorkspaceSelection = z.infer<typeof WorkspaceSelectionSchema>;
export type KnowledgeCapabilities = z.infer<typeof KnowledgeCapabilitiesSchema>;
export type ClassroomAccountRole = z.infer<typeof ClassroomAccountRoleSchema>;
export type KnowledgeGroup = z.infer<typeof KnowledgeGroupSchema>;
export type KnowledgeGroupList = z.infer<typeof KnowledgeGroupListSchema>;
export type CreateKnowledgeGroupRequest = z.infer<
  typeof CreateKnowledgeGroupRequestSchema
>;
export type KnowledgeSpaceMember = z.infer<typeof KnowledgeSpaceMemberSchema>;
export type KnowledgeSpaceMemberList = z.infer<
  typeof KnowledgeSpaceMemberListSchema
>;
export type AddKnowledgeSpaceMembersRequest = z.infer<
  typeof AddKnowledgeSpaceMembersRequestSchema
>;
export type AddKnowledgeSpaceMembersResult = z.infer<
  typeof AddKnowledgeSpaceMembersResultSchema
>;
export type CreateKnowledgeInviteRequest = z.infer<
  typeof CreateKnowledgeInviteRequestSchema
>;
export type KnowledgeInvite = z.infer<typeof KnowledgeInviteSchema>;
export type RedeemKnowledgeInviteRequest = z.infer<
  typeof RedeemKnowledgeInviteRequestSchema
>;
export type RedeemKnowledgeInviteResponse = z.infer<
  typeof RedeemKnowledgeInviteResponseSchema
>;
export type KnowledgeSpaceSummary = z.infer<typeof KnowledgeSpaceSummarySchema>;
export type KnowledgeSpaceList = z.infer<typeof KnowledgeSpaceListSchema>;
export type CreateKnowledgeSpaceRequest = z.infer<
  typeof CreateKnowledgeSpaceRequestSchema
>;
export type CreateKnowledgeSpaceResponse = z.infer<
  typeof CreateKnowledgeSpaceResponseSchema
>;
export type KnowledgeSourceList = z.infer<typeof KnowledgeSourceListSchema>;
export type SelectKnowledgeFilesRequest = z.infer<
  typeof SelectKnowledgeFilesRequestSchema
>;
export type KnowledgeFileSelection = z.infer<
  typeof KnowledgeFileSelectionSchema
>;
export type UploadKnowledgeSelectionRequest = z.infer<
  typeof UploadKnowledgeSelectionRequestSchema
>;
export type KnowledgeUploadResult = z.infer<typeof KnowledgeUploadResultSchema>;
export type SaveKnowledgeActivityRequest = z.infer<
  typeof SaveKnowledgeActivityRequestSchema
>;
export type KnowledgeActivityDraft = z.infer<
  typeof KnowledgeActivityDraftSchema
>;
export type PublishKnowledgeActivityRequest = z.infer<
  typeof PublishKnowledgeActivityRequestSchema
>;
export type KnowledgeActivityVersion = z.infer<
  typeof KnowledgeActivityVersionSchema
>;
export type PublishedKnowledgeActivity = z.infer<
  typeof PublishedKnowledgeActivitySchema
>;
export type PublishedKnowledgeActivityList = z.infer<
  typeof PublishedKnowledgeActivityListSchema
>;
export type KnowledgeClassSessionActivity = z.infer<
  typeof KnowledgeClassSessionActivitySchema
>;
export type KnowledgeClassSession = z.infer<typeof KnowledgeClassSessionSchema>;
export type KnowledgeClassSessionList = z.infer<
  typeof KnowledgeClassSessionListSchema
>;
export type CreateKnowledgeClassSessionRequest = z.infer<
  typeof CreateKnowledgeClassSessionRequestSchema
>;
export type CreateKnowledgeRunRequest = z.infer<
  typeof CreateKnowledgeRunRequestSchema
>;
export type KnowledgeRun = z.infer<typeof KnowledgeRunSchema>;
export type AssignedActivityList = z.infer<typeof AssignedActivityListSchema>;
export type HostedAttemptContext = z.infer<typeof HostedAttemptContextSchema>;
export type KnowledgeDashboard = z.infer<typeof KnowledgeDashboardSchema>;
export type KnowledgeSpaceIdRequest = z.infer<
  typeof KnowledgeSpaceIdRequestSchema
>;
export type KnowledgeAttemptIdRequest = z.infer<
  typeof KnowledgeAttemptIdRequestSchema
>;
export type AcknowledgeKnowledgeAttemptRequest = z.infer<
  typeof AcknowledgeKnowledgeAttemptRequestSchema
>;
export type SetKnowledgeRunStateRequest = z.infer<
  typeof SetKnowledgeRunStateRequestSchema
>;
export type GetKnowledgeDashboardRequest = z.infer<
  typeof GetKnowledgeDashboardRequestSchema
>;
export type PrepareActivityStarterRequest = z.infer<
  typeof PrepareActivityStarterRequestSchema
>;
export type SubmitKnowledgeSelectionRequest = z.infer<
  typeof SubmitKnowledgeSelectionRequestSchema
>;
export type RequestKnowledgeAttemptHelp = z.infer<
  typeof RequestKnowledgeAttemptHelpSchema
>;
export type CreateKnowledgeRoomCodeRequest = z.infer<
  typeof CreateKnowledgeRoomCodeRequestSchema
>;
export type KnowledgeRoomCode = z.infer<typeof KnowledgeRoomCodeSchema>;
export type RevokeKnowledgeRoomCodeRequest = z.infer<
  typeof RevokeKnowledgeRoomCodeRequestSchema
>;
export type KnowledgeRoomRevocation = z.infer<
  typeof KnowledgeRoomRevocationSchema
>;
export type JoinKnowledgeRoomRequest = z.infer<
  typeof JoinKnowledgeRoomRequestSchema
>;
export type JoinClassroomSessionRequest = z.infer<
  typeof JoinClassroomSessionRequestSchema
>;
export type KnowledgeClassroomSession = z.infer<
  typeof KnowledgeClassroomSessionSchema
>;
export type KnowledgeAttemptMutationRequest = z.infer<
  typeof KnowledgeAttemptMutationRequestSchema
>;
export type LeaveKnowledgeClassroomResponse = z.infer<
  typeof LeaveKnowledgeClassroomResponseSchema
>;
export type CreateClassroomDirectiveRequest = z.infer<
  typeof CreateClassroomDirectiveRequestSchema
>;
export type ClassroomDirectiveList = z.infer<
  typeof ClassroomDirectiveListSchema
>;
export type ClaimClassroomDirectiveRequest = z.infer<
  typeof ClaimClassroomDirectiveRequestSchema
>;
export type ClassroomDirectiveClaim = z.infer<
  typeof ClassroomDirectiveClaimSchema
>;
export type SetClassroomLinkConsentRequest = z.infer<
  typeof SetClassroomLinkConsentRequestSchema
>;
export type OpenClassroomDirectiveRequest = z.infer<
  typeof OpenClassroomDirectiveRequestSchema
>;
export type DismissClassroomDirectiveRequest = z.infer<
  typeof DismissClassroomDirectiveRequestSchema
>;
export type ReviewKnowledgeAttemptRequest = z.infer<
  typeof ReviewKnowledgeAttemptRequestSchema
>;
export type ResolveKnowledgeAttemptHelpRequest = z.infer<
  typeof ResolveKnowledgeAttemptHelpRequestSchema
>;
export type KnowledgeAttemptTransition = z.infer<
  typeof KnowledgeAttemptTransitionSchema
>;
export type VoiceSegmentTranscription = z.infer<
  typeof VoiceSegmentTranscriptionSchema
>;
export type VoiceDiagnostic = z.infer<typeof VoiceDiagnosticSchema>;
export type VoiceModeToggleEvent = z.infer<
  typeof VoiceModeToggleEventSchema
>;
export type VoiceShortcutEvent = z.infer<typeof VoiceShortcutEventSchema>;
export type VoiceStatus = z.infer<typeof VoiceStatusSchema>;
