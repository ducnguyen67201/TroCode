import type { AutoUpdater } from 'electron';
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { AppUpdateService } from './app-update-service';

function createAutoUpdater(): {
  checkForUpdates: ReturnType<typeof vi.fn>;
  emitter: EventEmitter;
  quitAndInstall: ReturnType<typeof vi.fn>;
  setFeedURL: ReturnType<typeof vi.fn>;
  updater: AutoUpdater;
} {
  const emitter = new EventEmitter();
  const checkForUpdates = vi.fn();
  const quitAndInstall = vi.fn();
  const setFeedURL = vi.fn();
  const updater = Object.assign(emitter, {
    checkForUpdates,
    quitAndInstall,
    setFeedURL,
  }) as unknown as AutoUpdater;

  return {
    checkForUpdates,
    emitter,
    quitAndInstall,
    setFeedURL,
    updater,
  };
}

function createService(
  overrides: Partial<ConstructorParameters<typeof AppUpdateService>[0]> = {},
) {
  const autoUpdater = createAutoUpdater();
  const prepareToInstall = vi.fn(async () => undefined);
  const service = new AppUpdateService({
    architecture: 'arm64',
    currentVersion: '0.1.0',
    isPackaged: true,
    managedByMicrosoftStore: () => false,
    platform: 'darwin',
    prepareToInstall,
    repository: 'ducnguyen67201/TroCode',
    updater: autoUpdater.updater,
    ...overrides,
  });

  return { autoUpdater, prepareToInstall, service };
}

