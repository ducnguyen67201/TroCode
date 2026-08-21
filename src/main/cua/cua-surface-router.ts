import { createHash, randomUUID } from 'node:crypto';

import {
  DesktopObservationSchema,
  SurfaceActionOutcomeSchema,
  type DesktopObservation,
  type SurfaceActionOutcome,
  type SurfaceCommand,
  type SurfaceDescriptor,
  type SurfaceElement,
} from '../agent/execution-contracts';

import type { CuaAuthorizationBroker } from './cua-authorization-broker';
import {
  CuaActionStructuredSchema,
  CuaBrowserStateSchema,
  CuaWindowListSchema,
  CuaWindowStateSchema,
  parseCuaStructuredResult,
  type CuaBrowserElement,
  type CuaOpenToolResult,
  type CuaSemanticCapabilities,
  type CuaWindow,
  type CuaWindowElement,
  type TrustedApplicationIdentity,
  type VisibleApplicationSurface,
} from './cua-semantic-contracts';
import {
  CuaSurfaceReferenceStore,
  type CuaBoundReference,
  type CuaSurfaceBinding,
} from './cua-surface-reference-store';

const MAX_PUBLIC_ELEMENTS = 400;
const MAX_TEXT_LENGTH = 100_000;
const MAX_STRUCTURED_STATE_LENGTH = 500_000;
const CODE_EDITOR_PATTERN = /\b(?:code|code-oss|visual studio code|vscode)\b/iu;
const BROWSER_PATTERN =
  /\b(?:arc|brave|chrome|chromium|edge|opera|vivaldi)\b/iu;
const TROCODE_PATTERN = /\btro(?:\s*code)?\b/iu;
const SECRET_ROLE_PATTERN = /(?:password|secure)/iu;
const STALE_OR_REFUSED_PATTERN =
  /(?:stale|not[_ -]?found|invalid[_ -]?(?:ref|token)|owner_pid_mismatch|permission_required|refus)/iu;
const CHROME_DRIVER_IDENTITIES = new Set([
  'google chrome',
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
]);

export type CuaToolCaller = (
  name: string,
  argumentsValue: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<CuaOpenToolResult>;

export interface ObserveSurfaceOptions {
  allowScreenshot?: boolean;
  query?: string;
}

export interface SurfaceRevalidationResult {
  currentObservation: DesktopObservation;
  rebound: boolean;
}

export interface CuaSurfaceRouterOptions {
  authorizationBroker: CuaAuthorizationBroker;
  callTool: CuaToolCaller;
  capabilities: () => CuaSemanticCapabilities;
  now?: () => number;
  ownProcessId?: number;
  referenceStore?: CuaSurfaceReferenceStore;
}

interface SurfaceSnapshot {
  binding: CuaSurfaceBinding;
  observation: DesktopObservation;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function boundedString(value: unknown, maximum: number): string | undefined {
  if (typeof value === 'string') return value.slice(0, maximum);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).slice(0, maximum);
  }
  return undefined;
}

function surfaceKind(application: string): SurfaceDescriptor['kind'] {
  if (CODE_EDITOR_PATTERN.test(application)) return 'code_editor';
  if (BROWSER_PATTERN.test(application)) return 'browser';
  return 'native_app';
}

function surfaceBounds(window: CuaWindow) {
  return {
    x: Math.round(window.bounds.x),
    y: Math.round(window.bounds.y),
    width: Math.max(1, Math.round(window.bounds.width)),
    height: Math.max(1, Math.round(window.bounds.height)),
  };
}

function selectWindow(
  windows: readonly CuaWindow[],
  ownProcessId: number,
  previous?: CuaSurfaceBinding,
): CuaWindow | undefined {
  const candidates = windows.filter(
    (window) =>
      window.pid !== ownProcessId &&
      !TROCODE_PATTERN.test(window.app_name) &&
      window.is_on_screen &&
      window.on_current_space &&
      window.bounds.width > 0 &&
      window.bounds.height > 0,
  );
  if (candidates.length === 0) return undefined;

  if (previous) {
    const retained = candidates.find(
      (window) =>
        window.pid === previous.processId &&
        window.window_id === previous.windowId,
    );
    if (retained) return retained;
  }

  const ranked = candidates.filter(
    (window): window is CuaWindow & { z_index: number } =>
      typeof window.z_index === 'number',
  );
  if (ranked.length === 0) return candidates.length === 1 ? candidates[0] : undefined;
  const highest = Math.max(...ranked.map((window) => window.z_index));
  const leaders = ranked.filter((window) => window.z_index === highest);
  return leaders.length === 1 ? leaders[0] : undefined;
}

