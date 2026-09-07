import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { lessonFixture } from '../../../main/knowledge/classroom-lesson.fixture';
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
  it('opens a semantic mode composer without sending or launching a general task', async () => {
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
      expect(host.textContent).toContain('Preview exact lesson');
      expect(host.textContent).toContain('Example to demonstrate');
      expect(host.querySelectorAll('textarea').length).toBeGreaterThan(3);
      expect(prepare).not.toHaveBeenCalled();
      expect(host.textContent).toContain('Choose a browser exercise');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      window.tro = previous;
    }
  });
});
