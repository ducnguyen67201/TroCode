import { EventEmitter } from 'node:events';

import { validateClassroomUrl } from '../../shared/classroom-url-policy';
import {
  BroadcastNoticeSchema,
  type BroadcastNotice,
  type ClassroomBroadcast,
} from '../../shared/contracts';

import type { ClassroomSessionService } from './classroom-session-service';
import {
  KnowledgeSpaceRequestError,
  type KnowledgeSpaceClient,
} from './knowledge-space-client';

export class ClassroomBroadcastService {
  private readonly events = new EventEmitter();
  private anchor: string | null = null;
  private generation = 0;
  private revision = 0;
  private cursor: number | undefined;
  private failures = 0;
  private caughtUp = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private unsubscribe: (() => void) | null = null;
  private notice: BroadcastNotice | null = null;
  private readonly retained = new Set<string>();
  private readonly cache = new Map<string, ClassroomBroadcast>();
  constructor(
    private readonly options: {
      client: Pick<
        KnowledgeSpaceClient,
        | 'capabilities'
        | 'listClassroomBroadcasts'
        | 'resolveBroadcastAssignment'
      >;
      sessionService: ClassroomSessionService;
      openExternal: (url: string) => Promise<void>;
      setTimer?: typeof setTimeout;
      clearTimer?: typeof clearTimeout;
      random?: () => number;
    },
  ) {}
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.options.sessionService.onChange((session) => {
      const anchor =
        session && !session.leftAt && session.run.state === 'open'
          ? session.attemptId
          : null;
      if (anchor !== this.anchor) this.reset(anchor);
    });
    const session = this.options.sessionService.get();
    this.reset(
      session && !session.leftAt && session.run.state === 'open'
        ? session.attemptId
        : null,
    );
  }
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.reset(null);
  }
  get(): BroadcastNotice | null {
    return this.notice ? BroadcastNoticeSchema.parse(this.notice) : null;
  }
  trusted(
    id: string,
  ): { anchor: string; broadcast: ClassroomBroadcast } | null {
    const broadcast = this.cache.get(id);
    return this.anchor && broadcast ? { anchor: this.anchor, broadcast } : null;
  }
  retain(id: string): void {
    if (this.cache.has(id) && this.retained.size < 6) this.retained.add(id);
  }
  release(id: string): void {
    this.retained.delete(id);
  }
  onChange(listener: (notice: BroadcastNotice | null) => void): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }
  onBroadcast(
    listener: (
      broadcast: ClassroomBroadcast,
      provenance: 'live_delta' | 'initial_snapshot',
    ) => void,
  ): () => void {
    this.events.on('broadcast', listener);
    return () => this.events.off('broadcast', listener);
  }
  async openAssignment(id: string): Promise<{ attemptId: string }> {
    const trusted = this.trusted(id);
    if (!trusted || trusted.broadcast.payload.kind !== 'assignment')
      throw new Error('Assignment notice is unavailable.');
    const generation = this.generation;
    const result = await this.options.client.resolveBroadcastAssignment(
      trusted.anchor,
      id,
    );
    if (generation !== this.generation)
      throw new Error('The classroom session changed.');
    return result;
  }
  async openLink(id: string): Promise<void> {
    const trusted = this.trusted(id);
    if (
      !trusted ||
      trusted.broadcast.payload.kind !== 'open_url' ||
      this.notice?.offline
    )
      throw new Error('Classroom link is unavailable.');
    const generation = this.generation;
    const response = await this.options.client.listClassroomBroadcasts(
      trusted.anchor,
    );
    if (generation !== this.generation || response.sessionState !== 'open')
      throw new Error('The classroom session changed.');
    const url = validateClassroomUrl(
      trusted.broadcast.payload.url,
      trusted.broadcast.payload.origin,
    );
    if (!url) throw new Error('Classroom link is invalid.');
    await this.options.openExternal(url.href);
  }
  dismiss(id: string): void {
    if (this.notice?.broadcast?.id === id)
      this.publish({ ...this.notice, broadcast: null });
  }
  async pollNow(): Promise<void> {
    if (!this.anchor || this.controller) return;
    const generation = this.generation;
    const anchor = this.anchor;
    const controller = new AbortController();
    this.controller = controller;
    try {
      if (this.cursor === undefined) {
        const capability = await this.options.client.capabilities();
        if (generation !== this.generation) return;
        if (
          !capability.classroomBroadcasts ||
          !capability.knowledgeSpaces.enabled
        ) {
          this.reset(null);
          return;
        }
      }
      const response = await this.options.client.listClassroomBroadcasts(
        anchor,
        this.cursor,
        controller.signal,
      );
      if (generation !== this.generation) return;
      if (response.sessionState !== 'open') {
        this.options.sessionService.updateRunState(response.sessionState);
        this.reset(null);
        return;
      }
      // Establish the verified session and its defaults before the first notice.
      if (!this.notice) {
        this.publish({
          anchorAttemptId: anchor,
          sessionId: response.sessionId,
          revision: 0,
          broadcast: null,
          offline: false,
        });
      }
      const live = this.caughtUp && this.failures === 0;
      for (const broadcast of response.items) {
        this.cache.set(broadcast.id, broadcast);
        while (this.cache.size > 20) {
          const oldest = [...this.cache.keys()].find(
            (id) => !this.retained.has(id),
          );
          if (!oldest) break;
          this.cache.delete(oldest);
        }
        this.publish({
          anchorAttemptId: anchor,
          sessionId: response.sessionId,
          revision: 0,
          broadcast,
          offline: false,
        });
        this.events.emit(
          'broadcast',
          broadcast,
          live ? 'live_delta' : 'initial_snapshot',
        );
      }
      this.cursor = response.maxSequence;
      this.failures = 0;
      this.caughtUp = response.items.length < 100;
      if (this.notice?.offline)
        this.publish({ ...this.notice, offline: false });
    } catch (error) {
      if (generation !== this.generation) return;
      this.caughtUp = false;
      if (
        error instanceof KnowledgeSpaceRequestError &&
        [401, 403, 404, 409].includes(error.status)
      ) {
        this.reset(null);
        return;
      }
      ++this.failures;
      if (this.notice) this.publish({ ...this.notice, offline: true });
    } finally {
      if (generation === this.generation) {
        this.controller = null;
        this.schedule();
      }
    }
  }
  private reset(anchor: string | null): void {
    ++this.generation;
    this.controller?.abort();
    this.controller = null;
    if (this.timer) (this.options.clearTimer ?? clearTimeout)(this.timer);
    this.timer = null;
    this.anchor = anchor;
    this.cursor = undefined;
    this.failures = 0;
    this.caughtUp = false;
    this.notice = null;
    this.cache.clear();
    this.retained.clear();
    ++this.revision;
    this.events.emit('change', null);
    if (anchor) this.schedule(0);
  }
  private schedule(delay?: number): void {
    if (!this.anchor || this.timer) return;
    this.timer = (this.options.setTimer ?? setTimeout)(
      () => {
        this.timer = null;
        void this.pollNow();
      },
      delay ??
        Math.min(
          30_000,
          3000 * 2 ** Math.min(this.failures, 4) +
            Math.floor((this.options.random ?? Math.random)() * 2000),
        ),
    );
  }
  private publish(notice: BroadcastNotice): void {
    this.notice = BroadcastNoticeSchema.parse({
      ...notice,
      revision: ++this.revision,
    });
    this.events.emit('change', this.get());
  }
}
