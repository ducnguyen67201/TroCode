// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { lessonStateFixture } from '../../../main/knowledge/classroom-lesson.fixture';
import type { DesktopApi } from '../../../shared/desktop-api';

import { ClassroomLessonMaterialPanel } from './ClassroomLessonMaterialPanel';

describe('material visibility acknowledgement', () => {
  it.each(['collapsed', 'background', 'empty', 'offscreen', 'covered'] as const)(
    'waits when material is %s and acknowledges after it becomes readable and visible', async (reason) => {
      vi.useFakeTimers();
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      const state = lessonStateFixture();
      const ack = vi.fn(async () => undefined);
      const previous = window.tro;
      window.tro = { lessons: { materialAck: ack } } as unknown as DesktopApi;
      const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
      rect.mockReturnValue(new DOMRect(0, 10, reason === 'collapsed' ? 0 : 600, 200));
      if (reason === 'offscreen') rect.mockReturnValue(new DOMRect(0, 10000, 600, 200));
      const visibility = vi.spyOn(document, 'visibilityState', 'get');
      visibility.mockReturnValue(reason === 'background' ? 'hidden' : 'visible');
      const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined);
      if (reason === 'empty') state.material!.text = '';
      const host = document.createElement('div');
      document.body.append(host);
      const hit = vi.spyOn(document, 'elementFromPoint').mockImplementation(() =>
        reason === 'covered' ? document.body : host.querySelector('pre'));
      const root = createRoot(host);
      try {
        await act(async () => root.render(<ClassroomLessonMaterialPanel state={state} vi={false} />));
        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(ack).not.toHaveBeenCalled();
        expect(scroll).toHaveBeenCalled();
        rect.mockReturnValue(new DOMRect(0, 10, 600, 200));
        visibility.mockReturnValue('visible');
        hit.mockImplementation(() => host.querySelector('pre'));
        state.material!.text = 'name = input("Name: ")';
        await act(async () => root.render(<ClassroomLessonMaterialPanel state={{ ...state }} vi={false} />));
        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(ack).toHaveBeenCalledExactlyOnceWith({
          lessonId: state.envelope.lessonId, revision: state.revision, resourceId: state.material!.resource.id,
        });
      } finally {
        await act(async () => root.unmount());
        host.remove();
        window.tro = previous;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
      }
    },
  );
});
