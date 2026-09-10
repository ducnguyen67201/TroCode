import type { LessonReason } from '../../shared/classroom-lesson-contracts';
import type { ResolvedToolInvocation, ToolExecutionResult } from '../agent/agent-contracts';
import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';

export type LessonExecutionScope = { kind: 'desktop'; lessonId: string; stepId: string };
export interface DesktopLessonExecutionGuard {
  before(invocation: ResolvedToolInvocation, dispatch: boolean): Promise<void>;
  observeResult(result: ToolExecutionResult): void | Promise<void>;
  uncertain(): boolean;
  complete(): boolean;
  failure(): LessonReason | null;
}
/** Main-only lifecycle guard; shared tool registration owns capability availability. */
export class ClassroomLessonToolPolicy {
  private readonly desktop = new Map<string, DesktopLessonExecutionGuard>();
  registerDesktop(taskId: string, guard: DesktopLessonExecutionGuard): void {
    if (this.has(taskId) || this.dispatches.has(taskId)) throw new Error('Lesson task already registered.');
    this.revoked.delete(taskId);
    this.desktop.set(taskId, guard);
  }
  private readonly dispatches = new Map<string, Promise<unknown>>();
  async dispatch(
    taskId: string,
    invocation: ResolvedToolInvocation,
    execute: () => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> {
    if (!this.has(taskId) && !this.revoked.has(taskId)) return execute();
    const work = (this.dispatches.get(taskId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        await this.before(taskId, invocation, true);
        const result = await execute();
        await this.observeResult(taskId, result);
        return result;
      });
    this.dispatches.set(taskId, work);
    try {
      return await work;
    } finally {
      if (this.dispatches.get(taskId) === work) this.dispatches.delete(taskId);
    }
  }
  private readonly revoked = new Set<string>();
  has(taskId: string): boolean { return this.desktop.has(taskId); }
  async before(taskId: string, invocation: ResolvedToolInvocation, dispatch = false): Promise<void> {
    if (this.revoked.has(taskId)) throw new Error('lesson_access_changed');
    const guard = this.desktop.get(taskId);
    if (!guard) return;
    await guard.before(invocation, dispatch);
    if (this.desktop.get(taskId) !== guard || this.revoked.has(taskId)) throw new Error('lesson_access_changed');
  }
  async observeResult(taskId: string, result: ToolExecutionResult): Promise<void> {
    await this.desktop.get(taskId)?.observeResult(result);
  }
  knownBlock(taskId: string): LessonReason | null { return this.desktop.get(taskId)?.failure() ?? null; }
  uncertain(taskId: string): boolean { return this.desktop.get(taskId)?.uncertain() ?? false; }
  isComplete(taskId: string): boolean { return this.desktop.get(taskId)?.complete() ?? false; }
  remove(taskId: string): void { if (this.desktop.delete(taskId)) this.revoked.add(taskId); }
}

export function lessonExecutionCoordinator(coordinator: Pick<TaskExecutionCoordinator, 'endTask' | 'dispatchTool'>, policy: ClassroomLessonToolPolicy) {
  return {
    endTask: (taskId: string) => coordinator.endTask(taskId),
    dispatchTool: (invocation: Parameters<TaskExecutionCoordinator['dispatchTool']>[0], context: Parameters<TaskExecutionCoordinator['dispatchTool']>[1]) => policy.dispatch(context.taskId, invocation, async () => { context.signal.throwIfAborted(); return coordinator.dispatchTool(invocation, context); }),
  };
}
