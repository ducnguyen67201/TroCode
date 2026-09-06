import type { VoiceShortcutEvent } from '../../../shared/contracts';
import type { PushToTalkPlatform } from '../../push-to-talk';
import { detectPushToTalkPlatform } from '../../push-to-talk';

import type {
  LocalVoiceReleaseState,
  PushToTalkAttemptReadiness,
  VoiceShortcutEventHandlers,
} from './voice-input-types';

export function shouldCancelVoiceTurnForAvailability(input: {
  disabled: boolean;
  enabled: boolean;
  finalizing: boolean;
  platform: PushToTalkPlatform;
}): boolean {
  if (!input.enabled || input.platform === 'unsupported') return true;
  return input.disabled && !input.finalizing;
}

export function beginPushToTalkAttemptIfValid(
  {
    disabled,
    enabled,
    hasActiveTurn,
    isChordHeld,
    platform,
  }: PushToTalkAttemptReadiness,
  onAttemptStart: () => void,
): boolean {
  if (
    disabled ||
    !enabled ||
    platform === 'unsupported' ||
    isChordHeld ||
    hasActiveTurn
  ) {
    return false;
  }
  onAttemptStart();
  return true;
}

export function handleVoiceShortcutEvent(
  event: VoiceShortcutEvent,
  {
    beginListening,
    finishListening,
    isListening,
    selectedMode,
  }: VoiceShortcutEventHandlers,
): void {
  if (event.action === 'pressed') {
    if (!isListening) beginListening(selectedMode);
    return;
  }
  if (event.action === 'released' && isListening) finishListening();
}

export function shouldFinishVoiceOnLocalRelease({
  activationMode,
  isListening,
  isLocalChordHeld,
}: LocalVoiceReleaseState): boolean {
  return activationMode === 'local_hold' && isListening && !isLocalChordHeld;
}

export function shouldMuteSystemAudioForVoice(
  enabled: boolean,
  isHolding: boolean,
): boolean {
  return enabled && isHolding;
}

export function getPushToTalkPlatform(): PushToTalkPlatform {
  if (typeof navigator === 'undefined') return 'unsupported';
  return detectPushToTalkPlatform(navigator.platform, navigator.userAgent);
}
