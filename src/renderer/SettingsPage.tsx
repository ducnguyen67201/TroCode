import type {
  AppUpdateStatus,
  PrimaryLanguage,
} from '../shared/contracts';

import { PRIMARY_LANGUAGE_OPTIONS } from './language-options';

interface SettingsPageProps {
  appUpdateError: string | null;
  appUpdateStatus: AppUpdateStatus | null;
  error: string | null;
  hasChanges: boolean;
  isSaving: boolean;
  isUpdatingApp: boolean;
  onCheckForUpdates(): void;
  onLanguageChange(language: PrimaryLanguage): void;
  onRestartAndInstall(): void;
  onSave(): void;
  primaryLanguage: PrimaryLanguage;
  saveMessage: string | null;
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
  appUpdateError,
  appUpdateStatus,
  error,
  hasChanges,
  isSaving,
  isUpdatingApp,
  onCheckForUpdates,
  onLanguageChange,
  onRestartAndInstall,
  onSave,
  primaryLanguage,
  saveMessage,
}: SettingsPageProps) {
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
  const updateActionLabel = appUpdateActionLabel(
    appUpdateStatus,
    isUpdatingApp,
  );
  const updateMessage =
    appUpdateError ??
    appUpdateStatus?.message ??
    'Loading application update status…';
  const updateHasError =
    Boolean(appUpdateError) || appUpdateStatus?.phase === 'error';

  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <div className="settings-heading">
        <p className="eyebrow">Preferences</p>
        <h1 id="settings-heading">Settings</h1>
        <p>
          Manage how TroCode interprets your voice and keep the installed
          application current.
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
            <p className="eyebrow">Voice input</p>
            <h2>Primary language</h2>
          </div>
          <span className="settings-badge">OpenAI Realtime</span>
        </div>

        <label className="language-field" htmlFor="settings-primary-language">
          <span>Spoken language</span>
          <select
            id="settings-primary-language"
            onChange={(event) =>
              onLanguageChange(event.target.value as PrimaryLanguage)
            }
            value={primaryLanguage}
          >
            {PRIMARY_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <p className="settings-help">
          TroCode sends this as a transcription hint so short or noisy speech is
          less likely to be interpreted as an unexpected language or script.
        </p>

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
            {isSaving ? 'Saving…' : hasChanges ? 'Save language' : 'Saved'}
          </button>
        </div>
      </form>

      <section className="settings-card settings-update-card" aria-labelledby="app-update-heading">
        <div className="settings-card__heading">
          <div>
            <p className="eyebrow">About TroCode</p>
            <h2 id="app-update-heading">Application update</h2>
          </div>
          <span className="settings-badge settings-badge--neutral">
            {appUpdateStatus
              ? `Version ${appUpdateStatus.currentVersion}`
              : 'Loading version…'}
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
