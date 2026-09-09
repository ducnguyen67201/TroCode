import type { LessonReason } from '../../shared/classroom-lesson-contracts';
import { validateClassroomUrl } from '../../shared/classroom-url-policy';
import type { ResolvedToolInvocation, ToolExecutionResult } from '../agent/agent-contracts';
import type { DesktopObservation, SurfaceCommand } from '../agent/execution-contracts';
import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';

export interface BrowserLessonScope {
  kind?: 'browser';
  lessonId: string;
  stepId: string;
  resourceUrl: string;
  origin: string;
}
export type LessonExecutionScope = BrowserLessonScope | { kind: 'desktop'; lessonId: string; stepId: string };
const desktopAllowed = new Set(['classroom.teaching-observe', 'classroom.teaching-navigate', 'classroom.teaching-present', 'classroom.teaching-demonstrate', 'classroom.teaching-finish']);
const allowed = new Set(['computer.observe', 'computer.control', 'browser.prepare', 'classroom.lesson-step']);
export function lessonToolAllowed(id: string, scope?: LessonExecutionScope): boolean {
  return !scope || (scope.kind === 'desktop' ? desktopAllowed : allowed).has(id);
}
export function verifyLessonSurface(
  observation: DesktopObservation,
  scope: Pick<BrowserLessonScope, 'resourceUrl' | 'origin'>,
): void {
  const surface = observation.surface;
  const url = surface?.url ? validateClassroomUrl(surface.url, scope.origin) : null;
  const target = new URL(scope.resourceUrl);
  if (
    !surface ||
    surface.kind !== 'browser' ||
    !/chrome/iu.test(surface.application) ||
    !url ||
    url.pathname !== target.pathname ||
    url.search !== target.search ||
    url.hash !== target.hash ||
    observation.degraded
  ) {
    throw new Error('lesson_surface_unverified');
  }
}
interface ActivePolicy {
  scope: BrowserLessonScope;
  before(): Promise<void>;
  consume(): Promise<void>;
  observe(): Promise<void>;
  observation: DesktopObservation | null;
  dirty: boolean;
  completed: boolean;
  uncertain: boolean;
  ownedValues: Set<string>;
  inputs: number;
  failure: LessonReason | null;
}
/** Main-only guard. Page/model text cannot grant a tool or change a lesson's mode. */
export class ClassroomLessonToolPolicy {
  private readonly dispatches = new Map<string, Promise<unknown>>();
  async dispatch(
    taskId: string,
    invocation: ResolvedToolInvocation,
    execute: () => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> {
    if (!this.tasks.has(taskId) && !this.revoked.has(taskId)) return execute();
    const work = (this.dispatches.get(taskId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        await this.before(taskId, invocation, true);
        const result = await execute();
        this.observeResult(taskId, result);
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
  private readonly tasks = new Map<string, ActivePolicy>();
  register(
    taskId: string,
    scope: BrowserLessonScope,
    before: () => Promise<void>,
    consume: () => Promise<void>,
    observe: () => Promise<void> = async () => undefined,
  ): void {
    if (this.tasks.has(taskId) || this.revoked.has(taskId)) throw new Error('Lesson task already registered.');
    this.tasks.set(taskId, {
      scope,
      before,
      consume,
      observe,
      observation: null,
      dirty: false,
      completed: false,
      uncertain: false,
      ownedValues: new Set(),
      inputs: 0,
      failure: null,
    });
  }
  has(taskId: string): boolean {
    return this.tasks.has(taskId);
  }
  async before(taskId: string, invocation: ResolvedToolInvocation, dispatch = false): Promise<void> {
    try {
      await this.checkBefore(taskId, invocation, dispatch);
    } catch (error) {
      const policy = this.tasks.get(taskId);
      const message = error instanceof Error ? error.message : '';
      if (policy)
        policy.failure = message.includes('existing_work')
          ? 'existing_work'
          : message.includes('surface_unverified')
            ? 'surface_unverified'
            : message.includes('budget_exhausted')
              ? 'budget_exhausted'
              : 'runtime_failed';
      throw error;
    }
  }
  knownBlock(taskId: string): LessonReason | null {
    const policy = this.tasks.get(taskId);
    return policy && policy.inputs === 0 && !policy.uncertain ? (policy.failure ?? 'runtime_failed') : null;
  }
  private async checkBefore(taskId: string, invocation: ResolvedToolInvocation, dispatch = false): Promise<void> {
    if (this.revoked.has(taskId)) throw new Error('lesson_access_changed');
    const policy = this.tasks.get(taskId);
    if (!policy) return;
    await policy.before();
    if (this.tasks.get(taskId) !== policy || this.revoked.has(taskId)) throw new Error('lesson_access_changed');
    if (policy.completed || !lessonToolAllowed(invocation.toolId, policy.scope)) throw new Error('lesson_tool_denied');
    if (invocation.toolId === 'computer.observe') {
      if (dispatch) await policy.observe();
      return;
    }
    if (policy.uncertain) throw new Error('lesson_outcome_unknown');
    const observation = policy.observation;
    if (!observation || Date.now() - Date.parse(observation.capturedAt) > 10_000)
      throw new Error('lesson_surface_unverified');
    verifyLessonSurface(observation, policy.scope);
    if (policy.dirty) throw new Error('Observe the result before the next action.');
    if (invocation.toolId === 'computer.control') {
      const input = invocation.input as { observationId: string; command: SurfaceCommand };
      if (input.observationId !== observation.observationId) throw new Error('lesson_surface_unverified');
      const cmd = input.command;
      const element = cmd.ref ? observation.elements?.find((e) => e.ref === cmd.ref) : undefined;
      if (!element || element.disabled) throw new Error('lesson_surface_unverified');
      if (cmd.kind === 'type_text') {
        if (
          !['textbox', 'textarea', 'input', 'editor', 'text area'].includes(element.role.toLowerCase()) ||
          cmd.text.length > 8000
        )
          throw new Error('lesson_tool_denied');
        if (element.value?.trim() && !policy.ownedValues.has(element.value)) throw new Error('lesson_existing_work');
        if (dispatch) policy.ownedValues.add(cmd.replace ? cmd.text : (element.value ?? '') + cmd.text);
      } else if (cmd.kind === 'click_element') {
        // V1 supports editor focus and local Run controls. Generic links/submission controls cannot be verified from origin alone.
        if (
          !['textbox', 'textarea', 'input', 'editor', 'text area'].includes(element.role.toLowerCase()) &&
          !(
            element.role.toLowerCase() === 'button' &&
            /^(run(?: code| program)?|execute|chạy(?: mã| chương trình)?)$/iu.test(element.name.trim())
          )
        )
          throw new Error('lesson_tool_denied');
      } else if (cmd.kind === 'press_key') {
        if (
          cmd.modifiers.length ||
          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(cmd.key)
        )
          throw new Error('lesson_tool_denied');
      }
      if (dispatch) {
        await policy.consume();
        if (this.tasks.get(taskId) !== policy || this.revoked.has(taskId)) throw new Error('lesson_access_changed');
        policy.inputs++;
        policy.dirty = true;
      }
    }
  }
  observeResult(taskId: string, result: ToolExecutionResult): void {
    const policy = this.tasks.get(taskId);
    if (!policy) return;
    if (result.status === 'unknown') policy.uncertain = true;
    if (result.observation) {
      policy.observation = result.observation;
      policy.dirty = false;
    }
  }
  complete(taskId: string, observationId: string, fingerprint: string): void {
    const policy = this.tasks.get(taskId);
    if (
      !policy ||
      policy.uncertain ||
      policy.dirty ||
      policy.observation?.observationId !== observationId ||
      policy.observation.fingerprint !== fingerprint
    )
      throw new Error('Observe the demonstrated result before completing.');
    verifyLessonSurface(policy.observation, policy.scope);
    policy.completed = true;
  }
  uncertain(taskId: string): boolean {
    const p = this.tasks.get(taskId);
    return Boolean(p && (p.dirty || p.uncertain));
  }
  isComplete(taskId: string): boolean {
    return this.tasks.get(taskId)?.completed ?? false;
  }
  remove(taskId: string): void {
    if (this.tasks.delete(taskId)) this.revoked.add(taskId);
  }
}

export function lessonExecutionCoordinator(coordinator: Pick<TaskExecutionCoordinator, 'endTask' | 'dispatchTool'>, policy: ClassroomLessonToolPolicy) {
  return {
    endTask: (taskId: string) => coordinator.endTask(taskId),
    dispatchTool: (invocation: Parameters<TaskExecutionCoordinator['dispatchTool']>[0], context: Parameters<TaskExecutionCoordinator['dispatchTool']>[1]) => policy.dispatch(context.taskId, invocation, async () => { context.signal.throwIfAborted(); return coordinator.dispatchTool(invocation, context); }),
  };
}
