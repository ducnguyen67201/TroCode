import { translate } from '../../app-language';

import { appUpdateActionLabel } from './app-update-presentation';
import { type SettingsSectionId } from './settings-navigation';
import type { SettingsPageProps } from './settings-types';

export function AboutSettingsSection({
  activeSection,
  appLanguage,
  appUpdateStatus,
  onCheckForUpdates,
  onRestartAndInstall,
  appUpdateError,
  isUpdatingApp,
}: Pick<
  SettingsPageProps,
  | 'appLanguage'
  | 'appUpdateStatus'
  | 'onCheckForUpdates'
  | 'onRestartAndInstall'
  | 'appUpdateError'
  | 'isUpdatingApp'
> & { activeSection: SettingsSectionId }) {
  const t = (message: string, replacements?: Record<string, string | number>) =>
    translate(appLanguage, message, replacements);
  const isUpdateReady = appUpdateStatus?.phase === 'ready';
  const updateActionDisabled =
    isUpdatingApp ||
    !appUpdateStatus ||
    ['unsupported', 'checking', 'downloading', 'installing'].includes(
      appUpdateStatus.phase,
    );
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
    <div
      aria-labelledby="settings-nav-about"
      className="settings-dialog__panel"
      hidden={activeSection !== 'about'}
      id="settings-panel-about"
      role="region"
    >
      <section
        className="settings-card settings-update-card"
        aria-labelledby="app-update-heading"
      >
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
            onClick={isUpdateReady ? onRestartAndInstall : onCheckForUpdates}
            type="button"
          >
            {updateActionLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
