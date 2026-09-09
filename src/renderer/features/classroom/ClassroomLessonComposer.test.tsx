import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { lessonFixture } from '../../../main/knowledge/classroom-lesson.fixture';
import type { LessonDraft } from '../../../shared/classroom-lesson-contracts';
import type { DesktopApi } from '../../../shared/desktop-api';

import { ClassroomLessonComposer } from './ClassroomLessonComposer';
import { ClassroomLessonPreview } from './ClassroomLessonPreview';

// @vitest-environment happy-dom

describe('teacher lesson entry point', () => {
  it('shows the reviewed objective, material and published criteria before sending', async () => {
    const f = lessonFixture();
    const confirm = vi.fn();
    const previous = window.tro;
    window.tro = { lessons: { context: async () => f.context, confirm } } as unknown as DesktopApi;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <ClassroomLessonPreview
            vi={false}
            onChange={() => undefined}
            draft={{
              draftId: f.envelope.lessonId,
              ownerId: 'teacher',
              binding: { spaceId: f.plan.targetRunId, sessionId: f.context.sessionId },
              revision: 1,
              plan: f.plan,
              digest: f.envelope.planDigest,
              expiresAt: f.envelope.expiresAt,
              state: 'prepared',
              receipt: null,
            }}
          />,
        ),
      );
      expect(host.querySelector<HTMLDetailsElement>('.lesson-plan')!.open).toBe(true);
      expect(host.textContent).toContain('Objective: Read a name');
      expect(host.textContent).toContain('Material: Greeting editor');
      expect(host.textContent).toContain('Name: Read input');
      expect(host.textContent).toContain('English');
      expect(host.querySelector('button')!.disabled).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
      window.tro = previous;
    }
  });
  it('opens one simple teaching request composer without sending or launching a general task', async () => {
    const f = lessonFixture();
    const prepare = vi.fn();
    const previous = window.tro;
    window.tro = {
      getTeacherClassroom: async () => ({ binding: { spaceId: f.plan.targetRunId, sessionId: f.context.sessionId } }),
      lessons: { context: async () => f.context, prepare },
    } as unknown as DesktopApi;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <ClassroomLessonComposer spaceId={f.plan.targetRunId} runId={f.plan.targetRunId} vi={false} enabled />,
        ),
      );
      await act(async () => host.querySelector('button')!.click());
      expect(host.textContent).toContain('Explain material on students’ computers');
      expect(host.textContent).toContain('Teaching request');
      expect(host.textContent).not.toContain('Document navigation');
      expect(host.textContent).not.toContain('Tro navigates with student permission');
      expect(host.querySelectorAll('textarea').length).toBe(1);
      expect(prepare).not.toHaveBeenCalled();
      expect(host.textContent).toContain('Tro downloads the class material');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      window.tro = previous;
    }
  });
});

it('discards a late preparation after edits and sends only the current reviewed draft', async () => {
  vi.useFakeTimers();
  const f = lessonFixture();
  f.context.maxPlanVersion = 3;
  f.context.sources = [{ sourceVersionId: f.envelope.lessonId, title: 'python.pdf' }];
  const pending: Array<{ input: { binding: { spaceId: string; sessionId: string }; plan: typeof f.plan }; resolve: (draft: LessonDraft) => void }> = [];
  const prepare = vi.fn((input: { binding: { spaceId: string; sessionId: string }; plan: typeof f.plan }) => new Promise<LessonDraft>((resolve) => pending.push({ input, resolve })));
  const cancelDraft = vi.fn(async () => undefined);
  const confirm = vi.fn(async () => ({ ...currentDraft, state: 'unknown' as const }));
  const previous = window.tro;
  window.tro = { getTeacherClassroom: async () => ({ binding: { spaceId: f.plan.targetRunId, sessionId: f.context.sessionId } }), lessons: { context: async () => f.context, prepare, cancelDraft, confirm } } as unknown as DesktopApi;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let currentDraft: LessonDraft;
  const change = async (text: string) => act(async () => {
    const textarea = host.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  try {
    await act(async () => root.render(<ClassroomLessonComposer spaceId={f.plan.targetRunId} runId={f.plan.targetRunId} vi={false} enabled />));
    await act(async () => host.querySelector('button')!.click());
    await change('Explain the first page');
    await act(async () => vi.advanceTimersByTimeAsync(501));
    await change('Explain the second page');
    await act(async () => vi.advanceTimersByTimeAsync(501));
    expect(pending).toHaveLength(2);
    expect(pending[1]!.input.plan.steps[0]!.surface?.navigation).toBe('tro');
    const makeDraft = (index: number) => ({ draftId: index === 1 ? f.envelope.lessonId : f.plan.targetRunId, ownerId: 'teacher', binding: pending[index]!.input.binding, plan: pending[index]!.input.plan, revision: 1, digest: String(index).repeat(64), state: 'prepared' as const, receipt: null, expiresAt: f.envelope.expiresAt });
    currentDraft = makeDraft(1);
    await act(async () => pending[1]!.resolve(currentDraft));
    await act(async () => pending[0]!.resolve(makeDraft(0)));
    expect(cancelDraft).toHaveBeenCalledWith({ draftId: f.plan.targetRunId });
    expect(host.textContent).not.toContain('Preview lesson');
    const send = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Send to class')!;
    expect(send.disabled).toBe(false);
    await act(async () => send.click());
    expect(confirm).toHaveBeenCalledWith({ draftId: currentDraft.draftId, revision: 1, digest: currentDraft.digest });
    expect(host.textContent).toContain('Reconcile receipt');
    expect(host.querySelector('fieldset')!.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); window.tro = previous; vi.useRealTimers(); }
});
