import { randomUUID } from 'node:crypto';

import {
  TaskUpdateSchema,
  SubmitTaskRequestSchema,
  type GoalSpec,
  type HostedTaskEvent,
  type HostedTaskRecord,
  type TaskSnapshot,
  type TaskUpdate,
} from '../../shared/contracts';
import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';
import type { TaskRuntime } from '../agent/task-runtime';
import type { ActivityContextService } from '../knowledge/activity-context-service';
import type { ActivityProgressReporter } from '../knowledge/activity-progress-reporter';
import type { AppPreferencesService } from '../preferences/app-preferences-service';
import type { WorkspaceSelectionService } from '../workspace/workspace-selection-service';

import {
  projectHostedTask,
  type HostedTaskClient,
} from './hosted-task-client';

interface TaskApplicationServiceOptions {
  activityContextService?: Pick<ActivityContextService, 'create' | 'inspect'>;
  activityProgressReporter?: Pick<ActivityProgressReporter, 'bind'>;
  appPreferencesService?: Pick<AppPreferencesService, 'get'>;
  workspaceSelectionService?: Pick<WorkspaceSelectionService, 'resolve'>;
  hostedTaskClient?: Pick<
    HostedTaskClient,
    'cancel' | 'decideApproval' | 'get' | 'list' | 'steer' | 'submit' | 'subscribe'
  >;
  onHostedUpdate?: (update: TaskUpdate) => void;
  onHostedTerminal?: (taskId: string) => Promise<void> | void;
  useHostedRuntime?: () => boolean;
}

function hostedIntentAuthorization(record: HostedTaskRecord) {
  if (record.contractSchemaVersion === 8 && record.intentAuthorization) {
    return record.intentAuthorization;
  }
  if (record.contractSchemaVersion === 7) {
    return {
      schemaVersion: 1 as const,
      revision: Math.max(1, record.outcomeRevision),
      source: 'user_instruction' as const,
      grants: [],
    };
  }
  return null;
}

export class TaskApplicationService {
  private readonly hostedByTask = new Map<string, {
    controller: AbortController;
    record: HostedTaskRecord;
    snapshot: TaskSnapshot;
  }>();

  constructor(
    private readonly runtime: TaskRuntime,
    private readonly execution: TaskExecutionCoordinator,
    private readonly options: TaskApplicationServiceOptions = {},
  ) {}

  async submitAndStart(input: unknown): Promise<TaskSnapshot> {
    const request = SubmitTaskRequestSchema.parse(input);
    const preferences = await this.options.appPreferencesService?.get();
    const attempt = request.activityAttemptId
      ? await this.options.activityContextService?.inspect(request.activityAttemptId)
      : null;
    if (request.activityAttemptId && !attempt) {
      throw new Error('This assigned Activity is unavailable.');
    }
    const executionProfile = attempt?.definition.launchTarget === 'workspace'
      ? 'workspace'
      : request.activityAttemptId
        ? 'everyday'
        : request.executionProfile;
    const workspace = request.workspaceSelectionId
      ? await this.options.workspaceSelectionService?.resolve(
          request.workspaceSelectionId,
        )
      : null;
    if (executionProfile === 'workspace' && !workspace) {
      throw new Error('Select a trusted workspace before starting Workspace mode.');
    }
    if (executionProfile !== 'workspace' && workspace) {
      throw new Error('This Activity does not grant Workspace authority.');
    }
    const taskId = randomUUID();
    const activity = attempt
      ? await this.options.activityContextService?.create(
          attempt,
          taskId,
          attempt.definition.launchTarget,
        )
      : null;
    if (request.activityAttemptId && !activity) {
      throw new Error('Could not create the Activity Work Session.');
    }
    if (activity) this.options.activityProgressReporter?.bind(taskId, activity.workSessionId);
    const autonomyMode = preferences?.autonomyMode ?? 'balanced';
    if (this.options.useHostedRuntime?.() && this.options.hostedTaskClient) {
      const record = await this.options.hostedTaskClient.submit({
        clientTaskId: randomUUID(),
        taskId,
        request: request.text,
        autonomyMode,
        executionProfile,
        workspaceSelectionId: request.workspaceSelectionId,
      });
      if (
        record.contractSchemaVersion !== 8 ||
        !record.outcomeContract ||
        !record.intentAuthorization ||
        !record.autonomyMode
      ) {
        throw new Error('The hosted runtime did not return a compatible task authority contract.');
      }
      this.runtime.submit(
        { ...request, executionProfile },
        {
          activity,
          autonomyMode: record.autonomyMode,
          executionProfile,
          intentAuthorization: record.intentAuthorization,
          outcomeContract: record.outcomeContract,
          runtimeKind: 'openai_agents',
          taskId,
          workspace,
        },
      );
      const snapshot = this.runtime.start({ taskId });
      this.attachHostedRun(record, snapshot);
      return snapshot;
    }
    const submitted = this.runtime.submit(
      { ...request, executionProfile },
      {
        activity,
        autonomyMode,
        executionProfile,
        runtimeKind: 'openai_agents',
        taskId,
        workspace,
      },
    );
    return this.execution.start({ taskId: submitted.taskId });
  }

