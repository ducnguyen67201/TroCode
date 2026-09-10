import {
  LessonCheckResultSchema,
  type LessonLocalState,
  type LessonMaterial,
  type LessonMode,
} from '../../shared/classroom-lesson-contracts';
import { ActivityContextSchema } from '../../shared/contracts';
import { lessonExecutionRoute, lessonUsesExternalMaterial } from '../../shared/lesson-execution-policy';
import type { TaskApplicationService } from '../application/task-application-service';
import type { CuaService } from '../cua/cua-service';

import type { ClassroomDesktopTeachingTools } from './classroom-desktop-teaching-tools';
import { canObserveClassroomExplanation } from './classroom-guidance-policy';
import type { LessonRunner } from './classroom-lesson-controller';
import { LessonBlockedError } from './classroom-lesson-errors';
import type { ClassroomLessonMaterialService } from './classroom-lesson-material-service';
import type { ClassroomLessonToolPolicy } from './classroom-lesson-tool-policy';
import type { KnowledgeSpaceClient } from './knowledge-space-client';

export class ClassroomLessonStepRunner implements LessonRunner {
  private readonly waiting = new Map<
    string,
    { resolve(result: { text: string; feedback: LessonLocalState['feedback']; disposition?: 'continue' | 'step_finished'; modelRequestCount?: number }): void; reject(error: Error): void }
  >();
  private readonly desktopTasks = new Set<string>();
  private readonly cancellations = new Map<string, Promise<'confirmed' | 'unknown'>>();
  private materialAck: { lessonId: string; revision: number; resourceId: string; resolve(): void } | null = null;
  constructor(
    private readonly options: {
      tasks: TaskApplicationService;
      desktop?: { materials: ClassroomLessonMaterialService; teaching: ClassroomDesktopTeachingTools };
      client: KnowledgeSpaceClient;
      cua: CuaService;
      policy: ClassroomLessonToolPolicy;
      showMaterial(): void;
      authorize(): Promise<void>;
      consume(kind: 'action' | 'model' | 'observation', count?: number): Promise<void>;
    },
  ) {}
  has(taskId: string) {
    return this.waiting.has(taskId);
  }
  busy() {
    return this.options.tasks.isDeviceBusy();
  }
  reserve(id: string) {
    this.options.tasks.reserveLesson(id);
  }
  release(id: string) {
    this.options.tasks.releaseReservation(id);
  }
  acknowledge(lessonId: string, revision: number, resourceId: string) {
    const ack = this.materialAck;
    if (!ack || ack.lessonId !== lessonId || ack.revision !== revision || ack.resourceId !== resourceId)
      throw new Error('Material changed.');
    ack.resolve();
    this.materialAck = null;
  }
  async prepare(state: LessonLocalState, material: LessonMaterial, signal: AbortSignal) {
    await this.options.authorize();
    signal.throwIfAborted();
    if (lessonUsesExternalMaterial(state.envelope.plan, state.stepIndex)) {
      if (!this.options.desktop) throw new LessonBlockedError('unsupported', 'Update Tro to use desktop lessons.');
      const readiness = await this.options.cua.getStatus();
      if (!canObserveClassroomExplanation(readiness)) throw new LessonBlockedError('permission_required', 'Enable screen recording and accessibility in Tro Settings.');
      await this.options.desktop.materials.prepare(state, signal);
      return;
    }
    if (material.resource.kind !== 'web') {
      if (![material.text, ...material.chunks.map((chunk) => chunk.body)].some((text) => text?.trim()))
        throw new LessonBlockedError('resource_unavailable', 'This material has no readable content. Ask the teacher to select an available class material.');
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          cleanup();
          reject(new Error('Material opening cancelled.'));
        };
        const cleanup = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          this.materialAck = null;
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new LessonBlockedError('resource_unavailable', 'The lesson material is not visible yet. Open Tro, then resume this lesson.'));
        }, 20_000);
        this.materialAck = {
          lessonId: state.envelope.lessonId,
          revision: state.revision,
          resourceId: material.resource.id,
          resolve: () => {
            cleanup();
            resolve();
          },
        };
        signal.addEventListener('abort', onAbort, { once: true });
        this.options.showMaterial();
      });
      return;
    }
    throw new LessonBlockedError('unsupported', 'This material cannot be prepared.');
  }
  async run(state: LessonLocalState, mode: LessonMode | 'help', question: string | undefined, signal: AbortSignal) {
    if (!state.child || !state.claim) throw new Error('Lesson step has not been claimed.');
    const taskId = state.child.taskId;
    if (this.waiting.has(taskId)) throw new Error('This lesson task already has a running turn.');
    this.cancellations.delete(taskId);
    const attempt = await this.options.client.getAttempt(state.claim.targetAttemptId);
    if (
      attempt.activityVersionId !== state.envelope.plan.activityVersionId ||
      attempt.definition.launchTarget === 'workspace'
    )
      throw new Error('Assignment version changed.');
    const activity = ActivityContextSchema.parse({
      attemptId: attempt.attemptId,
      workSessionId: state.child.workSessionId,
      activityVersionId: attempt.activityVersionId,
      runId: attempt.run.id,
      space: attempt.space,
      activity: attempt.definition,
      purpose: state.child.purpose,
      currentDirective: null,
      insightPolicy: attempt.run.insightPolicy,
      insightPolicyVersion: attempt.run.insightPolicyVersion,
      policyAcknowledged: attempt.acknowledgedPolicyVersion === attempt.run.insightPolicyVersion,
      sourceCatalog: attempt.sourceCatalog,
      priorProgress: attempt.priorProgress,
    });
    const execution = lessonExecutionRoute(state.envelope.plan, mode, state.stepIndex);
    const desktop = execution === 'shared_agent';
    if (desktop) {
      if (!this.options.desktop) throw new Error('Desktop teaching unavailable.');
      if (mode === 'demonstrate' && attempt.definition.guidancePolicy.answerReveal !== 'allowed')
        throw new LessonBlockedError('unsupported', 'This activity does not allow demonstrated answers.');
      await this.options.cua.startTaskSession(taskId, signal);
      this.options.desktop.teaching.register(taskId, state, mode, activity.activity.guidancePolicy);
      this.options.policy.registerDesktop(taskId, this.options.desktop.teaching.guard(taskId));
      this.desktopTasks.add(taskId);
    }
    const completion = new Promise<{ text: string; feedback: LessonLocalState['feedback']; disposition?: 'continue' | 'step_finished'; modelRequestCount?: number }>((resolve, reject) =>
      this.waiting.set(taskId, { resolve, reject }),
    );
    void completion.catch(() => undefined);
    const onAbort = () => {
      void this.cancel(taskId);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      signal.throwIfAborted();
      await this.options.authorize();
      await this.options.tasks.submitLesson(state, activity, mode, question);
      return await completion;
    } finally {
      signal.removeEventListener('abort', onAbort);
      this.waiting.delete(taskId);
      this.desktopTasks.delete(taskId);
      this.options.policy.remove(taskId);
      this.options.desktop?.teaching.remove(taskId);
      await this.options.cua.endTaskSession(taskId);
    }
  }
  async terminal(
    taskId: string,
    terminal: { status: string; finalOutput: string | null; message: string; outcomeUnknown?: boolean; modelRequestCount?: number },
  ) {
    const waiter = this.waiting.get(taskId);
    if (!waiter) return;
    await this.options.cua.endTaskSession(taskId);
    if (
      terminal.status !== 'completed' ||
      terminal.outcomeUnknown ||
      (this.desktopTasks.has(taskId) && !this.options.desktop?.teaching.result(taskId)) ||
      (this.options.policy.has(taskId) && !this.options.policy.isComplete(taskId))
    ) {
      const reason = this.options.policy.knownBlock(taskId) ?? (this.desktopTasks.has(taskId) ? this.options.desktop?.teaching.knownBlock(taskId) : null);
      waiter.reject(
        reason
          ? new LessonBlockedError(
              reason,
              terminal.message || 'No student input was dispatched; review the lesson before resuming.',
            )
          : new Error(terminal.message || 'Lesson outcome could not be verified.'),
      );
      return;
    }
    const taught = this.options.desktop?.teaching.result(taskId);
    if (taught) { waiter.resolve({ text: taught.recap, feedback: [], disposition: taught.disposition, modelRequestCount: terminal.modelRequestCount }); return; }
    const output = terminal.finalOutput ?? terminal.message;
    let feedback: LessonLocalState['feedback'] = [];
    try {
      feedback = LessonCheckResultSchema.parse(JSON.parse(output));
    } catch {
      /* Narrative explanation. */
    }
    waiter.resolve({ text: feedback.length ? feedback.map((f) => f.explanation).join('\n') : output, feedback });
  }
  onTaskCancelled(taskId: string): void {
    if (!this.waiting.has(taskId) || this.cancellations.has(taskId)) return;
    const unknown = this.options.policy.uncertain(taskId) || Boolean(this.options.desktop?.teaching.uncertain(taskId));
    this.options.policy.remove(taskId);
    this.options.desktop?.teaching.remove(taskId);
    const work = this.options.cua
      .endTaskSession(taskId)
      .then(() => (unknown ? ('unknown' as const) : ('confirmed' as const)))
      .catch(() => 'unknown' as const)
      .finally(() => this.waiting.get(taskId)?.reject(new Error('Lesson stopped.')));
    this.cancellations.set(taskId, work);
  }
  cancel(taskId: string): Promise<'confirmed' | 'unknown'> {
    const existing = this.cancellations.get(taskId);
    if (existing) return existing;
    const work = (async (): Promise<'confirmed' | 'unknown'> => {
      if (!this.waiting.has(taskId)) return 'confirmed';
      const unknown = this.options.policy.uncertain(taskId) || Boolean(this.options.desktop?.teaching.uncertain(taskId));
      this.options.policy.remove(taskId);
      this.options.desktop?.teaching.remove(taskId);
      try {
        await this.options.tasks.cancel({ taskId, source: 'stop_button' });
      } finally {
        try {
          await this.options.cua.endTaskSession(taskId);
        } finally {
          this.waiting.get(taskId)?.reject(new Error('Lesson stopped.'));
        }
      }
      return unknown ? 'unknown' : 'confirmed';
    })().catch(() => 'unknown' as const);
    this.cancellations.set(taskId, work);
    return work;
  }
}
