import type { ClassroomLessonClient } from './classroom-lesson-client';
import type { ClassroomLessonController } from './classroom-lesson-controller';
import type { ClassroomSessionService } from './classroom-session-service';

export class ClassroomLessonFeedService {
  private stopListener: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private anchor: string | null = null;
  private cursor: number | undefined;
  private presenceAt = 0;
  private presenceVersion = 0;
  constructor(
    private readonly session: ClassroomSessionService,
    private readonly client: ClassroomLessonClient,
    private readonly lessons: ClassroomLessonController,
    private readonly build: string,
  ) {}
  start() {
    if (this.stopListener) return;
    this.stopListener = this.session.onChange(() => {
      void this.update().catch(() => console.warn('[classroom:lesson] session activation unavailable'));
    });
    void this.update().catch(() => console.warn('[classroom:lesson] session activation unavailable'));
  }
  private async update() {
    const anchor = this.session.activeStudentAttemptId();
    if (anchor === this.anchor) return;
    this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
    const generation = ++this.generation;
    this.anchor = anchor;
    this.cursor = undefined;
    await this.lessons.activate(anchor, this.session.lessonConsent());
    if (anchor && generation === this.generation) void this.poll(generation);
  }
  private async poll(generation: number) {
    if (!this.anchor || generation !== this.generation) return;
    this.controller = new AbortController();
    const anchor = this.anchor;
    try {
      const feed = await this.client.feed(anchor, this.cursor, this.controller.signal);
      if (generation !== this.generation) return;
      this.lessons.feedStatus(null);
      if (Date.now() - this.presenceAt >= 10_000 || this.presenceVersion !== (feed.maxPlanVersion ?? 1)) {
        await this.client.device(
          anchor,
          this.lessons.clientInstanceId,
          this.build.slice(0, 100),
          this.lessons.view().autoRunConsent,
        );
        this.presenceAt = Date.now();
        this.presenceVersion = feed.maxPlanVersion ?? 1;
      }
      const live = this.cursor !== undefined;
      await this.lessons.invalidate(feed.stoppedIds, feed.sessionState === 'open');
      for (const lesson of [...feed.items].sort((a, b) => a.sequence - b.sequence)) {
        if (generation !== this.generation) return;
        await this.lessons.receive(lesson, live);
      }
      this.cursor = feed.maxSequence;
      await this.lessons.flushReports();
    } catch (error) {
      if (generation === this.generation && !this.controller.signal.aborted) {
        this.lessons.feedStatus(
          'Lesson connection unavailable. Check that this computer and the hosted API have the lesson update, and that you are still in the class.',
        );
        console.warn('[classroom:lesson] feed unavailable', { error: error instanceof Error ? error.name : 'Error' });
      }
    } finally {
      if (generation === this.generation)
        this.timer = setTimeout(
          () => {
            void this.poll(generation);
          },
          3000 + Math.floor(Math.random() * 2000),
        );
    }
  }
  stop() {
    this.anchor = null;
    this.cursor = undefined;
    this.generation++;
    this.stopListener?.();
    this.stopListener = null;
    this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
  }
}
