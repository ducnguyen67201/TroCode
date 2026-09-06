import type * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  AppLanguage,
  AppPreferences,
  CuaStatus,
} from '../../../shared/contracts';
import {
  createPermissionChecklist,
  inspectMicrophonePermission,
  type PermissionState,
  requestScreenRecordingPermission,
  shouldConnectAfterPermissionRefresh,
} from '../../permission-onboarding';
import { EMPTY_COMPUTER_STATUS } from '../../runtime-status';

export function useSystemPermissions({
  membershipAccessAllowed,
  appLanguageDraft,
  classroomPetEnabledDraft,
  muteSystemAudioWhileSpeakingDraft,
  languageDraft,
  selectedVoiceMode,
  setAppPreferences,
  setPreferencesLoadError,
}: {
  membershipAccessAllowed: boolean;
  appLanguageDraft: AppLanguage;
  classroomPetEnabledDraft: boolean;
  muteSystemAudioWhileSpeakingDraft: boolean;
  languageDraft:
    | 'id'
    | 'en'
    | 'vi'
    | 'ar'
    | 'de'
    | 'es'
    | 'fr'
    | 'hi'
    | 'it'
    | 'ja'
    | 'ko'
    | 'ms'
    | 'nl'
    | 'pl'
    | 'pt'
    | 'ru'
    | 'th'
    | 'tr'
    | 'uk'
    | 'zh';
  selectedVoiceMode: 'task' | 'dictation';
  setAppPreferences: React.Dispatch<
    React.SetStateAction<AppPreferences | null>
  >;
  setPreferencesLoadError: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const [computerStatus, setComputerStatus] = useState<CuaStatus>(
    EMPTY_COMPUTER_STATUS,
  );

  const [isCheckingPermissions, setIsCheckingPermissions] = useState(true);

  const [isRequestingPermissions, setIsRequestingPermissions] = useState(false);

  const [computerStatusLoaded, setComputerStatusLoaded] = useState(false);

  const [microphonePermission, setMicrophonePermission] =
    useState<PermissionState>('checking');

  const [permissionError, setPermissionError] = useState<string | null>(null);

  const permissionRefreshIdRef = useRef(0);

  const refreshPermissions = useCallback(async () => {
    const refreshId = permissionRefreshIdRef.current + 1;
    permissionRefreshIdRef.current = refreshId;
    setIsCheckingPermissions(true);

    try {
      const [observedComputerStatus, nextMicrophonePermission] =
        await Promise.all([
          window.tro.getComputerStatus(),
          inspectMicrophonePermission(),
        ]);
      if (permissionRefreshIdRef.current !== refreshId) return;

      const nextComputerStatus = shouldConnectAfterPermissionRefresh(
        observedComputerStatus,
      )
        ? await window.tro.connectComputer()
        : observedComputerStatus;
      if (permissionRefreshIdRef.current !== refreshId) return;

      setComputerStatus(nextComputerStatus);
      setComputerStatusLoaded(true);
      setMicrophonePermission(nextMicrophonePermission);
      setPermissionError(null);
    } catch (statusError) {
      if (permissionRefreshIdRef.current !== refreshId) return;
      setComputerStatusLoaded(true);
      setPermissionError(
        statusError instanceof Error
          ? statusError.message
          : 'Tro could not check system permissions.',
      );
    } finally {
      if (permissionRefreshIdRef.current === refreshId) {
        setIsCheckingPermissions(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!membershipAccessAllowed) return;

    const handleWindowFocus = (): void => {
      queueMicrotask(() => void refreshPermissions());
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void refreshPermissions();
    };

    queueMicrotask(() => void refreshPermissions());
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      permissionRefreshIdRef.current += 1;
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [membershipAccessAllowed, refreshPermissions]);

  const permissionChecklist = useMemo(
    () =>
      createPermissionChecklist(
        computerStatus,
        microphonePermission,
        computerStatusLoaded,
      ),
    [computerStatus, computerStatusLoaded, microphonePermission],
  );

  const desktopReady =
    computerStatus.state === 'ready' && computerStatus.available;

  const enablePermissions = useCallback(async () => {
    setPermissionError(null);
    setIsRequestingPermissions(true);

    try {
      try {
        const preferences = await window.tro.updateAppPreferences({
          appLanguage: appLanguageDraft,
          classroomPetEnabled: classroomPetEnabledDraft,
          muteSystemAudioWhileSpeaking: muteSystemAudioWhileSpeakingDraft,
          primaryLanguage: languageDraft,
          voiceMode: selectedVoiceMode,
        });
        setAppPreferences(preferences);
        setPreferencesLoadError(null);
      } catch (saveError) {
        setPermissionError(
          saveError instanceof Error
            ? saveError.message
            : 'Tro could not save your language preference.',
        );
        return;
      }
    } finally {
      setIsRequestingPermissions(false);
    }
  }, [
    appLanguageDraft,
    classroomPetEnabledDraft,
    languageDraft,
    muteSystemAudioWhileSpeakingDraft,
    selectedVoiceMode,
    setAppPreferences,
    setPreferencesLoadError,
  ]);

  const openScreenRecordingSettings = useCallback(async () => {
    setPermissionError(null);
    setIsRequestingPermissions(true);
    try {
      setComputerStatus(await requestScreenRecordingPermission(window.tro));
      setComputerStatusLoaded(true);
    } catch (settingsError) {
      setPermissionError(
        settingsError instanceof Error
          ? settingsError.message
          : 'Tro could not request Screen Recording permission.',
      );
    } finally {
      setIsRequestingPermissions(false);
    }
  }, []);

  return {
    microphonePermission,
    permissionChecklist,
    computerStatus,
    permissionError,
    isCheckingPermissions,
    isRequestingPermissions,
    enablePermissions,
    openScreenRecordingSettings,
    refreshPermissions,
    desktopReady,
  };
}
