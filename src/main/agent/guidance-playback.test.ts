import { describe, expect, it, vi } from 'vitest';

import { GuidancePlaybackController } from './guidance-playback';

describe('guidance playback controller', () => {
  it('auto-advances only after both dwell and narration complete', async () => {
    vi.useFakeTimers();
    try {
      let finishNarration: () => void = () => undefined;
      const narration = new Promise<void>((resolve) => {
        finishNarration = () => resolve();
      });
      const playback = new GuidancePlaybackController(1_000);
      const navigation = playback.wait(
        new AbortController().signal,
        narration,
      );

      await vi.advanceTimersByTimeAsync(1_000);
      let settled = false;
      void navigation.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      finishNarration();
      await expect(navigation).resolves.toBe('next');
    } finally {
      vi.useRealTimers();
    }
  });

  it('autoplays only after the slower guidance interval', async () => {
    vi.useFakeTimers();
    try {
      const playback = new GuidancePlaybackController(12_000);
      const navigation = playback.wait(new AbortController().signal);

      await vi.advanceTimersByTimeAsync(11_999);
      let settled = false;
      void navigation.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(navigation).resolves.toBe('next');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses K-style pause and resume without losing the current step', async () => {
    vi.useFakeTimers();
    try {
      const playback = new GuidancePlaybackController(1_000);
      expect(playback.togglePause()).toBe(true);
      const navigation = playback.wait(new AbortController().signal);

      await vi.advanceTimersByTimeAsync(5_000);
      let settled = false;
      void navigation.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      expect(playback.togglePause()).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(navigation).resolves.toBe('next');
    } finally {
      vi.useRealTimers();
    }
  });

  it('delivers J and L navigation immediately, including a buffered keypress', async () => {
    const playback = new GuidancePlaybackController(60_000);
    playback.back();
    await expect(playback.wait(new AbortController().signal)).resolves.toBe(
      'back',
    );

    const next = playback.wait(new AbortController().signal);
    playback.next();
    await expect(next).resolves.toBe('next');
  });

  it('aborts a pending playback wait with the task', async () => {
    const playback = new GuidancePlaybackController(60_000);
    const controller = new AbortController();
    const navigation = playback.wait(controller.signal);
    controller.abort();

    await expect(navigation).rejects.toMatchObject({ name: 'AbortError' });
  });
});
