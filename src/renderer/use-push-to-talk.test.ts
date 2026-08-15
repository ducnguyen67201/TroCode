import { describe, expect, it, vi } from 'vitest';

import {
  beginPushToTalkAttemptIfValid,
  handleVoiceShortcutEvent,
  logVoiceConnectionFailure,
  voiceConnectionErrorMessage,
} from './use-push-to-talk';

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

describe('voice connection diagnostics', () => {
  it('turns renderer fetch failures into an actionable voice message', () => {
    expect(voiceConnectionErrorMessage(new TypeError('Failed to fetch'))).toBe(
      'TroCode could not reach OpenAI voice. Check network access to api.openai.com and try again.',
    );
  });

  it('logs the failed voice connection step without exposing secrets', () => {
    const error = new TypeError('Failed to fetch');
    const logger = {
      error: vi.fn(),
    };

    logVoiceConnectionFailure('realtime_call', error, logger);

    expect(logger.error).toHaveBeenCalledWith(
      '[voice] OpenAI Realtime connection failed.',
      {
        error: {
          message: 'Failed to fetch',
          name: 'TypeError',
        },
        step: 'realtime_call',
      },
    );
  });
});

describe('global voice shortcut events', () => {
  it('starts listening when the global press arrives while inactive', () => {
    const beginListening = vi.fn();
    const finishListening = vi.fn();

    handleVoiceShortcutEvent(
      { action: 'pressed', source: 'global' },
      {
        beginListening,
        finishListening,
        isListening: false,
      },
    );

    expect(beginListening).toHaveBeenCalledOnce();
    expect(finishListening).not.toHaveBeenCalled();
  });

  it('ignores a repeated global press while already listening', () => {
    const beginListening = vi.fn();
    const finishListening = vi.fn();

    handleVoiceShortcutEvent(
      { action: 'pressed', source: 'global' },
      {
        beginListening,
        finishListening,
        isListening: true,
      },
    );

    expect(beginListening).not.toHaveBeenCalled();
    expect(finishListening).not.toHaveBeenCalled();
  });

  it('finishes listening when the global release arrives while active', () => {
    const beginListening = vi.fn();
    const finishListening = vi.fn();

    handleVoiceShortcutEvent(
      { action: 'released', source: 'global' },
      {
        beginListening,
        finishListening,
        isListening: true,
      },
    );

    expect(finishListening).toHaveBeenCalledOnce();
    expect(beginListening).not.toHaveBeenCalled();
  });

  it('ignores global release while inactive', () => {
    const beginListening = vi.fn();
    const finishListening = vi.fn();

    handleVoiceShortcutEvent(
      { action: 'released', source: 'global' },
      {
        beginListening,
        finishListening,
        isListening: false,
      },
    );

    expect(beginListening).not.toHaveBeenCalled();
    expect(finishListening).not.toHaveBeenCalled();
  });
});
