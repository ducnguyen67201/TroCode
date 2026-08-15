import type { SystemPermission } from '../shared/contracts';

const MACOS_PERMISSION_PANES: Record<SystemPermission, string> = {
  accessibility: 'Privacy_Accessibility',
  microphone: 'Privacy_Microphone',
  screen_recording: 'Privacy_ScreenCapture',
};

export function systemPermissionSettingsUrl(
  permission: SystemPermission,
  platform = process.platform,
): string {
  if (platform !== 'darwin') {
    throw new Error('Direct permission settings are currently available on macOS only.');
  }

  return `x-apple.systempreferences:com.apple.preference.security?${MACOS_PERMISSION_PANES[permission]}`;
}
