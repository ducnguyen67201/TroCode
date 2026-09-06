import type { useMembershipActivation } from '../features/account/use-membership-activation';
import type { useMembershipStatus } from '../features/account/use-membership-status';
import type { useOrganization } from '../features/account/use-organization';
import type { useCompanionCustomization } from '../features/companion/use-companion-customization';
import type { useAppPreferences } from '../features/settings/use-app-preferences';
import type { useAppUpdates } from '../features/settings/use-app-updates';
import type { PushToTalkPlatform } from '../push-to-talk';
import { SettingsPage } from '../SettingsPage';

interface AppSettingsProps {
  preferences: ReturnType<typeof useAppPreferences>;
  updates: ReturnType<typeof useAppUpdates>;
  membership: ReturnType<typeof useMembershipStatus>;
  activation: ReturnType<typeof useMembershipActivation>;
  companion: ReturnType<typeof useCompanionCustomization>;
  organizationState: ReturnType<typeof useOrganization>;
  voicePlatform: PushToTalkPlatform;
  closeSettings: () => void;
  onOpenOrganization: () => void;
}

// Compose settings across resource owners while drafts remain mounted in App.
export function AppSettings({
  preferences,
  updates,
  membership,
  activation,
  companion,
  organizationState,
  voicePlatform,
  closeSettings,
  onOpenOrganization,
}: AppSettingsProps) {
  return (
    <SettingsPage
      appLanguage={preferences.appLanguageDraft}
      appUpdateError={updates.appUpdateError}
      appUpdateStatus={updates.appUpdateStatus}
      classroomPetEnabled={preferences.classroomPetEnabledDraft}
      companionBusy={companion.companionBusy}
      companionError={companion.companionError}
      companionStatus={companion.companionStatus}
      error={preferences.settingsError}
      hasChanges={
        preferences.appPreferences?.appLanguage !==
          preferences.appLanguageDraft ||
        preferences.appPreferences?.classroomPetEnabled !==
          preferences.classroomPetEnabledDraft ||
        preferences.appPreferences?.muteSystemAudioWhileSpeaking !==
          preferences.muteSystemAudioWhileSpeakingDraft ||
        preferences.appPreferences?.primaryLanguage !==
          preferences.languageDraft
      }
      isSaving={preferences.isSavingPreferences}
      isActivatingMembership={activation.isActivatingMembership}
      isUpdatingApp={updates.isUpdatingApp}
      membershipError={membership.membershipError}
      membershipStatus={membership.membershipStatus}
      onActivateCompanion={companion.activateCompanion}
      onActivateSavedCompanion={companion.activateSavedCompanion}
      organization={organizationState.organization}
      organizationError={organizationState.organizationError}
      isLoadingOrganization={organizationState.isLoadingOrganization}
      onAppLanguageChange={(language) => {
        preferences.setAppLanguageDraft(language);
        preferences.setSettingsError(null);
        preferences.setSettingsSaveMessage(null);
      }}
      onCheckForUpdates={() => void updates.checkForAppUpdates()}
      onClassroomPetEnabledChange={(enabled) => {
        preferences.setClassroomPetEnabledDraft(enabled);
        preferences.setSettingsError(null);
        preferences.setSettingsSaveMessage(null);
      }}
      onGenerateCompanion={companion.generateCompanion}
      onLanguageChange={(language) => {
        preferences.setLanguageDraft(language);
        preferences.setSettingsError(null);
        preferences.setSettingsSaveMessage(null);
      }}
      onActivateMembership={(code) => void activation.activateMembership(code)}
      onClose={closeSettings}
      onMuteSystemAudioWhileSpeakingChange={(enabled) => {
        preferences.setMuteSystemAudioWhileSpeakingDraft(enabled);
        preferences.setSettingsError(null);
        preferences.setSettingsSaveMessage(null);
      }}
      onOpenOrganization={onOpenOrganization}
      onRefreshOrganization={() => void organizationState.refreshOrganization()}
      onRestartAndInstall={() => void updates.restartAndInstallAppUpdate()}
      onSave={() => void preferences.saveSettings()}
      onUseDefaultCompanion={companion.useDefaultCompanion}
      primaryLanguage={preferences.languageDraft}
      saveMessage={preferences.settingsSaveMessage}
      muteSystemAudioWhileSpeaking={
        preferences.muteSystemAudioWhileSpeakingDraft
      }
      systemAudioMuteSupported={voicePlatform === 'macos'}
    />
  );
}
