import { randomUUID } from 'node:crypto';

import {
  SubmitTaskRequestSchema,
  type TaskSnapshot,
} from '../../shared/contracts';
import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';
import type { TaskRuntime } from '../agent/task-runtime';
import type { ActivityContextService } from '../knowledge/activity-context-service';
import type { ActivityProgressReporter } from '../knowledge/activity-progress-reporter';
import type { AppPreferencesService } from '../preferences/app-preferences-service';
import type { WorkspaceSelectionService } from '../workspace/workspace-selection-service';

interface TaskApplicationServiceOptions {
  activityContextService?: Pick<ActivityContextService, 'create' | 'inspect'>;
  activityProgressReporter?: Pick<ActivityProgressReporter, 'bind'>;
  appPreferencesService?: Pick<AppPreferencesService, 'get'>;
  workspaceSelectionService?: Pick<WorkspaceSelectionService, 'resolve'>;
}

export class TaskApplicationService {
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
    const submitted = this.runtime.submit(
      { ...request, executionProfile },
      {
        activity,
        autonomyMode: preferences?.autonomyMode ?? 'balanced',
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

  cancel(input: unknown): TaskSnapshot {
    return this.execution.cancel(input);
  }

  respond(input: unknown): TaskSnapshot {
    const snapshot = this.runtime.respondToInteraction(input);
    this.execution.resume(snapshot.taskId);
    return snapshot;
  }

  decideApproval(input: unknown): TaskSnapshot {
    const snapshot = this.runtime.decideApproval(input);
    this.execution.resume(snapshot.taskId);
    return snapshot;
  }

  steer(input: unknown): Promise<TaskSnapshot> {
    return this.execution.steer(input);
  }
}
