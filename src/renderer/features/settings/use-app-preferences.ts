import { useCallback, useEffect, useState } from 'react';

import type {
  AppLanguage,
  AppPreferences,
  PrimaryLanguage,
  VoiceMode,
} from '../../../shared/contracts';
import { appLanguageLabel, translate } from '../../app-language';
import { primaryLanguageLabel } from '../../language-options';

export function useAppPreferences() {
  const [selectedVoiceMode, setSelectedVoiceMode] =
    useState<VoiceMode>('dictation');

  const [appPreferences, setAppPreferences] = useState<AppPreferences | null>(
    null,
  );

  const [languageDraft, setLanguageDraft] = useState<PrimaryLanguage>('en');

  const [appLanguageDraft, setAppLanguageDraft] = useState<AppLanguage>('en');

  const [classroomPetEnabledDraft, setClassroomPetEnabledDraft] =
    useState(true);

  const [
    muteSystemAudioWhileSpeakingDraft,
    setMuteSystemAudioWhileSpeakingDraft,
  ] = useState(false);

  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  const [preferencesLoadError, setPreferencesLoadError] = useState<
    string | null
  >(null);

  const [isSavingPreferences, setIsSavingPreferences] = useState(false);

  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [settingsSaveMessage, setSettingsSaveMessage] = useState<string | null>(
    null,
  );

  useEffect(() => {
    void window.tro
      .getAppPreferences()
      .then((preferences) => {
        setAppPreferences(preferences);
        setAppLanguageDraft(preferences.appLanguage);
        setClassroomPetEnabledDraft(preferences.classroomPetEnabled);
        setMuteSystemAudioWhileSpeakingDraft(
          preferences.muteSystemAudioWhileSpeaking,
        );
        setSelectedVoiceMode(preferences.voiceMode);
        if (preferences.primaryLanguage) {
          setLanguageDraft(preferences.primaryLanguage);
        }
        setPreferencesLoadError(null);
      })
      .catch((preferencesError: unknown) => {
        setPreferencesLoadError(
          preferencesError instanceof Error
            ? preferencesError.message
            : 'Tro could not load your language preference.',
        );
      })
      .finally(() => setPreferencesLoaded(true));
  }, []);

  useEffect(() => {
    document.documentElement.lang = appLanguageDraft;
  }, [appLanguageDraft]);

  const saveSettings = useCallback(async () => {
    setIsSavingPreferences(true);
    setSettingsError(null);
    setSettingsSaveMessage(null);
    try {
      const preferences = await window.tro.updateAppPreferences({
        appLanguage: appLanguageDraft,
        classroomPetEnabled: classroomPetEnabledDraft,
        muteSystemAudioWhileSpeaking: muteSystemAudioWhileSpeakingDraft,
        primaryLanguage: languageDraft,
        voiceMode: selectedVoiceMode,
      });
      setAppPreferences(preferences);
      setSettingsSaveMessage(
        translate(
          appLanguageDraft,
          'App controls will use {appLanguage}; new voice turns will use {spokenLanguage}.',
          {
            appLanguage: appLanguageLabel(appLanguageDraft),
            spokenLanguage: primaryLanguageLabel(
              languageDraft,
              appLanguageDraft,
            ),
          },
        ),
      );
    } catch (saveError) {
      setSettingsError(
        saveError instanceof Error
          ? saveError.message
          : 'Tro could not save your language preference.',
      );
    } finally {
      setIsSavingPreferences(false);
    }
  }, [
    appLanguageDraft,
    classroomPetEnabledDraft,
    languageDraft,
    muteSystemAudioWhileSpeakingDraft,
    selectedVoiceMode,
  ]);

  return {
    appLanguageDraft,
    appPreferences,
    preferencesLoaded,
    selectedVoiceMode,
    setSelectedVoiceMode,
    setAppPreferences,
    classroomPetEnabledDraft,
    muteSystemAudioWhileSpeakingDraft,
    languageDraft,
    setPreferencesLoadError,
    preferencesLoadError,
    setLanguageDraft,
    settingsError,
    isSavingPreferences,
    setAppLanguageDraft,
    setSettingsError,
    setSettingsSaveMessage,
    setClassroomPetEnabledDraft,
    setMuteSystemAudioWhileSpeakingDraft,
    saveSettings,
    settingsSaveMessage,
  };
}
