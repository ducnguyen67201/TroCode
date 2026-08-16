import { app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type * as CuaDriverSdk from '@trycua/cua-driver';
import { z } from 'zod';

import type { CuaStatus } from '../../shared/contracts';
import {
  DesktopActionOutcomeSchema,
  DesktopCoordinateSpaceSchema,
  DesktopObservationSchema,
  type DesktopActionOutcome,
  type DesktopCommand,
  type DesktopObservation,
} from '../agent/execution-contracts';

const DesktopStateMetadataSchema = z.object({
  screen_height: z.number().int().positive(),
  screen_width: z.number().int().positive(),
  screenshot_height: z.number().int().positive(),
  screenshot_width: z.number().int().positive(),
}).passthrough();

type CuaModule = typeof CuaDriverSdk;
type Driver = ReturnType<CuaModule['CuaDriver']['create']> & {
  uniffiDestroy(): void;
};

const CUA_PACKAGE_ENTRY_PARTS = [
  'cua-runtime',
  'node_modules',
  '@trycua',
  'cua-driver',
  'dist',
  'index.js',
] as const;

function isWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

function resourcePathToFileUrl(resourcesPath: string, targetPath: string): string {
  if (isWindowsPath(resourcesPath)) return pathToFileURL(targetPath).href;

  return new URL(`file://${targetPath}`).href;
}

export function getCuaModuleSpecifier(
  isPackaged: boolean,
  resourcesPath: string,
): string {
  if (!isPackaged) return '@trycua/cua-driver';

  const join = isWindowsPath(resourcesPath) ? path.win32.join : path.posix.join;
  const modulePath = join(
    resourcesPath,
    'app.asar.unpacked',
    ...CUA_PACKAGE_ENTRY_PARTS,
  );

  return resourcePathToFileUrl(resourcesPath, modulePath);
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

function coordinateSpaceFromDesktopState(
  structuredJson: string | undefined,
) {
  if (!structuredJson) return undefined;

  try {
    const metadata = DesktopStateMetadataSchema.safeParse(
      JSON.parse(structuredJson),
    );
    if (!metadata.success) return undefined;

    return DesktopCoordinateSpaceSchema.parse({
      screenHeight: metadata.data.screen_height,
      screenWidth: metadata.data.screen_width,
      screenshotHeight: metadata.data.screenshot_height,
      screenshotWidth: metadata.data.screenshot_width,
    });
  } catch {
    return undefined;
  }
}

interface CuaResultDiagnostic {
  action?: {
    delivery?: { mode: number };
    effect: number;
    route: number;
  };
  degraded: boolean;
  errorCode?: string;
  isError: boolean;
}

function logCuaResult(
  event: string,
  taskId: string,
  command: DesktopCommand,
  result: CuaResultDiagnostic,
): void {
  console.info(
    `[cua] ${event}`,
    JSON.stringify({
      taskId,
      command: command.kind,
      ...(command.kind === 'click' ||
      command.kind === 'point' ||
      command.kind === 'scroll'
        ? { x: command.x, y: command.y, inputCoordinates: 'screenshot_pixels' }
        : {}),
      isError: result.isError,
      errorCode: result.errorCode ?? null,
      degraded: result.degraded,
      effect: result.action?.effect ?? null,
      route: result.action?.route ?? null,
      deliveryMode: result.action?.delivery?.mode ?? null,
    }),
  );
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

  private readonly activeSessions = new Set<string>();

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
          nextActions: [
            'Approve the macOS prompts, or choose Connect computer to reopen them.',
          ],
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

  async startTaskSession(taskId: string, signal?: AbortSignal): Promise<void> {
    if (this.activeSessions.has(taskId)) return;

    const cua = await this.loadModule();
    const driver = this.requireDriver();
    const started = await driver.startSession(
      cua.StartSessionInput.new({
        session: taskId,
        captureScope: cua.CaptureScope.Desktop,
      }),
      signal ? { signal } : undefined,
    );
    if (!started.active) {
      throw new Error(`CUA did not activate task session ${taskId}.`);
    }
    console.info(
      '[cua] session.started',
      JSON.stringify({
        taskId,
        captureScope: started.state?.captureScope ?? null,
        effectiveScope: started.state?.effectiveScope ?? null,
        desktopUnlocked: started.state?.desktopUnlocked ?? null,
        revived: started.revived ?? null,
      }),
    );
    this.activeSessions.add(taskId);
  }

  async observe(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<DesktopObservation> {
    this.assertActiveSession(taskId);
    const cua = await this.loadModule();
    const result = await this.requireDriver().getDesktopState(
      cua.GetDesktopStateInput.new({ session: taskId }),
      signal ? { signal } : undefined,
    );

    if (result.isError) {
      throw new Error(
        result.text || result.errorCode || 'CUA could not observe the desktop.',
      );
    }

    const image = result.images[0];
    const coordinateSpace = coordinateSpaceFromDesktopState(
      result.structuredJson,
    );
    console.info(
      '[cua] observation.captured',
      JSON.stringify({
        taskId,
        degraded: result.degraded,
        hasScreenshot: Boolean(image),
        coordinateSpace: coordinateSpace ?? null,
      }),
    );
    const fingerprintSource = image
      ? Buffer.from(image.dataBase64, 'base64')
      : Buffer.from(
          `${result.text}\n${result.structuredJson ?? ''}\n${result.rawJson}`,
          'utf8',
        );

    return DesktopObservationSchema.parse({
      observationId: randomUUID(),
      taskId,
      capturedAt: new Date().toISOString(),
      text: result.text.slice(0, 100_000),
      ...(result.structuredJson
        ? { structuredState: result.structuredJson.slice(0, 500_000) }
        : {}),
      ...(image
        ? {
            screenshot: {
              mimeType: image.mimeType,
              dataBase64: image.dataBase64,
            },
          }
        : {}),
      ...(coordinateSpace ? { coordinateSpace } : {}),
      degraded: result.degraded,
      fingerprint: createHash('sha256').update(fingerprintSource).digest('hex'),
    });
  }

  async executeCommand(
    taskId: string,
    command: DesktopCommand,
    signal?: AbortSignal,
  ): Promise<DesktopActionOutcome> {
    this.assertActiveSession(taskId);
    const cua = await this.loadModule();
    const driver = this.requireDriver();
    const asyncOptions = signal ? { signal } : undefined;
    const movePointer = async (x: number, y: number) => {
      const movement = await driver.moveCursor(
        cua.MoveCursorInput.new({
          session: taskId,
          scope: cua.DesktopScope.Desktop,
          x,
          y,
        }),
        asyncOptions,
      );
      logCuaResult('pointer.move-result', taskId, command, movement);
      return movement;
    };

    const result = await (async () => {
      switch (command.kind) {
        case 'open_url':
          throw new Error('URL navigation is handled outside the CUA driver.');
        case 'click': {
          const movement = await movePointer(command.x, command.y);
          if (
            movement.isError ||
            movement.action?.effect === cua.ActionEffect.Refused
          ) {
            return movement;
          }

          const button = {
            left: cua.ClickButton.Left,
            middle: cua.ClickButton.Middle,
            right: cua.ClickButton.Right,
          }[command.button];
          return driver.click(
            cua.ClickInput.new({
              session: taskId,
              scope: cua.DesktopScope.Desktop,
              x: command.x,
              y: command.y,
              button,
              count: command.count,
            }),
            asyncOptions,
          );
        }
        case 'point':
          return movePointer(command.x, command.y);
        case 'type_text':
          return driver.typeText(
            cua.TypeTextInput.new({
              session: taskId,
              scope: cua.DesktopScope.Desktop,
              text: command.text,
            }),
            asyncOptions,
          );
        case 'keypress':
          if (command.keys.length === 1) {
            return driver.pressKey(
              cua.PressKeyInput.new({
                session: taskId,
                scope: cua.DesktopScope.Desktop,
                key: command.keys[0]!,
              }),
              asyncOptions,
            );
          }
          return driver.hotkey(
            cua.HotkeyInput.new({
              session: taskId,
              scope: cua.DesktopScope.Desktop,
              keys: command.keys,
            }),
            asyncOptions,
          );
        case 'scroll': {
          const movement = await movePointer(command.x, command.y);
          if (
            movement.isError ||
            movement.action?.effect === cua.ActionEffect.Refused
          ) {
            return movement;
          }

          const direction = {
            down: cua.ScrollDirection.Down,
            left: cua.ScrollDirection.Left,
            right: cua.ScrollDirection.Right,
            up: cua.ScrollDirection.Up,
          }[command.direction];
          return driver.scroll(
            cua.ScrollInput.new({
              session: taskId,
              scope: cua.DesktopScope.Desktop,
              x: command.x,
              y: command.y,
              direction,
              amount: BigInt(command.amount),
            }),
            asyncOptions,
          );
        }
      }
    })();
    logCuaResult('command.result', taskId, command, result);

    if (result.isError) {
      return DesktopActionOutcomeSchema.parse({
        status: 'failed',
        summary:
          result.text || result.errorCode || 'The desktop action was refused.',
      });
    }

    const effect = result.action?.effect;
    if (effect === cua.ActionEffect.Confirmed) {
      return DesktopActionOutcomeSchema.parse({
        status: 'confirmed',
        summary: result.text || 'CUA confirmed the desktop action.',
      });
    }
    if (effect === cua.ActionEffect.Refused) {
      return DesktopActionOutcomeSchema.parse({
        status: 'failed',
        summary: result.text || 'CUA refused the desktop action.',
      });
    }
    if (command.kind === 'point') {
      return DesktopActionOutcomeSchema.parse({
        status: 'confirmed',
        summary:
          result.text || 'CUA delivered the non-clicking pointer guidance.',
      });
    }

    return DesktopActionOutcomeSchema.parse({
      status: 'unknown',
      summary:
        result.text ||
        'CUA could not confirm whether the desktop action changed the screen.',
    });
  }

  async endTaskSession(taskId: string, signal?: AbortSignal): Promise<void> {
    if (!this.activeSessions.delete(taskId)) return;
    const cua = await this.loadModule();
    await this.requireDriver().endSession(
      cua.EndSessionInput.new({ session: taskId }),
      signal ? { signal } : undefined,
    );
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
    this.activeSessions.clear();

    if (!driver) return;

    try {
      await driver.shutdown();
    } finally {
      driver.uniffiDestroy();
    }
  }

  private requireDriver(): Driver {
    if (!this.driver || !this.driver.isAvailable()) {
      throw new Error('Connect the computer-use runtime before starting a task.');
    }
    return this.driver;
  }

  private assertActiveSession(taskId: string): void {
    if (!this.activeSessions.has(taskId)) {
      throw new Error(`CUA session for task ${taskId} is not active.`);
    }
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
