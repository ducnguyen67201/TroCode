import { setTimeout as delay } from 'node:timers/promises';

import {
  LessonCheckResultSchema,
  type LessonLocalState,
  type LessonMaterial,
  type LessonMode,
} from '../../shared/classroom-lesson-contracts';
import { ActivityContextSchema } from '../../shared/contracts';
import type { TaskApplicationService } from '../application/task-application-service';
import type { CuaService } from '../cua/cua-service';

import { canObserveClassroomExplanation } from './classroom-guidance-policy';
import type { LessonRunner } from './classroom-lesson-controller';
import { LessonBlockedError } from './classroom-lesson-errors';
import { verifyLessonSurface, type ClassroomLessonToolPolicy } from './classroom-lesson-tool-policy';
import type { KnowledgeSpaceClient } from './knowledge-space-client';

export class ClassroomLessonStepRunner implements LessonRunner {
  private readonly waiting = new Map<
    string,
    { resolve(result: { text: string; feedback: LessonLocalState['feedback'] }): void; reject(error: Error): void }
  >();
  private readonly cancellations = new Map<string, Promise<'confirmed' | 'unknown'>>();
  private materialAck: { lessonId: string; revision: number; resourceId: string; resolve(): void } | null = null;
  constructor(
    private readonly options: {
      tasks: TaskApplicationService;
      client: KnowledgeSpaceClient;
      cua: CuaService;
      policy: ClassroomLessonToolPolicy;
      openUrl(url: string): Promise<void>;
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
    if (material.resource.kind !== 'web') {
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
          reject(new Error('Open Tro to view the lesson material.'));
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
    const readiness = await this.options.cua.getStatus();
    if (!['darwin', 'win32'].includes(readiness.platform))
      throw new LessonBlockedError('unsupported', 'Browser lessons require Chrome on macOS or Windows.');
    if (!canObserveClassroomExplanation(readiness))
      throw new LessonBlockedError(
        'permission_required',
        'Allow screen recording and accessibility in Tro Settings, then resume this lesson.',
      );
    const resource = material.resource;
    const taskId = state.envelope.lessonId;
    await this.options.cua.startTaskSession(taskId, signal);
    try {
      await this.options.consume('observation');
      const existing = await this.options.cua.observeCurrentSurface(taskId, {}, signal);
      if (existing) {
        try {
          verifyLessonSurface(existing, { resourceUrl: resource.url, origin: resource.origin });
          return;
        } catch {
          /* Navigate to the reviewed material. */
        }
      }
      await this.options.authorize();
      signal.throwIfAborted();
      await this.options.consume('action');
      await this.options.openUrl(resource.url);
      for (let i = 0; i < 8; i++) {
        await delay(350, undefined, { signal });
        await this.options.authorize();
        await this.options.consume('observation');
        const observation = await this.options.cua.observeCurrentSurface(taskId, {}, signal);
        if (!observation) continue;
        try {
          verifyLessonSurface(observation, { resourceUrl: resource.url, origin: resource.origin });
          return;
        } catch {
          /* Bounded readiness wait, never repeat navigation. */
        }
      }
      throw new Error('lesson_surface_unverified');
    } finally {
      await this.options.cua.endTaskSession(taskId);
    }
  }
  async run(state: LessonLocalState, mode: LessonMode | 'help', question: string | undefined, signal: AbortSignal) {
    if (!state.child || !state.claim) throw new Error('Lesson step has not been claimed.');
    const taskId = state.child.taskId;
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
    const resource = state.material?.resource;
    if (mode === 'demonstrate') {
      if (resource?.kind !== 'web') throw new Error('Browser material is required.');
      let actions = 0;
      this.options.policy.register(
        taskId,
        {
          lessonId: state.envelope.lessonId,
          stepId: state.child.stepId,
          resourceUrl: resource.url,
          origin: resource.origin,
        },
        () => this.options.authorize(),
        async () => {
          if (++actions > 20) throw new Error('lesson_budget_exhausted');
          await this.options.consume('action');
        },
        () => this.options.consume('observation'),
      );
    }
    const completion = new Promise<{ text: string; feedback: LessonLocalState['feedback'] }>((resolve, reject) =>
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
      this.options.policy.remove(taskId);
      await this.options.cua.endTaskSession(taskId);
    }
  }
  async terminal(
    taskId: string,
    terminal: { status: string; finalOutput: string | null; message: string; outcomeUnknown?: boolean },
  ) {
    const waiter = this.waiting.get(taskId);
    if (!waiter) return;
    await this.options.cua.endTaskSession(taskId);
    if (
      terminal.status !== 'completed' ||
      terminal.outcomeUnknown ||
      (this.options.policy.has(taskId) && !this.options.policy.isComplete(taskId))
    ) {
      const reason = this.options.policy.knownBlock(taskId);
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
    const unknown = this.options.policy.uncertain(taskId);
    this.options.policy.remove(taskId);
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
      const unknown = this.options.policy.uncertain(taskId);
      this.options.policy.remove(taskId);
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
