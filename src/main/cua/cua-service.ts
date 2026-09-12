import { app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import type * as CuaDriverSdk from '@trycua/cua-driver';
import { z } from 'zod';

import type { CuaStatus } from '../../shared/contracts';
import type { ToolExecutionResult } from '../agent/agent-contracts';
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
import type { ImageEvidencePolicy } from '../inference/image-evidence-policy';

import { CuaCapabilityBroker } from './cua-capability-broker';
import { traceNativeCall } from './cua-execution-diagnostics';
import { cuaOpenToolOutcome } from './cua-open-tool-outcome';
import {
  type CuaDriverCatalog,
  type CuaDriverCatalogReport,
  CuaDriverMetadataSchema,
  CuaWindowListSchema,
  CuaSemanticCapabilitiesSchema,
  deriveCuaSemanticCapabilities,
  loadCuaDriverCatalog,
  normalizedCuaActionEffect,
  parseCuaStructuredResult,
  type CuaOpenToolResult,
  type CuaSemanticCapabilities,
  type CuaWindow,
  type TrustedApplicationIdentity,
  type VisibleApplicationSurface,
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
  imageEvidencePolicy?: Pick<ImageEvidencePolicy, 'clear' | 'inspect' | 'prepare'>;
  now?: () => number;
  onPerformanceMetric?: (metric: CuaPerformanceMetric) => void;
  platform?: NodeJS.Platform;
  performanceNow?: () => number;
  waitForSystemUiReveal?: (signal?: AbortSignal) => Promise<void>;
}

export interface CuaCatalogRegistrationFailure {
  readonly message: string;
  readonly name: string;
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

function getSupportedPlatform(
  platform: NodeJS.Platform = process.platform,
): CuaStatus['platform'] {
  if (platform === 'darwin') return 'darwin';
  if (platform === 'win32') return 'win32';
  if (platform === 'linux') return 'linux';
  return 'unsupported';
}

export interface CuaDictationStatus {
  reason?: 'accessibility' | 'driver' | 'platform';
  state: 'disconnected' | 'error' | 'permission_required' | 'ready' | 'unavailable';
  summary: string;
}

export interface CuaDictationDeliveryResult {
  effect: 'confirmed' | 'delivery_unverified' | 'refused_before_execution';
  errorCode?: string;
}

const CUA_REFUSED_BEFORE_EXECUTION_PATTERN =
  /(?:stale|not[_ -]?found|invalid[_ -]?(?:ref|token)|owner_pid_mismatch|permission_required|refus)/iu;

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
  private driverInitialization: Promise<void> | null = null;
  private driverVersion: string | undefined;

  private driverCatalog: CuaDriverCatalog | null = null;

  private driverCatalogReport: CuaDriverCatalogReport | null = null;

  private semanticCapabilityState: CuaSemanticCapabilities =
    NO_SEMANTIC_CAPABILITIES;

  private surfaceRouter: CuaSurfaceRouter | null = null;

  private authorizationBroker: CuaCapabilityBroker | null = null;

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

  private readonly imageEvidencePolicy?: Pick<
    ImageEvidencePolicy,
    'clear' | 'inspect' | 'prepare'
  >;

  private readonly platform: NodeJS.Platform;

  private readonly performanceNow: () => number;

  private readonly waitForSystemUiReveal: (
    signal?: AbortSignal,
  ) => Promise<void>;

  constructor(options: CuaServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.imageEvidencePolicy = options.imageEvidencePolicy;
    this.onPerformanceMetric = options.onPerformanceMetric;
    this.platform = options.platform ?? process.platform;
    this.performanceNow = options.performanceNow ?? performance.now.bind(performance);
    this.waitForSystemUiReveal =
      options.waitForSystemUiReveal ?? defaultSystemUiRevealWait;
  }

  semanticCapabilities(): CuaSemanticCapabilities {
    return this.semanticCapabilityState;
  }

  cuaToolCatalog(): CuaDriverCatalog | null {
    return this.driverCatalog;
  }

  cuaToolCatalogReport(): CuaDriverCatalogReport | null {
    return this.driverCatalogReport;
  }

  reportToolCatalogRegistrationFailures(
    failures: readonly CuaCatalogRegistrationFailure[],
  ): void {
    if (!this.driverCatalog || !this.driverCatalogReport || failures.length === 0) {
      return;
    }
    const required = new Set(this.driverCatalog.requiredTools);
    const requiredToolFailures = [
      ...this.driverCatalogReport.requiredToolFailures,
      ...failures.flatMap((failure) =>
        required.has(failure.name)
          ? [
              {
                code: 'incompatible_required_tool' as const,
                message: `Required CUA model tool ${failure.name} could not be registered: ${failure.message}`,
                name: failure.name,
              },
            ]
          : [],
      ),
    ];
    const quarantinedTools = [
      ...this.driverCatalogReport.quarantinedTools,
      ...failures.map((failure) => ({
        code: 'invalid_tool_contract' as const,
        message: `CUA tool ${failure.name} could not be registered: ${failure.message}`,
        name: failure.name,
      })),
    ];
    this.driverCatalogReport = {
      ...this.driverCatalogReport,
      quarantinedTools,
      requiredToolFailures,
      state: requiredToolFailures.length > 0 ? 'unavailable' : 'degraded',
    };
    for (const failure of requiredToolFailures) {
      console.error(
        '[cua] catalog.required-tool-failed',
        JSON.stringify(failure),
      );
    }
    if (requiredToolFailures.length > 0) this.driverCatalog = null;
  }

  async discoverToolCatalog(): Promise<CuaDriverCatalog> {
    if (this.driverCatalog) return this.driverCatalog;
    const cua = await this.loadModule();
    const driver = cua.CuaDriver.create(undefined) as Driver;
    try {
      const metadata = await driver.metadata();
      this.driverCatalog = this.admitDriverCatalog(
        metadata,
        JSON.parse(await driver.listToolsJson()),
      );
      return this.driverCatalog;
    } finally {
      await driver.shutdown();
      driver.uniffiDestroy();
    }
  }

  supportsSemanticFastPath(): boolean {
    return (
      this.semanticCapabilityState.windowState &&
      this.semanticCapabilityState.windowActions
    );
  }

  externalLessonWindows(signal?: AbortSignal) { return this.surfaceRouter?.externalWindows(signal) ?? Promise.resolve([]); }

  async observeLessonWindow(taskId: string, identity: { processId: number; windowId: number } | undefined,
    signal?: AbortSignal) {
    this.assertActiveSession(taskId);
    const result = await this.surfaceRouter?.observeExternalWindow(taskId, identity, signal);
    return result ? { ...result, observation: this.imageEvidencePolicy?.prepare(taskId, result.observation) ?? result.observation } : undefined;
  }

  async queryVisibleApplicationSurfaces(
    application: TrustedApplicationIdentity,
    signal?: AbortSignal,
  ): Promise<VisibleApplicationSurface[]> {
    if (!this.supportsSemanticFastPath() || !this.surfaceRouter) return [];
    return this.surfaceRouter.queryVisibleApplicationSurfaces(application, signal);
  }

  async getStatus(): Promise<CuaStatus> {
    const platform = getSupportedPlatform(this.platform);
    if (platform === 'unsupported') {
      return {
        state: 'error',
        available: false,
        platform,
        summary: `CUA does not support ${this.platform}.`,
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

      if (this.driverCatalogReport?.state === 'unavailable') {
        return {
          state: 'error',
          available: false,
          platform,
          permissions,
          summary: this.catalogUnavailableMessage(),
          nextActions: [
            'Install a compatible CUA driver before starting computer-use tasks.',
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
        summary:
          this.driverCatalogReport?.state === 'degraded'
            ? `CUA is connected in compatibility mode with ${this.driverCatalogReport.quarantinedTools.length} optional tool(s) quarantined.`
            : 'CUA is connected to this desktop process.',
        nextActions:
          this.driverCatalogReport?.state === 'degraded'
            ? [
                'Upgrade CUA Core to remove legacy adapters or quarantined optional tools.',
                'Compatible tools remain available for tasks.',
              ]
            : ['Give Tro a goal that requires computer use.'],
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

  async getDictationStatus(): Promise<CuaDictationStatus> {
    const platform = getSupportedPlatform(this.platform);
    if (platform === 'unsupported') {
      return {
        reason: 'platform',
        state: 'unavailable',
        summary: `Voice dictation does not support ${this.platform}.`,
      };
    }
    try {
      const cua = await this.loadModule();
      if (platform === 'darwin') {
        const permissions = cua.currentMacOsPermissionStatus();
        if (!permissions.accessibility) {
          return {
            reason: 'accessibility',
            state: 'permission_required',
            summary: 'Accessibility permission is required for system-wide dictation.',
          };
        }
      }
      if (!this.driver) {
        return {
          state: 'disconnected',
          summary: 'The dictation runtime is ready to initialize.',
        };
      }
      if (!this.driver.isAvailable()) {
        return {
          reason: 'driver',
          state: 'error',
          summary: 'The dictation runtime is not available.',
        };
      }
      return {
        state: 'ready',
        summary: 'System-wide dictation is ready.',
      };
    } catch (error) {
      return {
        reason: 'driver',
        state: 'error',
        summary: errorMessage(error),
      };
    }
  }

  async connectForDictation(): Promise<CuaDictationStatus> {
    const status = await this.getDictationStatus();
    if (status.state !== 'disconnected') return status;
    try {
      const cua = await this.loadModule();
      await this.ensureDriverInitialized(cua);
      return this.getDictationStatus();
    } catch (error) {
      return {
        reason: 'driver',
        state: 'error',
        summary: errorMessage(error),
      };
    }
  }

  async startTaskSession(taskId: string, signal?: AbortSignal): Promise<void> {
    return this.startSession(taskId, signal);
  }

  async startDictationSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.startSession(sessionId, signal);
  }

  async listDictationWindows(signal?: AbortSignal): Promise<CuaWindow[]> {
    const result = await this.callOpenTool(
      'list_windows',
      { on_screen_only: true },
      signal,
    );
    if (result.isError) {
      throw new Error(
        result.errorCode || result.text || 'CUA could not list application windows.',
      );
    }
    return parseCuaStructuredResult(result, CuaWindowListSchema).windows;
  }

  async typeDictationText(
    input: {
      processId: number;
      sessionId: string;
      text: string;
      windowId: number;
    },
    signal?: AbortSignal,
  ): Promise<CuaDictationDeliveryResult> {
    this.assertActiveSession(input.sessionId);
    const result = await this.callOpenTool(
      'type_text',
      {
        delivery_mode: 'background',
        pid: input.processId,
        session: input.sessionId,
        text: input.text,
        window_id: input.windowId,
      },
      signal,
    );
    const effect = normalizedCuaActionEffect(result);
    const refusedBeforeExecution =
      effect === 'refused' ||
      CUA_REFUSED_BEFORE_EXECUTION_PATTERN.test(
        `${result.errorCode ?? ''} ${result.text}`.slice(0, 4_000),
      );
    if (refusedBeforeExecution) {
      return {
        effect: 'refused_before_execution',
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      };
    }
    if (!result.isError && effect === 'confirmed') {
      return {
        effect: 'confirmed',
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      };
    }
    return {
      effect: 'delivery_unverified',
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    };
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
    return this.imageEvidencePolicy?.prepare(taskId, observation) ?? observation;
  }

  async observeCurrentSurface(taskId: string, options: ObserveSurfaceOptions = {}, signal?: AbortSignal): Promise<DesktopObservation | undefined> {
    this.assertActiveSession(taskId);
    const observation = this.supportsSemanticFastPath()
      ? await this.surfaceRouter?.observeCurrentSurface(taskId, options, signal)
      : undefined;
    return observation ? this.imageEvidencePolicy?.prepare(taskId, observation) ?? observation : undefined;
  }

  inspectSurfaceRegion(
    taskId: string,
    observationId: string,
    region: unknown,
  ): {
    dataUrl: string;
    height: number;
    observationId: string;
    region: unknown;
    width: number;
  } {
    this.assertActiveSession(taskId);
    if (!this.imageEvidencePolicy) {
      throw new Error('Original-resolution image inspection is unavailable.');
    }
    return this.imageEvidencePolicy.inspect(taskId, observationId, region);
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
      const movement = await traceNativeCall('move_cursor', { session: taskId }, () => driver.moveCursor(
        cua.MoveCursorInput.new({
          session: taskId,
          scope: cua.DesktopScope.Desktop,
          x,
          y,
        }),
        asyncOptions,
      ));
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
          return traceNativeCall('click', { session: taskId }, () => driver.click(
            cua.ClickInput.new({
              session: taskId,
              scope: cua.DesktopScope.Desktop,
              x: command.x,
              y: command.y,
              button,
              count: command.count,
            }),
            asyncOptions,
          ));
        }
        case 'point':
          return movePointer(command.x, command.y);
        case 'drag': {
          const button = {
            left: cua.ClickButton.Left,
            middle: cua.ClickButton.Middle,
            right: cua.ClickButton.Right,
          }[command.button];
          return traceNativeCall('drag', { session: taskId }, () => driver.drag(
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
          ));
        }
        case 'type_text':
          return traceNativeCall('type_text', { session: taskId }, () => driver.typeText(
            cua.TypeTextInput.new({
              session: taskId,
              scope: cua.DesktopScope.Desktop,
              text: command.text,
            }),
            asyncOptions,
          ));
        case 'paste_table': {
          const clipboardResult = await traceNativeCall('clipboard_write', { session: taskId }, () => driver.clipboardWrite(
            cua.ClipboardWriteInput.new({
              session: taskId,
              text: tableRowsToTsv(command.rows),
            }),
            asyncOptions,
          ));
          if (
            clipboardResult.isError ||
            clipboardResult.action?.effect === cua.ActionEffect.Refused
          ) {
            return clipboardResult;
          }
          return traceNativeCall('hotkey', { session: taskId }, () => driver.hotkey(
            cua.HotkeyInput.new({
              session: taskId,
              scope: cua.DesktopScope.Desktop,
              keys: pasteShortcutForPlatform(process.platform),
            }),
            asyncOptions,
          ));
        }
        case 'keypress':
          if (command.keys.length === 1) {
            return traceNativeCall('press_key', { session: taskId }, () => driver.pressKey(
              cua.PressKeyInput.new({
                session: taskId,
                scope: cua.DesktopScope.Desktop,
                key: command.keys[0]!,
              }),
              asyncOptions,
            ));
          }
          return traceNativeCall('hotkey', { session: taskId }, () => driver.hotkey(
            cua.HotkeyInput.new({
              session: taskId,
              scope: cua.DesktopScope.Desktop,
              keys: command.keys,
            }),
            asyncOptions,
          ));
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
          return traceNativeCall('scroll', { session: taskId }, () => driver.scroll(
            cua.ScrollInput.new({
              session: taskId,
              scope: cua.DesktopScope.Desktop,
              x: command.x,
              y: command.y,
              direction,
              amount: BigInt(command.amount),
            }),
            asyncOptions,
          ));
        }
      }
    })();

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

  async executeCuaTool(
    taskId: string,
    toolName: string,
    input: Record<string, unknown>,
    driverCatalogDigest: string,
    signal?: AbortSignal,
  ): Promise<ToolExecutionResult> {
    await this.startTaskSession(taskId, signal);
    const catalog = this.driverCatalog;
    if (!catalog || catalog.driverCatalogDigest !== driverCatalogDigest) {
      return {
        status: 'not_executed',
        summary: 'The installed CUA tool catalog changed before execution.',
      };
    }
    const tool = catalog.tools.find((candidate) => candidate.name === toolName);
    if (!tool) {
      return {
        status: 'not_executed',
        summary: 'The requested CUA tool is not in the installed driver catalog.',
      };
    }
    const argumentsValue = {
      ...input,
      ...(tool.injectSession ? { session: taskId } : {}),
    };
    const result = await this.callOpenTool(tool.name, argumentsValue, signal);
    return cuaOpenToolOutcome(tool.name, result);
  }

  async endTaskSession(taskId: string, signal?: AbortSignal): Promise<void> {
    this.surfaceRouter?.clearTask(taskId);
    this.imageEvidencePolicy?.clear(taskId);
    this.desktopScopeSessions.delete(taskId);
    this.latestCoordinateSpaces.delete(taskId);
    this.windowsBottomEdgeAwaitingObservation.delete(taskId);
    this.windowsBottomEdgeReadyUntil.delete(taskId);
    await this.endSession(taskId, signal);
  }

  async endDictationSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.endSession(sessionId, signal);
  }

  private async startSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.activeSessions.has(sessionId)) return;
    const cua = await this.loadModule();
    const started = await this.requireDriver().startSession(
      cua.StartSessionInput.new({
        session: sessionId,
        captureScope: cua.CaptureScope.Auto,
      }),
      signal ? { signal } : undefined,
    );
    if (!started.active) {
      throw new Error('CUA did not activate the requested session.');
    }
    if (started.state.effectiveScope === cua.EffectiveScope.Desktop) {
      this.desktopScopeSessions.add(sessionId);
    }
    console.info(
      '[cua] session.started',
      JSON.stringify({
        sessionKind: sessionId.startsWith('dictation:') ? 'dictation' : 'task',
        captureScope: started.state?.captureScope ?? null,
        effectiveScope: started.state?.effectiveScope ?? null,
        desktopUnlocked: started.state?.desktopUnlocked ?? null,
        revived: started.revived ?? null,
      }),
    );
    this.activeSessions.add(sessionId);
  }

  private async endSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    this.desktopScopeSessions.delete(sessionId);
    if (!this.activeSessions.delete(sessionId)) return;
    const cua = await this.loadModule();
    await this.requireDriver().endSession(
      cua.EndSessionInput.new({ session: sessionId }),
      signal ? { signal } : undefined,
    );
  }

  private async initializeDriver(
    requestMissingPermissions: boolean,
  ): Promise<CuaStatus> {
    const platform = getSupportedPlatform(this.platform);

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

      await this.ensureDriverInitialized(cua);

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

  private async ensureDriverInitialized(cua: CuaModule): Promise<void> {
    if (this.driverInitialization) {
      await this.driverInitialization;
      return;
    }
    if (this.driver) return;
    const initialization = this.initializeDriverInstance(cua);
    this.driverInitialization = initialization;
    try {
      await initialization;
    } finally {
      if (this.driverInitialization === initialization) {
        this.driverInitialization = null;
      }
    }
  }

  private async initializeDriverInstance(cua: CuaModule): Promise<void> {
    const authorizationBroker = new CuaCapabilityBroker({
      allow: cua.DriverAuthorizationAction.Allow,
      cancel: cua.DriverAuthorizationAction.Cancel,
      deny: cua.DriverAuthorizationAction.Deny,
    });
    const configuredOptions = cua.ConfiguredDriverOptions.new({
      claudeCodeCompatibility: false,
      authorization: cua.RuntimeAuthorizationOptions.new({
        allowedModes: [cua.SessionPermissionMode.Unrestricted],
        compatibilityMode: cua.SessionPermissionMode.Unrestricted,
        unrestrictedAcknowledged: true,
        maxSessionTtlSeconds: 7_200n,
        maxIdleTtlSeconds: 900n,
      }),
    });
    const driver = cua.CuaDriver.createConfiguredWithHostIntegrations(
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
    this.driver = driver;
    try {
      const metadata = CuaDriverMetadataSchema.parse(await driver.metadata());
      this.driverVersion = metadata.driverVersion;
      const inventory = JSON.parse(await driver.listToolsJson());
      this.driverCatalog = this.admitDriverCatalog(metadata, inventory);
      this.semanticCapabilityState = deriveCuaSemanticCapabilities(inventory);
      this.authorizationBroker = authorizationBroker;
      this.surfaceRouter = new CuaSurfaceRouter({
        authorizationBroker,
        callTool: (name, argumentsValue, signal) =>
          this.callOpenTool(name, argumentsValue, signal),
        capabilities: () => this.semanticCapabilityState,
        now: this.now,
      });
    } catch (error) {
      this.driver = null;
      try {
        await driver.shutdown();
      } finally {
        driver.uniffiDestroy();
      }
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    await this.driverInitialization?.catch(() => undefined);
    const driver = this.driver;
    this.driver = null;
    this.driverVersion = undefined;
    this.driverCatalog = null;
    this.driverCatalogReport = null;
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

  private admitDriverCatalog(
    metadata: unknown,
    inventory: unknown,
  ): CuaDriverCatalog {
    const result = loadCuaDriverCatalog(metadata, inventory);
    this.driverCatalogReport = result.report;
    for (const message of result.report.compatibilityMessages) {
      console.warn('[cua] catalog.compatibility', JSON.stringify({ message }));
    }
    for (const tool of result.report.quarantinedTools) {
      console.warn('[cua] catalog.tool-quarantined', JSON.stringify(tool));
    }
    for (const failure of result.report.requiredToolFailures) {
      console.error('[cua] catalog.required-tool-failed', JSON.stringify(failure));
    }
    if (!result.catalog) throw new Error(this.catalogUnavailableMessage());
    return result.catalog;
  }

  private catalogUnavailableMessage(): string {
    return (
      this.driverCatalogReport?.requiredToolFailures[0]?.message ??
      this.driverCatalogReport?.compatibilityMessages[0] ??
      'The CUA tool catalog is incompatible with this TroCode build.'
    );
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
      const result = await traceNativeCall(name, argumentsValue, () => this.requireDriver().callTool(
        name, JSON.stringify(argumentsValue), signal ? { signal } : undefined,
      ));
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
