import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { LocalTurnEventKind } from '../../../services/agent-runtime/src/protocol';
import {
  WorkCheckProjectionSchema,
  CancelTaskRequestSchema,
  CoachProgressSchema,
  RequestTaskInputSchema,
  RespondToInteractionRequestSchema,
  StartTaskRequestSchema,
  SteerTaskRequestSchema,
  SubmitTaskRequestSchema,
  TaskContractSchema,
  TaskSnapshotSchema,
  TaskUpdateSchema,
  type PendingInteraction,
  type TaskEvent,
  type TaskMessage,
  type TaskSnapshot,
} from '../../shared/contracts';

const MAX_TASK_MESSAGES = 200;

export interface LocalTaskSubmissionOptions {
  authority: unknown;
  taskId: string;
}

interface TaskRuntimeOptions { now?: () => Date }
interface LocalEvent { nextActions?: string[]; status?: TaskEvent['status']; summary: string; tool?: TaskEvent['tool'] }

/** Canonical, pure renderer-facing lifecycle for locally owned SDK tasks. */
export class TaskRuntime extends EventEmitter {
  private readonly tasks = new Map<string, TaskSnapshot>();
  private readonly now: () => Date;

  constructor(options: TaskRuntimeOptions = {}) {
    super();
    this.now = options.now ?? (() => new Date());
  }

  submit(input: unknown, options: LocalTaskSubmissionOptions): TaskSnapshot {
    const request = SubmitTaskRequestSchema.parse(input);
    const goal = TaskContractSchema.parse(options.authority);
    if (request.text !== goal.originalRequest) throw new Error('The local authority contract does not match the task request.');
    const timestamp = this.timestamp();
    const snapshot = TaskSnapshotSchema.parse({
      taskId: options.taskId,
      request: request.text,
      phase: 'ready',
      goal,
      messages: [{ messageId: randomUUID(), taskId: options.taskId, role: 'user', kind: 'request', text: request.text, timestamp }],
      pendingInteraction: null,
      progress: goal.schemaVersion === 11 && goal.route === 'coach'
        ? null
        : { kind: 'tool_calls', completed: 0, limit: goal.limits.maxToolCalls },
      queuedSteering: [],
      runtimeResume: goal.schemaVersion === 11 && goal.route === 'coach'
        ? null
        : { kind: 'local_agents_sdk', threadId: options.taskId, runtimeVersion: '0.17.0', checkpointRevision: null },
      createdAt: timestamp,
      updatedAt: timestamp,
      lastEvent: null,
    });
    return this.commit(snapshot, { summary: 'Local task created.', nextActions: ['Starting the local agent.'] });
  }

  start(input: unknown): TaskSnapshot {
    const { taskId } = StartTaskRequestSchema.parse(input);
    const snapshot = this.getTask(taskId);
    if (snapshot.phase !== 'ready') throw new Error(`Task ${taskId} is not ready to start.`);
    const coach = snapshot.goal?.schemaVersion === 11 && snapshot.goal.route === 'coach';
    return this.commit(
      { ...snapshot, phase: 'planning' },
      { summary: coach ? 'Tro Coach started the task.' : 'The local Agents SDK started the task.' },
    );
  }

