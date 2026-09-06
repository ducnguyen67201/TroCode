import { useEffect } from 'react';

import type {
  AppLanguage,
  AppPreferences,
  CompanionVoiceActivity,
} from '../../../shared/contracts';

import { shouldMuteSystemAudioForVoice } from './voice-input-policy';
import type { VoiceInputStatus } from './voice-input-types';

export function useVoiceFeedback({
  appPreferences,
  isVoiceShortcutHeld,
  reportError,
  voiceStatus,
  voiceActivityOverride,
  voiceMode,
  appLanguageDraft,
  voiceDestination,
  voiceTranscript,
}: {
  appPreferences: AppPreferences | null;
  isVoiceShortcutHeld: boolean;
  reportError: (message: string) => void;
  voiceStatus: VoiceInputStatus;
  voiceActivityOverride: CompanionVoiceActivity | null;
  voiceMode: 'task' | 'dictation' | null;
  appLanguageDraft: AppLanguage;
  voiceDestination: CompanionVoiceActivity['destination'];
  voiceTranscript: string;
}) {
  const shouldMuteSystemAudio = shouldMuteSystemAudioForVoice(
    appPreferences?.muteSystemAudioWhileSpeaking ?? false,
    isVoiceShortcutHeld,
  );

  useEffect(() => {
    void window.tro
      .setVoiceAudioDucking({ active: shouldMuteSystemAudio })
      .catch((duckingError: unknown) => {
        reportError(
          duckingError instanceof Error
            ? duckingError.message
            : 'Tro could not change the system audio mute state.',
        );
      });
  }, [reportError, shouldMuteSystemAudio]);

  useEffect(
    () => () => {
      void window.tro
        .setVoiceAudioDucking({ active: false })
        .catch((duckingError: unknown) => {
          console.error(
            '[voice] Could not restore system audio during cleanup.',
            duckingError,
          );
        });
    },
    [],
  );

  useEffect(() => {
    const voiceActive =
      voiceStatus === 'requesting_permission' ||
      voiceStatus === 'listening' ||
      voiceStatus === 'processing' ||
      voiceStatus === 'committing';
    const activity =
      voiceActivityOverride ??
      (voiceActive && voiceMode
        ? {
            appLanguage: appLanguageDraft,
            destination: voiceDestination,
            mode: voiceMode,
            phase: voiceStatus,
            transcript: voiceTranscript,
          }
        : null);
    void window.tro.setCompanionVoiceActivity(activity);
  }, [
    appLanguageDraft,
    voiceActivityOverride,
    voiceDestination,
    voiceMode,
    voiceStatus,
    voiceTranscript,
  ]);

  return {};
}
