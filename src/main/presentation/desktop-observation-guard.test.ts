import { describe, expect, it, vi } from 'vitest';

import {
  DesktopObservationGuard,
  type ObservationWindow,
} from './desktop-observation-guard';

function windowStub() {
  let destroyed = false;
  let visible = true;
  const window: ObservationWindow = {
    hide: vi.fn(() => {
      visible = false;
    }),
    isDestroyed: vi.fn(() => destroyed),
    isVisible: vi.fn(() => visible),
    showInactive: vi.fn(() => {
      visible = true;
    }),
  };
  return {
    destroy: () => {
      destroyed = true;
      visible = false;
    },
    window,
  };
}

describe('DesktopObservationGuard', () => {
  it('keeps the lesson window visible while hiding overlays and rejects conflicting captures', async () => {
    const main = windowStub().window;
    const overlay = windowStub().window;
    const guard = new DesktopObservationGuard({
      settle: async () => undefined,
      surfaces: [
        { getWindow: () => main, shouldRestore: () => false },
        { getWindow: () => overlay, shouldRestore: () => true },
      ],
    });
    const release = await guard.prepare(main);
    expect(main.isVisible()).toBe(true);
    expect(main.hide).not.toHaveBeenCalled();
    expect(overlay.isVisible()).toBe(false);
    await expect(guard.prepare()).rejects.toThrow('conflicting');
    await release();
    expect(overlay.isVisible()).toBe(true);
    const releaseOrdinary = await guard.prepare();
    expect(main.isVisible()).toBe(false);
    await releaseOrdinary();
    expect(main.isVisible()).toBe(false);
  });
  it('hides once and restores only after the final overlapping lease', async () => {
    const { window } = windowStub();
    const settle = vi.fn(async () => undefined);
    const guard = new DesktopObservationGuard({
      settle,
      surfaces: [{ getWindow: () => window, shouldRestore: () => true }],
    });

    const releaseFirst = await guard.prepare();
    const releaseSecond = await guard.prepare();
    await releaseFirst();

    expect(window.hide).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledOnce();
    expect(window.showInactive).not.toHaveBeenCalled();

    await releaseSecond();
    await releaseSecond();
    expect(window.showInactive).toHaveBeenCalledOnce();
  });

  it('does not resurrect a surface whose logical activity ended', async () => {
    const { window } = windowStub();
    let active = true;
    const guard = new DesktopObservationGuard({
      settle: async () => undefined,
      surfaces: [{ getWindow: () => window, shouldRestore: () => active }],
    });

    const release = await guard.prepare();
    active = false;
    await release();

    expect(window.hide).toHaveBeenCalledOnce();
    expect(window.showInactive).not.toHaveBeenCalled();
  });

  it('does not restore an overlay for a different coaching session', async () => {
    const { window } = windowStub();
    let taskId = 'task-a';
    const guard = new DesktopObservationGuard({
      settle: async () => undefined,
      surfaces: [{
        getWindow: () => window,
        restoreIdentity: () => taskId,
        shouldRestore: () => true,
      }],
    });
    const release = await guard.prepare();
    taskId = 'task-b';
    await release();
    expect(window.showInactive).not.toHaveBeenCalled();
  });

  it('ignores a window destroyed while the desktop capture is active', async () => {
    const { destroy, window } = windowStub();
    const guard = new DesktopObservationGuard({
      settle: async () => undefined,
      surfaces: [{ getWindow: () => window, shouldRestore: () => true }],
    });

    const release = await guard.prepare();
    destroy();
    await release();

    expect(window.showInactive).not.toHaveBeenCalled();
  });
});
