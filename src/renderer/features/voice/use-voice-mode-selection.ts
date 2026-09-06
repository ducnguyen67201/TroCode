import type * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';

import type {
  AppLanguage,
  AppPreferences,
  CompanionVoiceActivity,
  VoiceMode,
} from '../../../shared/contracts';
import type { PushToTalkPlatform } from '../../push-to-talk';
import type { VoiceTerminalDisposition } from '../../voice-route';
import {
  isVoiceModeToggleShortcut,
  nextVoiceMode,
} from '../../VoiceModeControl';

export function useVoiceModeSelection({
  selectedVoiceMode,
  setSelectedVoiceMode,
  appPreferences,
  setAppPreferences,
  reportError,
  voiceModeLocked,
  showVoiceTerminalActivity,
  appLanguageDraft,
  t,
  voicePlatform,
}: {
  selectedVoiceMode: 'task' | 'dictation';
  setSelectedVoiceMode: React.Dispatch<
    React.SetStateAction<'task' | 'dictation'>
  >;
  appPreferences: AppPreferences | null;
  setAppPreferences: React.Dispatch<
    React.SetStateAction<AppPreferences | null>
  >;
  reportError: (message: string) => void;
  voiceModeLocked: boolean;
  showVoiceTerminalActivity: (
    activity: CompanionVoiceActivity,
    durationMs: number,
    disposition?: VoiceTerminalDisposition,
  ) => void;
  appLanguageDraft: AppLanguage;
  t: (
    message: string,
    replacements?: Readonly<Record<string, string | number>>,
  ) => string;
  voicePlatform: PushToTalkPlatform;
}) {
  const voiceModeSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const selectVoiceMode = useCallback(
    (nextMode: VoiceMode): void => {
      if (nextMode === selectedVoiceMode) return;

      setSelectedVoiceMode(nextMode);
      if (!appPreferences) return;

      const nextPreferences: AppPreferences = {
        ...appPreferences,
        voiceMode: nextMode,
      };
      setAppPreferences(nextPreferences);
      if (!nextPreferences.primaryLanguage) return;

      const request = {
        ...nextPreferences,
        primaryLanguage: nextPreferences.primaryLanguage,
      };
      voiceModeSaveQueueRef.current = voiceModeSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const saved = await window.tro.updateAppPreferences(request);
          setAppPreferences((current) =>
            current?.voiceMode === nextMode ? saved : current,
          );
        })
        .catch((saveError: unknown) => {
          reportError(
            saveError instanceof Error
              ? saveError.message
              : 'Tro could not save the voice mode.',
          );
        });
    },
    [
      appPreferences,
      reportError,
      selectedVoiceMode,
      setAppPreferences,
      setSelectedVoiceMode,
    ],
  );

  useEffect(
    () =>
      window.tro.onVoiceModeToggleRequested(() => {
        if (voiceModeLocked) return;

        const nextMode = nextVoiceMode(selectedVoiceMode);
        selectVoiceMode(nextMode);
        showVoiceTerminalActivity(
          {
            appLanguage: appLanguageDraft,
            destination:
              nextMode === 'task'
                ? { kind: 'task', label: t('Tro task') }
                : { kind: 'tro_composer', label: t('Tro composer') },
            mode: nextMode,
            phase: 'mode_selected',
            transcript: '',
          },
          1_200,
        );
      }),
    [
      appLanguageDraft,
      selectVoiceMode,
      selectedVoiceMode,
      showVoiceTerminalActivity,
      t,
      voiceModeLocked,
    ],
  );

  useEffect(() => {
    const handleVoiceModeToggle = (event: KeyboardEvent): void => {
      if (
        event.repeat ||
        voiceModeLocked ||
        !isVoiceModeToggleShortcut(event, voicePlatform)
      ) {
        return;
      }
      event.preventDefault();
      selectVoiceMode(nextVoiceMode(selectedVoiceMode));
    };

    window.addEventListener('keydown', handleVoiceModeToggle);
    return () => window.removeEventListener('keydown', handleVoiceModeToggle);
  }, [selectVoiceMode, selectedVoiceMode, voiceModeLocked, voicePlatform]);

  return { selectVoiceMode };
}
