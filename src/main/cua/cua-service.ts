import { app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import type * as CuaDriverSdk from '@trycua/cua-driver';
import { z } from 'zod';

import type { CuaStatus } from '../../shared/contracts';
import {
  DesktopActionOutcomeSchema,
  DesktopCoordinateSpaceSchema,
  DesktopObservationSchema,
  type SurfaceActionOutcome,
  type SurfaceCommand,
  type DesktopActionOutcome,
  type DesktopCommand,
  type DesktopCoordinateSpace,
  type DesktopObservation,
  tableRowsToTsv,
} from '../agent/execution-contracts';

import { CuaAuthorizationBroker } from './cua-authorization-broker';
import {
  CuaDriverMetadataSchema,
  CuaSemanticCapabilitiesSchema,
  deriveCuaSemanticCapabilities,
  type CuaOpenToolResult,
  type CuaSemanticCapabilities,
} from './cua-semantic-contracts';
import {
  CuaSurfaceRouter,
  type ObserveSurfaceOptions,
  type SurfaceRevalidationResult,
} from './cua-surface-router';

const DesktopStateMetadataSchema = z.object({
  screen_height: z.number().int().positive(),
  screen_width: z.number().int().positive(),
  screen_x: z.number().int().min(-100_000).max(100_000).optional(),
  screen_y: z.number().int().min(-100_000).max(100_000).optional(),
  screenshot_height: z.number().int().positive(),
  screenshot_width: z.number().int().positive(),
}).passthrough();

type CuaModule = typeof CuaDriverSdk;
type Driver = ReturnType<CuaModule['CuaDriver']['create']> & {
  uniffiDestroy(): void;
};

const NO_SEMANTIC_CAPABILITIES = CuaSemanticCapabilitiesSchema.parse({
  browserActions: false,
  browserPrepare: false,
  browserState: false,
  capabilityVersion: 'unavailable',
  verification: false,
  windowActions: false,
  windowState: false,
});

export interface CuaPerformanceMetric {
  durationMs: number;
  fallbackReason:
    | 'none'
    | 'semantic_unavailable'
    | 'semantic_error'
    | 'screenshot_required';
  operation: string;
  route:
    | 'browser_semantic'
    | 'window_accessibility'
    | 'window_vision'
    | 'desktop_vision';
  screenshotAttached: boolean;
  status: 'confirmed' | 'error' | 'not_executed' | 'unknown';
}

export interface CuaServiceOptions {
  now?: () => number;
  onPerformanceMetric?: (metric: CuaPerformanceMetric) => void;
  platform?: NodeJS.Platform;
  performanceNow?: () => number;
  waitForSystemUiReveal?: (signal?: AbortSignal) => Promise<void>;
}

const WINDOWS_BOTTOM_EDGE_READY_MS = 15_000;

function defaultSystemUiRevealWait(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('The desktop action was cancelled.'));
      return;
    }

    const finish = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(finish, 450);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('The desktop action was cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function isWindowsBottomEdgeClick(
  platform: NodeJS.Platform,
  command: DesktopCommand,
  coordinateSpace: DesktopCoordinateSpace | undefined,
): command is Extract<DesktopCommand, { kind: 'click' }> {
  if (platform !== 'win32' || command.kind !== 'click' || !coordinateSpace) {
    return false;
  }

  const revealZoneHeight = Math.max(
    64,
    Math.ceil(coordinateSpace.screenshotHeight * 0.06),
  );
  return command.y >= coordinateSpace.screenshotHeight - revealZoneHeight;
}

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

