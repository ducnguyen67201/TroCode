import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AppUpdateStatus } from '../shared/contracts';

import { SettingsPage } from './SettingsPage';

function renderSettings(appUpdateStatus: AppUpdateStatus): string {
  return renderToStaticMarkup(
    SettingsPage({
      appUpdateError: null,
      appUpdateStatus,
      error: null,
      hasChanges: false,
      isSaving: false,
      isUpdatingApp: false,
      onCheckForUpdates: vi.fn(),
      onLanguageChange: vi.fn(),
      onRestartAndInstall: vi.fn(),
      onSave: vi.fn(),
      primaryLanguage: 'en',
      saveMessage: null,
    }),
  );
}

describe('SettingsPage application updates', () => {
  it('offers a manual update check with the installed version', () => {
    const markup = renderSettings({
      currentVersion: '0.1.0',
      message: 'Check whether a newer version of TroCode is available.',
      phase: 'idle',
      targetVersion: null,
    });

    expect(markup).toContain('Application update');
    expect(markup).toContain('Version 0.1.0');
    expect(markup).toContain('Check for updates');
  });

  it('offers restart only after an update is ready', () => {
    const markup = renderSettings({
      currentVersion: '0.1.0',
      message: 'Version v0.2.0 is ready to install.',
      phase: 'ready',
      targetVersion: 'v0.2.0',
    });

    expect(markup).toContain('Restart to update');
    expect(markup).toContain('v0.2.0');
  });

  it('disables the action on unsupported platforms', () => {
    const markup = renderSettings({
      currentVersion: '0.1.0',
      message: 'Use your Linux package manager to update TroCode.',
      phase: 'unsupported',
      targetVersion: null,
    });

    expect(markup).toContain('Updates unavailable');
    expect(markup).toContain('disabled');
  });
});
