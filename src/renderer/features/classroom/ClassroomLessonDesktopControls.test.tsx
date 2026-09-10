// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { desktopLessonFixture } from '../../../main/knowledge/classroom-desktop-teaching.fixture';

import { ClassroomLessonDesktopControls } from './ClassroomLessonDesktopControls';

describe('guided desktop lesson controls', () => {
  it.each([false, true])('shows guidance and recovery without another permission checkbox (Vietnamese: %s)', async (vi) => {
    const { state } = desktopLessonFixture();
    state.envelope.plan.steps[0]!.surface!.navigation = 'tro';
    state.desktopControlConsent = false;
    state.status = 'paused';
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<ClassroomLessonDesktopControls state={state} vi={vi} />));
      expect(host.querySelector('input[type="checkbox"]')).toBeNull();
      expect(host.textContent).toContain(vi ? 'chỉ dẫn từng bước' : 'pointing out what to do');
      expect(host.textContent).toContain(vi ? 'tạm dừng hoặc dừng' : 'pause or stop');
      expect(host.textContent).toContain(vi ? 'Chọn cửa sổ tài liệu' : 'Choose material window');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
