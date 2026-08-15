import { describe, expect, it } from 'vitest';

import { systemPermissionSettingsUrl } from './system-permission-settings';

describe('system permission settings', () => {
  it('deep-links directly to Screen Recording on macOS', () => {
    expect(systemPermissionSettingsUrl('screen_recording', 'darwin')).toBe(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
  });

  it('rejects unsupported platforms', () => {
    expect(() =>
      systemPermissionSettingsUrl('screen_recording', 'win32'),
    ).toThrow('available on macOS only');
  });
});
