import type {
  AppLanguage,
  AppUpdateStatus,
  CompanionCustomizationStatus,
  GenerateCompanionImageRequest,
  MembershipStatus,
  OrganizationSummary,
  PrimaryLanguage,
} from '../../../shared/contracts';
import type { CompanionCustomizationBusy } from '../companion/customization-types';

export interface SettingsPageProps {
  appLanguage: AppLanguage;
  appUpdateError: string | null;
  appUpdateStatus: AppUpdateStatus | null;
  classroomPetEnabled: boolean;
  companionBusy: CompanionCustomizationBusy;
  companionError: string | null;
  companionStatus: CompanionCustomizationStatus | null;
  error: string | null;
  hasChanges: boolean;
  isSaving: boolean;
  isActivatingMembership: boolean;
  isUpdatingApp: boolean;
  membershipError: string | null;
  membershipStatus: MembershipStatus | null;
  organization: OrganizationSummary | null;
  organizationError: string | null;
  isLoadingOrganization: boolean;
  muteSystemAudioWhileSpeaking: boolean;
  onAppLanguageChange(language: AppLanguage): void;
  onActivateCompanion(candidateId: string): Promise<void>;
  onActivateSavedCompanion(companionId: string): Promise<void>;
  onCheckForUpdates(): void;
  onClassroomPetEnabledChange(enabled: boolean): void;
  onGenerateCompanion(request: GenerateCompanionImageRequest): Promise<boolean>;
  onLanguageChange(language: PrimaryLanguage): void;
  onActivateMembership(code: string): void;
  onMuteSystemAudioWhileSpeakingChange(enabled: boolean): void;
  onClose(): void;
  onOpenOrganization(): void;
  onRefreshOrganization(): void;
  onRestartAndInstall(): void;
  onSave(): void;
  onUseDefaultCompanion(): Promise<void>;
  primaryLanguage: PrimaryLanguage;
  saveMessage: string | null;
  systemAudioMuteSupported: boolean;
}
