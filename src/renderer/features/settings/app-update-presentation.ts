import type { AppUpdateStatus } from '../../../shared/contracts';

export function appUpdateActionLabel(
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
