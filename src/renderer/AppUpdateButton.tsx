import type { AppLanguage, AppUpdateStatus } from '../shared/contracts';

import { translate } from './app-language';

interface AppUpdateButtonProps {
  appLanguage: AppLanguage;
  isUpdating: boolean;
  onRestartAndInstall(): void;
  status: AppUpdateStatus | null;
}

export function AppUpdateButton({
  appLanguage,
  isUpdating,
  onRestartAndInstall,
  status,
}: AppUpdateButtonProps) {
  if (
    !status ||
    !['downloading', 'ready', 'installing'].includes(status.phase)
  ) {
    return null;
  }

  const isReady = status.phase === 'ready' && !isUpdating;
  const label =
    status.phase === 'ready'
      ? translate(appLanguage, 'Restart to install Tro {version}', {
          version: status.targetVersion ?? translate(appLanguage, 'latest'),
        })
      : translate(
          appLanguage,
          status.phase === 'installing' ? 'Restarting…' : 'Downloading update…',
        );

  return (
    <button
      aria-label={label}
      className={`app-update-button app-update-button--${isReady ? 'ready' : 'busy'}`}
      disabled={!isReady}
      onClick={onRestartAndInstall}
      title={label}
      type="button"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 3v12" />
        <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
        <path d="M5 20h14" />
      </svg>
    </button>
  );
}
