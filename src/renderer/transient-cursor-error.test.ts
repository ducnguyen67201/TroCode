import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CURSOR_ERROR_BADGE_TIMEOUT_MS,
  INITIAL_TRANSIENT_CURSOR_ERROR_STATE,
  getCompanionErrorVisibility,
  scheduleTransientCursorErrorDismissal,
  transientCursorErrorReducer,
} from './transient-cursor-error';

describe('transient cursor error state', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dismisses the cursor badge after the named timeout without clearing the message', () => {
    vi.useFakeTimers();
    const reported = transientCursorErrorReducer(
      INITIAL_TRANSIENT_CURSOR_ERROR_STATE,
      { type: 'reported', message: 'No speech was detected.' },
    );
    const dismiss = vi.fn();
    scheduleTransientCursorErrorDismissal(reported.revision, dismiss);

    expect(CURSOR_ERROR_BADGE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(reported.visible).toBe(true);
    vi.advanceTimersByTime(CURSOR_ERROR_BADGE_TIMEOUT_MS - 1);
    expect(dismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(dismiss).toHaveBeenCalledWith(reported.revision);
    const dismissed = transientCursorErrorReducer(reported, {
      type: 'dismissed',
      revision: reported.revision,
    });
    expect(dismissed.visible).toBe(false);
    expect(dismissed.message).toBe('No speech was detected.');
  });

  it('clears a stale badge when a new voice attempt begins', () => {
    const reported = transientCursorErrorReducer(
      INITIAL_TRANSIENT_CURSOR_ERROR_STATE,
      { type: 'reported', message: 'No speech was detected.' },
    );

    const cleared = transientCursorErrorReducer(reported, { type: 'cleared' });
    expect(cleared.visible).toBe(false);
    expect(cleared.message).toBeNull();
  });

  it('does not let an older timeout dismiss a newer error', () => {
    const firstError = transientCursorErrorReducer(
      INITIAL_TRANSIENT_CURSOR_ERROR_STATE,
      { type: 'reported', message: 'First error' },
    );
    const secondError = transientCursorErrorReducer(firstError, {
      type: 'reported',
      message: 'Second error',
    });

    expect(
      transientCursorErrorReducer(secondError, {
        type: 'dismissed',
        revision: firstError.revision,
      }),
    ).toEqual(secondError);
  });

  it('keeps permanent failures visible after a transient badge is dismissed', () => {
    expect(
      getCompanionErrorVisibility({
        computerFailed: false,
        taskFailed: true,
        transientErrorVisible: false,
        voiceProviderFailed: false,
      }),
    ).toBe(true);
    expect(
      getCompanionErrorVisibility({
        computerFailed: true,
        taskFailed: false,
        transientErrorVisible: false,
        voiceProviderFailed: false,
      }),
    ).toBe(true);
    expect(
      getCompanionErrorVisibility({
        computerFailed: false,
        taskFailed: false,
        transientErrorVisible: false,
        voiceProviderFailed: true,
      }),
    ).toBe(true);
  });
});
