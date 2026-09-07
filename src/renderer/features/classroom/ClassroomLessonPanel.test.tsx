import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { lessonFixture } from '../../../main/knowledge/classroom-lesson.fixture';
import type { LessonView } from '../../../shared/classroom-lesson-contracts';
import type { DesktopApi } from '../../../shared/desktop-api';

import { ClassroomLessonPanel } from './ClassroomLessonPanel';

// @vitest-environment happy-dom

describe('student lesson controls', () => {
  it.each(['en', 'vi'] as const)(
    'makes a received lesson visible with explicit Start and session controls (%s)',
    async (language) => {
      const f = lessonFixture();
      const view: LessonView = { active: null, pending: [f.envelope], autoRunConsent: false, error: null };
      const start = vi.fn(async () => view);
      const consent = vi.fn(async () => view);
      const stop = vi.fn();
      const previous = window.tro;
      window.tro = {
        lessons: { view: async () => view, onChange: () => stop, continue: start, consent },
      } as unknown as DesktopApi;
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      try {
        await act(async () => root.render(<ClassroomLessonPanel appLanguage={language} />));
        expect(host.textContent).toContain(f.envelope.plan.title);
        expect(start).not.toHaveBeenCalled();
        await act(async () => host.querySelector('button')!.click());
        expect(start).toHaveBeenCalledWith({ action: 'start', lessonId: f.envelope.lessonId, expectedRevision: 0 });
        await act(async () => host.querySelector<HTMLInputElement>('input')!.click());
        expect(consent).toHaveBeenCalledWith({ enabled: true });
      } finally {
        await act(async () => root.unmount());
        host.remove();
        window.tro = previous;
      }
      expect(stop).toHaveBeenCalledOnce();
    },
  );
});