function semanticFingerprint(element: Omit<SurfaceElement, 'ref'>): string {
  return hash({
    role: element.role,
    name: element.name,
    value: element.value ?? null,
    href: element.href ?? null,
    bounds: element.bounds ?? null,
    disabled: element.disabled ?? null,
    selected: element.selected ?? null,
  });
}

function windowElementToPublic(
  element: CuaWindowElement,
  publicRef: string,
): SurfaceElement | undefined {
  if (SECRET_ROLE_PATTERN.test(element.role)) return undefined;
  const name =
    boundedString(element.label ?? element.name ?? element.value, 2_000)?.trim() ||
    element.role.slice(0, 120);
  const value = boundedString(element.value, 8_000);
  const frame = element.frame;
  const bounds =
    frame && frame.w > 0 && frame.h > 0
      ? {
          x: Math.round(frame.x),
          y: Math.round(frame.y),
          width: Math.max(1, Math.round(frame.w)),
          height: Math.max(1, Math.round(frame.h)),
        }
      : undefined;
  return {
    ref: publicRef,
    role: element.role.slice(0, 120),
    name,
    ...(value ? { value } : {}),
    ...(bounds ? { bounds } : {}),
    ...(element.disabled !== undefined
      ? { disabled: element.disabled }
      : element.enabled !== undefined
        ? { disabled: !element.enabled }
        : {}),
    ...(element.selected !== undefined ? { selected: element.selected } : {}),
  };
}

function browserElementToPublic(
  element: CuaBrowserElement,
  publicRef: string,
): SurfaceElement | undefined {
  if (SECRET_ROLE_PATTERN.test(element.role)) return undefined;
  const name =
    boundedString(
      element.name ?? element.label ?? element.text ?? element.value,
      2_000,
    )?.trim() || element.role.slice(0, 120);
  const value = boundedString(element.value ?? element.text, 8_000);
  const bounds =
    element.bounds && element.bounds.width > 0 && element.bounds.height > 0
      ? {
          x: Math.round(element.bounds.x),
          y: Math.round(element.bounds.y),
          width: Math.max(1, Math.round(element.bounds.width)),
          height: Math.max(1, Math.round(element.bounds.height)),
        }
      : undefined;
  return {
    ref: publicRef,
    role: element.role.slice(0, 120),
    name,
    ...(value ? { value } : {}),
    ...(element.href ? { href: element.href.slice(0, 8_000) } : {}),
    ...(bounds ? { bounds } : {}),
    ...(element.disabled !== undefined ? { disabled: element.disabled } : {}),
    ...(element.selected !== undefined ? { selected: element.selected } : {}),
  };
}

function publicStructuredState(
  surface: SurfaceDescriptor,
  elements: readonly SurfaceElement[],
): string {
  return JSON.stringify({ surface, elements }).slice(0, MAX_STRUCTURED_STATE_LENGTH);
}

function summarizedElements(elements: readonly SurfaceElement[]): string {
  return elements
    .map((element) => `${element.ref} [${element.role}] ${element.name}`)
    .join('\n')
    .slice(0, MAX_TEXT_LENGTH);
}

function actionEffect(result: CuaOpenToolResult): string | undefined {
  if (result.structuredJson || result.rawJson) {
    try {
      return parseCuaStructuredResult(result, CuaActionStructuredSchema).effect;
    } catch {
      // Fall through to the generated numeric ActionEffect contract.
    }
  }
  return result.action?.effect === 0
    ? 'confirmed'
    : result.action?.effect === 1
      ? 'partial'
      : result.action?.effect === 2
        ? 'unverifiable'
        : result.action?.effect === 3
          ? 'suspected_noop'
          : result.action?.effect === 4
            ? 'refused'
            : undefined;
}

