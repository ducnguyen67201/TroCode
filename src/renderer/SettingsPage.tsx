import { useEffect, useRef, useState } from 'react';

import { translate } from './app-language';
import { AboutSettingsSection } from './features/settings/AboutSettingsSection';
import { AccountSettingsSection } from './features/settings/AccountSettingsSection';
import { CompanionSettingsSection } from './features/settings/CompanionSettingsSection';
import { ConnectionsSettingsSection } from './features/settings/ConnectionsSettingsSection';
import { GeneralSettingsSection } from './features/settings/GeneralSettingsSection';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionDefinition,
  SettingsSectionIcon,
  type SettingsSectionId,
} from './features/settings/settings-navigation';
import type { SettingsPageProps } from './features/settings/settings-types';
import { VoiceSettingsSection } from './features/settings/VoiceSettingsSection';

export function SettingsPage({
  appLanguage,
  appUpdateError,
  appUpdateStatus,
  classroomPetEnabled,
  companionBusy,
  companionError,
  companionStatus,
  error,
  hasChanges,
  isSaving,
  isActivatingMembership,
  isUpdatingApp,
  membershipError,
  membershipStatus,
  organization,
  organizationError,
  isLoadingOrganization,
  muteSystemAudioWhileSpeaking,
  onActivateCompanion,
  onActivateSavedCompanion,
  onAppLanguageChange,
  onCheckForUpdates,
  onClassroomPetEnabledChange,
  onGenerateCompanion,
  onLanguageChange,
  onActivateMembership,
  onMuteSystemAudioWhileSpeakingChange,
  onClose,
  onOpenOrganization,
  onRefreshOrganization,
  onRestartAndInstall,
  onSave,
  onUseDefaultCompanion,
  primaryLanguage,
  saveMessage,
  systemAudioMuteSupported,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>('general');
  const activeNavigationItemRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const t = (message: string, replacements?: Record<string, string | number>) =>
    translate(appLanguage, message, replacements);
  const activeSectionDefinition =
    SETTINGS_SECTIONS.find((section) => section.id === activeSection) ??
    (SETTINGS_SECTIONS[0] as SettingsSectionDefinition);
  const showsPreferenceSave =
    activeSection === 'general' ||
    activeSection === 'voice' ||
    activeSection === 'companion';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const animationFrame = window.requestAnimationFrame(() => {
      dialog.dataset.ready = 'true';
      activeNavigationItemRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      delete dialog.dataset.ready;
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [activeSection]);

  return (
    <dialog
      aria-label={t('Settings')}
      aria-modal="true"
      className="settings-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
      role="dialog"
    >
      <aside className="settings-dialog__rail">
        <div className="settings-dialog__masthead">
          <span
            className="settings-dialog__registration-mark"
            aria-hidden="true"
          />
          <div>
            <strong>Tro</strong>
            <span>{t('Preferences')}</span>
          </div>
        </div>

        <nav
          aria-label={t('Settings sections')}
          className="settings-dialog__nav"
        >
          {(['Preferences', 'Workspace', 'Product'] as const).map((group) => (
            <div className="settings-dialog__nav-group" key={group}>
              <span>{t(group)}</span>
              {SETTINGS_SECTIONS.filter(
                (section) => section.group === group,
              ).map((section) => {
                const isActive = activeSection === section.id;
                return (
                  <button
                    aria-controls={`settings-panel-${section.id}`}
                    aria-current={isActive ? 'page' : undefined}
                    className="settings-dialog__nav-item"
                    id={`settings-nav-${section.id}`}
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    ref={isActive ? activeNavigationItemRef : undefined}
                    type="button"
                  >
                    <span className="settings-dialog__nav-number">
                      {section.number}
                    </span>
                    <SettingsSectionIcon name={section.id} />
                    <span>{t(section.label)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="settings-dialog__rail-footer">
          <span className="safety-indicator" aria-hidden="true" />
          <div>
            <strong>{t('Scoped execution')}</strong>
            <span>
              {t(
                'Registered tools run automatically; OS permissions and Workspace bounds still apply',
              )}
            </span>
          </div>
        </div>
      </aside>

      <div
        className={`settings-dialog__content ${
          showsPreferenceSave ? 'settings-dialog__content--with-save' : ''
        }`}
      >
        <header className="settings-dialog__header">
          <div className="settings-dialog__folio" aria-hidden="true">
            <span>{activeSectionDefinition.number}</span>
            <i />
          </div>
          <div className="settings-dialog__title">
            <p className="eyebrow">{t('Settings')}</p>
            <h1 id="settings-active-section-heading">
              {t(activeSectionDefinition.label)}
            </h1>
            <p>{t(activeSectionDefinition.description)}</p>
          </div>
          <button
            aria-label={t('Close settings')}
            className="settings-dialog__close"
            onClick={onClose}
            title={t('Close settings')}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="settings-dialog__scroller" ref={scrollerRef}>
          <GeneralSettingsSection
            activeSection={activeSection}
            appLanguage={appLanguage}
            onAppLanguageChange={onAppLanguageChange}
          />

          <VoiceSettingsSection
            activeSection={activeSection}
            appLanguage={appLanguage}
            muteSystemAudioWhileSpeaking={muteSystemAudioWhileSpeaking}
            onLanguageChange={onLanguageChange}
            onMuteSystemAudioWhileSpeakingChange={
              onMuteSystemAudioWhileSpeakingChange
            }
            primaryLanguage={primaryLanguage}
            systemAudioMuteSupported={systemAudioMuteSupported}
          />

          <CompanionSettingsSection
            activeSection={activeSection}
            appLanguage={appLanguage}
            classroomPetEnabled={classroomPetEnabled}
            companionBusy={companionBusy}
            companionError={companionError}
            companionStatus={companionStatus}
            onActivateCompanion={onActivateCompanion}
            onActivateSavedCompanion={onActivateSavedCompanion}
            onClassroomPetEnabledChange={onClassroomPetEnabledChange}
            onGenerateCompanion={onGenerateCompanion}
            onUseDefaultCompanion={onUseDefaultCompanion}
          />

          <ConnectionsSettingsSection
            activeSection={activeSection}
            appLanguage={appLanguage}
          />

          <AccountSettingsSection
            activeSection={activeSection}
            appLanguage={appLanguage}
            isActivatingMembership={isActivatingMembership}
            membershipError={membershipError}
            membershipStatus={membershipStatus}
            organization={organization}
            organizationError={organizationError}
            isLoadingOrganization={isLoadingOrganization}
            onActivateMembership={onActivateMembership}
            onOpenOrganization={onOpenOrganization}
            onRefreshOrganization={onRefreshOrganization}
          />

          <AboutSettingsSection
            activeSection={activeSection}
            appLanguage={appLanguage}
            appUpdateStatus={appUpdateStatus}
            onCheckForUpdates={onCheckForUpdates}
            onRestartAndInstall={onRestartAndInstall}
            appUpdateError={appUpdateError}
            isUpdatingApp={isUpdatingApp}
          />
        </div>

        {showsPreferenceSave && (
          <footer className="settings-save-shelf">
            <div aria-live="polite">
              {(error || saveMessage) && (
                <p
                  className={`settings-feedback ${
                    error ? 'settings-feedback--error' : ''
                  }`}
                  role={error ? 'alert' : 'status'}
                >
                  {error ?? saveMessage}
                </p>
              )}
            </div>
            <button
              className="primary-button"
              disabled={isSaving || !hasChanges}
              onClick={onSave}
              type="button"
            >
              {isSaving
                ? t('Saving…')
                : hasChanges
                  ? t('Save preferences')
                  : t('Saved')}
            </button>
          </footer>
        )}
      </div>
    </dialog>
  );
}