  applyCoachStatus(
    taskId: string,
    coachPhase: 'observing' | 'planning' | 'presenting' | 'waiting',
    summary: string,
  ): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    const phase = coachPhase === 'waiting' ? 'awaiting_input' : coachPhase === 'presenting' ? 'acting' : coachPhase;
    return this.commit({ ...snapshot, phase }, { summary });
  }

  appendCoachExplanation(taskId: string, text: string): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    if (snapshot.goal?.schemaVersion !== 11 || snapshot.goal.route !== 'coach') {
      throw new Error('An explanation belongs to a Coach task.');
    }
    return this.commit(
      this.appendMessage(snapshot, { role: 'assistant', kind: 'response', text: text.slice(0, 4_000) }, this.timestamp()),
      { summary: 'An explanation step is ready.' },
    );
  }

  updateWorkCheck(taskId: string, input: unknown): TaskSnapshot {
    const workCheck = WorkCheckProjectionSchema.parse(input);
    const snapshot = this.getTask(taskId);
    const activity = snapshot.goal?.activity;
    if (!activity || activity.purpose !== 'check' || ['completed','cancelled','failed','blocked'].includes(snapshot.phase)) throw new Error('Check result no longer belongs to an active task.');
    if (workCheck.report && (workCheck.report.taskId !== taskId || workCheck.report.attemptId !== activity.attemptId || workCheck.report.activityVersionId !== activity.activityVersionId)) throw new Error('Check result assignment mismatch.');
    return this.commit({...snapshot, workCheck}, {summary: workCheck.phase === 'checked' ? 'Check feedback is ready.' : 'Assignment check updated.'});
  }

  updateWorkSessionSync(taskId: string, sync: 'pending' | 'synced' | 'unknown'): void {
    const snapshot = this.tasks.get(taskId);
    if (!snapshot) return;
    if (snapshot.workSessionSync === sync) return;
    this.commit({...snapshot, workSessionSync:sync}, {summary:'Work Session reporting updated.'});
  }

  updateCoachProgress(taskId: string, input: unknown): TaskSnapshot {
    const progress = CoachProgressSchema.parse(input);
    const snapshot = this.getTask(taskId);
    const goal = snapshot.goal;
    if (!goal || goal.schemaVersion !== 11 || goal.route !== 'coach') {
      throw new Error('Coach progress can only be attached to a Coach task.');
    }
    return this.commit({
      ...snapshot,
      goal: { ...goal, coachProgress: progress },
    }, { summary: `Coach prepared step ${progress.stepNumber}.` });
  }

  restore(input: unknown): TaskSnapshot {
    const snapshot = TaskSnapshotSchema.parse(input);
    this.tasks.set(snapshot.taskId, snapshot);
    return snapshot;
  }

  getSnapshot(taskId: string): TaskSnapshot { return TaskSnapshotSchema.parse(this.getTask(taskId)); }

  applyRuntimeEvent(
    taskId: string,
    event: LocalTurnEventKind,
    summary: string,
    data: Record<string, unknown> | null,
  ): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    if (event === 'assistant_delta') {
      return this.applyAssistantDelta(snapshot, summary);
    }
    const phase = event === 'tool_requested' || event === 'tool_started'
      ? 'acting'
      : event === 'tool_completed'
        ? 'verifying'
        : snapshot.phase;
    const tool = data && typeof data.toolId === 'string' && typeof data.operation === 'string'
      ? { toolId: data.toolId, operation: data.operation }
      : undefined;
    const progress = event === 'tool_completed' && snapshot.progress?.kind === 'tool_calls'
      ? {
          ...snapshot.progress,
          completed: Math.min(snapshot.progress.limit, snapshot.progress.completed + 1),
        }
      : snapshot.progress;
    return this.commit({ ...snapshot, phase, progress }, {
      summary,
      status: event === 'tool_failed'
        || event === 'tool_unknown'
        || event === 'model_request_rejected'
        || event === 'model_request_failed'
        ? 'warning'
        : 'success',
      ...(tool ? { tool } : {}),
    });
  }

  complete(
    taskId: string,
    terminal: { status: 'completed' | 'failed' | 'cancelled' | 'unknown'; finalOutput: string | null; message: string },
  ): TaskSnapshot {
    let snapshot = this.getTask(taskId);
    const timestamp = this.timestamp();
    if (terminal.finalOutput) {
      const last = snapshot.messages.at(-1);
      snapshot = last?.role === 'assistant' && last.kind === 'response'
        ? {
            ...snapshot,
            messages: [
              ...snapshot.messages.slice(0, -1),
              { ...last, text: terminal.finalOutput, timestamp },
            ],
          }
        : this.appendMessage(snapshot, { kind: 'response', role: 'assistant', text: terminal.finalOutput }, timestamp);
    }
    const phase = terminal.status === 'completed'
      ? 'completed'
      : terminal.status === 'cancelled'
        ? 'cancelled'
        : terminal.status === 'unknown'
          ? 'blocked'
          : 'failed';
    const workCheck = snapshot.workCheck?.phase === 'checking' ? {phase: terminal.status === 'cancelled' ? 'cancelled' as const : terminal.status === 'unknown' ? 'unknown' as const : 'failed' as const, report:null, message:terminal.message.slice(0,1200)} : snapshot.workCheck;
    return this.commit({ ...snapshot, workCheck, phase, pendingInteraction: null }, {
      summary: terminal.finalOutput ?? terminal.message,
      status: terminal.status === 'completed' ? 'success' : 'error',
    });
  }

  cancel(input: unknown): TaskSnapshot {
    const request = CancelTaskRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    if (['completed', 'failed', 'cancelled', 'blocked'].includes(snapshot.phase)) return snapshot;
    return this.commit({ ...snapshot, phase: 'cancelled', pendingInteraction: null }, {
      summary: 'The local task was cancelled.', status: 'warning',
    });
  }

  steer(input: unknown): TaskSnapshot {
    const request = SteerTaskRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    const timestamp = this.timestamp();
    const instruction = { id: randomUUID(), instruction: request.instruction, createdAt: timestamp, requiresGoalReview: true as const };
    return this.commit(this.appendMessage({ ...snapshot, queuedSteering: [...snapshot.queuedSteering, instruction].slice(-50) }, {
      kind: 'request', role: 'user', text: request.instruction,
    }, timestamp), { summary: 'Steering was queued for the local agent.' });
  }

  requestInput(input: unknown): TaskSnapshot {
    const request = RequestTaskInputSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    if (snapshot.pendingInteraction) throw new Error('Resolve the pending interaction before creating another.');
    const timestamp = this.timestamp();
    const interaction: PendingInteraction = {
      id: randomUUID(), taskId: snapshot.taskId, kind: 'clarification', prompt: request.prompt,
      createdAt: timestamp, ...(request.choices ? { choices: request.choices } : {}),
    };
    return this.commit(this.appendMessage({ ...snapshot, pendingInteraction: interaction, phase: 'awaiting_input' }, {
      kind: 'clarification', role: 'assistant', text: request.prompt,
    }, timestamp), { summary: request.prompt, status: 'warning' });
  }

  respondToInteraction(input: unknown): TaskSnapshot {
    const request = RespondToInteractionRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    if (!snapshot.pendingInteraction || snapshot.pendingInteraction.id !== request.interactionId) {
      throw new Error('The interaction ID does not match the pending request.');
    }
    const timestamp = this.timestamp();
    return this.commit(this.appendMessage({ ...snapshot, pendingInteraction: null, phase: 'planning' }, {
      kind: 'answer', role: 'user', text: request.text,
    }, timestamp), { summary: 'The clarification answer was sent to the local agent.' });
  }

  private applyAssistantDelta(snapshot: TaskSnapshot, delta: string): TaskSnapshot {
    const timestamp = this.timestamp();
    const last = snapshot.messages.at(-1);
    const messages = last?.role === 'assistant' && last.kind === 'response'
      ? [...snapshot.messages.slice(0, -1), { ...last, text: `${last.text}${delta}`.slice(0, 8_000), timestamp }]
      : [...snapshot.messages, { messageId: randomUUID(), taskId: snapshot.taskId, role: 'assistant' as const, kind: 'response' as const, text: delta.slice(0, 8_000), timestamp }];
    return this.commit(
      { ...snapshot, messages: messages.slice(-MAX_TASK_MESSAGES) },
      { summary: 'Tro is responding.' },
    );
  }

  private appendMessage(snapshot: TaskSnapshot, details: Pick<TaskMessage, 'kind' | 'role' | 'text'>, timestamp: string): TaskSnapshot {
    return { ...snapshot, messages: [...snapshot.messages, { messageId: randomUUID(), taskId: snapshot.taskId, ...details, timestamp }].slice(-MAX_TASK_MESSAGES) };
  }

  private commit(snapshot: TaskSnapshot, details: LocalEvent): TaskSnapshot {
    const timestamp = this.timestamp();
    const event: TaskEvent = {
      eventId: randomUUID(), taskId: snapshot.taskId, phase: snapshot.phase, timestamp,
      status: details.status ?? 'success', summary: details.summary,
      nextActions: details.nextActions ?? [], artifacts: [], ...(details.tool ? { tool: details.tool } : {}),
    };
    const next = TaskSnapshotSchema.parse({ ...snapshot, updatedAt: timestamp, lastEvent: event });
    this.tasks.set(next.taskId, next);
    this.emit('task-update', TaskUpdateSchema.parse({ event, snapshot: next }));
    return next;
  }

  private getTask(taskId: string): TaskSnapshot {
    const snapshot = this.tasks.get(taskId);
    if (!snapshot) throw new Error(`Task ${taskId} does not exist.`);
    return snapshot;
  }
  private timestamp(): string { return this.now().toISOString(); }
}