export function pasteShortcutForPlatform(
  platform: NodeJS.Platform,
): string[] {
  return platform === 'darwin' ? ['cmd', 'v'] : ['ctrl', 'v'];
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
      ...(metadata.data.screen_x !== undefined
        ? { screenX: metadata.data.screen_x }
        : {}),
      ...(metadata.data.screen_y !== undefined
        ? { screenY: metadata.data.screen_y }
        : {}),
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

  private semanticCapabilityState: CuaSemanticCapabilities =
    NO_SEMANTIC_CAPABILITIES;

  private surfaceRouter: CuaSurfaceRouter | null = null;

  private authorizationBroker: CuaAuthorizationBroker | null = null;

  private readonly activeSessions = new Set<string>();

  private readonly desktopScopeSessions = new Set<string>();

  private readonly latestCoordinateSpaces = new Map<
    string,
    DesktopCoordinateSpace
  >();

  private readonly windowsBottomEdgeReadyUntil = new Map<string, number>();

  private readonly windowsBottomEdgeAwaitingObservation = new Set<string>();

  private readonly now: () => number;

  private readonly onPerformanceMetric?: (metric: CuaPerformanceMetric) => void;

  private readonly platform: NodeJS.Platform;

  private readonly performanceNow: () => number;

  private readonly waitForSystemUiReveal: (
    signal?: AbortSignal,
  ) => Promise<void>;

  constructor(options: CuaServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.onPerformanceMetric = options.onPerformanceMetric;
    this.platform = options.platform ?? process.platform;
    this.performanceNow = options.performanceNow ?? performance.now.bind(performance);
    this.waitForSystemUiReveal =
      options.waitForSystemUiReveal ?? defaultSystemUiRevealWait;
  }

  semanticCapabilities(): CuaSemanticCapabilities {
    return this.semanticCapabilityState;
  }

  supportsSemanticFastPath(): boolean {
    return (
      this.semanticCapabilityState.windowState &&
      this.semanticCapabilityState.windowActions
    );
  }

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
        captureScope: cua.CaptureScope.Auto,
      }),
      signal ? { signal } : undefined,
    );
    if (!started.active) {
      throw new Error(`CUA did not activate task session ${taskId}.`);
    }
    if (started.state.effectiveScope === cua.EffectiveScope.Desktop) {
      this.desktopScopeSessions.add(taskId);
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
    const startedAt = this.performanceNow();
    this.assertActiveSession(taskId);
    const cua = await this.loadModule();
    await this.ensureDesktopScope(
      taskId,
      cua.EscalationReason.NoWindowTarget,
      'semantic_surface_unavailable',
      signal,
    );
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
    if (coordinateSpace) {
      this.latestCoordinateSpaces.set(taskId, coordinateSpace);
    } else {
      this.latestCoordinateSpaces.delete(taskId);
    }
    if (this.windowsBottomEdgeAwaitingObservation.delete(taskId)) {
      this.windowsBottomEdgeReadyUntil.set(
        taskId,
        this.now() + WINDOWS_BOTTOM_EDGE_READY_MS,
      );
    }
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

    const observation = DesktopObservationSchema.parse({
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
      route: 'desktop_vision',
      surface: { kind: 'desktop', application: 'Desktop' },
      degraded: result.degraded,
      fingerprint: createHash('sha256').update(fingerprintSource).digest('hex'),
    });
    this.recordPerformance({
      durationMs: Math.max(0, this.performanceNow() - startedAt),
      fallbackReason: 'semantic_unavailable',
      operation: 'observe',
      route: 'desktop_vision',
      screenshotAttached: Boolean(observation.screenshot),
      status: 'confirmed',
    });
    return observation;
  }

  async observeCurrentSurface(
    taskId: string,
    options: ObserveSurfaceOptions = {},
    signal?: AbortSignal,
  ): Promise<DesktopObservation | undefined> {
    this.assertActiveSession(taskId);
    if (this.supportsSemanticFastPath() && this.surfaceRouter) {
      const observation = await this.surfaceRouter.observeCurrentSurface(
        taskId,
        options,
        signal,
      );
      if (observation) return observation;
    }
    return undefined;
  }

  async executeSurfaceCommand(
    taskId: string,
    observationId: string,
    command: SurfaceCommand,
    signal?: AbortSignal,
  ): Promise<SurfaceActionOutcome> {
    this.assertActiveSession(taskId);
    if (!this.supportsSemanticFastPath() || !this.surfaceRouter) {
      return {
        status: 'not_executed',
        summary: 'The semantic computer-use path is unavailable. Observe the desktop.',
      };
    }
    return this.surfaceRouter.execute(taskId, observationId, command, signal);
  }

  async revalidateSurfaceAction(
    taskId: string,
    observationId: string,
    publicRef: string | undefined,
    signal?: AbortSignal,
  ): Promise<SurfaceRevalidationResult> {
    this.assertActiveSession(taskId);
    if (!this.surfaceRouter) {
      throw new Error('The semantic computer-use path is unavailable.');
    }
    return this.surfaceRouter.revalidate(
      taskId,
      observationId,
      publicRef,
      signal,
    );
  }

  async prepareBrowserAccess(
    taskId: string,
    observationId: string,
    signal?: AbortSignal,
  ): Promise<SurfaceActionOutcome> {
    this.assertActiveSession(taskId);
    if (!this.surfaceRouter) {
      return {
        status: 'not_executed',
        summary: 'The semantic browser path is unavailable.',
      };
    }
    return this.surfaceRouter.prepareBrowserAccess(taskId, observationId, signal);
  }

  async executeCommand(
    taskId: string,
    command: DesktopCommand,
    signal?: AbortSignal,
  ): Promise<DesktopActionOutcome> {
    const startedAt = this.performanceNow();
    this.assertActiveSession(taskId);
    const cua = await this.loadModule();
    await this.ensureDesktopScope(
      taskId,
      cua.EscalationReason.Other,
      'desktop_command_required',
      signal,
    );
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

    const coordinateSpace = this.latestCoordinateSpaces.get(taskId);
    const bottomEdgeClick = isWindowsBottomEdgeClick(
      this.platform,
      command,
      coordinateSpace,
    );
    if (!bottomEdgeClick) {
      this.windowsBottomEdgeAwaitingObservation.delete(taskId);
      this.windowsBottomEdgeReadyUntil.delete(taskId);
    } else if (
      (this.windowsBottomEdgeReadyUntil.get(taskId) ?? 0) <= this.now()
    ) {
      const movement = await movePointer(
        command.x,
        coordinateSpace!.screenshotHeight - 1,
      );
      if (
        movement.isError ||
        movement.action?.effect === cua.ActionEffect.Refused
      ) {
        const outcome = DesktopActionOutcomeSchema.parse({
          status: 'failed',
          summary:
            movement.text ||
            movement.errorCode ||
            'CUA could not move the pointer to reveal Windows system UI.',
        });
        this.recordPerformance({
          durationMs: Math.max(0, this.performanceNow() - startedAt),
          fallbackReason: 'semantic_unavailable',
          operation: command.kind,
          route: 'desktop_vision',
          screenshotAttached: false,
          status: 'error',
        });
        return outcome;
      }

      await this.waitForSystemUiReveal(signal);
      this.windowsBottomEdgeReadyUntil.delete(taskId);
      this.windowsBottomEdgeAwaitingObservation.add(taskId);
      console.info(
        '[cua] windows.system-ui-revealed',
        JSON.stringify({
          taskId,
          requestedX: command.x,
          requestedY: command.y,
          revealY: coordinateSpace!.screenshotHeight - 1,
        }),
      );
      const outcome = DesktopActionOutcomeSchema.parse({
        status: 'not_executed',
        summary:
          'Tro moved the pointer to the Windows bottom edge to reveal auto-hidden system UI. No click was performed; use the fresh observation before clicking.',
      });
      this.recordPerformance({
        durationMs: Math.max(0, this.performanceNow() - startedAt),
        fallbackReason: 'semantic_unavailable',
        operation: command.kind,
        route: 'desktop_vision',
        screenshotAttached: false,
        status: 'not_executed',
      });
      return outcome;
    } else {
      this.windowsBottomEdgeReadyUntil.set(
        taskId,
        this.now() + WINDOWS_BOTTOM_EDGE_READY_MS,
      );
    }

    const result = await (async () => {
      switch (command.kind) {
        case 'open_url':
          throw new Error('URL navigation is handled outside the CUA driver.');
        case 'direct_tool':
          throw new Error('Direct tools are handled outside the CUA driver.');
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
        case 'drag': {
          const button = {
            left: cua.ClickButton.Left,
            middle: cua.ClickButton.Middle,
            right: cua.ClickButton.Right,
          }[command.button];
          return driver.drag(
            cua.DragInput.new({
              session: taskId,
              scope: cua.DesktopScope.Desktop,
              fromX: command.fromX,
              fromY: command.fromY,
              toX: command.toX,
              toY: command.toY,
              durationMs: BigInt(command.durationMs),
              button,
            }),
            asyncOptions,
          );
        }
        case 'type_text':
          return driver.typeText(
            cua.TypeTextInput.new({
              session: taskId,
              scope: cua.DesktopScope.Desktop,
              text: command.text,
            }),
            asyncOptions,
          );
        case 'paste_table': {
          const clipboardResult = await driver.clipboardWrite(
            cua.ClipboardWriteInput.new({
              session: taskId,
              text: tableRowsToTsv(command.rows),
            }),
            asyncOptions,
          );
          logCuaResult(
            'clipboard.table-write-result',
            taskId,
            command,
            clipboardResult,
          );
          if (
            clipboardResult.isError ||
            clipboardResult.action?.effect === cua.ActionEffect.Refused
          ) {
            return clipboardResult;
          }
          return driver.hotkey(
            cua.HotkeyInput.new({
              session: taskId,
              scope: cua.DesktopScope.Desktop,
              keys: pasteShortcutForPlatform(process.platform),
            }),
            asyncOptions,
          );
        }
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

    let outcome: DesktopActionOutcome;
    if (result.isError) {
      outcome = DesktopActionOutcomeSchema.parse({
        status: 'failed',
        summary:
          result.text || result.errorCode || 'The desktop action was refused.',
      });
    } else if (result.action?.effect === cua.ActionEffect.Confirmed) {
      outcome = DesktopActionOutcomeSchema.parse({
        status: 'confirmed',
        summary: result.text || 'CUA confirmed the desktop action.',
      });
    } else if (result.action?.effect === cua.ActionEffect.Refused) {
      outcome = DesktopActionOutcomeSchema.parse({
        status: 'failed',
        summary: result.text || 'CUA refused the desktop action.',
      });
    } else if (command.kind === 'point') {
      outcome = DesktopActionOutcomeSchema.parse({
        status: 'confirmed',
        summary:
          result.text || 'CUA delivered the non-clicking pointer guidance.',
      });
    } else {
      outcome = DesktopActionOutcomeSchema.parse({
        status: 'unknown',
        summary:
          result.text ||
          'CUA could not confirm whether the desktop action changed the screen.',
      });
    }
    this.recordPerformance({
      durationMs: Math.max(0, this.performanceNow() - startedAt),
      fallbackReason: 'semantic_unavailable',
      operation: command.kind,
      route: 'desktop_vision',
      screenshotAttached: false,
      status:
        outcome.status === 'failed'
          ? 'error'
          : outcome.status === 'unknown'
            ? 'unknown'
            : 'confirmed',
    });
    return outcome;
  }

  async endTaskSession(taskId: string, signal?: AbortSignal): Promise<void> {
    this.surfaceRouter?.clearTask(taskId);
    this.desktopScopeSessions.delete(taskId);
    this.latestCoordinateSpaces.delete(taskId);
    this.windowsBottomEdgeAwaitingObservation.delete(taskId);
    this.windowsBottomEdgeReadyUntil.delete(taskId);
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
                ? 'Enable Tro under Accessibility and Screen Recording.'
                : 'Choose Connect computer to finish permission onboarding.',
              'Restart Tro after changing Screen Recording permission.',
            ],
          };
        }
      }

      if (!this.driver) {
        const authorizationBroker = new CuaAuthorizationBroker({
          allow: cua.DriverAuthorizationAction.Allow,
          cancel: cua.DriverAuthorizationAction.Cancel,
          deny: cua.DriverAuthorizationAction.Deny,
        });
        const configuredOptions = cua.ConfiguredDriverOptions.new({
          claudeCodeCompatibility: false,
          authorization: cua.RuntimeAuthorizationOptions.new({
            allowedModes: [cua.SessionPermissionMode.Standard],
            compatibilityMode: cua.SessionPermissionMode.Standard,
            unrestrictedAcknowledged: false,
            maxSessionTtlSeconds: 7_200n,
            maxIdleTtlSeconds: 900n,
          }),
        });
        this.driver = cua.CuaDriver.createConfiguredWithHostIntegrations(
          configuredOptions,
          authorizationBroker,
          {
            onActivity: (event) => {
              console.info(
                '[cua] activity',
                JSON.stringify({
                  kind: event.kind,
                  toolName: event.toolName,
                  riskClass: event.riskClass,
                  refusalCode: event.refusalCode ?? null,
                }),
              );
            },
          },
        ) as Driver;
        const metadata = CuaDriverMetadataSchema.parse(
          await this.driver.metadata(),
        );
        if (
          metadata.driverVersion !== '0.19.3' ||
          metadata.contractVersion !== '0.6.0' ||
          metadata.toolsListSchemaVersion !== '1'
        ) {
          throw new Error(
            'CUA runtime does not match Tro supported contract 0.19.3/0.6.0.',
          );
        }
        this.driverVersion = metadata.driverVersion;
        try {
          this.semanticCapabilityState = deriveCuaSemanticCapabilities(
            JSON.parse(await this.driver.listToolsJson()),
          );
        } catch {
          this.semanticCapabilityState = NO_SEMANTIC_CAPABILITIES;
        }
        this.authorizationBroker = authorizationBroker;
        this.surfaceRouter = new CuaSurfaceRouter({
          authorizationBroker,
          callTool: (name, argumentsValue, signal) =>
            this.callOpenTool(name, argumentsValue, signal),
          capabilities: () => this.semanticCapabilityState,
          now: this.now,
        });
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
    this.semanticCapabilityState = NO_SEMANTIC_CAPABILITIES;
    this.activeSessions.clear();
    this.desktopScopeSessions.clear();
    this.surfaceRouter?.clear();
    this.surfaceRouter = null;
    this.authorizationBroker?.clear();
    this.authorizationBroker = null;

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

  private async ensureDesktopScope(
    taskId: string,
    reason: CuaDriverSdk.EscalationReason,
    detail: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.desktopScopeSessions.has(taskId)) return;
    const cua = await this.loadModule();
    const state = await this.requireDriver().escalateSession(
      cua.EscalateSessionInput.new({ session: taskId, reason, detail }),
      signal ? { signal } : undefined,
    );
    if (
      state.effectiveScope !== cua.EffectiveScope.Desktop ||
      !state.desktopUnlocked
    ) {
      throw new Error('CUA did not escalate the task to desktop scope.');
    }
    this.desktopScopeSessions.add(taskId);
    console.info(
      '[cua] session.escalated',
      JSON.stringify({
        taskId,
        captureScope: state.captureScope,
        effectiveScope: state.effectiveScope,
        desktopUnlocked: state.desktopUnlocked,
        reason,
      }),
    );
  }

  private async callOpenTool(
    name: string,
    argumentsValue: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CuaOpenToolResult> {
    const startedAt = this.performanceNow();
    try {
      const result = await this.requireDriver().callTool(
        name,
        JSON.stringify(argumentsValue),
        signal ? { signal } : undefined,
      );
      this.recordPerformance({
        durationMs: Math.max(0, this.performanceNow() - startedAt),
        fallbackReason:
          name === 'get_window_state' && result.images.length > 0
            ? 'screenshot_required'
            : 'none',
        operation: name,
        route: this.routeForTool(name, result.images.length > 0),
        screenshotAttached: result.images.length > 0,
        status: result.isError ? 'error' : 'confirmed',
      });
      return result;
    } catch (error) {
      this.recordPerformance({
        durationMs: Math.max(0, this.performanceNow() - startedAt),
        fallbackReason: 'semantic_error',
        operation: name,
        route: this.routeForTool(name, false),
        screenshotAttached: false,
        status: 'error',
      });
      throw error;
    }
  }

  private recordPerformance(metric: CuaPerformanceMetric): void {
    console.info('[cua] performance', JSON.stringify(metric));
    this.onPerformanceMetric?.(metric);
  }

  private routeForTool(
    name: string,
    screenshotAttached: boolean,
  ): CuaPerformanceMetric['route'] {
    if (name.startsWith('browser_') || name === 'get_browser_state') {
      return 'browser_semantic';
    }
    return screenshotAttached ? 'window_vision' : 'window_accessibility';
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