describe('AppUpdateService', () => {
  it('configures a platform and architecture-scoped HTTPS feed', () => {
    const { autoUpdater, service } = createService();

    expect(service.start()).toMatchObject({
      currentVersion: '0.1.0',
      phase: 'idle',
    });
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
      url: 'https://update.electronjs.org/ducnguyen67201/TroCode/darwin-arm64/0.1.0',
    });
  });

  it('does not configure native updates for development or Linux builds', () => {
    const development = createService({ isPackaged: false });
    const linux = createService({ platform: 'linux' });

    expect(development.service.start()).toMatchObject({
      phase: 'unsupported',
    });
    expect(linux.service.start()).toMatchObject({ phase: 'unsupported' });
    expect(development.autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(linux.autoUpdater.setFeedURL).not.toHaveBeenCalled();
  });

  it('leaves updates to Microsoft Store for an MSIX installation', async () => {
    const { autoUpdater, service } = createService({
      architecture: 'x64',
      managedByMicrosoftStore: () => true,
      platform: 'win32',
    });

    expect(service.start()).toMatchObject({
      message: 'Microsoft Store keeps this installation of TroCode updated.',
      phase: 'unsupported',
    });
    await expect(service.checkForUpdates()).resolves.toMatchObject({
      phase: 'unsupported',
    });
    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('does not check when the update feed could not be configured', async () => {
    const { autoUpdater, service } = createService();
    autoUpdater.setFeedURL.mockImplementation(() => {
      throw new Error('Feed unavailable.');
    });

    expect(service.start()).toMatchObject({ phase: 'error' });
    await expect(service.checkForUpdates()).resolves.toMatchObject({
      phase: 'error',
    });
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('moves through checking, downloading, and ready without duplicate checks', async () => {
    const { autoUpdater, service } = createService();
    const statuses: string[] = [];
    service.start();
    service.onStatusChange((status) => statuses.push(status.phase));

    await expect(service.checkForUpdates()).resolves.toMatchObject({
      phase: 'checking',
    });
    await service.checkForUpdates();
    autoUpdater.emitter.emit('update-available');
    autoUpdater.emitter.emit(
      'update-downloaded',
      {},
      '',
      'v0.2.0',
      new Date(),
      'https://example.invalid/update.zip',
    );

    expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
    expect(service.getStatus()).toMatchObject({
      phase: 'ready',
      targetVersion: 'v0.2.0',
    });
    expect(statuses).toEqual(['checking', 'downloading', 'ready']);
  });

  it('reports an up-to-date result and permits a later manual recheck', async () => {
    const { autoUpdater, service } = createService();
    service.start();

    await service.checkForUpdates();
    autoUpdater.emitter.emit('update-not-available');
    expect(service.getStatus()).toMatchObject({ phase: 'up_to_date' });

    await service.checkForUpdates();
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('surfaces updater failures without exposing native stack traces', () => {
    const { autoUpdater, service } = createService();
    service.start();

    autoUpdater.emitter.emit('error', new Error('x'.repeat(3_000)));

    expect(service.getStatus()).toMatchObject({
      message: 'TroCode could not check for updates. Please try again.',
      phase: 'error',
    });
    expect(service.getStatus().message).not.toContain('xxx');
  });

  it('resolves an exact GitHub release feed before checking on Windows', async () => {
    const resolveWindowsRelease = vi.fn(async () => ({
      feedUrl:
        'https://github.com/ducnguyen67201/TroCode/releases/download/v0.1.3-preview.8',
      targetVersion: '0.1.3',
    }));
    const { autoUpdater, service } = createService({
      architecture: 'x64',
      currentVersion: '0.1.1',
      platform: 'win32',
      resolveWindowsRelease,
    });

    expect(service.start()).toMatchObject({ phase: 'idle' });
    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
    await expect(service.checkForUpdates()).resolves.toMatchObject({
      phase: 'checking',
    });

    expect(resolveWindowsRelease).toHaveBeenCalledWith({
      currentVersion: '0.1.1',
      repository: 'ducnguyen67201/TroCode',
    });
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
      url: 'https://github.com/ducnguyen67201/TroCode/releases/download/v0.1.3-preview.8',
    });
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce();

    autoUpdater.emitter.emit('update-available');
    expect(service.getStatus()).toMatchObject({
      phase: 'downloading',
      targetVersion: '0.1.3',
    });
  });

  it('reports Windows as up to date when no newer compatible release exists', async () => {
    const resolveWindowsRelease = vi.fn(async () => null);
    const { autoUpdater, service } = createService({
      architecture: 'x64',
      currentVersion: '0.1.1',
      platform: 'win32',
      resolveWindowsRelease,
    });

    await expect(service.checkForUpdates()).resolves.toMatchObject({
      message: 'TroCode 0.1.1 is up to date.',
      phase: 'up_to_date',
    });
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('treats a native 404 as no published update instead of an app error', async () => {
    const resolveWindowsRelease = vi.fn(async () => ({
      feedUrl: 'https://example.invalid/release',
      targetVersion: '0.1.3',
    }));
    const { autoUpdater, service } = createService({
      architecture: 'x64',
      platform: 'win32',
      resolveWindowsRelease,
    });

    await service.checkForUpdates();
    autoUpdater.emitter.emit(
      'error',
      new Error('System.Net.WebException: The remote server returned 404'),
    );

    expect(service.getStatus()).toMatchObject({
      message: 'No published update is available for this installation yet.',
      phase: 'up_to_date',
    });
  });

  it('prepares application shutdown before restarting into a downloaded update', async () => {
    const { autoUpdater, prepareToInstall, service } = createService();
    service.start();
    await service.checkForUpdates();
    autoUpdater.emitter.emit(
      'update-downloaded',
      {},
      '',
      'v0.2.0',
      new Date(),
      'https://example.invalid/update.zip',
    );

    await service.restartAndInstall();

    expect(prepareToInstall).toHaveBeenCalledOnce();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledOnce();
    expect(prepareToInstall.mock.invocationCallOrder[0]).toBeLessThan(
      autoUpdater.quitAndInstall.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('rejects restart requests until an update has downloaded', async () => {
    const { autoUpdater, prepareToInstall, service } = createService();
    service.start();

    await expect(service.restartAndInstall()).rejects.toThrow(
      'No downloaded update is ready to install.',
    );
    expect(prepareToInstall).not.toHaveBeenCalled();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });
});
