import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { lessonFixture } from '../main/knowledge/classroom-lesson.fixture';

import { ClassroomLessonPlanSchema } from './classroom-lesson-contracts';
import { planFromRequest } from './classroom-teaching-request';

describe('teaching request routing', () => {
  const context = { ...lessonFixture().context, allowedOrigins: ['https://google.com'] };
  const plan = (text: string) => planFromRequest(context, context.targetRunId, text, false);
  it.each(['opening google.com link', 'Open https://google.com', 'Open google.com.', 'Mở google.com'])('opens a link without explaining: %s', (text) => {
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
  it('honors a Vietnamese request for an English explanation', () => {
    const result = planFromRequest(context, context.targetRunId, 'Giải thích bài này bằng tiếng Anh', true);
    expect(result.language).toBe('en');
    expect(result.steps.map((step) => step.mode)).toEqual(['explain']);
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

it('defaults a selected v3 class file to an external app and keeps visible-screen teaching explicit', () => {
  const source = { title: 'python.pdf', sourceVersionId: randomUUID() };
  const context = lessonFixture().context;
  const current = { ...context, maxPlanVersion: 3, sources: [source] };
  const options = { material: source.sourceVersionId, surface: 'resource_app' as const, navigation: 'student' as const, language: 'vi' as const, section: 'Page 2' };
  const plan = planFromRequest(current, current.targetRunId, 'Explain one example', false, options);
  expect(plan.schemaVersion).toBe(3);
  expect(plan.resources[0]).toMatchObject({ kind: 'source_text', sourceVersionId: source.sourceVersionId });
  expect(plan.steps[0]).toMatchObject({ surface: { kind: 'resource_app', navigation: 'student' }, instruction: 'Explain one example\nSection: Page 2' });
  const visible = planFromRequest(current, current.targetRunId, 'Explain this', false, { ...options, material: 'current_screen', surface: 'current_window' });
  expect(visible.resources[0]?.kind).toBe('current_screen');
  expect(() => planFromRequest({ ...current, maxPlanVersion: 2 }, current.targetRunId, 'Explain this', false, options)).toThrow('server');
});
