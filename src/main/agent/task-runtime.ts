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
  type SteeringInstruction,
  type TaskEvent,
  type TaskMessage,
  type TaskSnapshot,
  type TaskUpdate,
} from '../../shared/contracts';

import { createActionDigest } from './action-approval';
import { canTransition, isTerminalPhase, transitionTask } from './goal-machine';
import { compileGoal, requestNeedsClarification } from './goal-router';
import { evaluateAction } from './policy';

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
}

interface MessageDetails {
  kind: TaskMessage['kind'];
  role: TaskMessage['role'];
  text: string;
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

export class TaskRuntime extends EventEmitter {
  private readonly tasks = new Map<string, TaskSnapshot>();

  private readonly now: () => Date;

  constructor(options: TaskRuntimeOptions = {}) {
    super();
    this.now = options.now ?? (() => new Date());
  }

  submit(input: unknown): TaskSnapshot {
    const request = SubmitTaskRequestSchema.parse(input);
    const timestamp = this.timestamp();
    let snapshot: TaskSnapshot = {
      taskId: randomUUID(),
      request: request.text,
      phase: 'idle',
      goal: null,
      messages: [],
      pendingInteraction: null,
      approvalGrant: null,
      progress: null,
      queuedSteering: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      lastEvent: null,
    };

    snapshot = appendMessage(
      snapshot,
      { kind: 'request', role: 'user', text: request.text },
      timestamp,
    );
    snapshot = this.move(snapshot, 'interpreting', {
      summary: 'Interpreting the request and compiling a bounded goal.',
      nextActions: ['Classify domain, interaction mode, and capabilities.'],
    });

    if (requestNeedsClarification(request.text)) {
      return this.askForClarification(
        snapshot,
        'What outcome would you like, and should TroCode guide you or act for you?',
        'clarifying',
      );
    }

    return this.compileReadyGoal(snapshot);
  }

  start(input: unknown): TaskSnapshot {
    const request = StartTaskRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);

    if (snapshot.phase !== 'ready') {
      throw new Error(`Task ${request.taskId} is not ready to start.`);
    }

    return this.move(snapshot, 'planning', {
      summary: 'Task coordination started.',
      nextActions: ['Observe the target before proposing an action.'],
    });
  }

  getSnapshot(taskId: string): TaskSnapshot {
    return TaskSnapshotSchema.parse(this.getTask(taskId));
  }

  beginObservation(taskId: string, summary: string): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    if (snapshot.phase === 'observing') {
      return this.record(snapshot, {
        summary,
        nextActions: ['Ask the model for one bounded next step.'],
      });
    }

