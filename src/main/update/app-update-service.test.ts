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

  it('does not check when the update feed could not be configured', () => {
    const { autoUpdater, service } = createService();
    autoUpdater.setFeedURL.mockImplementation(() => {
      throw new Error('Feed unavailable.');
    });

    expect(service.start()).toMatchObject({ phase: 'error' });
    expect(service.checkForUpdates()).toMatchObject({ phase: 'error' });
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('moves through checking, downloading, and ready without duplicate checks', () => {
    const { autoUpdater, service } = createService();
    const statuses: string[] = [];
    service.start();
    service.onStatusChange((status) => statuses.push(status.phase));

    expect(service.checkForUpdates()).toMatchObject({ phase: 'checking' });
    service.checkForUpdates();
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

  it('reports an up-to-date result and permits a later manual recheck', () => {
    const { autoUpdater, service } = createService();
    service.start();

    service.checkForUpdates();
    autoUpdater.emitter.emit('update-not-available');
    expect(service.getStatus()).toMatchObject({ phase: 'up_to_date' });

    service.checkForUpdates();
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('surfaces updater failures without exposing an unbounded message', () => {
    const { autoUpdater, service } = createService();
    service.start();

    autoUpdater.emitter.emit('error', new Error('x'.repeat(3_000)));

    expect(service.getStatus()).toMatchObject({ phase: 'error' });
    expect(service.getStatus().message.length).toBeLessThanOrEqual(1_000);
  });

  it('prepares application shutdown before restarting into a downloaded update', async () => {
    const { autoUpdater, prepareToInstall, service } = createService();
    service.start();
    service.checkForUpdates();
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
