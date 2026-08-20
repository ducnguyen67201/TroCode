import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type LaunchableApplication = 'chrome';

interface DesktopApplicationLauncherOptions {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  openPath(path: string): Promise<string>;
  pathExists?: (path: string) => Promise<boolean>;
  platform?: NodeJS.Platform;
}

async function defaultPathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

function uniqueCandidates(candidates: Array<string | undefined>): string[] {
  return [...new Set(candidates.filter((candidate): candidate is string =>
    Boolean(candidate),
  ))];
}

function chromeCandidates(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  homeDirectory: string,
): string[] {
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app',
      path.posix.join(homeDirectory, 'Applications', 'Google Chrome.app'),
    ];
  }

  if (platform === 'win32') {
    const chromePath = (...parts: string[]) =>
      path.win32.join(...parts, 'Google', 'Chrome', 'Application', 'chrome.exe');
    return uniqueCandidates([
      environment.LOCALAPPDATA
        ? chromePath(environment.LOCALAPPDATA)
        : chromePath(homeDirectory, 'AppData', 'Local'),
      environment.PROGRAMFILES
        ? chromePath(environment.PROGRAMFILES)
        : undefined,
      environment['PROGRAMFILES(X86)']
        ? chromePath(environment['PROGRAMFILES(X86)'])
        : undefined,
    ]);
  }

  if (platform === 'linux') {
    const executableNames = [
      'google-chrome',
      'google-chrome-stable',
      'chromium',
      'chromium-browser',
    ];
    const searchDirectories = uniqueCandidates([
      ...(environment.PATH?.split(':') ?? []),
      '/usr/local/bin',
      '/usr/bin',
      '/snap/bin',
    ]);
    return searchDirectories.flatMap((directory) =>
      executableNames.map((name) => path.posix.join(directory, name)),
    );
  }

  return [];
}

export class DesktopApplicationLauncher {
  private readonly environment: NodeJS.ProcessEnv;

  private readonly homeDirectory: string;

  private readonly openPath: (path: string) => Promise<string>;

  private readonly pathExists: (path: string) => Promise<boolean>;

  private readonly platform: NodeJS.Platform;

  constructor(options: DesktopApplicationLauncherOptions) {
    this.environment = options.environment ?? process.env;
    this.homeDirectory = options.homeDirectory ?? os.homedir();
    this.openPath = options.openPath;
    this.pathExists = options.pathExists ?? defaultPathExists;
    this.platform = options.platform ?? process.platform;
  }

  async launch(application: LaunchableApplication): Promise<void> {
    const candidates =
      application === 'chrome'
        ? chromeCandidates(
            this.platform,
            this.environment,
            this.homeDirectory,
          )
        : [];
    const target = await this.firstInstalledCandidate(candidates);
    if (!target) {
      throw new Error('Google Chrome is not installed in a supported location.');
    }

    const error = await this.openPath(target);
    if (error) throw new Error(`Could not open Google Chrome: ${error}`);
  }

  private async firstInstalledCandidate(
    candidates: readonly string[],
  ): Promise<string | undefined> {
    for (const candidate of candidates) {
      if (await this.pathExists(candidate)) return candidate;
    }
    return undefined;
  }
}
