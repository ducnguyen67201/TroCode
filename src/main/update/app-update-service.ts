import type { AutoUpdater } from 'electron';

import {
  AppUpdateStatusSchema,
  type AppUpdateStatus,
} from '../../shared/contracts';

import {
  resolveWindowsUpdateRelease,
  type WindowsUpdateRelease,
} from './github-release-update-source';

const ELECTRON_UPDATE_SERVER = 'https://update.electronjs.org';
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

interface AppUpdateServiceOptions {
  architecture: string;
  currentVersion: string;
  isPackaged: boolean;
  managedByMicrosoftStore(): boolean;
  platform: NodeJS.Platform;
  prepareToInstall(): Promise<void> | void;
  repository: string;
  resolveWindowsRelease?(input: {
    currentVersion: string;
    repository: string;
  }): Promise<WindowsUpdateRelease | null>;
  updater: AutoUpdater;
}

type AppUpdateStatusListener = (status: AppUpdateStatus) => void;

function initialStatus(
  options: Pick<
    AppUpdateServiceOptions,
    'architecture' | 'currentVersion' | 'isPackaged' | 'platform'
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

  if (options.platform === 'win32' && options.architecture !== 'x64') {
    return AppUpdateStatusSchema.parse({
      currentVersion: options.currentVersion,
      message: 'Automatic Windows updates currently require an x64 installation.',
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
  const message = error instanceof Error ? error.message : String(error);
  if (/404|no updates found|not found/i.test(message)) {
    return 'No published update is available for this installation yet.';
  }
  if (
    /network|webexception|econn|enotfound|fetch failed|timed? ?out|http 5\d\d/i.test(
      message,
    )
  ) {
    return 'TroCode could not reach the update service. Check your connection and try again.';
  }
  return 'TroCode could not check for updates. Please try again.';
}

export class AppUpdateService {
  private feedConfigured = false;
  private readonly listeners = new Set<AppUpdateStatusListener>();
  private readonly options: AppUpdateServiceOptions;
  private pendingTargetVersion: string | null = null;
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
    if (
      this.options.platform === 'win32' &&
      this.options.managedByMicrosoftStore()
    ) {
      this.updateStatus({
        message: 'Microsoft Store keeps this installation of TroCode updated.',
        phase: 'unsupported',
        targetVersion: null,
      });
      return this.getStatus();
    }

    const { updater } = this.options;
    updater.on('checking-for-update', this.handleCheckingForUpdate);
    updater.on('update-available', this.handleUpdateAvailable);
    updater.on('update-not-available', this.handleUpdateNotAvailable);
    updater.on('update-downloaded', this.handleUpdateDownloaded);
    updater.on('error', this.handleError);

    if (this.options.platform === 'darwin') {
      try {
        updater.setFeedURL({
          url: `${ELECTRON_UPDATE_SERVER}/${this.options.repository}/${this.options.platform}-${this.options.architecture}/${this.options.currentVersion}`,
        });
        this.feedConfigured = true;
      } catch (error) {
        this.setError(error);
      }
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

  async checkForUpdates(): Promise<AppUpdateStatus> {
    if (
      this.status.phase === 'unsupported' ||
      this.status.phase === 'checking' ||
      this.status.phase === 'downloading' ||
      this.status.phase === 'ready' ||
      this.status.phase === 'installing'
    ) {
      return this.getStatus();
    }

    if (!this.started) {
      const startedStatus = this.start();
      if (startedStatus.phase === 'unsupported') return startedStatus;
    }
    if (this.options.platform === 'darwin' && !this.feedConfigured) {
      return this.getStatus();
    }

    this.pendingTargetVersion = null;
    this.updateStatus({
      message: 'Checking for updates…',
      phase: 'checking',
      targetVersion: null,
    });
    try {
      if (this.options.platform === 'win32') {
        const release = await (
          this.options.resolveWindowsRelease ?? resolveWindowsUpdateRelease
        )({
          currentVersion: this.options.currentVersion,
          repository: this.options.repository,
        });
        if (!release) {
          this.handleUpdateNotAvailable();
          return this.getStatus();
        }

        this.options.updater.setFeedURL({ url: release.feedUrl });
        this.feedConfigured = true;
        this.pendingTargetVersion = release.targetVersion;
      }

      if (!this.feedConfigured) return this.getStatus();
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
      targetVersion: this.pendingTargetVersion,
    });
  };

  private readonly handleUpdateNotAvailable = (): void => {
    this.pendingTargetVersion = null;
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
    const targetVersion =
      this.pendingTargetVersion ||
      releaseName.trim().slice(0, 100) ||
      'New version';
    this.updateStatus({
      message: `TroCode ${targetVersion} is ready to install.`,
      phase: 'ready',
      targetVersion,
    });
  };

  private readonly handleError = (error: Error): void => {
    this.setError(error, this.pendingTargetVersion);
  };

  private setError(error: unknown, targetVersion: string | null = null): void {
    const message = updaterErrorMessage(error);
    if (message.startsWith('No published update')) {
      this.pendingTargetVersion = null;
      this.updateStatus({
        message,
        phase: 'up_to_date',
        targetVersion: null,
      });
      return;
    }
    this.updateStatus({
      message,
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
