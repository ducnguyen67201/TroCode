import type {
  AutonomyMode,
  AppLanguage,
  AppUpdateStatus,
  PrimaryLanguage,
} from '../shared/contracts';

import {
  APP_LANGUAGE_OPTIONS,
  appLanguageLabel,
  translate,
} from './app-language';
import {
  PRIMARY_LANGUAGE_OPTIONS,
  primaryLanguageLabel,
} from './language-options';

interface SettingsPageProps {
  autonomyMode: AutonomyMode;
  appLanguage: AppLanguage;
  appUpdateError: string | null;
  appUpdateStatus: AppUpdateStatus | null;
  error: string | null;
  hasChanges: boolean;
  isSaving: boolean;
  isUpdatingApp: boolean;
  muteSystemAudioWhileSpeaking: boolean;
  onAutonomyModeChange(mode: AutonomyMode): void;
  onAppLanguageChange(language: AppLanguage): void;
  onCheckForUpdates(): void;
  onLanguageChange(language: PrimaryLanguage): void;
  onMuteSystemAudioWhileSpeakingChange(enabled: boolean): void;
  onRestartAndInstall(): void;
  onSave(): void;
  primaryLanguage: PrimaryLanguage;
  saveMessage: string | null;
  systemAudioMuteSupported: boolean;
}

function appUpdateActionLabel(
  status: AppUpdateStatus | null,
  isUpdatingApp: boolean,
): string {
  if (isUpdatingApp) {
    return status?.phase === 'ready' ? 'Restarting…' : 'Checking…';
  }

  switch (status?.phase) {
    case 'ready':
      return 'Restart to update';
    case 'checking':
      return 'Checking…';
    case 'downloading':
      return 'Downloading update…';
    case 'installing':
      return 'Restarting…';
    case 'unsupported':
      return 'Updates unavailable';
    case undefined:
      return 'Loading…';
    default:
      return 'Check for updates';
  }
}