function refusedBeforeExecution(result: CuaOpenToolResult): boolean {
  if (actionEffect(result) === 'refused') return true;
  return STALE_OR_REFUSED_PATTERN.test(
    `${result.errorCode ?? ''} ${result.text}`.slice(0, 4_000),
  );
}

function resourceContainsWindow(
  value: unknown,
  processId: number,
  windowId: number,
  depth = 0,
): boolean {
  if (depth > 8 || !value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const pid = record.pid ?? record.process_id ?? record.processId;
  const window = record.window_id ?? record.windowId;
  if (pid === processId && window === windowId) return true;
  return Object.values(record).some((child) =>
    resourceContainsWindow(child, processId, windowId, depth + 1),
  );
}

export class CuaSurfaceRouter {
  readonly referenceStore: CuaSurfaceReferenceStore;

  private readonly now: () => number;
  private readonly ownProcessId: number;

  constructor(private readonly options: CuaSurfaceRouterOptions) {
    this.now = options.now ?? Date.now;
    this.ownProcessId = options.ownProcessId ?? process.pid;
    this.referenceStore =
      options.referenceStore ?? new CuaSurfaceReferenceStore();
  }

  available(): boolean {
    const capabilities = this.options.capabilities();
    return capabilities.windowState && capabilities.windowActions;
  }

  async observeCurrentSurface(
    taskId: string,
    observeOptions: ObserveSurfaceOptions = {},
    signal?: AbortSignal,
  ): Promise<DesktopObservation | undefined> {
    if (!this.available()) return undefined;
    const listed = await this.options.callTool(
      'list_windows',
      { on_screen_only: true },
      signal,
    );
    if (listed.isError) return undefined;
    let windows;
    try {
      windows = parseCuaStructuredResult(listed, CuaWindowListSchema).windows;
    } catch {
      return undefined;
    }
    const window = selectWindow(
      windows,
      this.ownProcessId,
      this.referenceStore.current(taskId),
    );
    if (!window) return undefined;
    const snapshot = await this.observeWindow(
      taskId,
      window,
      observeOptions,
      signal,
    );
    if (!snapshot) return undefined;
    this.referenceStore.replace(snapshot.binding);
    return snapshot.observation;
  }

  async queryVisibleApplicationSurfaces(
    application: TrustedApplicationIdentity,
    signal?: AbortSignal,
  ): Promise<VisibleApplicationSurface[]> {
    if (!this.available()) return [];
    const listed = await this.options.callTool(
      'list_windows',
      { on_screen_only: true },
      signal,
    );
    if (listed.isError) return [];
    const windows = parseCuaStructuredResult(listed, CuaWindowListSchema).windows;
    return windows
      .filter((window) => {
        if (
          !window.is_on_screen ||
          !window.on_current_space ||
          window.bounds.width <= 0 ||
          window.bounds.height <= 0
        ) {
          return false;
        }
        return (
          application === 'chrome' &&
          CHROME_DRIVER_IDENTITIES.has(window.app_name.trim().toLocaleLowerCase('en-US'))
        );
      })
      .map((window) => ({
        application,
        observationId: randomUUID(),
        observedAt: new Date(this.now()).toISOString(),
        observationFingerprint: hash({
          application,
          bounds: window.bounds,
          pid: window.pid,
          windowId: window.window_id,
        }),
      }));
  }

  async execute(
    taskId: string,
    observationId: string,
    command: SurfaceCommand,
    signal?: AbortSignal,
  ): Promise<SurfaceActionOutcome> {
    const binding = this.referenceStore.require(taskId, observationId);
    const ref = 'ref' in command && command.ref
      ? this.referenceStore.resolve(taskId, observationId, command.ref)
      : undefined;
    const result = await this.executeBound(binding, ref, command, signal);
    if (refusedBeforeExecution(result)) {
      return SurfaceActionOutcomeSchema.parse({
        status: 'not_executed',
        summary: result.text || result.errorCode || 'CUA refused a stale target.',
      });
    }
    if (result.isError) {
      return SurfaceActionOutcomeSchema.parse({
        status: 'failed',
        summary: result.text || result.errorCode || 'CUA could not execute the action.',
      });
    }

    const effect = actionEffect(result);
    let fresh: SurfaceSnapshot | undefined;
    try {
      fresh = await this.observeBoundSurface(taskId, binding, {}, signal);
    } catch {
      fresh = undefined;
    }
    if (!fresh) {
      return SurfaceActionOutcomeSchema.parse({
        status: effect === 'confirmed' ? 'unknown' : 'unknown',
        summary:
          'CUA may have delivered the action, but Tro could not refresh the exact surface.',
      });
    }
    this.referenceStore.replace(fresh.binding);

    const stateChanged = fresh.observation.fingerprint !== binding.observationFingerprint;
    if (effect === 'confirmed' || stateChanged) {
      return SurfaceActionOutcomeSchema.parse({
        status: 'confirmed',
        summary: result.text || 'CUA confirmed the semantic surface action.',
        observation: fresh.observation,
      });
    }
    return SurfaceActionOutcomeSchema.parse({
      status: 'unknown',
      summary:
        result.text || 'CUA could not confirm whether the semantic action changed the surface.',
      observation: fresh.observation,
    });
  }

  async revalidate(
    taskId: string,
    observationId: string,
    publicRef?: string,
    signal?: AbortSignal,
  ): Promise<SurfaceRevalidationResult> {
    const previous = this.referenceStore.require(taskId, observationId);
    const approved = publicRef
      ? this.referenceStore.resolve(taskId, observationId, publicRef)
      : undefined;
    const fresh = await this.observeBoundSurface(taskId, previous, {}, signal);
    if (!fresh || fresh.binding.surfaceIdentityHash !== previous.surfaceIdentityHash) {
      return {
        currentObservation: fresh?.observation ?? this.observationFromBinding(previous),
        rebound: false,
      };
    }
    if (!approved || !publicRef) {
      this.referenceStore.replace({
        ...fresh.binding,
        observationId,
      });
      return { currentObservation: fresh.observation, rebound: true };
    }
    const match = this.referenceStore.findUniqueMatch(
      fresh.binding,
      approved.semanticFingerprint,
    );
    if (!match) {
      this.referenceStore.replace(fresh.binding);
      return { currentObservation: fresh.observation, rebound: false };
    }

    const rebound: CuaSurfaceBinding = {
      ...fresh.binding,
      observationId,
      references: new Map([
        [
          publicRef,
          {
            ...match,
            publicElement: approved.publicElement,
          },
        ],
      ]),
    };
    this.referenceStore.replace(rebound);
    return { currentObservation: fresh.observation, rebound: true };
  }

  async prepareBrowserAccess(
    taskId: string,
    observationId: string,
    signal?: AbortSignal,
  ): Promise<SurfaceActionOutcome> {
    const binding = this.referenceStore.require(taskId, observationId);
    if (!this.options.capabilities().browserPrepare) {
      return {
        status: 'not_executed',
        summary: 'The installed CUA runtime does not expose browser preparation.',
      };
    }
    const disarm = this.options.authorizationBroker.arm({
      expiresUnixMs: this.now() + 60_000,
      publicSession: taskId,
      matchesResource: (resource) =>
        resourceContainsWindow(resource, binding.processId, binding.windowId),
    });
    try {
      const result = await this.options.callTool(
        'browser_prepare',
        {
          pid: binding.processId,
          window_id: binding.windowId,
          session: taskId,
          strategy: { kind: 'existing_profile' },
        },
        signal,
      );
      if (refusedBeforeExecution(result)) {
        return {
          status: 'not_executed',
          summary: result.text || 'CUA refused browser-profile attachment.',
        };
      }
      if (result.isError) {
        return {
          status: 'failed',
          summary: result.text || result.errorCode || 'Browser preparation failed.',
        };
      }
      return {
        status: 'confirmed',
        summary: result.text || 'CUA prepared the current browser for this task.',
      };
    } finally {
      disarm();
    }
  }

  clearTask(taskId: string): void {
    this.referenceStore.clearTask(taskId);
  }

  clear(): void {
    this.referenceStore.clear();
  }

  private async observeWindow(
    taskId: string,
    window: CuaWindow,
    observeOptions: ObserveSurfaceOptions,
    signal?: AbortSignal,
  ): Promise<SurfaceSnapshot | undefined> {
    const capabilities = this.options.capabilities();
    if (capabilities.browserState && BROWSER_PATTERN.test(window.app_name)) {
      const browser = await this.observeBrowser(
        taskId,
        window,
        observeOptions,
        signal,
      );
      if (browser) return browser;
    }
    return this.observeAccessibility(taskId, window, observeOptions, signal);
  }

  private async observeBoundSurface(
    taskId: string,
    binding: CuaSurfaceBinding,
    observeOptions: ObserveSurfaceOptions,
    signal?: AbortSignal,
  ): Promise<SurfaceSnapshot | undefined> {
    const window: CuaWindow = {
      window_id: binding.windowId,
      pid: binding.processId,
      app_name: binding.surface.application,
      title: binding.surface.title ?? '',
      bounds: binding.surface.bounds ?? { x: 0, y: 0, width: 1, height: 1 },
      z_index: 0,
      is_on_screen: true,
      on_current_space: true,
    };
    if (binding.route === 'browser_semantic') {
      const browser = await this.observeBrowser(
        taskId,
        window,
        observeOptions,
        signal,
      );
      if (browser) return browser;
    }
    return this.observeAccessibility(taskId, window, observeOptions, signal);
  }

  private async observeAccessibility(
    taskId: string,
    window: CuaWindow,
    observeOptions: ObserveSurfaceOptions,
    signal?: AbortSignal,
  ): Promise<SurfaceSnapshot | undefined> {
    const call = async (includeScreenshot: boolean) =>
      this.options.callTool(
        'get_window_state',
        {
          pid: window.pid,
          window_id: window.window_id,
          session: taskId,
          include_screenshot: includeScreenshot,
          max_elements: 500,
          max_depth: 12,
          ...(observeOptions.query ? { query: observeOptions.query.slice(0, 500) } : {}),
        },
        signal,
      );

    let result = await call(false);
    if (result.isError) return undefined;
    let state;
    try {
      state = parseCuaStructuredResult(result, CuaWindowStateSchema);
    } catch {
      return undefined;
    }
    let includeScreenshot =
      observeOptions.allowScreenshot !== false &&
      (state.elements.length === 0 || Boolean(state.degraded_reason) || result.degraded);
    if (includeScreenshot) {
      const visual = await call(true);
      if (!visual.isError) {
        try {
          state = parseCuaStructuredResult(visual, CuaWindowStateSchema);
          result = visual;
        } catch {
          // Retain the truthful accessibility-only state.
          includeScreenshot = false;
        }
      }
    }
    if (state.elements.length === 0) return undefined;

    const surface: SurfaceDescriptor = {
      kind: surfaceKind(window.app_name),
      application: window.app_name.slice(0, 120) || 'Application',
      ...(window.title ? { title: window.title.slice(0, 500) } : {}),
      bounds: surfaceBounds(window),
      ...(BROWSER_PATTERN.test(window.app_name)
        ? {
            deepAccess: this.options.capabilities().browserPrepare
              ? ('available_requires_approval' as const)
              : ('unavailable' as const),
          }
        : {}),
    };
    const observationId = randomUUID();
    const references = new Map<string, CuaBoundReference>();
    const publicElements: SurfaceElement[] = [];
    for (const element of state.elements) {
      if (publicElements.length >= MAX_PUBLIC_ELEMENTS) break;
      const publicRef = `e${publicElements.length + 1}`;
      const publicElement = windowElementToPublic(element, publicRef);
      if (!publicElement) continue;
      const fingerprint = semanticFingerprint(publicElement);
      publicElements.push(publicElement);
      references.set(publicRef, {
        publicElement,
        raw: {
          kind: 'window',
          elementIndex: element.element_index,
          ...(element.element_token ? { elementToken: element.element_token } : {}),
          snapshotId: state.snapshot_id,
        },
        semanticFingerprint: fingerprint,
      });
    }
    if (publicElements.length === 0) return undefined;
    const text = (state.tree_markdown || summarizedElements(publicElements)).slice(
      0,
      MAX_TEXT_LENGTH,
    );
    const image = result.images[0];
    const fingerprint = hash({ surface, publicElements, text });
    const route = includeScreenshot && image
      ? ('window_vision' as const)
      : ('window_accessibility' as const);
    const observation = DesktopObservationSchema.parse({
      observationId,
      taskId,
      capturedAt: new Date(this.now()).toISOString(),
      route,
      surface,
      elements: publicElements,
      text,
      structuredState: publicStructuredState(surface, publicElements),
      ...(image
        ? {
            screenshot: {
              mimeType: image.mimeType,
              dataBase64: image.dataBase64,
            },
          }
        : {}),
      degraded:
        result.degraded ||
        Boolean(state.degraded_reason) ||
        state.elements.length > MAX_PUBLIC_ELEMENTS,
      fingerprint,
    });
    return {
      observation,
      binding: {
        observationFingerprint: fingerprint,
        observationId,
        processId: window.pid,
        references,
        route,
        surface,
        surfaceIdentityHash: hash({ pid: window.pid, windowId: window.window_id }),
        taskId,
        windowId: window.window_id,
      },
    };
  }

  private async observeBrowser(
    taskId: string,
    window: CuaWindow,
    observeOptions: ObserveSurfaceOptions,
    signal?: AbortSignal,
  ): Promise<SurfaceSnapshot | undefined> {
    const result = await this.options.callTool(
      'get_browser_state',
      {
        pid: window.pid,
        window_id: window.window_id,
        session: taskId,
        snapshot_format: 'semantic_v2',
        include_screenshot: false,
        ...(observeOptions.query ? { query: observeOptions.query.slice(0, 500) } : {}),
      },
      signal,
    );
    if (result.isError) return undefined;
    let state;
    try {
      state = parseCuaStructuredResult(result, CuaBrowserStateSchema);
    } catch {
      return undefined;
    }
    const rawElements = state.elements ?? state.refs ?? [];
    if (rawElements.length === 0) return undefined;
    const surface: SurfaceDescriptor = {
      kind: 'browser',
      application: window.app_name.slice(0, 120) || 'Browser',
      title: (state.title ?? window.title).slice(0, 500),
      ...(state.url ? { url: state.url.slice(0, 8_000) } : {}),
      bounds: surfaceBounds(window),
      deepAccess: 'ready',
    };
    const observationId = randomUUID();
    const snapshotId =
      state.snapshot_id ??
      state.state_version ??
      rawElements[0]?.ref.split(':')[0] ??
      hash({ target: state.target_id, tab: state.tab_id }).slice(0, 16);
    const references = new Map<string, CuaBoundReference>();
    const publicElements: SurfaceElement[] = [];
    for (const element of rawElements) {
      if (publicElements.length >= MAX_PUBLIC_ELEMENTS) break;
      const publicRef = `e${publicElements.length + 1}`;
      const publicElement = browserElementToPublic(element, publicRef);
      if (!publicElement) continue;
      publicElements.push(publicElement);
      references.set(publicRef, {
        publicElement,
        raw: {
          kind: 'browser',
          browserRef: element.ref,
          targetId: state.target_id,
          tabId: state.tab_id,
          snapshotId,
        },
        semanticFingerprint: semanticFingerprint(publicElement),
      });
    }
    if (publicElements.length === 0) return undefined;
    const text = (
      state.text ??
      state.tree_markdown ??
      summarizedElements(publicElements)
    ).slice(0, MAX_TEXT_LENGTH);
    const fingerprint = hash({ surface, publicElements, text });
    const observation = DesktopObservationSchema.parse({
      observationId,
      taskId,
      capturedAt: new Date(this.now()).toISOString(),
      route: 'browser_semantic',
      surface,
      elements: publicElements,
      text,
      structuredState: publicStructuredState(surface, publicElements),
      degraded:
        result.degraded ||
        Boolean(state.degraded_reason) ||
        rawElements.length > MAX_PUBLIC_ELEMENTS,
      fingerprint,
    });
    return {
      observation,
      binding: {
        observationFingerprint: fingerprint,
        observationId,
        processId: window.pid,
        references,
        route: 'browser_semantic',
        surface,
        surfaceIdentityHash: hash({
          pid: window.pid,
          windowId: window.window_id,
          targetId: state.target_id,
          tabId: state.tab_id,
        }),
        taskId,
        windowId: window.window_id,
      },
    };
  }

  private async executeBound(
    binding: CuaSurfaceBinding,
    reference: CuaBoundReference | undefined,
    command: SurfaceCommand,
    signal?: AbortSignal,
  ): Promise<CuaOpenToolResult> {
    const commonWindow = {
      pid: binding.processId,
      window_id: binding.windowId,
      session: binding.taskId,
    };
    const raw = reference?.raw;
    const browserCommon =
      raw?.kind === 'browser'
        ? {
            target_id: raw.targetId,
            tab_id: raw.tabId,
            session: binding.taskId,
          }
        : undefined;
    const windowReference =
      raw?.kind === 'window'
        ? {
            ...(raw.elementToken
              ? { element_token: raw.elementToken }
              : {
                  element_index: raw.elementIndex,
                  snapshot_id: raw.snapshotId,
                }),
          }
        : {};

    switch (command.kind) {
      case 'click_element':
        if (raw?.kind === 'browser' && browserCommon) {
          return this.options.callTool(
            'browser_click',
            {
              ...browserCommon,
              ref: raw.browserRef,
              input_route: 'trusted',
            },
            signal,
          );
        }
        return this.options.callTool(
          'click',
          {
            ...commonWindow,
            ...windowReference,
            button: command.button,
            count: command.count,
            delivery_mode: 'background',
          },
          signal,
        );
      case 'type_text':
        if (raw?.kind === 'browser' && browserCommon) {
          return this.options.callTool(
            'browser_type',
            {
              ...browserCommon,
              ref: raw.browserRef,
              text: command.text,
              replace: command.replace,
            },
            signal,
          );
        }
        return this.options.callTool(
          'type_text',
          {
            ...commonWindow,
            ...windowReference,
            text: command.text,
            delivery_mode: 'background',
          },
          signal,
        );
      case 'press_key':
        return this.options.callTool(
          'press_key',
          {
            ...commonWindow,
            ...windowReference,
            key: command.key,
            modifiers: command.modifiers,
            delivery_mode: 'background',
          },
          signal,
        );
      case 'scroll':
        if (raw?.kind === 'browser' && browserCommon) {
          const multiplier = command.direction === 'up' || command.direction === 'left'
            ? -1
            : 1;
          return this.options.callTool(
            'browser_pointer',
            {
              ...browserCommon,
              action: 'scroll',
              ...(raw.browserRef ? { ref: raw.browserRef } : {}),
              delta_x:
                command.direction === 'left' || command.direction === 'right'
                  ? multiplier * command.amount * 120
                  : 0,
              delta_y:
                command.direction === 'up' || command.direction === 'down'
                  ? multiplier * command.amount * 120
                  : 0,
            },
            signal,
          );
        }
        return this.options.callTool(
          'scroll',
          {
            ...commonWindow,
            ...windowReference,
            direction: command.direction,
            amount: command.amount,
            delivery_mode: 'background',
          },
          signal,
        );
    }
  }

  private observationFromBinding(binding: CuaSurfaceBinding): DesktopObservation {
    const elements = [...binding.references.values()].map(
      (reference) => reference.publicElement,
    );
    return DesktopObservationSchema.parse({
      observationId: binding.observationId,
      taskId: binding.taskId,
      capturedAt: new Date(this.now()).toISOString(),
      route: binding.route,
      surface: binding.surface,
      elements,
      text: summarizedElements(elements),
      degraded: true,
      fingerprint: binding.observationFingerprint,
    });
  }
}

export { selectWindow };
