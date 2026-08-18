import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  CancelTaskRequestSchema,
  ConsumeApprovalGrantRequestSchema,
  DecideApprovalRequestSchema,
  RequestApprovalSchema,
  RequestTaskInputSchema,
  RespondToInteractionRequestSchema,
  StartTaskRequestSchema,
  SteerTaskRequestSchema,
  SubmitTaskRequestSchema,
  TaskSnapshotSchema,
  type PendingInteraction,
  type ProposedAction,
  type RuntimeToolId,
  type SteeringInstruction,
  type TaskEvent,
  type TaskMessage,
  type TaskSnapshot,
  type TaskUpdate,
} from '../../shared/contracts';

import { createActionDigest } from './action-approval';
import { canTransition, isTerminalPhase, transitionTask } from './goal-machine';
import { evaluateAction } from './policy';
import {
  defaultRuntimeToolRegistry,
  type RuntimeToolRegistry,
} from './runtime-tool-registry';
import { createTaskContract } from './task-contract';
import type { CreateTaskContractOptions } from './task-contract';

const APPROVAL_TTL_MS = 5 * 60 * 1_000;
const MAX_TASK_MESSAGES = 200;
const MAX_QUEUED_STEERING = 50;
const STEERABLE_PHASES: ReadonlySet<TaskSnapshot['phase']> = new Set([
  'planning',
  'observing',
  'acting',
  'verifying',
  'paused',
  'blocked',
]);

interface TaskRuntimeOptions {
  now?: () => Date;
  toolRegistry?: Pick<RuntimeToolRegistry, 'supports'>;
}

interface MessageDetails {
  kind: TaskMessage['kind'];
  role: TaskMessage['role'];
  text: string;
}

interface RuntimeEventDetails {
  status?: TaskEvent['status'];
  summary: string;
  nextActions?: string[];
  tool?: TaskEvent['tool'];
}

function createMessage(
  taskId: string,
  details: MessageDetails,
  timestamp: string,
): TaskMessage {
  return {
    messageId: randomUUID(),
    taskId,
    role: details.role,
    kind: details.kind,
    text: details.text,
    timestamp,
  };
}

function appendMessage(
  snapshot: TaskSnapshot,
  details: MessageDetails,
  timestamp: string,
): TaskSnapshot {
  return {
    ...snapshot,
    messages: [
      ...snapshot.messages,
      createMessage(snapshot.taskId, details, timestamp),
    ].slice(-MAX_TASK_MESSAGES),
  };
}

function incrementProgress(snapshot: TaskSnapshot): TaskSnapshot['progress'] {
  const progress = snapshot.progress;
  if (!progress) return progress;
  if ('kind' in progress) {
    return {
      ...progress,
      completed: Math.min(progress.limit, progress.completed + 1),
    };
  }
  return {
    ...progress,
    currentStep: Math.min(progress.maxSteps, progress.currentStep + 1),
  };
}

export class TaskRuntime extends EventEmitter {
  private readonly tasks = new Map<string, TaskSnapshot>();

  private readonly now: () => Date;

  private readonly toolRegistry: Pick<RuntimeToolRegistry, 'supports'>;

  constructor(options: TaskRuntimeOptions = {}) {
    super();
    this.now = options.now ?? (() => new Date());
    this.toolRegistry = options.toolRegistry ?? defaultRuntimeToolRegistry;
  }

  submit(
    input: unknown,
    contractOptions: CreateTaskContractOptions = {},
  ): TaskSnapshot {
    const request = SubmitTaskRequestSchema.parse(input);
    const timestamp = this.timestamp();
    const contract = createTaskContract(request.text, contractOptions);
    const idle: TaskSnapshot = {
      taskId: randomUUID(),
      request: request.text,
      phase: 'idle',
      goal: contract,
      messages: [],
      pendingInteraction: null,
      approvalGrant: null,
      progress: {
        kind: 'tool_calls',
        completed: 0,
        limit: contract.limits.maxToolCalls,
      },
      queuedSteering: [],
      runtimeResume: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastEvent: null,
    };
    const withRequest = appendMessage(
      idle,
      { kind: 'request', role: 'user', text: request.text },
      timestamp,
    );
    return this.move(withRequest, 'ready', {
      summary: 'Task ready for the agent.',
      nextActions: ['Start the agent when the model provider is ready.'],
    });
  }

