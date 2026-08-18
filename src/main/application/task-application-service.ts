import type { TaskSnapshot } from '../../shared/contracts';
import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';
import type { TaskRuntime } from '../agent/task-runtime';
import type { AppPreferencesService } from '../preferences/app-preferences-service';

export class TaskApplicationService {
  constructor(
    private readonly runtime: TaskRuntime,
    private readonly execution: TaskExecutionCoordinator,
    private readonly preferences: Pick<AppPreferencesService, 'get'>,
  ) {}

  async submitAndStart(input: unknown): Promise<TaskSnapshot> {
    const preferences = await this.preferences.get();
    const submitted = this.runtime.submit(input, preferences.approvalMode);
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

  steer(input: unknown): TaskSnapshot {
    const snapshot = this.runtime.steer(input);
    this.execution.resume(snapshot.taskId);
    return snapshot;
  }
}
