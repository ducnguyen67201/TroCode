// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { lessonFixture } from '../../../main/knowledge/classroom-lesson.fixture';
import type { LessonDraft, LessonProgress } from '../../../shared/classroom-lesson-contracts';
import type { DesktopApi } from '../../../shared/desktop-api';

import { ClassroomLessonPreview } from './ClassroomLessonPreview';

it('keeps a sent plan compact, exposes recovery details, and stops only on request', async () => {
  const f = lessonFixture('open');
  const draft: LessonDraft = {
    draftId: f.envelope.lessonId, ownerId: 'teacher', binding: { spaceId: f.plan.targetRunId, sessionId: f.context.sessionId },
    revision: 1, plan: f.plan, digest: f.envelope.planDigest, expiresAt: f.envelope.expiresAt,
    state: 'sent', receipt: { clientId: f.envelope.lessonId, lesson: f.envelope, newlyCreated: true },
  };
  const data: LessonProgress = {
    counts: { not_received: 1 }, nextCursor: 'page-2', rows: [{
      userId: '10784111-student', status: 'not_received', stepId: null, reasonCode: null,
      criterionOutcomes: [], receivedAt: null, updatedAt: null,
      device: { build: '0.1.8:build-hash', connected: false, ready: false, lessonsVersion: 1, lastSeenAt: null },
    }],
  };
  const stop = vi.fn(async () => undefined);
  const progress = vi.fn(async () => data);
  const confirm = vi.fn();
  const previous = window.tro;
  window.tro = { lessons: { context: async () => f.context, progress, stop, confirm } } as unknown as DesktopApi;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ClassroomLessonPreview draft={draft} vi={false} onChange={vi.fn()} />));
    expect(host.querySelector<HTMLDetailsElement>('.lesson-plan')!.open).toBe(false);
    const roster = host.querySelector<HTMLDetailsElement>('.lesson-roster')!;
    expect(roster.open).toBe(false);
    expect(roster.querySelector('summary')!.textContent).toContain('1 Not received');
    await act(async () => { roster.open = true; });
    expect(host.textContent).toContain('Sent does not mean started');
    expect(host.textContent).toContain('Update and restart Tro');
    expect(host.querySelector<HTMLDetailsElement>('.lesson-device')!.open).toBe(false);
    expect(host.querySelector('.lesson-device')!.textContent).toContain('0.1.8:build-hash');
    expect(host.querySelector('.lesson-student__identity')!.textContent).not.toContain('build-hash');
    expect(stop).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    const next = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Next page')!;
    await act(async () => next.click());
    expect(progress).toHaveBeenLastCalledWith({ ...draft.binding, lessonId: f.envelope.lessonId, cursor: 'page-2' });
    const stopButton = host.querySelector<HTMLButtonElement>('.lesson-button--stop')!;
    await act(async () => stopButton.click());
    expect(stop).toHaveBeenCalledExactlyOnceWith({ ...draft.binding, lessonId: f.envelope.lessonId });
    expect(stopButton.disabled).toBe(true);
    expect(stopButton.textContent).toBe('Lesson stopped');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    window.tro = previous;
  }
});
