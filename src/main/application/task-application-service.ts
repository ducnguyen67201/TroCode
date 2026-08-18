import {
  SubmitTaskRequestSchema,
  type TaskSnapshot,
} from '../../shared/contracts';
import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';
import type { TaskRuntime } from '../agent/task-runtime';
import type { AppPreferencesService } from '../preferences/app-preferences-service';
import type { WorkspaceSelectionService } from '../workspace/workspace-selection-service';

interface TaskApplicationServiceOptions {
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
    const workspace = request.workspaceSelectionId
      ? await this.options.workspaceSelectionService?.resolve(
          request.workspaceSelectionId,
        )
      : null;
    if (request.executionProfile === 'workspace' && !workspace) {
      throw new Error('Select a trusted workspace before starting Workspace mode.');
    }
    const submitted = this.runtime.submit(request, {
      autonomyMode: preferences?.autonomyMode ?? 'balanced',
      executionProfile: request.executionProfile,
      runtimeKind: 'openai_agents',
      workspace,
    });
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
