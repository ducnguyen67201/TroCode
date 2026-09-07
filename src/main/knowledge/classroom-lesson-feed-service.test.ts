import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClassroomLessonClient } from './classroom-lesson-client';
import type { ClassroomLessonController } from './classroom-lesson-controller';
import { ClassroomLessonFeedService } from './classroom-lesson-feed-service';
import { lessonFixture } from './classroom-lesson.fixture';
import type { ClassroomSessionService } from './classroom-session-service';

afterEach(() => vi.useRealTimers());
describe('classroom lesson feed', () => {
  it('distinguishes initial snapshots from deltas and stops polling on cleanup', async () => {
    vi.useFakeTimers();
    const f = lessonFixture();
    const anchor = randomUUID();
    const unsubscribe = vi.fn();
    const feed = vi.fn(async () => ({
      sessionId: f.context.sessionId,
      sessionState: 'open',
      items: [f.envelope],
      maxSequence: 1,
      stoppedIds: [],
      serverTime: f.envelope.serverTime,
    }));
    const receive = vi.fn();
    const service = new ClassroomLessonFeedService(
      {
        activeStudentAttemptId: () => anchor,
        lessonConsent: () => true,
        onChange: () => unsubscribe,
      } as unknown as ClassroomSessionService,
      { feed, device: vi.fn() } as unknown as ClassroomLessonClient,
      {
        feedStatus: vi.fn(),
        activate: vi.fn(),
        invalidate: vi.fn(),
        receive,
        view: () => ({ autoRunConsent: true }),
        flushReports: vi.fn(),
        clientInstanceId: randomUUID(),
      } as unknown as ClassroomLessonController,
      'test-build',
    );
    service.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(receive).toHaveBeenCalledWith(f.envelope, false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(receive).toHaveBeenCalledWith(f.envelope, true);
    service.stop();
    const count = feed.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(feed).toHaveBeenCalledTimes(count);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
