import { access, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  WorkspaceRuntimeAvailabilitySchema,
  type WorkspaceRuntimeAvailability,
} from '../../shared/contracts';

import { createCodexEnvironment } from './codex-environment';

export const SUPPORTED_CODEX_VERSION = '0.146.0';

export interface LocatedCodexRuntime extends WorkspaceRuntimeAvailability {
  executable: string | null;
}

export interface CodexRuntimeLocatorOptions {
  appCodexHome: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  probeAuthentication?: (
    executable: string,
    appCodexHome: string,
  ) => Promise<boolean>;
  probeVersion?: (executable: string) => Promise<string>;
}

async function defaultProbeVersion(
  executable: string,
  appCodexHome: string,
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const { execFile } = await import('node:child_process');
  return new Promise<string>((resolve, reject) => {
    execFile(
      executable,
      ['--version'],
      {
        env: createCodexEnvironment(environment, appCodexHome),
        timeout: 5_000,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim());
      },
    );
  });
}

async function defaultProbeAuthentication(
  executable: string,
  appCodexHome: string,
  environment: NodeJS.ProcessEnv,
): Promise<boolean> {
  const { execFile } = await import('node:child_process');
  return new Promise<boolean>((resolve) => {
    execFile(
      executable,
      ['login', 'status'],
      {
        env: createCodexEnvironment(environment, appCodexHome),
        timeout: 5_000,
      },
      (error) => resolve(!error),
    );
  });
}

function versionFrom(output: string): string | null {
  return /(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/u.exec(output)?.[1] ?? null;
}

export class CodexRuntimeLocator {
  private readonly appCodexHome: string;

  private readonly environment: NodeJS.ProcessEnv;

  private readonly platform: NodeJS.Platform;

  private readonly probeAuthentication: (
    executable: string,
    appCodexHome: string,
  ) => Promise<boolean>;

  private readonly probeVersion: (executable: string) => Promise<string>;

  constructor(options: CodexRuntimeLocatorOptions) {
    this.appCodexHome = path.resolve(options.appCodexHome);
    this.environment = options.environment ?? process.env;
    this.platform = options.platform ?? process.platform;
    this.probeAuthentication =
      options.probeAuthentication ??
      ((executable, appCodexHome) =>
        defaultProbeAuthentication(
          executable,
          appCodexHome,
          this.environment,
        ));
    this.probeVersion =
      options.probeVersion ??
      ((executable) =>
        defaultProbeVersion(executable, this.appCodexHome, this.environment));
  }

  async locate(): Promise<LocatedCodexRuntime> {
    const executable = await this.findExecutable();
    if (!executable) {
      return {
        available: false,
        executable: null,
        runtimeVersion: null,
        summary:
          'Workspace mode needs Codex CLI 0.146.0. Install it or set TROCODE_CODEX_PATH to its absolute executable path.',
      };
    }

    try {
      const runtimeVersion = versionFrom(await this.probeVersion(executable));
      if (runtimeVersion !== SUPPORTED_CODEX_VERSION) {
        return {
          available: false,
          executable,
          runtimeVersion,
          summary: `Workspace mode requires Codex CLI ${SUPPORTED_CODEX_VERSION}; found ${runtimeVersion ?? 'an unknown version'}.`,
        };
      }
      if (!(await this.probeAuthentication(executable, this.appCodexHome))) {
        return {
          available: false,
          executable,
          runtimeVersion,
          summary:
            `Workspace mode needs an app-scoped Codex sign-in. Set CODEX_HOME to ${this.appCodexHome}, run ${executable} login, then restart TroCode.`,
        };
      }
      const availability = WorkspaceRuntimeAvailabilitySchema.parse({
        available: true,
        runtimeVersion,
        summary: `Codex CLI ${runtimeVersion} is available for Workspace mode.`,
      });
      return { ...availability, executable };
    } catch {
      return {
        available: false,
        executable,
        runtimeVersion: null,
        summary: 'TroCode found Codex CLI but could not verify its version.',
      };
    }
  }

  private async findExecutable(): Promise<string | null> {
    const explicit = this.environment.TROCODE_CODEX_PATH?.trim();
    if (explicit) {
      if (!path.isAbsolute(explicit)) return null;
      return this.validateCandidate(explicit);
    }

    const executableNames = this.platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex'];
    for (const directory of (this.environment.PATH ?? '').split(path.delimiter)) {
      if (!directory) continue;
      for (const name of executableNames) {
        const candidate = await this.validateCandidate(path.join(directory, name));
        if (candidate) return candidate;
      }
    }
    return null;
  }

  private async validateCandidate(candidate: string): Promise<string | null> {
    try {
      await access(candidate, this.platform === 'win32' ? undefined : 1);
      return await realpath(candidate);
    } catch {
      return null;
    }
  }
}
