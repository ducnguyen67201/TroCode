import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AppUpdateStatus } from '../shared/contracts';

import { AppUpdateButton } from './AppUpdateButton';

function renderButton(status: AppUpdateStatus): string {
  return renderToStaticMarkup(
    <AppUpdateButton
      appLanguage="en"
      isUpdating={false}
      onRestartAndInstall={vi.fn()}
      status={status}
    />,
  );
}

describe('AppUpdateButton', () => {
  it('stays out of the header when no update needs attention', () => {
    expect(
      renderButton({
        currentVersion: '0.1.1',
        message: 'TroCode 0.1.1 is up to date.',
        phase: 'up_to_date',
        targetVersion: null,
      }),
    ).toBe('');
  });

  it('shows non-interactive progress while an update downloads', () => {
    const markup = renderButton({
      currentVersion: '0.1.1',
      message: 'A newer version is downloading in the background…',
      phase: 'downloading',
      targetVersion: '0.1.3',
    });

    expect(markup).toContain('Downloading update…');
    expect(markup).toContain('disabled');
    expect(markup).toContain('app-update-button--busy');
  });

  it('offers a compact restart action once the update is ready', () => {
    const markup = renderButton({
      currentVersion: '0.1.1',
      message: 'TroCode 0.1.3 is ready to install.',
      phase: 'ready',
      targetVersion: '0.1.3',
    });

    expect(markup).toContain('Restart to install TroCode 0.1.3');
    expect(markup).toContain('app-update-button--ready');
    expect(markup).not.toContain('disabled');
  });
});
