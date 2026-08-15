import { describe, expect, it, vi } from 'vitest';

import { beginPushToTalkAttemptIfValid } from './use-push-to-talk';

describe('push-to-talk attempt lifecycle', () => {
  it('clears stale UI state when a valid attempt begins', () => {
    const onAttemptStart = vi.fn();

    expect(
      beginPushToTalkAttemptIfValid(
        {
          disabled: false,
          enabled: true,
          hasActiveTurn: false,
          isChordHeld: false,
          platform: 'macos',
        },
        onAttemptStart,
      ),
    ).toBe(true);
    expect(onAttemptStart).toHaveBeenCalledOnce();
  });

  it('does not clear UI state when the attempt is invalid', () => {
    const onAttemptStart = vi.fn();

    expect(
      beginPushToTalkAttemptIfValid(
        {
          disabled: true,
          enabled: true,
          hasActiveTurn: false,
          isChordHeld: false,
          platform: 'macos',
        },
        onAttemptStart,
      ),
    ).toBe(false);
    expect(onAttemptStart).not.toHaveBeenCalled();
  });
});
