import { describe, expect, it, vi } from 'vitest';

import { setNonActivatingWindowInteractivity } from './non-activating-window';

describe('setNonActivatingWindowInteractivity', () => {
  it.each([
    { interactive: true, ignoresMouse: false },
    { interactive: false, ignoresMouse: true },
  ])(
    'keeps the window non-focusable when interactive=$interactive',
    ({ interactive, ignoresMouse }) => {
      const window = {
        setFocusable: vi.fn(),
        setIgnoreMouseEvents: vi.fn(),
      };

      setNonActivatingWindowInteractivity(window, interactive);

      expect(window.setFocusable).toHaveBeenCalledWith(false);
      expect(window.setFocusable).not.toHaveBeenCalledWith(true);
      expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(ignoresMouse, {
        forward: true,
      });
    },
  );
});
