import { describe, expect, it } from 'vitest';

import { lessonFixture } from '../main/knowledge/classroom-lesson.fixture';

import { ClassroomLessonPlanSchema, LessonContinueSchema } from './classroom-lesson-contracts';

describe('classroom lesson boundaries', () => {
  it('accepts reviewed semantic steps and rejects effect instructions as protocol fields', () => {
    const { plan } = lessonFixture('demonstrate');
    expect(ClassroomLessonPlanSchema.parse(plan)).toEqual(plan);
    expect(ClassroomLessonPlanSchema.safeParse({ ...plan, tools: ['terminal'] }).success).toBe(false);
    expect(ClassroomLessonPlanSchema.safeParse({ ...plan, steps: [{ ...plan.steps[0], x: 20, y: 40 }] }).success).toBe(
      false,
    );
  });
  it('rejects missing material, duplicate IDs, wrong demo mode and credentialed URLs', () => {
    const { plan } = lessonFixture('demonstrate');
    for (const bad of [
      { ...plan, resources: [] },
      { ...plan, steps: [plan.steps[0], plan.steps[0]] },
      { ...plan, steps: [{ ...plan.steps[0], mode: 'practice' }] },
      { ...plan, resources: [{ ...plan.resources[0], url: 'https://secret@example.com/editor' }] },
    ])
      expect(ClassroomLessonPlanSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects a stale/malformed continuation and oversized Unicode text', () => {
    expect(LessonContinueSchema.safeParse({ lessonId: 'bad', expectedRevision: -1, action: 'next' }).success).toBe(
      false,
    );
    const { plan } = lessonFixture();
    plan.objective = '😀'.repeat(2001);
    expect(ClassroomLessonPlanSchema.safeParse(plan).success).toBe(false);
  });
});

describe('shared Rust/TypeScript lesson corpus', () => {
  it('agrees on validation and canonical digests', async () => {
    const { readFile } = await import('node:fs/promises');
    const { lessonDigest } = await import('../main/knowledge/classroom-lesson-policy');
    const cases = JSON.parse(
      await readFile('services/api/tests/fixtures/classroom-lesson-contracts.json', 'utf8'),
    ) as Array<{ name: string; valid: boolean; plan: unknown; digest?: string }>;
    for (const item of cases) {
      const parsed = ClassroomLessonPlanSchema.safeParse(item.plan);
      expect(parsed.success, item.name).toBe(item.valid);
      if (parsed.success) expect(lessonDigest(parsed.data)).toBe(item.digest);
    }
  });
});
