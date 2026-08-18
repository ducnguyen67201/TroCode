import type {
  ApprovalMode,
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
  approvalMode: ApprovalMode;
  appLanguage: AppLanguage;
  appUpdateError: string | null;
  appUpdateStatus: AppUpdateStatus | null;
  error: string | null;
  hasChanges: boolean;
  fullyApprovedAcknowledged: boolean;
  isSaving: boolean;
  isUpdatingApp: boolean;
  muteSystemAudioWhileSpeaking: boolean;
  onAppLanguageChange(language: AppLanguage): void;
  onApprovalModeChange(mode: ApprovalMode): void;
  onCheckForUpdates(): void;
  onLanguageChange(language: PrimaryLanguage): void;
  onFullyApprovedAcknowledgedChange(acknowledged: boolean): void;
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
  approvalMode,
  appLanguage,
  appUpdateError,
  appUpdateStatus,
  error,
  fullyApprovedAcknowledged,
  hasChanges,
  isSaving,
  isUpdatingApp,
  muteSystemAudioWhileSpeaking,
  onAppLanguageChange,
  onApprovalModeChange,
  onCheckForUpdates,
  onLanguageChange,
  onFullyApprovedAcknowledgedChange,
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
  const approvalAcknowledgementRequired =
    approvalMode === 'fully_approved' && !fullyApprovedAcknowledged;

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

        <fieldset className="approval-mode-fieldset">
          <legend>{t('Action approvals')}</legend>
          <p className="settings-help">
            {t('Choose the default approval behavior for new tasks.')}
          </p>
          <label className="approval-mode-option">
            <input
              checked={approvalMode === 'ask_every_time'}
              name="approval-mode"
              onChange={() => onApprovalModeChange('ask_every_time')}
              type="radio"
              value="ask_every_time"
            />
            <span>
              <strong>{t('Ask every time (recommended)')}</strong>
              <small>
                {t('Require an exact cursor-card approval for host-required actions.')}
              </small>
            </span>
          </label>
          <label className="approval-mode-option">
            <input
              checked={approvalMode === 'fully_approved'}
              name="approval-mode"
              onChange={() => onApprovalModeChange('fully_approved')}
              type="radio"
              value="fully_approved"
            />
            <span>
              <strong>{t('Fully approved')}</strong>
              <small>
                {t('Run host-approved action types without a per-action prompt for new tasks.')}
              </small>
            </span>
          </label>
          {approvalMode === 'fully_approved' && (
            <div className="approval-mode-warning" role="status">
              <p>
                {t(
                  'TroCode will still enforce target grounding, budgets, blocked destinations, cancellation, and result verification.',
                )}
              </p>
              <label className="settings-toggle settings-toggle--warning">
                <input
                  checked={fullyApprovedAcknowledged}
                  onChange={(event) =>
                    onFullyApprovedAcknowledgedChange(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <strong>
                    {t('I understand consequential actions may run automatically.')}
                  </strong>
                </span>
              </label>
            </div>
          )}
        </fieldset>

        <div className="settings-section-divider" />

        <div className="settings-card__heading">
          <div>
            <p className="eyebrow">{t('Voice input')}</p>
            <h2>{t('Primary language')}</h2>
          </div>
          <span className="settings-badge">OpenAI Realtime</span>
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
            disabled={
              isSaving || !hasChanges || approvalAcknowledgementRequired
            }
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
