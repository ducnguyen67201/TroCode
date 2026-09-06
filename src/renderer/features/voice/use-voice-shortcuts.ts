import type * as React from 'react';
import { useEffect, useRef } from 'react';

import type { VoiceMode } from '../../../shared/contracts';
import {
  type PushToTalkPlatform,
  INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
  isVoiceShortcutModifierCode,
  transitionVoiceShortcutArbiter,
  type VoiceShortcutArbiterState,
} from '../../push-to-talk';

import { handleVoiceShortcutEvent } from './voice-input-policy';
import type { ActiveVoiceTurn, VoiceActivationMode } from './voice-input-types';

export function useVoiceShortcuts({
  finishListening,
  platform,
  selectedModeRef,
  beginListening,
  activeTurnRef,
  cancel,
}: {
  finishListening: (releasedMode?: VoiceMode) => void;
  platform: PushToTalkPlatform;
  selectedModeRef: React.RefObject<'dictation' | 'task'>;
  beginListening: (
    activation?: VoiceActivationMode,
    voiceMode?: VoiceMode,
  ) => Promise<void>;
  activeTurnRef: React.RefObject<ActiveVoiceTurn | null>;
  cancel: () => void;
}) {
  const localArbiterRef = useRef<VoiceShortcutArbiterState>(
    INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
  );

  const localSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const pressedCodesRef = useRef(new Set<string>());

  const finishListeningRef = useRef<(mode?: VoiceMode) => void>(
    () => undefined,
  );

  useEffect(() => {
    finishListeningRef.current = finishListening;
  }, [finishListening]);

  useEffect(() => {
    const clearLocalSettleTimer = (): void => {
      if (localSettleTimerRef.current) {
        clearTimeout(localSettleTimerRef.current);
        localSettleTimerRef.current = null;
      }
    };
    const processLocalShortcut = (nowMs: number): void => {
      clearLocalSettleTimer();
      const transition = transitionVoiceShortcutArbiter(
        localArbiterRef.current,
        platform,
        pressedCodesRef.current,
        nowMs,
        selectedModeRef.current,
      );
      localArbiterRef.current = transition.state;
      for (const shortcutEvent of transition.events) {
        if (shortcutEvent.action === 'pressed') {
          void beginListening('local_hold', shortcutEvent.mode);
        } else {
          finishListeningRef.current(shortcutEvent.mode);
        }
      }
      if (
        transition.state.phase === 'settling' &&
        transition.state.deadlineMs !== null
      ) {
        const delay = Math.max(
          0,
          transition.state.deadlineMs - performance.now(),
        );
        localSettleTimerRef.current = setTimeout(
          () =>
            processLocalShortcut(
              transition.state.deadlineMs ?? performance.now(),
            ),
          delay,
        );
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (activeTurnRef.current) {
          event.preventDefault();
          cancel();
          return;
        }
        if (localArbiterRef.current.phase === 'settling') {
          event.preventDefault();
          clearLocalSettleTimer();
          localArbiterRef.current = {
            deadlineMs: null,
            phase: 'await_all_released',
          };
        }
        return;
      }
      if (event.repeat || !isVoiceShortcutModifierCode(event.code)) return;
      pressedCodesRef.current.add(event.code);
      processLocalShortcut(performance.now());
      if (localArbiterRef.current.phase !== 'idle') event.preventDefault();
    };
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (!isVoiceShortcutModifierCode(event.code)) return;
      pressedCodesRef.current.delete(event.code);
      processLocalShortcut(performance.now());
    };
    const handleBlur = (): void => {
      clearLocalSettleTimer();
      if (activeTurnRef.current) cancel();
      pressedCodesRef.current.clear();
      localArbiterRef.current = INITIAL_VOICE_SHORTCUT_ARBITER_STATE;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      clearLocalSettleTimer();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [activeTurnRef, beginListening, cancel, platform, selectedModeRef]);

  useEffect(
    () =>
      window.tro.onVoiceShortcut((event) => {
        handleVoiceShortcutEvent(event, {
          beginListening: (eventMode) =>
            beginListening('global_hold', eventMode),
          finishListening: () => finishListeningRef.current(),
          isListening: Boolean(activeTurnRef.current),
          selectedMode: selectedModeRef.current,
        });
      }),
    [activeTurnRef, beginListening, selectedModeRef],
  );

  return {};
}