  start(input: unknown): TaskSnapshot {
    return this.execution.start(input);
  }

  async cancel(input: unknown): Promise<TaskSnapshot> {
    const taskId = typeof input === 'object' && input && 'taskId' in input
      ? String(input.taskId)
      : '';
    const hosted = this.hostedByTask.get(taskId);
    if (hosted && this.options.hostedTaskClient) {
      const record = await this.options.hostedTaskClient.cancel(hosted.record.id);
      hosted.record = record;
      hosted.snapshot = projectHostedTask(record, undefined, hosted.snapshot);
      return hosted.snapshot;
    }
    return this.execution.cancel(input);
  }

  respond(input: unknown): TaskSnapshot {
    const snapshot = this.runtime.respondToInteraction(input);
    if (!this.hostedByTask.has(snapshot.taskId)) {
      this.execution.resume(snapshot.taskId);
    }
    return snapshot;
  }

  decideApproval(input: unknown): TaskSnapshot {
    const snapshot = this.runtime.decideApproval(input);
    if (!this.hostedByTask.has(snapshot.taskId)) {
      this.execution.resume(snapshot.taskId);
    }
    return snapshot;
  }

  async steer(input: unknown): Promise<TaskSnapshot> {
    const request = input as { taskId?: string; instruction?: string };
    const hosted = request.taskId ? this.hostedByTask.get(request.taskId) : undefined;
    if (hosted && this.options.hostedTaskClient && request.instruction) {
      await this.options.hostedTaskClient.steer(
        hosted.record.id,
        randomUUID(),
        request.instruction,
      );
      const record = await this.options.hostedTaskClient.get(hosted.record.id);
      if (
        record.contractSchemaVersion !== 8 ||
        !record.autonomyMode ||
        !record.intentAuthorization ||
        !record.outcomeContract
      ) {
        throw new Error('The revised hosted authority contract is incompatible.');
      }
      const synchronized = this.runtime.synchronizeHostedAuthority(
        hosted.record.taskId,
        {
          autonomyMode: record.autonomyMode,
          intentAuthorization: record.intentAuthorization,
          outcomeContract: record.outcomeContract,
        },
      );
      hosted.record = record;
      hosted.snapshot = {
        ...hosted.snapshot,
        goal: synchronized.goal,
        outcomes: synchronized.outcomes,
        approvalGrant: null,
      };
      return hosted.snapshot;
    }
    return this.execution.steer(input);
  }

  hostedGoal(runId: string): GoalSpec | undefined {
    return [...this.hostedByTask.values()].find((entry) => entry.record.id === runId)
      ?.snapshot.goal ?? undefined;
  }

