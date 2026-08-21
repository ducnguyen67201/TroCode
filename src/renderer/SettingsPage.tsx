import type {
  AutonomyMode,
  AppLanguage,
  AppUpdateStatus,
  MembershipStatus,
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
import { planTitle } from './usage-presentation';

interface SettingsPageProps {
  autonomyMode: AutonomyMode;
  appLanguage: AppLanguage;
  appUpdateError: string | null;
  appUpdateStatus: AppUpdateStatus | null;
  error: string | null;
  hasChanges: boolean;
  isSaving: boolean;
  isActivatingMembership: boolean;
  isUpdatingApp: boolean;
  membershipError: string | null;
  membershipStatus: MembershipStatus | null;
  muteSystemAudioWhileSpeaking: boolean;
  onAutonomyModeChange(mode: AutonomyMode): void;
  onAppLanguageChange(language: AppLanguage): void;
  onCheckForUpdates(): void;
  onLanguageChange(language: PrimaryLanguage): void;
  onActivateMembership(code: string): void;
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
    case 'up_to_date':
      return 'Check again';
    case 'error':
      return 'Try again';
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
  isActivatingMembership,
  isUpdatingApp,
  membershipError,
  membershipStatus,
  muteSystemAudioWhileSpeaking,
  onAutonomyModeChange,
  onAppLanguageChange,
  onCheckForUpdates,
  onLanguageChange,
  onActivateMembership,
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
            'Manage Tro’s interface language, voice input, and installed application.',
          )}
        </p>
      </div>

      <section
        className="settings-card settings-membership-card"
        aria-labelledby="membership-settings-heading"
      >
        <div className="settings-card__heading">
          <div>
            <p className="eyebrow">{t('Plan access')}</p>
            <h2 id="membership-settings-heading">{t('Promo code')}</h2>
          </div>
          <span className="settings-badge">
            {planTitle(membershipStatus?.plan ?? 'free')}
          </span>
        </div>

        <p className="settings-help">
          {membershipStatus?.plan === 'free'
            ? t(
                'You can keep using Tro Free. Enter a promo code here whenever you are ready to upgrade.',
              )
            : t('Your promo code is active on this account.')}
        </p>

        {membershipStatus?.plan === 'free' && (
          <form
            className="settings-promo-form"
            onSubmit={(event) => {
              event.preventDefault();
              const code = String(
                new FormData(event.currentTarget).get('promoCode') ?? '',
              ).trim();
              if (code.length >= 4) onActivateMembership(code);
            }}
          >
            <label className="settings-promo-field">
              <span>{t('Promo or access code')}</span>
              <input
                autoCapitalize="none"
                autoComplete="off"
                disabled={isActivatingMembership}
                minLength={4}
                name="promoCode"
                placeholder={t('Enter your promo code')}
                required
                spellCheck={false}
                type="text"
              />
            </label>
            <p
              className={`settings-feedback ${
                membershipError ? 'settings-feedback--error' : ''
              }`}
              role={membershipError ? 'alert' : 'status'}
            >
              {membershipError ?? membershipStatus.summary}
            </p>
            <div className="settings-actions">
              <button
                className="primary-button"
                disabled={isActivatingMembership}
                type="submit"
              >
                {isActivatingMembership
                  ? t('Checking…')
                  : t('Apply promo code')}
              </button>
            </div>
          </form>
        )}
      </section>

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
            'Choose the language used for navigation, settings, and other Tro controls.',
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
                'Routine, reversible actions continue automatically. Tro still pauses for destructive, financial, privacy-sensitive, or permission-changing actions.',
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
          <span className="settings-badge">{t('OpenAI GPT Transcribe')}</span>
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
            'Tro sends this as a transcription hint so short or noisy speech is less likely to be interpreted as an unexpected language or script.',
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
            <p className="eyebrow">{t('About Tro')}</p>
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
