import type { TaskSnapshot } from '../../shared/contracts';
import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';
import type { TaskRuntime } from '../agent/task-runtime';

export class TaskApplicationService {
  constructor(
    private readonly runtime: TaskRuntime,
    private readonly execution: TaskExecutionCoordinator,
  ) {}

  submitAndStart(input: unknown): TaskSnapshot {
    const submitted = this.runtime.submit(input);
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
