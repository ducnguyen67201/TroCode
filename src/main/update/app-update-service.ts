import type { AutoUpdater } from 'electron';

import {
  AppUpdateStatusSchema,
  type AppUpdateStatus,
} from '../../shared/contracts';

const ELECTRON_UPDATE_SERVER = 'https://update.electronjs.org';
const MAX_UPDATE_ERROR_LENGTH = 1_000;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

interface AppUpdateServiceOptions {
  architecture: string;
  currentVersion: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  prepareToInstall(): Promise<void> | void;
  repository: string;
  updater: AutoUpdater;
}

type AppUpdateStatusListener = (status: AppUpdateStatus) => void;

function initialStatus(
  options: Pick<
    AppUpdateServiceOptions,
    'currentVersion' | 'isPackaged' | 'platform'
  >,
): AppUpdateStatus {
  if (!options.isPackaged) {
    return AppUpdateStatusSchema.parse({
      currentVersion: options.currentVersion,
      message: 'Application updates are available in installed builds.',
      phase: 'unsupported',
      targetVersion: null,
    });
  }

  if (options.platform !== 'darwin' && options.platform !== 'win32') {
    return AppUpdateStatusSchema.parse({
      currentVersion: options.currentVersion,
      message: 'Use your Linux package manager to update TroCode.',
      phase: 'unsupported',
      targetVersion: null,
    });
  }

  return AppUpdateStatusSchema.parse({
    currentVersion: options.currentVersion,
    message: 'Check whether a newer version of TroCode is available.',
    phase: 'idle',
    targetVersion: null,
  });
}

function updaterErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown updater error.';
  return `TroCode could not check for updates: ${message}`.slice(
    0,
    MAX_UPDATE_ERROR_LENGTH,
  );
}

export class AppUpdateService {
  private feedConfigured = false;
  private readonly listeners = new Set<AppUpdateStatusListener>();
  private readonly options: AppUpdateServiceOptions;
  private started = false;
  private status: AppUpdateStatus;

  constructor(options: AppUpdateServiceOptions) {
    if (!GITHUB_REPOSITORY_PATTERN.test(options.repository)) {
      throw new Error('The update repository must use the GitHub owner/name format.');
    }

    this.options = options;
    this.status = initialStatus(options);
  }

  start(): AppUpdateStatus {
    if (this.started || this.status.phase === 'unsupported') {
      return this.getStatus();
    }

    this.started = true;
    const { updater } = this.options;
    updater.on('checking-for-update', this.handleCheckingForUpdate);
    updater.on('update-available', this.handleUpdateAvailable);
    updater.on('update-not-available', this.handleUpdateNotAvailable);
    updater.on('update-downloaded', this.handleUpdateDownloaded);
    updater.on('error', this.handleError);

    try {
      updater.setFeedURL({
        url: `${ELECTRON_UPDATE_SERVER}/${this.options.repository}/${this.options.platform}-${this.options.architecture}/${this.options.currentVersion}`,
      });
      this.feedConfigured = true;
    } catch (error) {
      this.setError(error);
    }

    return this.getStatus();
  }

  getStatus(): AppUpdateStatus {
    return { ...this.status };
  }

  onStatusChange(listener: AppUpdateStatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  checkForUpdates(): AppUpdateStatus {
    if (
      this.status.phase === 'unsupported' ||
      this.status.phase === 'checking' ||
      this.status.phase === 'downloading' ||
      this.status.phase === 'ready' ||
      this.status.phase === 'installing'
    ) {
      return this.getStatus();
    }

    if (!this.started) this.start();
    if (!this.feedConfigured) return this.getStatus();

    this.updateStatus({
      message: 'Checking for updates…',
      phase: 'checking',
      targetVersion: null,
    });
    try {
      this.options.updater.checkForUpdates();
    } catch (error) {
      this.setError(error);
    }
    return this.getStatus();
  }

  async restartAndInstall(): Promise<void> {
    if (this.status.phase !== 'ready') {
      throw new Error('No downloaded update is ready to install.');
    }

    const targetVersion = this.status.targetVersion;
    this.updateStatus({
      message: `Restarting to install ${targetVersion}…`,
      phase: 'installing',
      targetVersion,
    });

    try {
      await this.options.prepareToInstall();
      this.options.updater.quitAndInstall();
    } catch (error) {
      this.setError(error, targetVersion);
      throw error;
    }
  }

  private readonly handleCheckingForUpdate = (): void => {
    this.updateStatus({
      message: 'Checking for updates…',
      phase: 'checking',
      targetVersion: null,
    });
  };

  private readonly handleUpdateAvailable = (): void => {
    this.updateStatus({
      message: 'A newer version is downloading in the background…',
      phase: 'downloading',
      targetVersion: null,
    });
  };

  private readonly handleUpdateNotAvailable = (): void => {
    this.updateStatus({
      message: `TroCode ${this.options.currentVersion} is up to date.`,
      phase: 'up_to_date',
      targetVersion: null,
    });
  };

  private readonly handleUpdateDownloaded = (
    _event: Electron.Event,
    _releaseNotes: string,
    releaseName: string,
  ): void => {
    const targetVersion = releaseName.trim().slice(0, 100) || 'New version';
    this.updateStatus({
      message: `${targetVersion} is ready to install.`,
      phase: 'ready',
      targetVersion,
    });
  };

  private readonly handleError = (error: Error): void => {
    this.setError(error);
  };

  private setError(error: unknown, targetVersion: string | null = null): void {
    this.updateStatus({
      message: updaterErrorMessage(error),
      phase: 'error',
      targetVersion,
    });
  }

  private updateStatus(
    update: Pick<AppUpdateStatus, 'message' | 'phase' | 'targetVersion'>,
  ): void {
    this.status = AppUpdateStatusSchema.parse({
      currentVersion: this.options.currentVersion,
      ...update,
    });
    const snapshot = this.getStatus();
    for (const listener of this.listeners) listener(snapshot);
  }
}