    return this.move(snapshot, 'observing', {
      summary,
      nextActions: ['Capture a fresh screenshot before choosing an action.'],
    });
  }

  beginAllowedAction(taskId: string, action: ProposedAction): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    if (!snapshot.goal) throw new Error('Desktop action requires a compiled goal.');

    const decision = evaluateAction(snapshot.goal, action);
    if (decision.status !== 'allowed') {
      throw new Error(`Action is not directly dispatchable: ${decision.summary}`);
    }

    return this.move(snapshot, 'acting', {
      summary: `Dispatching action: ${action.description}`,
      nextActions: ['Observe and verify before choosing another action.'],
    });
  }

  beginVerification(
    taskId: string,
    summary: string,
    actionCompleted = false,
  ): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    const progress =
      actionCompleted && snapshot.progress
        ? {
            ...snapshot.progress,
            currentStep: snapshot.progress.currentStep + 1,
          }
        : snapshot.progress;

    return this.move({ ...snapshot, progress }, 'verifying', {
      summary,
      nextActions: ['Use a fresh observation to confirm the result.'],
    });
  }

  complete(taskId: string, summary: string): TaskSnapshot {
    return this.move(this.getTask(taskId), 'completed', {
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

    return this.record({ ...snapshot, approvalGrant: null }, {
      status: 'warning',
      summary,
      nextActions: ['Request fresh approval if a consequential action remains.'],
    });
  }

  resumePlanning(taskId: string, summary: string): TaskSnapshot {
    return this.move(this.getTask(taskId), 'planning', {
      summary,
      nextActions: ['Re-observe before choosing another action.'],
    });
  }

  requestInput(input: unknown): TaskSnapshot {
    const request = RequestTaskInputSchema.parse(input);
    const snapshot = this.getTask(request.taskId);

    this.assertCanCreateInteraction(snapshot, 'awaiting_input');

    return this.askForClarification(
      { ...snapshot, approvalGrant: null },
      request.prompt,
      'awaiting_input',
      request.choices,
    );
  }

  respondToInteraction(input: unknown): TaskSnapshot {
    const request = RespondToInteractionRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    const pending = this.matchPendingInteraction(
      snapshot,
      request.interactionId,
    );

    if (pending.kind !== 'clarification') {
      throw new Error('The pending interaction requires an approval decision.');
    }
    if (snapshot.phase !== 'clarifying' && snapshot.phase !== 'awaiting_input') {
      throw new Error(`Task ${request.taskId} is not waiting for an answer.`);
    }

    const timestamp = this.timestamp();
    let answeredSnapshot = appendMessage(
      { ...snapshot, pendingInteraction: null },
      { kind: 'answer', role: 'user', text: request.text },
      timestamp,
    );

    if (snapshot.phase === 'awaiting_input') {
      return this.move(answeredSnapshot, 'observing', {
        summary: 'Answer received. Re-observing before any action.',
        nextActions: ['Capture fresh application state and re-plan safely.'],
      });
    }

    answeredSnapshot = {
      ...answeredSnapshot,
      request: request.text,
    };
    answeredSnapshot = this.move(answeredSnapshot, 'interpreting', {
      summary: 'Clarification received. Recompiling the bounded goal.',
      nextActions: ['Validate the clarified objective and scope.'],
    });

    if (requestNeedsClarification(request.text)) {
      return this.askForClarification(
        answeredSnapshot,
        'Please describe the specific outcome you want TroCode to accomplish.',
        'clarifying',
      );
    }

    return this.compileReadyGoal(answeredSnapshot);
  }

  requestApproval(input: unknown): TaskSnapshot {
    const request = RequestApprovalSchema.parse(input);
    const snapshot = this.getTask(request.taskId);

    this.assertCanCreateInteraction(snapshot, 'awaiting_approval');
    if (!snapshot.goal) throw new Error('Approval requires a compiled goal.');

    const policyDecision = evaluateAction(snapshot.goal, request.action);
    if (policyDecision.status !== 'needs_approval') {
      throw new Error(
        `Approval cannot be requested for this action: ${policyDecision.summary}`,
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
    const waitingSnapshot = appendMessage(
      { ...snapshot, pendingInteraction: interaction },
      { kind: 'approval_request', role: 'assistant', text: request.prompt },
      createdAt,
    );

    return this.move(waitingSnapshot, 'awaiting_approval', {
      status: 'warning',
      summary: request.prompt,
      nextActions: ['Review the exact action, then approve or deny it.'],
    });
  }

  decideApproval(input: unknown): TaskSnapshot {
    const request = DecideApprovalRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    const pending = this.matchPendingInteraction(
      snapshot,
      request.interactionId,
    );

    if (pending.kind !== 'approval') {
      throw new Error('The pending interaction requires a clarification answer.');
    }
    if (snapshot.phase !== 'awaiting_approval') {
      throw new Error(`Task ${request.taskId} is not waiting for approval.`);
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
          nextActions: ['Re-observe and request a fresh approval.'],
        },
      );
      throw new Error('The pending approval has expired.');
    }

    const approved = request.decision === 'approve';
    const timestamp = this.timestamp();
    const decidedSnapshot = appendMessage(
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

    return this.move(decidedSnapshot, 'observing', {
      status: approved ? 'success' : 'warning',
      summary: approved
        ? 'Exact action approved. Re-observing before dispatch.'
        : 'Action denied. Re-observing before replanning.',
      nextActions: approved
        ? ['Confirm the observation and action digest still match.']
        : ['Choose a route that does not perform the denied action.'],
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
        `Task ${snapshot.taskId} cannot be steered from ${snapshot.phase}.`,
      );
    }

    const timestamp = this.timestamp();
    const steering: SteeringInstruction = {
      id: randomUUID(),
      instruction: request.instruction,
      createdAt: timestamp,
      requiresGoalReview: true,
    };
    const steeredSnapshot = appendMessage(
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

    return this.record(steeredSnapshot, {
      status: 'warning',
      summary: 'Steering queued for goal review at the next safe boundary.',
      nextActions: [
        'Finish or cancel the atomic action, review scope, then re-observe.',
      ],
    });
  }

  takeSteering(taskId: string): SteeringInstruction[] {
    const snapshot = this.getTask(taskId);
    if (snapshot.queuedSteering.length === 0) return [];

    const queuedSteering = snapshot.queuedSteering;
    this.record({ ...snapshot, queuedSteering: [] }, {
      summary: 'Applying queued steering at a safe boundary.',
      nextActions: ['Re-observe before proposing another action.'],
    });
    return queuedSteering;
  }

  consumeApprovalGrant(input: unknown): TaskSnapshot {
    const request = ConsumeApprovalGrantRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    const grant = snapshot.approvalGrant;

    if (!grant) {
      throw new Error(`Task ${request.taskId} has no approved action grant.`);
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
        nextActions: ['Re-observe and request a fresh approval.'],
      });
      throw new Error('The approved action grant has expired.');
    }
    if (!snapshot.goal) throw new Error('Approved action requires a compiled goal.');

    const policyDecision = evaluateAction(snapshot.goal, request.action);
    if (policyDecision.status !== 'needs_approval') {
      throw new Error(
        `Approved action cannot be dispatched: ${policyDecision.summary}`,
      );
    }

    const timestamp = this.timestamp();
    const consumingSnapshot = appendMessage(
      { ...snapshot, approvalGrant: null },
      {
        kind: 'status',
        role: 'system',
        text: `Consuming approval for: ${grant.action.description}`,
      },
      timestamp,
    );

    return this.move(
      consumingSnapshot,
      'acting',
      {
        summary: `Dispatching approved action: ${grant.action.description}`,
        nextActions: ['Observe and verify before considering any retry.'],
      },
      timestamp,
    );
  }

  private askForClarification(
    snapshot: TaskSnapshot,
    prompt: string,
    phase: 'clarifying' | 'awaiting_input',
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
    const waitingSnapshot = appendMessage(
      { ...snapshot, pendingInteraction: interaction },
      { kind: 'clarification', role: 'assistant', text: prompt },
      timestamp,
    );

    return this.move(waitingSnapshot, phase, {
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
      throw new Error(`Task ${snapshot.taskId} already has a pending interaction.`);
    }
    if (targetPhase === 'awaiting_approval' && snapshot.approvalGrant) {
      throw new Error(
        `Task ${snapshot.taskId} already has an unconsumed approval grant.`,
      );
    }
    if (!canTransition(snapshot.phase, targetPhase)) {
      throw new Error(
        `Task ${snapshot.taskId} cannot request interaction from ${snapshot.phase}.`,
      );
    }
  }

  private compileReadyGoal(snapshot: TaskSnapshot): TaskSnapshot {
    const goal = compileGoal(snapshot.request);
    return this.move(
      {
        ...snapshot,
        goal,
        pendingInteraction: null,
        approvalGrant: null,
        progress: { currentStep: 0, maxSteps: goal.limits.maxSteps },
      },
      'ready',
      {
        summary: 'Goal compiled and ready for review.',
        nextActions: [
          'Review the capability and resource scope.',
          'Start the task when the execution provider is available.',
        ],
      },
    );
  }

  private getTask(taskId: string): TaskSnapshot {
    const snapshot = this.tasks.get(taskId);
    if (!snapshot) throw new Error(`Task ${taskId} was not found.`);
    return snapshot;
  }

  private matchPendingInteraction(
    snapshot: TaskSnapshot,
    interactionId: string,
  ): PendingInteraction {
    const pending = snapshot.pendingInteraction;
    if (!pending) {
      throw new Error(`Task ${snapshot.taskId} has no pending interaction.`);
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
    const updatedSnapshot = TaskSnapshotSchema.parse(
      transitionTask(transitionSnapshot, phase, { ...details, timestamp }),
    );
    const event = updatedSnapshot.lastEvent;
    if (!event) throw new Error('A lifecycle transition must create an event.');

    this.tasks.set(updatedSnapshot.taskId, updatedSnapshot);
    this.emit('task-update', {
      event: event satisfies TaskEvent,
      snapshot: updatedSnapshot,
    } satisfies TaskUpdate);
    return updatedSnapshot;
  }

  private record(
    snapshot: TaskSnapshot,
    details: {
      status?: TaskEvent['status'];
      summary: string;
      nextActions?: string[];
    },
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
    };
    const updatedSnapshot = TaskSnapshotSchema.parse({
      ...snapshot,
      updatedAt: timestamp,
      lastEvent: event,
    });

    this.tasks.set(updatedSnapshot.taskId, updatedSnapshot);
    this.emit('task-update', {
      event,
      snapshot: updatedSnapshot,
    } satisfies TaskUpdate);
    return updatedSnapshot;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
