import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { lessonFixture } from '../main/knowledge/classroom-lesson.fixture';

import { ClassroomLessonPlanSchema } from './classroom-lesson-contracts';
import { planFromRequest } from './classroom-teaching-request';

describe('teaching request routing', () => {
  const context = { ...lessonFixture().context, allowedOrigins: ['https://google.com'] };
  const plan = (text: string) => planFromRequest(context, context.targetRunId, text, false);
  it.each(['opening google.com link', 'Open https://google.com', 'Open google.com.'])('opens a link without explaining: %s', (text) => {
    const result = plan(text);
    expect(result.schemaVersion).toBe(2);
    expect(result.resources[0]).toMatchObject({ kind: 'web', url: 'https://google.com/', title: 'google.com' });
    expect(result.steps.map((step) => step.mode)).toEqual(['open']);
    expect(result.steps[0]?.criterionIds).toEqual([]);
  });
  it('explains the opened page only when requested, without Python assignment criteria', () => {
    const result = plan('Open google.com and explain it in Vietnamese');
    expect(result.language).toBe('vi');
    expect(result.steps.map((step) => step.mode)).toEqual(['explain']);
    expect(result.steps[0]?.criterionIds).toEqual([]);
  });
  it('keeps named markdown material distinct from a hostname', () => {
    const source = { title: '01-python-bai-hoc.md', sourceVersionId: randomUUID() };
    const result = planFromRequest({ ...context, sources: [source] }, context.targetRunId, 'Open 01-python-bai-hoc.md', false);
    expect(result.resources[0]).toMatchObject({ kind: 'source_text', sourceVersionId: source.sourceVersionId });
    expect(result.steps[0]?.mode).toBe('open');
  });
  it.each(['Open http://google.com', 'Open https://localhost', 'Open https://unapproved.example', 'Open a link', 'Explain missing.md'])('does not silently fall back to the assignment: %s', (text) => {
    expect(() => plan(text)).toThrow();
  });
  it('does not invent an explanation before an explicit demonstration', () => {
    expect(plan('Demonstrate typing a search into https://google.com').steps.map((step) => step.mode)).toEqual(['demonstrate']);
  });
  it('requires the server update for open-only plans and rejects open in version 1', () => {
    expect(() => planFromRequest({ ...context, maxPlanVersion: undefined }, context.targetRunId, 'Open google.com', false)).toThrow('server');
    expect(ClassroomLessonPlanSchema.safeParse({ ...plan('Open google.com'), schemaVersion: 1 }).success).toBe(false);
  });
});
