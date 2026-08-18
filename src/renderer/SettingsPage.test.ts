import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AppUpdateStatus } from '../shared/contracts';

import { SettingsPage } from './SettingsPage';

function renderSettings(appUpdateStatus: AppUpdateStatus): string {
  return renderToStaticMarkup(
    SettingsPage({
      approvalMode: 'ask_every_time',
      appLanguage: 'en',
      appUpdateError: null,
      appUpdateStatus,
      error: null,
      fullyApprovedAcknowledged: false,
      hasChanges: false,
      isSaving: false,
      isUpdatingApp: false,
      muteSystemAudioWhileSpeaking: false,
      onAppLanguageChange: vi.fn(),
      onApprovalModeChange: vi.fn(),
      onCheckForUpdates: vi.fn(),
      onLanguageChange: vi.fn(),
      onFullyApprovedAcknowledgedChange: vi.fn(),
      onMuteSystemAudioWhileSpeakingChange: vi.fn(),
      onRestartAndInstall: vi.fn(),
      onSave: vi.fn(),
      primaryLanguage: 'en',
      saveMessage: null,
      systemAudioMuteSupported: true,
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
    expect(markup).toContain('App language');
    expect(markup).toContain('Spoken language');
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

describe('SettingsPage app language', () => {
  it('renders translated controls when Vietnamese is selected', () => {
    const markup = renderToStaticMarkup(
      SettingsPage({
        approvalMode: 'fully_approved',
        appLanguage: 'vi',
        appUpdateError: null,
        appUpdateStatus: {
          currentVersion: '0.1.0',
          message: 'No updates found.',
          phase: 'up_to_date',
          targetVersion: null,
        },
        error: null,
        fullyApprovedAcknowledged: true,
        hasChanges: true,
        isSaving: false,
        isUpdatingApp: false,
        muteSystemAudioWhileSpeaking: true,
        onAppLanguageChange: vi.fn(),
        onApprovalModeChange: vi.fn(),
        onCheckForUpdates: vi.fn(),
        onLanguageChange: vi.fn(),
        onFullyApprovedAcknowledgedChange: vi.fn(),
        onMuteSystemAudioWhileSpeakingChange: vi.fn(),
        onRestartAndInstall: vi.fn(),
        onSave: vi.fn(),
        primaryLanguage: 'vi',
        saveMessage: null,
        systemAudioMuteSupported: true,
      }),
    );

    expect(markup).toContain('Cài đặt');
    expect(markup).toContain('Ngôn ngữ ứng dụng');
    expect(markup).toContain('Ngôn ngữ nói');
    expect(markup).toContain('Lưu tùy chọn');
    expect(markup).toContain('Tắt âm thanh khác khi đang nói');
    expect(markup).toContain('Phê duyệt hành động');
    expect(markup).toContain('Phê duyệt hoàn toàn');
  });
});

describe('SettingsPage approval mode', () => {
  it('defaults to Ask and describes exact cursor-card approval', () => {
    const markup = renderSettings({
      currentVersion: '0.1.0',
      message: 'No updates found.',
      phase: 'up_to_date',
      targetVersion: null,
    });

    expect(markup).toContain('Action approvals');
    expect(markup).toContain('Ask every time (recommended)');
    expect(markup).toContain('exact cursor-card approval');
    expect(markup).toMatch(
      /<input[^>]*name="approval-mode"[^>]*checked=""[^>]*value="ask_every_time"/u,
    );
    expect(markup).not.toContain('consequential actions may run automatically');
  });

  it('shows the Full warning and acknowledgement control', () => {
    const markup = renderToStaticMarkup(
      SettingsPage({
        approvalMode: 'fully_approved',
        appLanguage: 'en',
        appUpdateError: null,
        appUpdateStatus: {
          currentVersion: '0.1.0',
          message: 'No updates found.',
          phase: 'up_to_date',
          targetVersion: null,
        },
        error: null,
        fullyApprovedAcknowledged: false,
        hasChanges: true,
        isSaving: false,
        isUpdatingApp: false,
        muteSystemAudioWhileSpeaking: false,
        onAppLanguageChange: vi.fn(),
        onApprovalModeChange: vi.fn(),
        onCheckForUpdates: vi.fn(),
        onFullyApprovedAcknowledgedChange: vi.fn(),
        onLanguageChange: vi.fn(),
        onMuteSystemAudioWhileSpeakingChange: vi.fn(),
        onRestartAndInstall: vi.fn(),
        onSave: vi.fn(),
        primaryLanguage: 'en',
        saveMessage: null,
        systemAudioMuteSupported: true,
      }),
    );

    expect(markup).toContain('Fully approved');
    expect(markup).toContain('consequential actions may run automatically');
    expect(markup).toMatch(/disabled=""[^>]*type="submit"/u);
  });
});

describe('SettingsPage voice audio preference', () => {
  it('offers an opt-in macOS system audio mute control', () => {
    const markup = renderSettings({
      currentVersion: '0.1.0',
      message: 'No updates found.',
      phase: 'up_to_date',
      targetVersion: null,
    });

    expect(markup).toContain('Mute other audio while speaking');
    expect(markup).toContain('restore its previous mute state');
    expect(markup).toContain('type="checkbox"');
  });
});
