// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { ClassroomWorkspaceLayout } from './ClassroomWorkspaceLayout';

describe('classroom workspace layout', () => {
  it('changes presentation without restarting session subscriptions', async () => {
    const subscribe = vi.fn();
    const unsubscribe = vi.fn();
    function Session() {
      useEffect(() => {
        subscribe();
        return unsubscribe;
      }, []);
      return <div className="classroom-bar">Teacher direction</div>;
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const render = (enabled: boolean) =>
      root.render(
        <ClassroomWorkspaceLayout
          enabled={enabled}
          appLanguage="en"
          sidebar={<Session />}
        >
          <p>Assignment instructions</p>
        </ClassroomWorkspaceLayout>,
      );
    try {
      await act(async () => render(true));
      expect(container.querySelector('.classroom-workspace')).not.toBeNull();
      const toggle = container.querySelector('button')!;
      await act(async () => toggle.click());
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      await act(async () =>
        toggle.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
      );
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(toggle);
      await act(async () => render(false));
      expect(container.querySelector('.classroom-workspace')).toBeNull();
      expect(
        container.querySelector('.classroom-workspace--horizontal'),
      ).not.toBeNull();
      expect(container.textContent).toContain('Assignment instructions');
      expect(subscribe).toHaveBeenCalledOnce();
      expect(unsubscribe).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
