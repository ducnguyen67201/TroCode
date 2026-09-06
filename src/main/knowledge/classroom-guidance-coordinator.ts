import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  GuidanceConsentRequestSchema,
  GuidanceContinueSchema,
  GuidanceStartLocalSchema,
  GuidanceStateSchema,
  type GuidanceContinue,
  type GuidanceState,
  type LocalGuidanceStartJournal,
  type GuidanceReport,
} from '../../shared/contracts';
import type { EncryptedAgentStateStore } from '../agent-runtime/encrypted-agent-state-store';
import type { TaskApplicationService } from '../application/task-application-service';

import type { ActivityContextService } from './activity-context-service';
import type { ClassroomBroadcastService } from './classroom-broadcast-service';
import {
  canAutomaticallyExplain,
  classroomExplanationQueue,
  defaultClassroomGuidanceConsent,
} from './classroom-guidance-policy';
import type { KnowledgeSpaceClient } from './knowledge-space-client';

export class ClassroomGuidanceCoordinator {
  private readonly events = new EventEmitter();
  private readonly instanceId = randomUUID();
  private generation = 0;
  private consentEnabledAt = 0;
  private consentSequence = 0;
  private journal: LocalGuidanceStartJournal | null = null;
  private pendingContinuation: {
    taskId: string;
    revision: number;
    resolve: (value: GuidanceContinue) => void;
    reject: (error: Error) => void;
  } | null = null;
  private readonly unsubscribers: Array<() => void> = [];
  private state: GuidanceState = {
    revision: 0,
    sessionId: null,
    consent: null,
    pending: [],
    active: null,
    message: null,
  };
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private reportQueue: Promise<void> = Promise.resolve();
  private readonly queuedStatuses = new Map<string, GuidanceReport['status']>();
  constructor(
    private readonly options: {
      broadcasts: ClassroomBroadcastService;
      client: KnowledgeSpaceClient;
      tasks: TaskApplicationService;
      activity: ActivityContextService;
      store: EncryptedAgentStateStore;
      owner: () => Promise<string>;
      screenPermitted: () => Promise<boolean>;
      language: () => Promise<'en' | 'vi'>;
      onExplanationText?: (taskId: string, text: string) => void;
      now?: () => number;
    },
  ) {}
  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
  start(): void {
    if (this.unsubscribers.length) return;
    this.unsubscribers.push(
      this.options.broadcasts.onChange((notice) => {
        if ((notice?.sessionId ?? null) !== this.state.sessionId) {
          void this.invalidate();
          this.state.sessionId = notice?.sessionId ?? null;
          this.state.consent = defaultClassroomGuidanceConsent(notice);
          this.consentEnabledAt = this.now();
          this.consentSequence = notice?.broadcast?.sequence ?? 0;
          this.publish();
        }
        if (notice?.offline) {
          this.consentSequence =
            notice.broadcast?.sequence ?? this.consentSequence;
          this.consentEnabledAt = this.now();
        }
      }),
      this.options.broadcasts.onBroadcast((broadcast, provenance) => {
        const { pending, releaseIds } = classroomExplanationQueue(
          this.state.pending,
          broadcast,
          this.state.active?.broadcastId ?? null,
        );
        this.state.pending = pending;
        releaseIds.forEach((id) => this.options.broadcasts.release(id));
        pending.forEach((b) => this.options.broadcasts.retain(b.id));
        this.publish();
        if (
          canAutomaticallyExplain({
            broadcast,
            provenance,
            consentSessionId: this.state.consent?.enabled
              ? this.state.consent.sessionId
              : null,
            consentEnabledAt: this.consentEnabledAt,
            consentSequence: this.consentSequence,
            busy: this.options.tasks.isDeviceBusy(),
            now: this.now(),
          })
        ) {
          void this.startExplanation(
            {
              broadcastId: broadcast.id,
              contextMode: this.state.consent!.contextMode,
            },
            true,
          ).catch(() => undefined);
        }
      }),
    );
  }
  async restore(): Promise<void> {
    const owner = await this.options.owner();
    for (const journal of await this.options.store.listGuidanceJournals(
      owner,
    )) {
      if ((await this.options.owner()) !== owner) return;
      // Reconcile status facts only. Never restart a model request or observation.
      if (['running', 'dispatching'].includes(journal.phase)) {
        journal.phase = 'unknown';
        if (journal.claim)
          journal.report = {
            status: 'interrupted',
            reason: 'restart',
            revision:
              Math.max(journal.claim.revision, journal.report?.revision ?? 0) +
              1,
          };
        await this.options.store.writeGuidanceJournal(journal);
      }
      if (journal.claim && journal.report) {
        try {
          journal.claim = await this.options.client.reportClassroomGuidance(
            journal.claim.workSessionId,
            journal.report,
          );
          journal.report = null;
          await this.options.store.writeGuidanceJournal(journal);
        } catch {
          /* Keep uncertain status for another explicit restore. */
        }
      }
    }
  }
  get(): GuidanceState {
    return GuidanceStateSchema.parse(this.state);
  }
  onChange(listener: (state: GuidanceState) => void): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }
  setConsent(raw: unknown): GuidanceState {
    const input = GuidanceConsentRequestSchema.parse(raw);
    if (input.sessionId !== this.options.broadcasts.get()?.sessionId)
      throw new Error('This classroom session is unavailable.');
    this.state.consent = input;
    this.consentEnabledAt = this.now();
    this.consentSequence =
      this.options.broadcasts.get()?.broadcast?.sequence ?? 0;
    return this.publish();
  }
  async startExplanation(
    raw: unknown,
    automatic = false,
  ): Promise<GuidanceState> {
    const input = GuidanceStartLocalSchema.parse(raw);
    const trusted = this.options.broadcasts.trusted(input.broadcastId);
    if (
      !trusted ||
      trusted.broadcast.payload.kind !== 'assignment' ||
      trusted.broadcast.payload.studentAction !== 'explain'
    )
      throw new Error('Explanation notice is unavailable.');
    if (this.options.broadcasts.get()?.offline)
      throw new Error('Reconnect before starting the explanation.');
    if (this.now() >= Date.parse(trusted.broadcast.createdAt) + 600_000)
      throw new Error(
        'This explanation expired. Open the assignment to ask a new question.',
      );
    const generation = this.generation;
    const owner = await this.options.owner();
    let journal = await this.options.store.readGuidanceJournal(
      owner,
      input.broadcastId,
    );
    if (journal && journal.phase !== 'claimed') {
      if (['claiming', 'unknown'].includes(journal.phase))
        await this.options.client.lookupClassroomGuidance(
          trusted.anchor,
          input.broadcastId,
        );
      if (
        generation !== this.generation ||
        (await this.options.owner()) !== owner
      )
        throw new Error('The classroom session changed.');
      this.state.message =
        'This explanation has already started or its outcome is unknown. Open the assignment to ask a new question.';
      if (
        journal.claim && journal.lastText &&
        (!this.state.active || ['finished', 'cancelled', 'failed', 'unknown'].includes(this.state.active.phase))
      )
        this.state.active = {
          guidanceId: journal.claim.id,
          taskId: journal.request.taskId,
          broadcastId: journal.broadcastId,
          stepRevision: 0,
          phase: 'unknown',
          text: journal.lastText,
          contextMode: journal.request.contextMode,
        };
      return this.publish();
    }
    const taskId = journal?.request.taskId ?? randomUUID();
    let reserved = false;
    try {
      this.options.tasks.reserveClassroomExplanation(taskId);
      reserved = true;
      const capability = await this.options.client.capabilities();
      if (!capability.classroomGuidance)
        throw new Error('Student explanations are unavailable on this server.');
      const contextMode =
        input.contextMode === 'screen_if_permitted' &&
        (await this.options.screenPermitted())
          ? 'screen_if_permitted'
          : 'text_only';
      if (
        generation !== this.generation ||
        (await this.options.owner()) !== owner
      )
        throw new Error('The classroom session changed.');
      const target = await this.options.broadcasts.openAssignment(
        input.broadcastId,
      );
      const attempt = await this.options.activity.inspect(target.attemptId);
      if (['submitted', 'completed', 'withdrawn'].includes(attempt.state))
        throw new Error(
          'Open this assignment to ask an ordinary read-only question.',
        );
      if (
        attempt.run.insightPolicy === 'evidence_candidates' &&
        attempt.acknowledgedPolicyVersion !== attempt.run.insightPolicyVersion
      )
        throw new Error(
          'Open the assignment and acknowledge its class insight policy first.',
        );
      if (!journal) {
        journal = {
          ownerId: owner,
          anchorAttemptId: trusted.anchor,
          broadcastId: input.broadcastId,
          request: {
            clientStartId: randomUUID(),
            taskId,
            clientInstanceId: this.instanceId,
            contextMode,
          },
          claim: null,
          phase: 'claiming',
          modelRequests: 0,
          observations: 0,
          startedAt: new Date(this.now()).toISOString(),
          report: null,
        };
        await this.options.store.writeGuidanceJournal(journal);
        this.journal = journal;
        journal.claim = await this.options.client.claimClassroomGuidance(
          trusted.anchor,
          input.broadcastId,
          journal.request,
        );
        if (!journal.claim.ownedByThisRequest) {
          journal.phase = 'terminal';
          await this.options.store.writeGuidanceJournal(journal);
          throw new Error('This explanation was claimed on another device.');
        }
        journal.phase = 'claimed';
        await this.options.store.writeGuidanceJournal(journal);
      }
      if (!journal.claim || journal.modelRequests || journal.observations)
        throw new Error('The prior explanation cannot be replayed.');
      if (
        generation !== this.generation ||
        (await this.options.owner()) !== owner
      )
        throw new Error('The classroom session changed.');
      this.journal = journal;
      this.options.broadcasts.retain(input.broadcastId);
      this.state.active = {
        guidanceId: journal.claim.id,
        taskId,
        broadcastId: input.broadcastId,
        stepRevision: 0,
        phase: 'starting',
        text: 'Starting your assignment explanation.',
        contextMode: journal.request.contextMode,
      };
      this.state.message =
        contextMode !== input.contextMode
          ? 'Starting without screen context because screen access is not already permitted.'
          : null;
      this.publish();
      await this.beforeRound(taskId, new AbortController().signal);
      if (generation !== this.generation)
        throw new Error('The classroom session changed.');
      const activity = this.options.activity.createForClassroomGuidance(
        attempt,
        journal.claim,
      );
      journal.phase = 'dispatching';
      await this.options.store.writeGuidanceJournal(journal);
      // Persist before runtime dispatch. A crash from this point never permits an automatic replay.
      await this.options.tasks.submitClassroomExplanation(activity, journal, {
        guidanceId: journal.claim.id,
        broadcastId: input.broadcastId,
        teacherInstruction: trusted.broadcast.payload.instruction,
        language: await this.options.language(),
        contextMode: journal.request.contextMode,
        expiresAt: new Date(
          Date.parse(trusted.broadcast.createdAt) + 600_000,
        ).toISOString(),
        startedAt: journal.startedAt,
        modelRequests: journal.modelRequests,
        observations: journal.observations,
      });
      if (generation !== this.generation) {
        await this.options.tasks.cancel({ taskId, source: 'stop_button' });
        throw new Error('The classroom session changed.');
      }
      // A very fast failure/finish may already have terminalized this journal.
      if (journal.phase !== 'dispatching') return this.get();
      journal.phase = 'running';
      await this.options.store.writeGuidanceJournal(journal);
      // Completion or invalidation can arrive during the encrypted write too.
      if (
        journal.phase !== 'running' ||
        generation !== this.generation ||
        this.state.active?.taskId !== taskId
      )
        return this.get();
      this.state.pending = this.state.pending.filter(
        (b) => b.id !== input.broadcastId,
      );
      this.deadline = setTimeout(
        () => {
          if (this.state.active?.taskId === taskId)
            void this.stop(this.state.active.guidanceId, 'expired');
        },
        Math.max(
          1,
          Date.parse(trusted.broadcast.createdAt) + 600_000 - this.now(),
        ),
      );
      void this.report('active', null);
      return this.publish();
    } catch (error) {
      if (reserved) this.options.tasks.releaseReservation(taskId);
      if (journal?.phase === 'claiming' || journal?.phase === 'dispatching') {
        journal.phase = 'unknown';
        await this.options.store.writeGuidanceJournal(journal);
      }
      if (generation !== this.generation) {
        if (!automatic) throw error;
        return this.get();
      }
      this.state.message =
        error instanceof Error
          ? error.message
          : 'The explanation could not start.';
      if (this.state.active?.taskId === taskId)
        this.state.active.phase =
          journal?.phase === 'unknown' ? 'unknown' : 'failed';
      this.publish();
      if (!automatic) throw error;
      return this.get();
    }
  }
  async beforeRound(taskId: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const journal = this.requireJournal(taskId);
    const trusted = this.options.broadcasts.trusted(journal.broadcastId);
    if (
      !trusted ||
      trusted.anchor !== journal.anchorAttemptId ||
      this.options.broadcasts.get()?.offline ||
      this.now() >= Date.parse(trusted.broadcast.createdAt) + 600_000
    )
      throw new Error('Classroom authority is unavailable or expired.');
    const generation = this.generation;
    const target = await this.options.broadcasts.openAssignment(
      journal.broadcastId,
    );
    const attempt = await this.options.activity.inspect(target.attemptId);
    if (
      generation !== this.generation ||
      (await this.options.owner()) !== journal.ownerId ||
      attempt.activityVersionId !== journal.claim?.activityVersionId ||
      attempt.run.state !== 'open' ||
      ['submitted', 'completed', 'withdrawn'].includes(attempt.state)
    )
      throw new Error('Classroom assignment access changed.');
    signal.throwIfAborted();
  }
  async consume(taskId: string, kind: 'model' | 'observation', requestId?: string): Promise<void> {
    const journal = this.requireJournal(taskId);
    if (kind === 'model') {
      if (!requestId || journal.modelRequestIds?.includes(requestId))
        throw new Error('A model request needs a new durable identity.');
      if (journal.modelRequests >= 8)
        throw new Error('Explanation model limit reached.');
      journal.modelRequestIds = [...(journal.modelRequestIds ?? []), requestId];
      ++journal.modelRequests;
    } else {
      if (journal.observations >= 16)
        throw new Error('Explanation observation limit reached.');
      ++journal.observations;
    }
    await this.options.store.writeGuidanceJournal(journal);
  }
  async awaitContinuation(
    taskId: string,
    text: string,
    signal: AbortSignal,
  ): Promise<GuidanceContinue> {
    const journal = this.requireJournal(taskId);
    signal.throwIfAborted();
    journal.lastText = text;
    await this.options.store.writeGuidanceJournal(journal);
    signal.throwIfAborted();
    this.options.onExplanationText?.(taskId, text);
    const active = this.state.active!;
    active.phase = 'waiting';
    active.text = text;
    active.stepRevision++;
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (this.pendingContinuation?.taskId === taskId)
          this.pendingContinuation = null;
        reject(new Error('Explanation stopped.'));
      };
      this.pendingContinuation = {
        taskId,
        revision: active.stepRevision,
        resolve: (value) => {
          signal.removeEventListener('abort', abort);
          resolve(value);
        },
        reject: (error) => {
          signal.removeEventListener('abort', abort);
          reject(error);
        },
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else this.publish();
    });
  }
  continue(raw: unknown): GuidanceState {
    const input = GuidanceContinueSchema.parse(raw);
    const active = this.state.active;
    const pending = this.pendingContinuation;
    if (
      !active ||
      active.guidanceId !== input.guidanceId ||
      active.phase !== 'waiting' ||
      !pending ||
      pending.taskId !== active.taskId ||
      pending.revision !== input.stepRevision
    )
      throw new Error('This explanation step has already changed.');
    if ((input.action === 'question') !== Boolean(input.text))
      throw new Error('A question needs text; other actions do not.');
    this.pendingContinuation = null;
    active.phase = 'planning';
    if (input.action === 'text_only') active.contextMode = 'text_only';
    pending.resolve(input);
    return this.publish();
  }
  async stop(
    guidanceId: string,
    reason: GuidanceReport['reason'] = 'student_stop',
  ): Promise<GuidanceState> {
    const active = this.state.active;
    if (!active || active.guidanceId !== guidanceId) return this.get();
    ++this.generation;
    const journal = this.journal;
    this.clearDeadline();
    this.options.broadcasts.release(active.broadcastId);
    this.pendingContinuation?.reject(new Error('Explanation stopped.'));
    this.pendingContinuation = null;
    await this.options.tasks
      .cancel({ taskId: active.taskId, source: 'stop_button' })
      .catch(() => this.options.tasks.finish(active.taskId));
    active.phase = 'cancelled';
    this.publish();
    if (journal?.claim?.status !== 'cancelled')
      void this.report('cancelled', reason, journal);
    return this.get();
  }
  onStatus(
    taskId: string,
    phase: 'observing' | 'planning' | 'presenting' | 'waiting',
    text: string,
  ): void {
    if (this.state.active?.taskId !== taskId) return;
    this.state.active.phase = phase;
    if (phase !== 'waiting') this.state.active.text = text;
    this.publish();
  }
  async onTerminal(
    taskId: string,
    terminal: {
      status: 'completed' | 'failed' | 'cancelled';
      message: string;
      finalOutput: string | null;
      outcomeUnknown?: boolean;
    },
  ): Promise<void> {
    if (this.state.active?.taskId !== taskId) return;
    const journal = this.journal;
    this.options.broadcasts.release(this.state.active.broadcastId);
    this.clearDeadline();
    this.pendingContinuation?.reject(new Error('Explanation finished.'));
    this.pendingContinuation = null;
    this.state.active.phase = terminal.outcomeUnknown
      ? 'unknown'
      : terminal.status === 'completed'
        ? 'finished'
        : terminal.status;
    this.state.active.text = terminal.finalOutput ?? terminal.message;
    this.publish();
    if (journal) {
      journal.phase = terminal.outcomeUnknown ? 'unknown' : 'terminal';
      await this.options.store.writeGuidanceJournal(journal);
    }
    await this.report(
      terminal.outcomeUnknown
        ? 'unknown'
        : terminal.status === 'completed'
          ? 'finished'
          : terminal.status,
      terminal.outcomeUnknown
        ? 'outcome_unknown'
        : terminal.status === 'failed'
          ? 'runtime_failed'
          : null,
      journal,
    );
  }
  onTaskCancelled(taskId: string): void {
    if (
      this.state.active?.taskId !== taskId ||
      ['finished', 'cancelled', 'failed', 'unknown'].includes(
        this.state.active.phase,
      )
    )
      return;
    void this.onTerminal(taskId, {
      status: 'cancelled',
      message: 'Explanation stopped.',
      finalOutput: null,
    });
  }
  dismiss(broadcastId: string): void {
    this.state.pending = this.state.pending.filter((b) => b.id !== broadcastId);
    if (this.state.active?.broadcastId !== broadcastId)
      this.options.broadcasts.release(broadcastId);
    this.publish();
  }
  async invalidate(): Promise<void> {
    ++this.generation;
    this.state.consent = null;
    this.state.pending.forEach((b) => this.options.broadcasts.release(b.id));
    this.state.pending = [];
    const active = this.state.active;
    if (
      active &&
      !['finished', 'cancelled', 'failed', 'unknown'].includes(active.phase)
    ) {
      // Stop synchronously invalidates the visible round before its network report.
      const stopping = this.stop(active.guidanceId, 'session_ended');
      this.state.active = null;
      this.state.message = null;
      this.clearDeadline();
      this.publish();
      await stopping;
    } else {
      this.state.active = null;
      this.state.message = null;
      this.clearDeadline();
      this.publish();
    }
  }
  async shutdown(): Promise<void> {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    await this.invalidate();
    await this.reportQueue;
  }
  private requireJournal(taskId: string): LocalGuidanceStartJournal {
    if (
      !this.journal ||
      this.journal.request.taskId !== taskId ||
      !this.journal.claim
    )
      throw new Error('Explanation binding is unavailable.');
    return this.journal;
  }
  private async report(
    status: GuidanceReport['status'],
    reason: GuidanceReport['reason'],
    journal: LocalGuidanceStartJournal | null = this.journal,
  ): Promise<void> {
    if (!journal?.claim) return;
    const priorStatus = this.queuedStatuses.get(journal.claim.id);
    if (
      priorStatus === status ||
      (priorStatus && priorStatus !== 'active' && priorStatus !== 'accepted')
    )
      return;
    this.queuedStatuses.set(journal.claim.id, status);
    const operation = this.reportQueue.then(async () => {
      const report: GuidanceReport = {
        status,
        reason,
        revision:
          Math.max(journal.claim!.revision, journal.report?.revision ?? 0) + 1,
      };
      journal.report = report;
      await this.options.store.writeGuidanceJournal(journal);
      try {
        const claim = await this.options.client.reportClassroomGuidance(
          journal.claim!.workSessionId,
          report,
        );
        journal.claim = claim;
        journal.report = null;
        await this.options.store.writeGuidanceJournal(journal);
      } catch {
        /* Keep the pending monotonic report encrypted for later reconciliation. */
      }
    });
    this.reportQueue = operation.catch(() => undefined);
    await operation;
  }
  private clearDeadline(): void {
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
  }
  private publish(): GuidanceState {
    ++this.state.revision;
    const value = this.get();
    this.events.emit('change', value);
    return value;
  }
}
