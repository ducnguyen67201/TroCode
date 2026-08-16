import { describe, expect, it, vi } from 'vitest';

import { keepWindowAliveForBackgroundVoice } from './background-app-lifecycle';

describe('keepWindowAliveForBackgroundVoice', () => {
  it('hides the main window instead of destroying the voice host', () => {
    const closeListeners: Array<
      (event: { preventDefault(): void }) => void
    > = [];
    const window = {
      hide: vi.fn(),
      on: vi.fn(
        (_event: 'close', listener: (event: { preventDefault(): void }) => void) => {
          closeListeners.push(listener);
        },
      ),
      removeListener: vi.fn(),
    };
    const preventDefault = vi.fn();

    const remove = keepWindowAliveForBackgroundVoice(window, {
      isShuttingDown: () => false,
    });
    closeListeners[0]?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();

    remove();
    expect(window.removeListener).toHaveBeenCalledWith(
      'close',
      expect.any(Function),
    );
  });

  it('allows the window to close during application shutdown', () => {
    const closeListeners: Array<
      (event: { preventDefault(): void }) => void
    > = [];
    const window = {
      hide: vi.fn(),
      on: vi.fn(
        (_event: 'close', listener: (event: { preventDefault(): void }) => void) => {
          closeListeners.push(listener);
        },
      ),
      removeListener: vi.fn(),
    };
    const preventDefault = vi.fn();

    keepWindowAliveForBackgroundVoice(window, {
      isShuttingDown: () => true,
    });
    closeListeners[0]?.({ preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
  });
});