export function SettingsPage({
  autonomyMode,
  appLanguage,
  appUpdateError,
  appUpdateStatus,
  error,
  hasChanges,
  isSaving,
  isUpdatingApp,
  muteSystemAudioWhileSpeaking,
  onAutonomyModeChange,
  onAppLanguageChange,
  onCheckForUpdates,
  onLanguageChange,
  onMuteSystemAudioWhileSpeakingChange,
  onRestartAndInstall,
  onSave,
  primaryLanguage,
  saveMessage,
  systemAudioMuteSupported,
}: SettingsPageProps) {
  const t = (message: string, replacements?: Record<string, string | number>) =>
    translate(appLanguage, message, replacements);
  const isUpdateReady = appUpdateStatus?.phase === 'ready';
  const updateActionDisabled =
    isUpdatingApp ||
    !appUpdateStatus ||
    [
      'unsupported',
      'checking',
      'downloading',
      'installing',
    ].includes(appUpdateStatus.phase);
  const updateActionLabel = t(
    appUpdateActionLabel(appUpdateStatus, isUpdatingApp),
  );
  const updateMessage =
    appUpdateError ??
    appUpdateStatus?.message ??
    t('Loading application update status…');
  const updateHasError =
    Boolean(appUpdateError) || appUpdateStatus?.phase === 'error';

  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <div className="settings-heading">
        <p className="eyebrow">{t('Preferences')}</p>
        <h1 id="settings-heading">{t('Settings')}</h1>
        <p>
          {t(
            'Manage TroCode’s interface language, voice input, and installed application.',
          )}
        </p>
      </div>

      <form
        className="settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="settings-card__heading">
          <div>
            <p className="eyebrow">{t('App interface')}</p>
            <h2>{t('App language')}</h2>
          </div>
          <span className="settings-badge settings-badge--neutral">
            {appLanguageLabel(appLanguage)}
          </span>
        </div>

        <label className="language-field" htmlFor="settings-app-language">
          <span>{t('Interface language')}</span>
          <select
            id="settings-app-language"
            onChange={(event) =>
              onAppLanguageChange(event.target.value as AppLanguage)
            }
            value={appLanguage}
          >
            {APP_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <p className="settings-help">
          {t(
            'Choose the language used for navigation, settings, and other TroCode controls.',
          )}
        </p>

        <div className="settings-section-divider" />

        <div className="settings-card__heading">
          <div>
            <p className="eyebrow">{t('Task safety')}</p>
            <h2>{t('Autonomy')}</h2>
          </div>
          <span className="settings-badge settings-badge--neutral">
            {autonomyMode === 'balanced' ? t('Balanced') : t('Strict')}
          </span>
        </div>

        <label className="language-field" htmlFor="settings-autonomy-mode">
          <span>{t('Approval style')}</span>
          <select
            id="settings-autonomy-mode"
            onChange={(event) =>
              onAutonomyModeChange(event.target.value as AutonomyMode)
            }
            value={autonomyMode}
          >
            <option value="balanced">{t('Balanced')}</option>
            <option value="strict">{t('Strict')}</option>
          </select>
        </label>

        <p className="settings-help">
          {autonomyMode === 'balanced'
            ? t(
                'Routine, reversible actions continue automatically. TroCode still pauses for destructive, financial, privacy-sensitive, or permission-changing actions.',
              )
            : t(
                'Ask before routine desktop mutations as well as consequential actions.',
              )}
        </p>

        <div className="settings-section-divider" />

        <div className="settings-card__heading">
          <div>
            <p className="eyebrow">{t('Voice input')}</p>
            <h2>{t('Primary language')}</h2>
          </div>
          <span className="settings-badge">OpenAI Whisper</span>
        </div>

        <label className="language-field" htmlFor="settings-primary-language">
          <span>{t('Spoken language')}</span>
          <select
            id="settings-primary-language"
            onChange={(event) =>
              onLanguageChange(event.target.value as PrimaryLanguage)
            }
            value={primaryLanguage}
          >
            {PRIMARY_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {primaryLanguageLabel(option.code, appLanguage)}
              </option>
            ))}
          </select>
        </label>

        <p className="settings-help">
          {t(
            'TroCode sends this as a transcription hint so short or noisy speech is less likely to be interpreted as an unexpected language or script.',
          )}
        </p>

        <label className="settings-toggle">
          <input
            checked={muteSystemAudioWhileSpeaking}
            disabled={!systemAudioMuteSupported}
            onChange={(event) =>
              onMuteSystemAudioWhileSpeakingChange(event.target.checked)
            }
            type="checkbox"
          />
          <span>
            <strong>{t('Mute other audio while speaking')}</strong>
            <small>
              {systemAudioMuteSupported
                ? t(
                    'Mute system output while you hold the voice shortcut, then restore its previous mute state when you release.',
                  )
                : t('System audio muting is currently available on macOS.')}
            </small>
          </span>
        </label>

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

        <div className="settings-actions">
          <button
            className="primary-button"
            disabled={isSaving || !hasChanges}
            type="submit"
          >
            {isSaving
              ? t('Saving…')
              : hasChanges
                ? t('Save preferences')
                : t('Saved')}
          </button>
        </div>
      </form>

      <section className="settings-card settings-update-card" aria-labelledby="app-update-heading">
        <div className="settings-card__heading">
          <div>
            <p className="eyebrow">{t('About TroCode')}</p>
            <h2 id="app-update-heading">{t('Application update')}</h2>
          </div>
          <span className="settings-badge settings-badge--neutral">
            {appUpdateStatus
              ? t('Version {version}', {
                  version: appUpdateStatus.currentVersion,
                })
              : t('Loading version…')}
          </span>
        </div>

        <p
          className={`settings-help settings-update-message ${
            updateHasError ? 'settings-feedback--error' : ''
          }`}
          role={updateHasError ? 'alert' : 'status'}
          aria-live="polite"
        >
          {updateMessage}
        </p>

        <div className="settings-actions">
          <button
            className="primary-button"
            disabled={updateActionDisabled}
            onClick={
              isUpdateReady ? onRestartAndInstall : onCheckForUpdates
            }
            type="button"
          >
            {updateActionLabel}
          </button>
        </div>
      </section>
    </section>
  );
}
