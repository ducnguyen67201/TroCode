import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { DesktopApplicationLauncher } from './desktop-application-launcher';

describe('DesktopApplicationLauncher', () => {
  it('launches Chrome from the current Windows user installation', async () => {
    const localAppData = String.raw`C:\Users\Ada\AppData\Local`;
    const chromePath = path.win32.join(
      localAppData,
      'Google',
      'Chrome',
      'Application',
      'chrome.exe',
    );
    const openPath = vi.fn(async () => '');
    const launcher = new DesktopApplicationLauncher({
      environment: { LOCALAPPDATA: localAppData },
      homeDirectory: String.raw`C:\Users\Ada`,
      openPath,
      pathExists: async (candidate) => candidate === chromePath,
      platform: 'win32',
    });

    await launcher.launch('chrome');

    expect(openPath).toHaveBeenCalledWith(chromePath);
  });

  it('launches the system Chrome application on macOS', async () => {
    const openPath = vi.fn(async () => '');
    const launcher = new DesktopApplicationLauncher({
      environment: {},
      homeDirectory: '/Users/ada',
      openPath,
      pathExists: async (candidate) =>
        candidate === '/Applications/Google Chrome.app',
      platform: 'darwin',
    });

    await launcher.launch('chrome');

    expect(openPath).toHaveBeenCalledWith('/Applications/Google Chrome.app');
  });

  it('reports when Chrome is not installed in a supported location', async () => {
    const launcher = new DesktopApplicationLauncher({
      environment: { PATH: '/usr/local/bin:/usr/bin' },
      homeDirectory: '/home/ada',
      openPath: vi.fn(async () => ''),
      pathExists: async () => false,
      platform: 'linux',
    });

    await expect(launcher.launch('chrome')).rejects.toThrow(
      'Google Chrome is not installed in a supported location.',
    );
  });

  it('surfaces the operating-system launch error', async () => {
    const launcher = new DesktopApplicationLauncher({
      environment: {},
      homeDirectory: '/Users/ada',
      openPath: async () => 'The application cannot be opened.',
      pathExists: async () => true,
      platform: 'darwin',
    });

    await expect(launcher.launch('chrome')).rejects.toThrow(
      'Could not open Google Chrome: The application cannot be opened.',
    );
  });
});

