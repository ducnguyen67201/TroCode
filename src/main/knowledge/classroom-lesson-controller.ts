import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  LessonContinueSchema,
  LessonLocalStateSchema,
  LessonViewSchema,
  type LessonEnvelope,
  type LessonLocalState,
  type LessonMaterial,
  type LessonMode,
  type LessonReason,
  type LessonStatus,
  type LessonView,
} from '../../shared/classroom-lesson-contracts';

import { claimLessonChild } from './classroom-lesson-child';
import type { ClassroomLessonClient } from './classroom-lesson-client';
import { LessonBlockedError } from './classroom-lesson-errors';
import { assertLessonTransition, canAutoStartLesson, finishMaterialStep, lessonDigest, lessonRunningPhase, lessonReportSnapshot, rememberLessonResult } from './classroom-lesson-policy';
import type { ClassroomLessonStateStore } from './classroom-lesson-state-store';

export interface LessonRunner {
  busy(): boolean;
  reserve(parentId: string): void;
  release(parentId: string): void;
  prepare(state: LessonLocalState, material: LessonMaterial, signal: AbortSignal): Promise<void>;
  run(
    state: LessonLocalState,
    mode: LessonMode | 'help',
    question: string | undefined,
    signal: AbortSignal,
  ): Promise<{ text: string; feedback: LessonLocalState['feedback']; disposition?: 'continue' | 'step_finished' }>;
  cancel(taskId: string): Promise<'confirmed' | 'unknown'>;
}
export class ClassroomLessonController {
  private readonly events = new EventEmitter();
  private active: LessonLocalState | null = null;
  private pending: LessonEnvelope[] = [];
  private consent = false;
  private error: string | null = null;
  private feedError: string | null = null;
  feedStatus(error: string | null) {
    if (this.feedError !== error) {
      this.feedError = error;
      this.emit();
    }
  }
  private abort: AbortController | null = null;
  private work: Promise<void> | null = null;
  private generation = 0;
  private ownerId: string | null = null;
  private anchor: string | null = null;
  readonly clientInstanceId = randomUUID();
  constructor(
    private readonly options: {
      client: ClassroomLessonClient;
      store: ClassroomLessonStateStore;
      runner: LessonRunner;
      owner(): Promise<string>;
    },
  ) {}
  view(): LessonView {
    return LessonViewSchema.parse({
      active: this.active,
      pending: this.pending,
      autoRunConsent: this.consent,
      error: this.error ?? this.feedError,
    });
  }
  onChange(listener: (view: LessonView) => void) {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }
  private emit() {
    this.events.emit('change', this.view());
  }
  onChildCancelled(taskId: string) {
    if (this.active?.child?.taskId === taskId && !this.abort?.signal.aborted)
      void this.halt('stopped', 'student_stop').catch(() => {
        this.error = 'Could not save stopped lesson.';
        this.emit();
      });
  }
  setConsent(value: boolean) {
    this.consent = value;
    if (!value && this.work)
      void this.halt('paused', 'opted_out').catch(() => {
        this.error = 'Could not save paused lesson.';
        this.emit();
      });
    this.emit();
    return this.ownerId && this.anchor
      ? this.options.store.saveConsent(this.ownerId, this.anchor, value)
      : Promise.resolve();
  }
  async activate(anchor: string | null, consent: boolean): Promise<void> {
    if (this.anchor === anchor) return;
    const generation = ++this.generation;
    await this.halt('paused', 'access_changed');
    if (generation !== this.generation) return;
    this.anchor = anchor;
    this.consent = consent;
    this.active = null;
    this.pending = [];
    this.error = null;
    this.feedError = null;
    this.ownerId = null;
    if (anchor) {
      const ownerId = await this.options.owner();
      const savedConsent = await this.options.store.readConsent(ownerId, anchor);
      if (savedConsent === null) await this.options.store.saveConsent(ownerId, anchor, consent);
      const state = await this.options.store.latest(ownerId, anchor);
      if (generation !== this.generation) return;
      this.ownerId = ownerId;
      this.consent = savedConsent ?? consent;
      if (state) {
        state.desktopControlConsent = false;
        state.status =
          state.effect === 'dispatching' || state.effect === 'unknown' || state.child ? 'unknown' : 'paused';
        state.reasonCode = state.status === 'unknown' ? 'outcome_unknown' : 'restart';
        state.revision++;
        this.active = state;
        await this.options.store.saveLesson(state);
      }
    }
    this.emit();
  }
  async receive(envelope: LessonEnvelope, live: boolean): Promise<void> {
    const generation = this.generation;
    if (!this.anchor || !this.ownerId || envelope.planDigest !== lessonDigest(envelope.plan)) return;
    if (this.active?.envelope.lessonId === envelope.lessonId) return;
    const alreadyPending = this.pending.some((p) => p.lessonId === envelope.lessonId);
    const persisted = await this.options.store.readLesson(this.ownerId, envelope.lessonId);
    if (persisted || generation !== this.generation) return;
    this.pending = [...this.pending.filter((p) => p.lessonId !== envelope.lessonId), envelope]
      .sort((a, b) => b.sequence - a.sequence)
      .slice(0, 5);
    this.emit();
    const busy =
      Boolean(this.work || (this.active && !['finished', 'stopped', 'expired'].includes(this.active.status))) ||
      this.options.runner.busy();
    await this.options.client.receipt(this.anchor, envelope.lessonId, {
      reportId: randomUUID(),
      revision: 0,
      stepId: null,
      status: busy ? 'blocked' : 'received',
      reasonCode: busy ? 'device_busy' : null,
      actionCount: 0,
      modelRequestCount: 0,
    });
    if (generation !== this.generation) return;
    if (
      canAutoStartLesson({
        live: live && !alreadyPending,
        consent: this.consent,
        busy,
        active: envelope.state === 'active',
        serverTime: envelope.serverTime,
        expiresAt: envelope.expiresAt,
      })
    )
      this.launch(envelope);
  }
  async invalidate(stoppedIds: string[], sessionOpen: boolean) {
    if (this.active && (!sessionOpen || stoppedIds.includes(this.active.envelope.lessonId)))
      await this.halt('stopped', 'session_ended');
    this.pending = this.pending.filter((p) => sessionOpen && !stoppedIds.includes(p.lessonId));
    this.emit();
  }
  async continue(input: unknown): Promise<LessonView> {
    const request = LessonContinueSchema.parse(input);
    if (request.action === 'start' && this.active?.envelope.lessonId !== request.lessonId) {
      if (this.active && !['finished', 'stopped', 'expired'].includes(this.active.status))
        throw new Error('Stop the current lesson before starting another.');
      const envelope = this.pending.find((p) => p.lessonId === request.lessonId);
      if (!envelope || request.expectedRevision !== 0) throw new Error('Lesson is unavailable.');
      this.consent = true;
      this.launch(envelope);
      return this.view();
    }
    const state = this.active;
    if (!state || state.envelope.lessonId !== request.lessonId || (state.revision !== request.expectedRevision && !['pause', 'stop'].includes(request.action)))
      throw new Error('Lesson changed. Use the current controls.');
    if (request.action === 'stop' || request.action === 'pause') {
      await this.halt(request.action === 'stop' ? 'stopped' : 'paused', 'student_stop');
      return this.view();
    }
    if (['unknown', 'failed', 'stopped', 'finished', 'expired'].includes(state.status))
      throw new Error('This lesson cannot be resumed. Stop it and ask for a new lesson.');
    if (request.action === 'question' && this.work) {
      await this.halt('paused', 'student_stop');
      if (this.active?.status === 'unknown') throw new Error('Inspect the uncertain action before continuing.');
    }
    if (this.work) throw new Error('Wait for the current step or press Pause.');
    if (request.action === 'check' && !['practice', 'check'].includes(state.envelope.plan.steps[state.stepIndex]?.mode ?? ''))
      throw new Error('Check your work during practice or the check step.');
    if (request.action === 'continue_explanation' && (state.envelope.plan.schemaVersion !== 3 || state.status !== 'waiting_for_student' || state.teachingProgress?.disposition !== 'continue'))
      throw new Error('There is no explanation waiting to continue.');
    if (request.action === 'next') {
      if (state.teachingProgress?.disposition === 'continue') throw new Error('Continue the explanation before advancing the step.');
      state.teachingProgress = undefined;
      if (state.status !== 'waiting_for_student') throw new Error('Finish the current step first.');
      state.feedback = [];
      state.stepIndex++;
      if (state.stepIndex >= state.envelope.plan.steps.length) {
        await this.transition('finished');
        this.options.runner.release(state.envelope.lessonId);
        return this.view();
      }
    }
    this.consent = true;
    this.launch(
      state.envelope,
      request.action === 'question' ? 'help' : request.action === 'check' ? 'check' : undefined,
      request.text,
    );
    return this.view();
  }
  private launch(envelope: LessonEnvelope, mode?: 'help' | 'check', question?: string) {
    if (this.work) return;
    this.error = null;
    const controller = new AbortController();
    this.abort = controller;
    const generation = this.generation;
    this.work = this.execute(envelope, mode, question, controller.signal)
      .catch(async (error: unknown) => {
        if (generation !== this.generation || controller.signal.aborted) return;
        this.error = error instanceof Error ? error.message.slice(0, 500) : 'Lesson could not continue.';
        const noEffect = error instanceof LessonBlockedError;
        if (noEffect && this.active) {
          this.active.effect = 'none';
          this.active.child = null;
        }
        const unknown = !noEffect && (this.active?.effect === 'dispatching' || this.active?.effect === 'unknown');
        if (
          this.active?.envelope.lessonId === envelope.lessonId &&
          !['finished', 'stopped', 'expired'].includes(this.active.status)
        ) {
          await this.transition(
            unknown ? 'unknown' : 'blocked',
            unknown ? 'outcome_unknown' : error instanceof LessonBlockedError ? error.reason : 'runtime_failed',
          );
        } else {
          this.options.runner.release(envelope.lessonId);
        }
      })
      .catch(() => {
        this.error = 'Lesson state could not be saved. Stop and reopen Tro.';
      })
      .finally(() => {
        if (this.abort === controller) {
          this.abort = null;
          this.work = null;
          this.emit();
        }
      });
  }
  private async execute(
    envelope: LessonEnvelope,
    override: 'help' | 'check' | undefined,
    question: string | undefined,
    signal: AbortSignal,
  ) {
    if (!this.anchor || !this.ownerId) throw new Error('Join the class first.');
    this.options.runner.reserve(envelope.lessonId);
    if (this.active?.envelope.lessonId !== envelope.lessonId) {
      this.active = LessonLocalStateSchema.parse({
        schemaVersion: 1,
        ownerId: this.ownerId,
        anchorAttemptId: this.anchor,
        envelope,
        revision: 0,
        status: 'received',
        reasonCode: null,
        claim: null,
        clientStartId: randomUUID(),
        clientInstanceId: this.clientInstanceId,
        childModelLimit: 6,
        stepIndex: 0,
        stepBudgets: {},
        attempts: {},
        child: null,
        pendingChild: null,
        phase: 'Starting lesson',
        text: '',
        feedback: [],
        actionCount: 0,
        modelRequestCount: 0,
        observationCount: 0,
        effect: 'none',
        material: null,
        pendingReports: [],
      });
      this.pending = this.pending.filter((p) => p.lessonId !== envelope.lessonId);
    }
    const state = this.active;
    await this.transition('preparing');
    signal.throwIfAborted();
    if (!state.claim) {
      await this.options.client.receipt(this.anchor, envelope.lessonId, {
        reportId: randomUUID(),
        revision: 0,
        stepId: null,
        status: 'received',
        reasonCode: null,
        actionCount: 0,
        modelRequestCount: 0,
      });
      signal.throwIfAborted();
      await this.persist(); // Stable start identity is durable before the request.
      try {
        state.claim = await this.options.client.start(
          this.anchor,
          envelope.lessonId,
          state.clientStartId,
          state.clientInstanceId,
        );
      } catch (error) {
        const found = await this.options.client.lookupStart(this.anchor, envelope.lessonId);
        if (
          !found.claim ||
          found.claim.clientStartId !== state.clientStartId ||
          found.claim.clientInstanceId !== state.clientInstanceId
        )
          throw error;
        state.claim = { ...found.claim, ownedByThisRequest: true };
      }
      if (!state.claim.ownedByThisRequest) throw new Error('This lesson is already owned by another device.');
      await this.persist();
    }
    await this.authorize();
    signal.throwIfAborted();
    const step = envelope.plan.steps[state.stepIndex];
    if (!step) throw new Error('Lesson step is unavailable.');
    const mode = override ?? step.mode;
    if (mode !== 'check') state.feedback = [];
    state.phase = 'Opening material';
    state.material = await this.options.client.material(this.anchor, envelope.lessonId, step.resourceId);
    await this.persist();
    signal.throwIfAborted();
    state.effect = envelope.plan.schemaVersion === 3 ? 'none' : 'dispatching';
    await this.persist();
    if (!(envelope.plan.schemaVersion === 3 && mode === 'check')) await this.options.runner.prepare(state, state.material, signal);
    signal.throwIfAborted();
    state.effect = 'confirmed';
    state.phase = 'Material ready';
    await this.persist();
    if (mode === 'practice' || mode === 'open') {
      finishMaterialStep(state, mode);
      await this.transition('waiting_for_student');
      if (mode === 'open' && state.stepIndex + 1 === envelope.plan.steps.length) {
        await this.transition('finished');
        this.options.runner.release(envelope.lessonId);
      }
      return;
    }
    const purpose = mode === 'help' ? 'help' : mode === 'check' ? 'check' : 'work';
    await claimLessonChild(state, step, purpose, this.options.client, () => this.persist());
    state.observationCount = 0;
    state.phase = lessonRunningPhase(mode);
    const remainingModels = 8 - (state.stepBudgets[step.id]?.models ?? 0);
    const childModelLimit = envelope.plan.schemaVersion === 3 && mode !== 'check' ? Math.min(mode === 'demonstrate' ? 8 : 4, remainingModels) : mode === 'demonstrate' ? Math.min(6, remainingModels) : 1;
    if (childModelLimit < 1)
      throw new LessonBlockedError(
        'budget_exhausted',
        'This step reached its model limit. Stop this lesson and ask for a shorter example.',
      );
    state.childModelLimit = childModelLimit;
    await this.consume('model', state.childModelLimit);
    state.effect = envelope.plan.schemaVersion === 3 && mode !== 'check' ? 'none' : 'dispatching';
    await this.transition('running');
    signal.throwIfAborted();
    const result = await this.options.runner.run(state, mode, question, signal);
    signal.throwIfAborted();
    state.effect = 'confirmed';
    state.child = null;
    state.text = result.text.slice(0, 16000);
    rememberLessonResult(state, mode, question);
    state.feedback = result.feedback;
    if (result.disposition) state.teachingProgress = { disposition: result.disposition, round: (state.teachingProgress?.round ?? 0) + 1 };
    state.phase = mode === 'check' ? 'Feedback ready' : result.disposition === 'continue' ? 'Ready to continue explaining' : 'Ready for the next step';
    await this.transition('waiting_for_student');
  }
  async authorize(): Promise<void> {
    const state = this.active;
    if (!state?.claim || !this.consent || this.abort?.signal.aborted || (await this.options.owner()) !== state.ownerId)
      throw new Error('lesson_access_changed');
    const status = await this.options.client.status(state.claim.executionId);
    if (
      !status.active ||
      status.planDigest !== state.envelope.planDigest ||
      Date.parse(status.serverTime) >= Date.parse(state.envelope.expiresAt)
    )
      throw new Error('lesson_expired');
  }
  async consume(kind: 'action' | 'model' | 'observation', count = 1) {
    const state = this.active;
    if (!state) throw new Error('Lesson is unavailable.');
    const field = kind === 'action' ? 'actionCount' : kind === 'model' ? 'modelRequestCount' : 'observationCount';
    const max = kind === 'action' ? 160 : kind === 'model' ? 64 : 16;
    if (state[field] + count > max) throw new Error('lesson_budget_exhausted');
    const step = state.envelope.plan.steps[state.stepIndex];
    if (!step) throw new Error('Lesson step is unavailable.');
    const budget = state.stepBudgets[step.id] ?? { models: 0, actions: 0, observations: 0 };
    const key = kind === 'model' ? 'models' : kind === 'action' ? 'actions' : 'observations';
    const stepMax = kind === 'model' ? 8 : kind === 'action' ? 20 : 16;
    if (budget[key] + count > stepMax) throw new Error('lesson_budget_exhausted');
    budget[key] += count;
    state.stepBudgets[step.id] = budget;
    state[field] += count;
    await this.persist();
  }
  private async halt(status: 'paused' | 'stopped', reason: LessonReason) {
    this.abort?.abort();
    if (this.active) this.active.desktopControlConsent = false;
    const state = this.active;
    if (state && !['finished', 'stopped', 'expired'].includes(state.status)) {
      state.phase = status === 'stopped' ? 'Stopping lesson' : 'Pausing lesson';
      this.emit();
    }
    if (state?.child) state.effect = await this.options.runner.cancel(state.child.taskId);
    if (this.work) await this.work;
    if (state && !['finished', 'stopped', 'expired'].includes(state.status)) {
      const unknown = state.effect === 'dispatching' || state.effect === 'unknown';
      state.child = null;
      await this.transition(
        status === 'stopped' ? 'stopped' : unknown ? 'unknown' : status,
        unknown ? 'outcome_unknown' : reason,
      );
      this.options.runner.release(state.envelope.lessonId);
    }
  }
  async transition(status: LessonStatus, reason: LessonReason | null = null) {
    if (!this.active) return;
    assertLessonTransition(this.active.status, status);
    this.active.status = status;
    this.active.reasonCode = reason;
    await this.persist();
  }
  private async persist() {
    const state = this.active;
    if (!state) return;
    state.revision++;
    await this.options.store.saveLesson(state);
    this.emit();
    if (state.claim) {
      const report = lessonReportSnapshot(state, randomUUID());
      state.pendingReports = [...state.pendingReports, report].slice(-100);
      await this.options.store.saveLesson(state);
      try {
        await this.options.client.report(state.claim.executionId, report);
        state.pendingReports = state.pendingReports.filter((r) => r.revision > report.revision);
        await this.options.store.saveLesson(state);
      } catch {
        /* Retain report; feed tick retries without replaying effects. */
      }
    }
  }
  async markEffect(effect: LessonLocalState['effect']) {
    if (!this.active) throw new Error('Lesson unavailable.');
    this.active.effect = effect;
    await this.persist();
  }
  async desktopState(lessonId: string, revision: number): Promise<LessonLocalState> {
    const state = this.active;
    if (!state || state.envelope.lessonId !== lessonId || state.revision !== revision || state.envelope.plan.schemaVersion !== 3 || this.work || ['unknown', 'failed', 'finished', 'stopped', 'expired'].includes(state.status))
      throw new Error('Pause the lesson and use its current controls.');
    await this.authorize();
    if (this.active !== state || state.revision !== revision || this.work) throw new Error('Lesson changed.');
    return state;
  }
  async setDesktopConsent(lessonId: string, revision: number, enabled: boolean) {
    if (!enabled && this.active?.envelope.lessonId === lessonId && this.work) await this.halt('paused', 'opted_out');
    const state = await this.desktopState(lessonId, !enabled ? this.active?.revision ?? revision : revision);
    state.desktopControlConsent = enabled;
    await this.persist();
    return this.view();
  }
  async materialPage(lessonId: string, resourceId: string, ordinal: number) {
    const state = this.active;
    if (!state || state.envelope.lessonId !== lessonId || state.material?.resource.id !== resourceId)
      throw new Error('Material changed.');
    await this.authorize();
    return this.options.client.material(state.anchorAttemptId, lessonId, resourceId, ordinal);
  }
  async flushReports() {
    const state = this.active;
    if (!state?.claim) return;
    for (const report of [...state.pendingReports]) {
      await this.options.client.report(state.claim.executionId, report);
      state.pendingReports = state.pendingReports.filter((r) => r.reportId !== report.reportId);
    }
    await this.options.store.saveLesson(state);
  }
  async shutdown() {
    await this.halt('paused', 'access_changed');
    await this.options.store.close();
  }
}