  start(input: unknown): TaskSnapshot {
    const request = StartTaskRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    if (snapshot.phase !== 'ready') {
      throw new Error('Task ' + request.taskId + ' is not ready to start.');
    }
    return this.move(snapshot, 'planning', {
      summary: 'Agent turn started.',
      nextActions: ['Ask the model to answer or choose one available tool.'],
    });
  }

  getSnapshot(taskId: string): TaskSnapshot {
    return TaskSnapshotSchema.parse(this.getTask(taskId));
  }

  recordModelSampling(taskId: string): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    if (snapshot.phase === 'planning') {
      return this.record(snapshot, {
        summary: 'Thinking about the next response or tool call.',
        nextActions: ['Wait for the model response.'],
      });
    }
    return this.move(snapshot, 'planning', {
      summary: 'Continuing the agent turn.',
      nextActions: ['Ask the model to answer or choose one available tool.'],
    });
  }

  beginObservation(taskId: string, summary: string): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    if (snapshot.phase === 'observing') {
      return this.record(snapshot, {
        summary,
        nextActions: ['Return the fresh observation to the model.'],
      });
    }
    return this.move(snapshot, 'observing', {
      summary,
      nextActions: ['Capture a fresh screenshot before any grounded action.'],
    });
  }

  recordGuidance(taskId: string, guidance: string): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    const timestamp = this.timestamp();
    return this.record(
      appendMessage(
        snapshot,
        { kind: 'answer', role: 'assistant', text: guidance },
        timestamp,
      ),
      {
        summary: guidance,
        nextActions: [
          'Follow the visible pointer; use Back, Pause/Resume, or Next while narration plays.',
        ],
        tool: { toolId: 'task.guidance', operation: 'show' },
      },
    );
  }

  beginAllowedAction(taskId: string, action: ProposedAction): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    if (!snapshot.goal) throw new Error('Tool action requires a task contract.');
    const decision = evaluateAction(snapshot.goal, action, this.toolRegistry);
    if (decision.status !== 'allowed') {
      throw new Error('Action is not directly dispatchable: ' + decision.summary);
    }
    return this.move(snapshot, 'acting', {
      summary: 'Using tool: ' + action.description,
      nextActions: ['Return the tool result before choosing another action.'],
      ...(action.toolId && action.operation
        ? { tool: { toolId: action.toolId, operation: action.operation } }
        : {}),
    });
  }

  beginVerification(
    taskId: string,
    summary: string,
    toolCompleted = false,
    tool?: { toolId: RuntimeToolId; operation: string },
  ): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    return this.move(
      {
        ...snapshot,
        progress: toolCompleted ? incrementProgress(snapshot) : snapshot.progress,
      },
      'verifying',
      {
        summary,
        nextActions: ['Return the result to the model.'],
        ...(tool ? { tool } : {}),
      },
    );
  }

  recordToolResult(
    taskId: string,
    summary: string,
    tool: { toolId: RuntimeToolId; operation: string },
  ): TaskSnapshot {
    return this.beginVerification(taskId, summary, true, tool);
  }

  complete(taskId: string, summary: string): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    const completedWithResponse = appendMessage(
      snapshot,
      { kind: 'answer', role: 'assistant', text: summary },
      this.timestamp(),
    );
    return this.move(completedWithResponse, 'completed', {
      summary,
      nextActions: [],
    });
  }

  block(taskId: string, summary: string, nextActions: string[]): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    if (snapshot.phase === 'blocked') {
      return this.record(snapshot, {
        status: 'warning',
        summary,
        nextActions,
      });
    }
    return this.move(snapshot, 'blocked', {
      status: 'warning',
      summary,
      nextActions,
    });
  }

  fail(taskId: string, summary: string): TaskSnapshot {
    return this.move(this.getTask(taskId), 'failed', {
      status: 'error',
      summary,
      nextActions: ['Review the failure before starting another task.'],
    });
  }

  discardApprovalGrant(taskId: string, summary: string): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    if (!snapshot.approvalGrant) return snapshot;
    return this.record(
      { ...snapshot, approvalGrant: null },
      {
        status: 'warning',
        summary,
        nextActions: ['Request fresh approval if a risky action remains.'],
      },
    );
  }

  resumePlanning(taskId: string, summary: string): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    if (snapshot.phase === 'planning') {
      return this.record(snapshot, {
        summary,
        nextActions: ['Continue the model turn.'],
      });
    }
    return this.move(snapshot, 'planning', {
      summary,
      nextActions: ['Continue the model turn.'],
    });
  }

  requestInput(input: unknown): TaskSnapshot {
    const request = RequestTaskInputSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    this.assertCanCreateInteraction(snapshot, 'awaiting_input');
    return this.askForClarification(
      { ...snapshot, approvalGrant: null },
      request.prompt,
      request.choices,
    );
  }

  respondToInteraction(input: unknown): TaskSnapshot {
    const request = RespondToInteractionRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    const pending = this.matchPendingInteraction(snapshot, request.interactionId);
    if (pending.kind !== 'clarification') {
      throw new Error('The pending interaction requires an approval decision.');
    }
    if (snapshot.phase !== 'awaiting_input') {
      throw new Error('Task ' + request.taskId + ' is not waiting for an answer.');
    }
    const timestamp = this.timestamp();
    const answered = appendMessage(
      { ...snapshot, pendingInteraction: null },
      { kind: 'answer', role: 'user', text: request.text },
      timestamp,
    );
    return this.move(answered, 'planning', {
      summary: 'Answer received. Continuing the same agent turn.',
      nextActions: ['Return the answer to the waiting model tool call.'],
    });
  }

  requestApproval(input: unknown): TaskSnapshot {
    const request = RequestApprovalSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    this.assertCanCreateInteraction(snapshot, 'awaiting_approval');
    if (!snapshot.goal) throw new Error('Approval requires a task contract.');
    const policyDecision = evaluateAction(
      snapshot.goal,
      request.action,
      this.toolRegistry,
    );
    if (policyDecision.status !== 'needs_approval') {
      throw new Error(
        'Approval cannot be requested for this action: ' + policyDecision.summary,
      );
    }
    const createdAt = this.timestamp();
    const expiresAt = new Date(
      this.now().getTime() + APPROVAL_TTL_MS,
    ).toISOString();
    const interaction: PendingInteraction = {
      id: randomUUID(),
      taskId: snapshot.taskId,
      kind: 'approval',
      prompt: request.prompt,
      createdAt,
      expiresAt,
      actionDigest: createActionDigest(request.action),
      action: request.action,
      consequence: request.consequence,
    };
    const waiting = appendMessage(
      { ...snapshot, pendingInteraction: interaction },
      { kind: 'approval_request', role: 'assistant', text: request.prompt },
      createdAt,
    );
    return this.move(waiting, 'awaiting_approval', {
      status: 'warning',
      summary: request.prompt,
      nextActions: ['Review the exact action, then approve or deny it.'],
    });
  }

  decideApproval(input: unknown): TaskSnapshot {
    const request = DecideApprovalRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    const pending = this.matchPendingInteraction(snapshot, request.interactionId);
    if (pending.kind !== 'approval') {
      throw new Error('The pending interaction requires a clarification answer.');
    }
    if (snapshot.phase !== 'awaiting_approval') {
      throw new Error('Task ' + request.taskId + ' is not waiting for approval.');
    }
    if (pending.actionDigest !== request.actionDigest) {
      throw new Error('The approval action digest does not match.');
    }
    if (createActionDigest(pending.action) !== request.actionDigest) {
      throw new Error('The pending action changed after approval was requested.');
    }
    if (Date.parse(pending.expiresAt) <= this.now().getTime()) {
      this.move(
        { ...snapshot, pendingInteraction: null, approvalGrant: null },
        'blocked',
        {
          status: 'warning',
          summary: 'The approval expired before it was used.',
          nextActions: ['Request a fresh approval from current state.'],
        },
      );
      throw new Error('The pending approval has expired.');
    }
    const approved = request.decision === 'approve';
    const timestamp = this.timestamp();
    const decided = appendMessage(
      {
        ...snapshot,
        pendingInteraction: null,
        approvalGrant: approved
          ? {
              interactionId: pending.id,
              actionDigest: pending.actionDigest,
              action: pending.action,
              approvedAt: timestamp,
              expiresAt: pending.expiresAt,
            }
          : null,
      },
      {
        kind: 'approval_decision',
        role: 'user',
        text: approved
          ? 'Approved the exact proposed action.'
          : 'Denied the proposed action.',
      },
      timestamp,
    );
    return this.move(decided, 'planning', {
      status: approved ? 'success' : 'warning',
      summary: approved
        ? 'Exact action approved.'
        : 'Action denied. Continuing without executing it.',
      nextActions: approved
        ? ['Validate current state and execute the held action once.']
        : ['Return the denial to the model.'],
    });
  }

  cancel(input: unknown): TaskSnapshot {
    const request = CancelTaskRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    if (isTerminalPhase(snapshot.phase)) return snapshot;
    return this.move(
      { ...snapshot, pendingInteraction: null, approvalGrant: null },
      'cancelled',
      {
        status: 'warning',
        summary: 'Task cancelled by the user.',
        nextActions: [],
      },
    );
  }

  steer(input: unknown): TaskSnapshot {
    const request = SteerTaskRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    if (snapshot.pendingInteraction) {
      throw new Error('Answer or decide the pending interaction before steering.');
    }
    if (!STEERABLE_PHASES.has(snapshot.phase)) {
      throw new Error(
        'Task ' + snapshot.taskId + ' cannot be steered from ' + snapshot.phase + '.',
      );
    }
    const timestamp = this.timestamp();
    const steering: SteeringInstruction = {
      id: randomUUID(),
      instruction: request.instruction,
      createdAt: timestamp,
      requiresGoalReview: true,
    };
    const steered = appendMessage(
      {
        ...snapshot,
        approvalGrant: null,
        queuedSteering: [...snapshot.queuedSteering, steering].slice(
          -MAX_QUEUED_STEERING,
        ),
      },
      { kind: 'steering', role: 'user', text: request.instruction },
      timestamp,
    );
    return this.record(steered, {
      status: 'warning',
      summary: 'Steering queued for the next safe model boundary.',
      nextActions: ['Finish or cancel any atomic action, then continue.'],
    });
  }

  takeSteering(taskId: string): SteeringInstruction[] {
    const snapshot = this.getTask(taskId);
    if (snapshot.queuedSteering.length === 0) return [];
    const queued = snapshot.queuedSteering;
    this.record(
      { ...snapshot, queuedSteering: [] },
      {
        summary: 'Applying queued steering at a safe boundary.',
        nextActions: ['Return steering to the model.'],
      },
    );
    return queued;
  }

  setRuntimeResumeMetadata(
    taskId: string,
    metadata: TaskSnapshot['runtimeResume'],
  ): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    return this.record(
      { ...snapshot, runtimeResume: metadata },
      {
        summary: 'Workspace runtime continuity metadata updated.',
        nextActions: ['Continue the active workspace turn.'],
      },
    );
  }

  consumeApprovalGrant(input: unknown): TaskSnapshot {
    const request = ConsumeApprovalGrantRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    const grant = snapshot.approvalGrant;
    if (!grant) {
      throw new Error('Task ' + request.taskId + ' has no approved action grant.');
    }
    const actionDigest = createActionDigest(request.action);
    if (grant.actionDigest !== actionDigest) {
      throw new Error('The approved action grant does not match this action.');
    }
    if (createActionDigest(grant.action) !== actionDigest) {
      throw new Error('The approved action changed before dispatch.');
    }
    if (Date.parse(grant.expiresAt) <= this.now().getTime()) {
      this.move({ ...snapshot, approvalGrant: null }, 'blocked', {
        status: 'warning',
        summary: 'The approved action expired before dispatch.',
        nextActions: ['Request a fresh approval from current state.'],
      });
      throw new Error('The approved action grant has expired.');
    }
    if (!snapshot.goal) throw new Error('Approved action requires a task contract.');
    const policyDecision = evaluateAction(
      snapshot.goal,
      request.action,
      this.toolRegistry,
    );
    if (policyDecision.status !== 'needs_approval') {
      throw new Error(
        'Approved action cannot be dispatched: ' + policyDecision.summary,
      );
    }
    const timestamp = this.timestamp();
    const consuming = appendMessage(
      { ...snapshot, approvalGrant: null },
      {
        kind: 'status',
        role: 'system',
        text: 'Consuming approval for: ' + grant.action.description,
      },
      timestamp,
    );
    return this.move(
      consuming,
      'acting',
      {
        summary: 'Using approved tool action: ' + grant.action.description,
        nextActions: ['Return the result before considering another action.'],
        ...(grant.action.toolId && grant.action.operation
          ? {
              tool: {
                toolId: grant.action.toolId,
                operation: grant.action.operation,
              },
            }
          : {}),
      },
      timestamp,
    );
  }

  private askForClarification(
    snapshot: TaskSnapshot,
    prompt: string,
    choices?: Array<{ id: string; label: string }>,
  ): TaskSnapshot {
    const timestamp = this.timestamp();
    const interaction: PendingInteraction = {
      id: randomUUID(),
      taskId: snapshot.taskId,
      kind: 'clarification',
      prompt,
      createdAt: timestamp,
      ...(choices ? { choices } : {}),
    };
    const waiting = appendMessage(
      { ...snapshot, pendingInteraction: interaction },
      { kind: 'clarification', role: 'assistant', text: prompt },
      timestamp,
    );
    return this.move(waiting, 'awaiting_input', {
      status: 'warning',
      summary: prompt,
      nextActions: ['Answer by voice or text to continue this task.'],
    });
  }

  private assertCanCreateInteraction(
    snapshot: TaskSnapshot,
    targetPhase: 'awaiting_input' | 'awaiting_approval',
  ): void {
    if (snapshot.pendingInteraction) {
      throw new Error('Task ' + snapshot.taskId + ' already has a pending interaction.');
    }
    if (targetPhase === 'awaiting_approval' && snapshot.approvalGrant) {
      throw new Error(
        'Task ' + snapshot.taskId + ' already has an unconsumed approval grant.',
      );
    }
    if (!canTransition(snapshot.phase, targetPhase)) {
      throw new Error(
        'Task ' +
          snapshot.taskId +
          ' cannot request interaction from ' +
          snapshot.phase +
          '.',
      );
    }
  }

  private getTask(taskId: string): TaskSnapshot {
    const snapshot = this.tasks.get(taskId);
    if (!snapshot) throw new Error('Task ' + taskId + ' was not found.');
    return snapshot;
  }

  private matchPendingInteraction(
    snapshot: TaskSnapshot,
    interactionId: string,
  ): PendingInteraction {
    const pending = snapshot.pendingInteraction;
    if (!pending) {
      throw new Error('Task ' + snapshot.taskId + ' has no pending interaction.');
    }
    if (pending.id !== interactionId) {
      throw new Error('The interaction ID does not match the pending request.');
    }
    return pending;
  }

  private move(
    snapshot: TaskSnapshot,
    phase: Parameters<typeof transitionTask>[1],
    details: Parameters<typeof transitionTask>[2],
    timestamp = this.timestamp(),
  ): TaskSnapshot {
    const transitionSnapshot = isTerminalPhase(phase)
      ? {
          ...snapshot,
          pendingInteraction: null,
          approvalGrant: null,
          queuedSteering: [],
        }
      : snapshot;
    const updated = TaskSnapshotSchema.parse(
      transitionTask(transitionSnapshot, phase, { ...details, timestamp }),
    );
    const event = updated.lastEvent;
    if (!event) throw new Error('A lifecycle transition must create an event.');
    this.tasks.set(updated.taskId, updated);
    this.emit('task-update', {
      event: event satisfies TaskEvent,
      snapshot: updated,
    } satisfies TaskUpdate);
    return updated;
  }

  private record(
    snapshot: TaskSnapshot,
    details: RuntimeEventDetails,
  ): TaskSnapshot {
    const timestamp = this.timestamp();
    const event: TaskEvent = {
      eventId: randomUUID(),
      taskId: snapshot.taskId,
      phase: snapshot.phase,
      timestamp,
      status: details.status ?? 'success',
      summary: details.summary,
      nextActions: details.nextActions ?? [],
      artifacts: [],
      ...(details.tool ? { tool: details.tool } : {}),
    };
    const updated = TaskSnapshotSchema.parse({
      ...snapshot,
      updatedAt: timestamp,
      lastEvent: event,
    });
    this.tasks.set(updated.taskId, updated);
    this.emit('task-update', {
      event,
      snapshot: updated,
    } satisfies TaskUpdate);
    return updated;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