  taskIdForHostedRun(runId: string): string | undefined {
    for (const [taskId, entry] of this.hostedByTask) {
      if (entry.record.id === runId) return taskId;
    }
    return undefined;
  }

  async restoreHostedRuns(): Promise<number> {
    if (!this.options.hostedTaskClient) return 0;
    const records = await this.options.hostedTaskClient.list();
    const active = records.filter((record) =>
      !['completed', 'blocked', 'failed', 'cancelled', 'expired'].includes(record.state),
    );
    let restored = 0;
    for (const record of active) {
      if (this.hostedByTask.has(record.taskId)) continue;
      const workspace = record.workspaceSelectionId
        ? await this.options.workspaceSelectionService?.resolve(record.workspaceSelectionId)
        : null;
      if (record.executionProfile === 'workspace' && !workspace) continue;
      if (
        !record.outcomeContract ||
        !record.autonomyMode
      ) continue;
      const intentAuthorization = hostedIntentAuthorization(record);
      if (!intentAuthorization) continue;
      this.runtime.submit(
        {
          activityAttemptId: null,
          executionProfile: record.executionProfile,
          text: record.request,
          workspaceSelectionId: record.workspaceSelectionId,
        },
        {
          activity: null,
          autonomyMode: record.autonomyMode,
          executionProfile: record.executionProfile,
          intentAuthorization,
          outcomeContract: record.outcomeContract,
          runtimeKind: 'openai_agents',
          taskId: record.taskId,
          workspace,
        },
      );
      const snapshot = this.runtime.start({ taskId: record.taskId });
      this.attachHostedRun(record, snapshot);
      restored += 1;
    }
    return restored;
  }

  private attachHostedRun(record: HostedTaskRecord, snapshot: TaskSnapshot): void {
    if (!this.options.hostedTaskClient) return;
    const taskId = record.taskId;
    const controller = new AbortController();
    this.hostedByTask.set(taskId, { controller, record, snapshot });
    void this.options.hostedTaskClient
      .subscribe(
        record.id,
        (event) => this.applyHostedEvent(taskId, event),
        controller.signal,
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const current = this.hostedByTask.get(taskId);
        if (!current) return;
        this.applyHostedEvent(taskId, {
          id: randomUUID(),
          runId: current.record.id,
          sequence: Number.MAX_SAFE_INTEGER,
          type: 'run.connection_failed',
          summary: error instanceof Error
            ? `Hosted task connection failed: ${error.message}`
            : 'Hosted task connection failed.',
          createdAt: new Date().toISOString(),
        });
      });
  }

  private applyHostedEvent(taskId: string, event: HostedTaskEvent): void {
    const hosted = this.hostedByTask.get(taskId);
    if (!hosted) return;
    const stateByType: Partial<Record<string, HostedTaskRecord['state']>> = {
      'run.awaiting_worker': 'awaiting_worker',
      'run.blocked': 'blocked',
      'run.cancelled': 'cancelled',
      'run.completed': 'completed',
      'run.connection_failed': 'recovering',
      'run.outcomes_incomplete': 'blocked',
      'run.planning': 'planning',
      'tool.completed': 'verifying',
      'tool.requested': 'awaiting_worker',
    };
    hosted.record = {
      ...hosted.record,
      state: stateByType[event.type] ?? hosted.record.state,
      publicSummary: event.summary,
      updatedAt: event.createdAt,
    };
    hosted.snapshot = projectHostedTask(hosted.record, event, hosted.snapshot);
    const lastEvent = hosted.snapshot.lastEvent;
    if (!lastEvent) return;
    this.options.onHostedUpdate?.(
      TaskUpdateSchema.parse({ event: lastEvent, snapshot: hosted.snapshot }),
    );
    if (['completed', 'blocked', 'failed', 'cancelled', 'expired'].includes(hosted.record.state)) {
      hosted.controller.abort();
      void this.options.onHostedTerminal?.(taskId);
    }
  }
}
