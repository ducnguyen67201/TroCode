import { describe, expect, it } from 'vitest';

import {
  assertLessonTransition,
  canAutoStartLesson,
  lessonDigest,
  validateLessonContext,
} from './classroom-lesson-policy';
import { lessonFixture } from './classroom-lesson.fixture';

describe('lesson policy', () => {
  it('pins published target, origin, source and answer policy', () => {
    const { plan, context } = lessonFixture('demonstrate');
    expect(() => validateLessonContext(plan, context)).not.toThrow();
    for (const changed of [
      { ...context, allowedOrigins: [] },
      { ...context, answerReveal: 'never' as const },
      { ...context, launchTarget: 'workspace' as const },
    ])
      expect(() => validateLessonContext(plan, changed)).toThrow();
  });
  it('never auto starts initial snapshots, busy students or opted-out sessions', () => {
    const { envelope } = lessonFixture();
    const input = {
      live: true,
      consent: true,
      busy: false,
      active: true,
      serverTime: envelope.serverTime,
      expiresAt: envelope.expiresAt,
    };
    expect(canAutoStartLesson(input)).toBe(true);
    expect(canAutoStartLesson({ ...input, live: false })).toBe(false);
    expect(canAutoStartLesson({ ...input, busy: true })).toBe(false);
    expect(canAutoStartLesson({ ...input, consent: false })).toBe(false);
    expect(canAutoStartLesson({ ...input, serverTime: envelope.expiresAt })).toBe(false);
  });
  it('does not turn uncertain or completed state back into execution', () => {
    expect(() => assertLessonTransition('unknown', 'preparing')).toThrow();
    expect(() => assertLessonTransition('finished', 'running')).toThrow();
    expect(() => assertLessonTransition('waiting_for_student', 'preparing')).not.toThrow();
  });
  it('digests exact content independently of object key order', () => {
    const { plan } = lessonFixture();
    const reverse = Object.fromEntries(Object.entries(plan).reverse()) as typeof plan;
    expect(lessonDigest(reverse)).toBe(lessonDigest(plan));
    expect(lessonDigest({ ...plan, objective: 'Different objective' })).not.toBe(lessonDigest(plan));
  });
});
