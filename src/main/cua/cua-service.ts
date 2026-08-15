import { app } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type * as CuaDriverSdk from '@trycua/cua-driver';

import type { CuaStatus } from '../../shared/contracts';

type CuaModule = typeof CuaDriverSdk;
type Driver = ReturnType<CuaModule['CuaDriver']['create']> & {
  uniffiDestroy(): void;
};

const CUA_PACKAGE_ENTRY = path.join(
  'cua-runtime',
  'node_modules',
  '@trycua',
  'cua-driver',
  'dist',
  'index.js',
);

export function getCuaModuleSpecifier(
  isPackaged: boolean,
  resourcesPath: string,
): string {
  if (!isPackaged) return '@trycua/cua-driver';

  return pathToFileURL(
    path.join(resourcesPath, 'app.asar.unpacked', CUA_PACKAGE_ENTRY),
  ).href;
}

function getSupportedPlatform(): CuaStatus['platform'] {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'win32') return 'win32';
  if (process.platform === 'linux') return 'linux';
  return 'unsupported';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown CUA initialization error.';
}

export function shouldAutoConnect(status: CuaStatus): boolean {
  if (status.state !== 'disconnected') return false;

  if (status.platform === 'darwin') {
    return (
      status.permissions?.accessibility === true &&
      status.permissions.screenRecording === true
    );
  }

  return status.platform === 'win32' || status.platform === 'linux';
}

export class CuaService {
  private cuaModule: CuaModule | null = null;
  private driver: Driver | null = null;
  private driverVersion: string | undefined;

  async getStatus(): Promise<CuaStatus> {
    const platform = getSupportedPlatform();
    if (platform === 'unsupported') {
      return {
        state: 'error',
        available: false,
        platform,
        summary: `CUA does not support ${process.platform}.`,
        nextActions: ['Use macOS, Windows, or Linux.'],
      };
    }

    try {
      const cua = await this.loadModule();
      const permissions =
        platform === 'darwin' ? cua.currentMacOsPermissionStatus() : undefined;

      if (
        platform === 'darwin' &&
        permissions &&
        (!permissions.accessibility || !permissions.screenRecording)
      ) {
        return {
          state: 'permission_required',
          available: false,
          platform,
          permissions,
          summary: 'Accessibility and Screen Recording permissions are required.',
          nextActions: ['Choose Connect computer and approve the macOS prompts.'],
        };
      }

      if (!this.driver) {
        return {
          state: 'disconnected',
          available: false,
          platform,
          permissions,
          summary: 'CUA is installed and ready to initialize.',
          nextActions: ['Choose Connect computer.'],
        };
      }

      return {
        state: 'ready',
        available: this.driver.isAvailable(),
        platform,
        version: this.driverVersion,
        permissions,
        summary: 'CUA is connected to this desktop process.',
        nextActions: ['Create a bounded task before granting actions.'],
      };
    } catch (error) {
      return {
        state: 'error',
        available: false,
        platform,
        summary: errorMessage(error),
        nextActions: [
          'Confirm that the CUA native package matches this OS and architecture.',
          'Restart the app after repairing the dependency.',
        ],
      };
    }
  }

  async connect(): Promise<CuaStatus> {
    return this.initializeDriver(true);
  }

  async connectIfPermitted(): Promise<CuaStatus> {
    const status = await this.getStatus();
    if (!shouldAutoConnect(status)) return status;

    return this.initializeDriver(false);
  }

  private async initializeDriver(
    requestMissingPermissions: boolean,
  ): Promise<CuaStatus> {
    const platform = getSupportedPlatform();

    try {
      const cua = await this.loadModule();

      if (platform === 'darwin') {
        const permissions = requestMissingPermissions
          ? cua.requestMacOsPermissions()
          : cua.currentMacOsPermissionStatus();
        if (!permissions.accessibility || !permissions.screenRecording) {
          return {
            state: 'permission_required',
            available: false,
            platform,
            permissions,
            summary: 'macOS permissions are not complete yet.',
            nextActions: [
              requestMissingPermissions
                ? 'Enable TroCode under Accessibility and Screen Recording.'
                : 'Choose Connect computer to finish permission onboarding.',
              'Restart TroCode after changing Screen Recording permission.',
            ],
          };
        }
      }

      if (!this.driver) {
        this.driver = cua.CuaDriver.create(undefined) as Driver;
        const metadata = await this.driver.metadata();
        this.driverVersion = metadata.driverVersion;
      }

      return this.getStatus();
    } catch (error) {
      return {
        state: 'error',
        available: false,
        platform,
        summary: errorMessage(error),
        nextActions: [
          'Review the application log for the native driver error.',
          'Stop instead of automatically retrying actions with unknown outcomes.',
        ],
      };
    }
  }

  async shutdown(): Promise<void> {
    const driver = this.driver;
    this.driver = null;
    this.driverVersion = undefined;

    if (!driver) return;

    await driver.shutdown();
    driver.uniffiDestroy();
  }

  private async loadModule(): Promise<CuaModule> {
    if (!this.cuaModule) {
      const moduleSpecifier = getCuaModuleSpecifier(
        app.isPackaged,
        process.resourcesPath,
      );

      this.cuaModule = (await import(
        /* webpackIgnore: true */ moduleSpecifier
      )) as CuaModule;
    }

    return this.cuaModule;
  }
}
