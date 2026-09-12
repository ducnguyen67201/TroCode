import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CuaStatus } from '../../shared/contracts';

import { createCuaDriverCatalog } from './cua-semantic-contracts';
import {
  CuaService,
  getCuaModuleSpecifier,
  isWindowsBottomEdgeClick,
  pasteShortcutForPlatform,
  shouldAutoConnect,
} from './cua-service';

describe('getCuaModuleSpecifier', () => {
  it('uses the installed package during development', () => {
    expect(getCuaModuleSpecifier(false, '/unused')).toBe('@trycua/cua-driver');
  });

  it('loads the unpacked dependency island in a packaged app', () => {
    const moduleUrl = getCuaModuleSpecifier(true, '/Applications/Tro/Resources');

    expect(moduleUrl).toBe(
      'file:///Applications/Tro/Resources/app.asar.unpacked/cua-runtime/node_modules/@trycua/cua-driver/dist/index.js',
    );
  });
});

describe('shouldAutoConnect', () => {
  const disconnectedStatus: CuaStatus = {
    state: 'disconnected',
    available: false,
    platform: 'darwin',
    permissions: {
      accessibility: true,
      screenRecording: true,
    },
    summary: 'Ready to initialize.',
    nextActions: [],
  };

  it('auto-connects on macOS only after both permissions are granted', () => {
    expect(shouldAutoConnect(disconnectedStatus)).toBe(true);
    expect(
      shouldAutoConnect({
        ...disconnectedStatus,
        permissions: {
          accessibility: true,
          screenRecording: false,
        },
      }),
    ).toBe(false);
    expect(
      shouldAutoConnect({ ...disconnectedStatus, permissions: undefined }),
    ).toBe(false);
  });

  it('auto-connects supported platforms without macOS permission gates', () => {
    expect(
      shouldAutoConnect({ ...disconnectedStatus, platform: 'win32' }),
    ).toBe(true);
    expect(
      shouldAutoConnect({ ...disconnectedStatus, platform: 'linux' }),
    ).toBe(true);
  });

  it('does not reconnect ready, errored, or permission-blocked states', () => {
    for (const state of ['ready', 'error', 'permission_required'] as const) {
      expect(shouldAutoConnect({ ...disconnectedStatus, state })).toBe(false);
    }
  });
});

describe('CUA shutdown', () => {
  it('destroys the native handle even when graceful shutdown rejects', async () => {
    const service = new CuaService();
    const driver = {
      shutdown: vi.fn().mockRejectedValue(new Error('shutdown failed')),
      uniffiDestroy: vi.fn(),
    };
    Reflect.set(service, 'driver', driver);

    await expect(service.shutdown()).rejects.toThrow('shutdown failed');
    expect(driver.uniffiDestroy).toHaveBeenCalledOnce();
  });
});

describe('CUA catalog startup admission', () => {
  function serviceWithInventory(inventory: unknown) {
    const driver = {
      listToolsJson: vi.fn(async () => JSON.stringify(inventory)),
      metadata: vi.fn(async () => ({
        capabilityVersion: '3',
        contractVersion: '0.8.0',
        driverVersion: '0.21.0',
        toolsListSchemaVersion: '2',
      })),
      shutdown: vi.fn(async () => undefined),
      uniffiDestroy: vi.fn(),
    };
    const service = new CuaService({ platform: 'linux' });
    Reflect.set(service, 'cuaModule', {
      CuaDriver: { create: vi.fn(() => driver) },
    });
    return { driver, service };
  }

  it('reports and skips an incompatible optional tool during startup discovery', async () => {
    const { service } = serviceWithInventory({
      capability_version: '3',
      schema_version: '2',
      requiredTools: [],
      tools: [
        {
          name: 'valid_action',
          description: 'Valid action.',
          capabilities: [],
          audience: 'model',
          schemaDialect: 'openai.function.strict',
          schemaVersion: '1',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: [],
          },
          modelInputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: [],
          },
        },
        {
          name: 'future_action',
          description: 'Future dialect action.',
          capabilities: [],
          audience: 'model',
          schemaDialect: 'future.provider.schema',
          schemaVersion: '1',
          inputSchema: {},
          modelInputSchema: {},
        },
      ],
    });

    await expect(service.discoverToolCatalog()).resolves.toMatchObject({
      tools: [{ name: 'valid_action' }],
    });
    expect(service.cuaToolCatalogReport()).toMatchObject({
      state: 'degraded',
      quarantinedTools: [
        expect.objectContaining({
          name: 'future_action',
          code: 'unsupported_schema_dialect',
        }),
      ],
    });
  });

  it('marks discovery unavailable before a task when required tools are missing', async () => {
    const { service } = serviceWithInventory({
      capability_version: '3',
      schema_version: '2',
      requiredTools: ['required_action'],
      tools: [],
    });

    await expect(service.discoverToolCatalog()).rejects.toThrow(
      'Required CUA model tool required_action is missing',
    );
    expect(service.cuaToolCatalogReport()).toMatchObject({
      state: 'unavailable',
      requiredToolFailures: [
        expect.objectContaining({ name: 'required_action' }),
      ],
    });
  });

  it('marks the catalog unavailable when a required admitted tool cannot register', async () => {
    const { service } = serviceWithInventory({
      capability_version: '3',
      schema_version: '2',
      requiredTools: ['required_action'],
      tools: [{
        name: 'required_action',
        description: 'Required action.',
        capabilities: [],
        audience: 'model',
        schemaDialect: 'openai.function.strict',
        schemaVersion: '1',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
          required: [],
        },
        modelInputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
          required: [],
        },
      }],
    });
    await service.discoverToolCatalog();

    service.reportToolCatalogRegistrationFailures([
      { name: 'required_action', message: 'Model name is already registered.' },
    ]);
    Reflect.set(service, 'driver', { isAvailable: () => true });

    expect(service.cuaToolCatalog()).toBeNull();
    expect(service.cuaToolCatalogReport()).toMatchObject({
      state: 'unavailable',
      requiredToolFailures: [
        expect.objectContaining({ name: 'required_action' }),
      ],
    });
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'error',
      available: false,
      summary: expect.stringContaining('required_action'),
    });
  });
});

function recordFactory<T extends object>() {
  return { new: (value: T) => value };
}

function fakeCuaModule() {
  return {
    ActionEffect: { Confirmed: 0, Refused: 4 },
    CaptureScope: { Auto: 0, Desktop: 2 },
    ClickButton: { Left: 0, Right: 1, Middle: 2 },
    DesktopScope: { Desktop: 0 },
    EffectiveScope: { Window: 0, Desktop: 1 },
    EscalationReason: { NoWindowTarget: 3, Other: 4 },
    ScrollDirection: { Up: 0, Down: 1, Left: 2, Right: 3 },
    ClickInput: recordFactory(),
    ClipboardWriteInput: recordFactory(),
    DragInput: recordFactory(),
    EndSessionInput: recordFactory(),
    EscalateSessionInput: recordFactory(),
    GetDesktopStateInput: recordFactory(),
    HotkeyInput: recordFactory(),
    MoveCursorInput: recordFactory(),
    PressKeyInput: recordFactory(),
    ScrollInput: recordFactory(),
    StartSessionInput: recordFactory(),
    TypeTextInput: recordFactory(),
  };
}

describe('CUA Dictation adapter', () => {
  it('initializes with Accessibility alone while full CUA still requires Screen Recording', async () => {
    const driver = {
      isAvailable: vi.fn(() => true),
      listToolsJson: vi.fn(async () => JSON.stringify({
        capability_version: '1',
        schema_version: '1',
        tools: [],
      })),
      metadata: vi.fn(async () => ({
        capabilityVersion: '1',
        contractVersion: '0.6.0',
        driverVersion: '0.19.3',
        toolsListSchemaVersion: '1',
      })),
      shutdown: vi.fn(async () => undefined),
      uniffiDestroy: vi.fn(),
    };
    const requestMacOsPermissions = vi.fn();
    const runtimeAuthorizationOptions = vi.fn((value) => value);
    const module = {
      ...fakeCuaModule(),
      ConfiguredDriverOptions: recordFactory(),
      CuaDriver: {
        createConfiguredWithHostIntegrations: vi.fn(() => driver),
      },
      DriverAuthorizationAction: { Allow: 0, Cancel: 1, Deny: 2 },
      RuntimeAuthorizationOptions: { new: runtimeAuthorizationOptions },
      SessionPermissionMode: { Standard: 0, Unrestricted: 2 },
      currentMacOsPermissionStatus: vi.fn(() => ({
        accessibility: true,
        screenRecording: false,
      })),
      requestMacOsPermissions,
    };
    const service = new CuaService({ platform: 'darwin' });
    Reflect.set(service, 'cuaModule', module);

    await expect(service.connectForDictation()).resolves.toEqual({
      state: 'ready',
      summary: 'System-wide dictation is ready.',
    });
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'permission_required',
      permissions: { accessibility: true, screenRecording: false },
    });
    expect(requestMacOsPermissions).not.toHaveBeenCalled();
    expect(runtimeAuthorizationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedModes: [2],
        compatibilityMode: 2,
        unrestrictedAcknowledged: true,
      }),
    );
    expect(module.CuaDriver.createConfiguredWithHostIntegrations).toHaveBeenCalledOnce();
  });

  it('lists windows without screenshots and sends one scoped background type call', async () => {
    const sessionId = `dictation:${randomUUID()}`;
    const callTool = vi.fn(async (name: string) => {
      if (name === 'list_windows') {
        return {
          action: null,
          degraded: false,
          images: [],
          isError: false,
          rawJson: '{}',
          structuredJson: JSON.stringify({
            windows: [{
              app_name: 'Notes',
              bounds: { height: 600, width: 800, x: 0, y: 0 },
              is_on_screen: true,
              on_current_space: true,
              pid: 10,
              title: 'Private title',
              window_id: 20,
              z_index: 1,
            }],
          }),
          text: 'One window.',
        };
      }
      return {
        action: { effect: 0 },
        degraded: false,
        images: [],
        isError: false,
        rawJson: '{}',
        text: 'Typed.',
      };
    });
    const driver = {
      callTool,
      endSession: vi.fn(async () => ({ active: false })),
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => startedWindowSession()),
    };
    const service = new CuaService();
    Reflect.set(service, 'cuaModule', fakeCuaModule());
    Reflect.set(service, 'driver', driver);

    await service.startDictationSession(sessionId);
    await expect(service.listDictationWindows()).resolves.toHaveLength(1);
    await expect(
      service.typeDictationText({
        processId: 10,
        sessionId,
        text: 'Private dictated text',
        windowId: 20,
      }),
    ).resolves.toEqual({ effect: 'confirmed' });
    await service.endDictationSession(sessionId);

    expect(callTool).toHaveBeenNthCalledWith(
      1,
      'list_windows',
      JSON.stringify({ on_screen_only: true }),
      undefined,
    );
    expect(callTool).toHaveBeenNthCalledWith(
      2,
      'type_text',
      JSON.stringify({
        delivery_mode: 'background',
        pid: 10,
        session: sessionId,
        text: 'Private dictated text',
        window_id: 20,
      }),
      undefined,
    );
    expect(JSON.stringify(callTool.mock.calls)).not.toMatch(
      /screenshot|element|press_key|enter/iu,
    );
  });
});

function startedWindowSession() {
  return {
    active: true,
    revived: false,
    state: {
      captureScope: 0,
      effectiveScope: 0,
      desktopUnlocked: false,
      session: 'test-session',
    },
  };
}

function escalatedDesktopSession() {
  return {
    captureScope: 0,
    effectiveScope: 1,
    desktopUnlocked: true,
    session: 'test-session',
  };
}

describe('CUA task sessions', () => {
  it.each([
    { command: { kind: 'click', x: 14, y: 27, button: 'left', count: 1 } as const, firstMethod: 'moveCursor', secondMethod: 'click', firstName: 'move_cursor', secondName: 'click' },
    { command: { kind: 'scroll', x: 14, y: 27, direction: 'down', amount: 1 } as const, firstMethod: 'moveCursor', secondMethod: 'scroll', firstName: 'move_cursor', secondName: 'scroll' },
    { command: { kind: 'paste_table', rows: [['private content']] } as const, firstMethod: 'clipboardWrite', secondMethod: 'hotkey', firstName: 'clipboard_write', secondName: 'hotkey' },
  ])('identifies the pending second native call in $command.kind', async ({ command, firstMethod, secondMethod, firstName, secondName }) => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const taskId = randomUUID();
    const confirmed = { text: 'Delivered', images: [], isError: false, degraded: false, rawJson: '{}', action: { effect: 0, route: 0 } };
    let complete!: (value: typeof confirmed) => void;
    const first = vi.fn(async () => confirmed);
    const second = vi.fn(() => new Promise<typeof confirmed>((resolve) => { complete = resolve; }));
    const driver = { isAvailable: () => true, startSession: async () => startedWindowSession(), escalateSession: async () => escalatedDesktopSession(), [firstMethod]: first, [secondMethod]: second };
    const service = new CuaService();
    Reflect.set(service, 'cuaModule', fakeCuaModule());
    Reflect.set(service, 'driver', driver);
    try {
      await service.startTaskSession(taskId);
      const pending = service.executeCommand(taskId, command.kind === 'paste_table' ? { ...command, rows: command.rows.map((row) => [...row]) } : command);
      await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());
      const records = log.mock.calls.filter(([prefix]) => prefix === '[execution]').map(([, line]) => JSON.parse(String(line)));
      const starts = records.filter((record) => record.event === 'cua.started');
      expect(starts.map((record) => record.nativeTool)).toEqual([firstName, secondName]);
      expect(starts[0].nativeCallId).not.toBe(starts[1].nativeCallId);
      expect(records.filter((record) => record.event === 'cua.result')).toMatchObject([{ nativeCallId: starts[0].nativeCallId, nativeTool: firstName }]);
      expect(JSON.stringify(records)).not.toContain('private content');
      complete(confirmed);
      await expect(pending).resolves.toMatchObject({ status: 'confirmed' });
      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledOnce();
      const results = log.mock.calls.filter(([prefix]) => prefix === '[execution]').map(([, line]) => JSON.parse(String(line))).filter((record) => record.event === 'cua.result');
      expect(results.map((record) => record.nativeCallId)).toEqual(starts.map((record) => record.nativeCallId));
    } finally { log.mockRestore(); }
  });

  it('uses the native platform paste shortcut', () => {
    expect(pasteShortcutForPlatform('darwin')).toEqual(['cmd', 'v']);
    expect(pasteShortcutForPlatform('win32')).toEqual(['ctrl', 'v']);
    expect(pasteShortcutForPlatform('linux')).toEqual(['ctrl', 'v']);
  });

  it('injects the host task session into generic driver calls', async () => {
    const taskId = randomUUID();
    const callTool = vi.fn(async () => ({
      text: 'Future tool completed.',
      images: [],
      isError: false,
      degraded: false,
      rawJson: '{}',
    }));
    const driver = {
      callTool,
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => startedWindowSession()),
    };
    const catalog = createCuaDriverCatalog(
      {
        driverVersion: '0.20.0',
        contractVersion: '0.7.0',
        toolsListSchemaVersion: '1',
        capabilityVersion: '2',
      },
      {
        capability_version: '2',
        schema_version: '1',
        tools: [{
          name: 'future_cua_action',
          description: 'A future driver tool.',
          capabilities: ['future.action'],
          inputSchema: {
            type: 'object',
            properties: {
              session: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['session', 'value'],
          },
        }],
      },
    );
    const service = new CuaService();
    Reflect.set(service, 'cuaModule', fakeCuaModule());
    Reflect.set(service, 'driver', driver);
    Reflect.set(service, 'driverCatalog', catalog);

    await expect(service.executeCuaTool(
      taskId,
      'future_cua_action',
      { session: 'spoofed-session', value: 'hello' },
      catalog.driverCatalogDigest,
    )).resolves.toMatchObject({ status: 'confirmed' });

    expect(callTool).toHaveBeenCalledWith(
      'future_cua_action',
      JSON.stringify({ session: taskId, value: 'hello' }),
      undefined,
    );
  });

  it('starts a session, captures a bounded observation, and ends it', async () => {
    const taskId = randomUUID();
    const driver = {
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => startedWindowSession()),
      escalateSession: vi.fn(async () => escalatedDesktopSession()),
      getDesktopState: vi.fn(async () => ({
        text: 'Chrome — Gmail',
        images: [{ mimeType: 'image/png', dataBase64: 'aW1hZ2U=' }],
        structuredJson: JSON.stringify({
          window: 'Gmail',
          screen_height: 1_117,
          screen_width: 1_728,
          screen_x: -1_440,
          screen_y: -100,
          screenshot_height: 2_234,
          screenshot_width: 3_456,
        }),
        isError: false,
        degraded: false,
        rawJson: '{}',
      })),
      endSession: vi.fn(async () => ({ active: false })),
    };
    const service = new CuaService();
    Reflect.set(service, 'cuaModule', fakeCuaModule());
    Reflect.set(service, 'driver', driver);

    await service.startTaskSession(taskId);
    const observation = await service.observe(taskId);
    await service.endTaskSession(taskId);

    expect(driver.startSession).toHaveBeenCalledWith(
      { session: taskId, captureScope: 0 },
      undefined,
    );
    expect(driver.escalateSession).toHaveBeenCalledWith(
      {
        session: taskId,
        reason: 3,
        detail: 'semantic_surface_unavailable',
      },
      undefined,
    );
    expect(observation).toMatchObject({
      taskId,
      text: 'Chrome — Gmail',
      screenshot: { mimeType: 'image/png', dataBase64: 'aW1hZ2U=' },
      coordinateSpace: {
        screenHeight: 1_117,
        screenWidth: 1_728,
        screenX: -1_440,
        screenY: -100,
        screenshotHeight: 2_234,
        screenshotWidth: 3_456,
      },
      degraded: false,
    });
    expect(observation.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(driver.endSession).toHaveBeenCalledWith(
      { session: taskId },
      undefined,
    );
  });

  it('keeps an auto session window-scoped while semantic observation succeeds', async () => {
    const taskId = randomUUID();
    const observation = {
      observationId: randomUUID(),
      taskId,
      capturedAt: '2026-08-19T08:00:00.000Z',
      route: 'window_accessibility' as const,
      surface: { kind: 'native_app' as const, application: 'Scratch' },
      elements: [{ ref: 'e1', role: 'button', name: 'Green flag' }],
      text: 'Scratch project with a green flag.',
      degraded: false,
      fingerprint: 'a'.repeat(64),
    };
    const driver = {
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => startedWindowSession()),
      escalateSession: vi.fn(async () => escalatedDesktopSession()),
    };
    const surfaceRouter = {
      observeCurrentSurface: vi.fn(async () => observation),
    };
    const service = new CuaService();
    Reflect.set(service, 'cuaModule', fakeCuaModule());
    Reflect.set(service, 'driver', driver);
    Reflect.set(service, 'surfaceRouter', surfaceRouter);
    Reflect.set(service, 'semanticCapabilityState', {
      browserActions: true,
      browserPrepare: true,
      browserState: true,
      capabilityVersion: '1',
      verification: true,
      windowActions: true,
      windowState: true,
    });

    await service.startTaskSession(taskId);
    await expect(service.observeCurrentSurface(taskId)).resolves.toEqual(
      observation,
    );

    expect(driver.startSession).toHaveBeenCalledWith(
      { session: taskId, captureScope: 0 },
      undefined,
    );
    expect(surfaceRouter.observeCurrentSurface).toHaveBeenCalledOnce();
    expect(driver.escalateSession).not.toHaveBeenCalled();
  });

  it('moves the real pointer before dispatching a typed click', async () => {
    const taskId = randomUUID();
    const actionOrder: string[] = [];
    const driver = {
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => startedWindowSession()),
      escalateSession: vi.fn(async () => {
        actionOrder.push('escalate');
        return escalatedDesktopSession();
      }),
      moveCursor: vi.fn(async () => {
        actionOrder.push('move');
        return {
          text: 'Pointer moved.',
          images: [],
          isError: false,
          action: { effect: 0 },
          degraded: false,
          rawJson: '{}',
        };
      }),
      click: vi.fn(async () => {
        actionOrder.push('click');
        return {
          text: 'Clicked.',
          images: [],
          isError: false,
          action: { effect: 0 },
          degraded: false,
          rawJson: '{}',
        };
      }),
    };
    const service = new CuaService();
    Reflect.set(service, 'cuaModule', fakeCuaModule());
    Reflect.set(service, 'driver', driver);

    await service.startTaskSession(taskId);
    await expect(
      service.executeCommand(taskId, {
        kind: 'click',
        x: 14,
        y: 27,
        button: 'left',
        count: 1,
      }),
    ).resolves.toEqual({ status: 'confirmed', summary: 'Clicked.' });
    expect(driver.moveCursor).toHaveBeenCalledWith(
      {
        session: taskId,
        scope: 0,
        x: 14,
        y: 27,
      },
      undefined,
    );
    expect(driver.click).toHaveBeenCalledWith(
      {
        session: taskId,
        scope: 0,
        x: 14,
        y: 27,
        button: 0,
        count: 1,
      },
      undefined,
    );
    expect(driver.escalateSession).toHaveBeenCalledWith(
      {
        session: taskId,
        reason: 4,
        detail: 'desktop_command_required',
      },
      undefined,
    );
    expect(actionOrder).toEqual(['escalate', 'move', 'click']);
  });

  it('reveals Windows bottom-edge UI and requires a fresh observation before clicking', async () => {
    const taskId = randomUUID();
    const driver = {
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => startedWindowSession()),
      escalateSession: vi.fn(async () => escalatedDesktopSession()),
      getDesktopState: vi.fn(async () => ({
        text: 'Desktop with an auto-hidden taskbar.',
        images: [{ mimeType: 'image/png', dataBase64: 'aW1hZ2U=' }],
        structuredJson: JSON.stringify({
          screen_height: 1_080,
          screen_width: 1_920,
          screenshot_height: 1_080,
          screenshot_width: 1_920,
        }),
        isError: false,
        degraded: false,
        rawJson: '{}',
      })),
      moveCursor: vi.fn(async () => ({
        text: 'Pointer moved.',
        images: [],
        isError: false,
        action: { effect: 0 },
        degraded: false,
        rawJson: '{}',
      })),
      click: vi.fn(async () => ({
        text: 'Clicked.',
        images: [],
        isError: false,
        action: { effect: 0 },
        degraded: false,
        rawJson: '{}',
      })),
    };
    const service = new CuaService({
      now: () => 1_000,
      platform: 'win32',
      waitForSystemUiReveal: vi.fn(async () => undefined),
    });
    Reflect.set(service, 'cuaModule', fakeCuaModule());
    Reflect.set(service, 'driver', driver);

    await service.startTaskSession(taskId);
    await service.observe(taskId);
    const command = {
      kind: 'click' as const,
      x: 540,
      y: 1_054,
      button: 'left' as const,
      count: 1 as const,
    };

    await expect(service.executeCommand(taskId, command)).resolves.toEqual({
      status: 'not_executed',
      summary:
        'Tro moved the pointer to the Windows bottom edge to reveal auto-hidden system UI. No click was performed; use the fresh observation before clicking.',
    });
    expect(driver.moveCursor).toHaveBeenLastCalledWith(
      { session: taskId, scope: 0, x: 540, y: 1_079 },
      undefined,
    );
    expect(driver.click).not.toHaveBeenCalled();

    await service.observe(taskId);
    await expect(service.executeCommand(taskId, command)).resolves.toEqual({
      status: 'confirmed',
      summary: 'Clicked.',
    });
    expect(driver.click).toHaveBeenCalledOnce();
  });

  it('only treats clicks within the Windows bottom-edge reveal zone as system UI', () => {
    const coordinateSpace = {
      screenHeight: 1_080,
      screenWidth: 1_920,
      screenshotHeight: 1_080,
      screenshotWidth: 1_920,
    };

    expect(
      isWindowsBottomEdgeClick(
        'win32',
        { kind: 'click', x: 540, y: 1_054, button: 'left', count: 1 },
        coordinateSpace,
      ),
    ).toBe(true);
    expect(
      isWindowsBottomEdgeClick(
        'win32',
        { kind: 'click', x: 540, y: 900, button: 'left', count: 1 },
        coordinateSpace,
      ),
    ).toBe(false);
    expect(
      isWindowsBottomEdgeClick(
        'darwin',
        { kind: 'click', x: 540, y: 1_054, button: 'left', count: 1 },
        coordinateSpace,
      ),
    ).toBe(false);
  });

  it('dispatches a bounded drag through the typed CUA driver contract', async () => {
    const taskId = randomUUID();
    const driver = {
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => startedWindowSession()),
      escalateSession: vi.fn(async () => escalatedDesktopSession()),
      drag: vi.fn(async () => ({
        text: 'Dragged.',
        images: [],
        isError: false,
        action: { effect: 0 },
        degraded: false,
        rawJson: '{}',
      })),
    };
    const service = new CuaService();
    Reflect.set(service, 'cuaModule', fakeCuaModule());
    Reflect.set(service, 'driver', driver);

    await service.startTaskSession(taskId);
    await expect(
      service.executeCommand(taskId, {
        kind: 'drag',
        fromX: 100,
        fromY: 200,
        toX: 500,
        toY: 600,
        durationMs: 750,
        button: 'left',
      }),
    ).resolves.toEqual({ status: 'confirmed', summary: 'Dragged.' });
    expect(driver.drag).toHaveBeenCalledWith(
      {
        session: taskId,
        scope: 0,
        fromX: 100,
        fromY: 200,
        toX: 500,
        toY: 600,
        durationMs: 750n,
        button: 0,
      },
      undefined,
    );
  });

  it('pastes rectangular table data into the selected spreadsheet cell', async () => {
    const taskId = randomUUID();
    const actionOrder: string[] = [];
    const confirmed = (text: string) => ({
      text,
      images: [],
      isError: false,
      action: { effect: 0 },
      degraded: false,
      rawJson: '{}',
    });
    const driver = {
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => startedWindowSession()),
      escalateSession: vi.fn(async () => escalatedDesktopSession()),
      clipboardWrite: vi.fn(async () => {
        actionOrder.push('clipboard');
        return confirmed('Table copied.');
      }),
      hotkey: vi.fn(async () => {
        actionOrder.push('paste');
        return confirmed('Table pasted.');
      }),
    };
    const service = new CuaService();
    Reflect.set(service, 'cuaModule', fakeCuaModule());
    Reflect.set(service, 'driver', driver);

    await service.startTaskSession(taskId);
    await expect(
      service.executeCommand(taskId, {
        kind: 'paste_table',
        rows: [
          ['Ngày', 'Danh mục', 'Số tiền (VND)'],
          ['18/08/2026', 'Ăn uống', '50000'],
        ],
      }),
    ).resolves.toEqual({ status: 'confirmed', summary: 'Table pasted.' });

    expect(driver.clipboardWrite).toHaveBeenCalledWith(
      {
        session: taskId,
        text: 'Ngày\tDanh mục\tSố tiền (VND)\n18/08/2026\tĂn uống\t50000',
      },
      undefined,
    );
    expect(driver.hotkey).toHaveBeenCalledWith(
      {
        session: taskId,
        scope: 0,
        keys: pasteShortcutForPlatform(process.platform),
      },
      undefined,
    );
    expect(actionOrder).toEqual(['clipboard', 'paste']);
  });

  it('can point for visual guidance without clicking', async () => {
    const taskId = randomUUID();
    const driver = {
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => startedWindowSession()),
      escalateSession: vi.fn(async () => escalatedDesktopSession()),
      moveCursor: vi.fn(async () => ({
        text: 'Moved the real desktop pointer to (495, 357).',
        images: [],
        isError: false,
        action: { effect: 2 },
        degraded: false,
        rawJson: '{}',
      })),
      click: vi.fn(),
    };
    const service = new CuaService();
    Reflect.set(service, 'cuaModule', fakeCuaModule());
    Reflect.set(service, 'driver', driver);

    await service.startTaskSession(taskId);
    await expect(
      service.executeCommand(taskId, { kind: 'point', x: 990, y: 714 }),
    ).resolves.toEqual({
      status: 'confirmed',
      summary: 'Moved the real desktop pointer to (495, 357).',
    });

    expect(driver.moveCursor).toHaveBeenCalledWith(
      { session: taskId, scope: 0, x: 990, y: 714 },
      undefined,
    );
    expect(driver.click).not.toHaveBeenCalled();
  });

  it('continues to an exact-coordinate click after an unverifiable pointer move', async () => {
    const taskId = randomUUID();
    const driver = {
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => startedWindowSession()),
      escalateSession: vi.fn(async () => escalatedDesktopSession()),
      moveCursor: vi.fn(async () => ({
        text: 'Moved the real desktop pointer to (7, 13.5).',
        images: [],
        isError: false,
        action: { effect: 2 },
        degraded: false,
        rawJson: '{}',
      })),
      click: vi.fn(async () => ({
        text: 'Clicked the target.',
        images: [],
        isError: false,
        action: { effect: 0 },
        degraded: false,
        rawJson: '{}',
      })),
    };
    const service = new CuaService();
    Reflect.set(service, 'cuaModule', fakeCuaModule());
    Reflect.set(service, 'driver', driver);

    await service.startTaskSession(taskId);
    await expect(
      service.executeCommand(taskId, {
        kind: 'click',
        x: 14,
        y: 27,
        button: 'left',
        count: 1,
      }),
    ).resolves.toEqual({
      status: 'confirmed',
      summary: 'Clicked the target.',
    });
    expect(driver.click).toHaveBeenCalledOnce();
  });

  it('does not click after the driver refuses pointer movement', async () => {
    const taskId = randomUUID();
    const driver = {
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => startedWindowSession()),
      escalateSession: vi.fn(async () => escalatedDesktopSession()),
      moveCursor: vi.fn(async () => ({
        text: 'Desktop pointer movement was refused.',
        images: [],
        isError: false,
        action: { effect: 4 },
        degraded: false,
        rawJson: '{}',
      })),
      click: vi.fn(),
    };
    const service = new CuaService();
    Reflect.set(service, 'cuaModule', fakeCuaModule());
    Reflect.set(service, 'driver', driver);

    await service.startTaskSession(taskId);
    await expect(
      service.executeCommand(taskId, {
        kind: 'click',
        x: 14,
        y: 27,
        button: 'left',
        count: 1,
      }),
    ).resolves.toEqual({
      status: 'failed',
      summary: 'Desktop pointer movement was refused.',
    });
    expect(driver.click).not.toHaveBeenCalled();
  });

  it('moves the real pointer before scrolling at a screen coordinate', async () => {
    const taskId = randomUUID();
    const actionOrder: string[] = [];
    const confirmedResult = {
      text: 'Confirmed.',
      images: [],
      isError: false,
      action: { effect: 0 },
      degraded: false,
      rawJson: '{}',
    };
    const driver = {
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => startedWindowSession()),
      escalateSession: vi.fn(async () => escalatedDesktopSession()),
      moveCursor: vi.fn(async () => {
        actionOrder.push('move');
        return confirmedResult;
      }),
      scroll: vi.fn(async () => {
        actionOrder.push('scroll');
        return confirmedResult;
      }),
    };
    const service = new CuaService();
    Reflect.set(service, 'cuaModule', fakeCuaModule());
    Reflect.set(service, 'driver', driver);

    await service.startTaskSession(taskId);
    await expect(
      service.executeCommand(taskId, {
        kind: 'scroll',
        x: 320,
        y: 480,
        direction: 'down',
        amount: 3,
      }),
    ).resolves.toEqual({ status: 'confirmed', summary: 'Confirmed.' });
    expect(driver.moveCursor).toHaveBeenCalledWith(
      { session: taskId, scope: 0, x: 320, y: 480 },
      undefined,
    );
    expect(driver.scroll).toHaveBeenCalledWith(
      {
        session: taskId,
        scope: 0,
        x: 320,
        y: 480,
        direction: 1,
        amount: 3n,
      },
      undefined,
    );
    expect(actionOrder).toEqual(['move', 'scroll']);
  });
});

it('rediscovers the material window after desktop input instead of permanently returning identity-less evidence', async () => {
  const service = new CuaService();
  const taskId = randomUUID();
  Reflect.set(service, 'activeSessions', new Set([taskId]));
  Reflect.set(service, 'desktopScopeSessions', new Set([taskId]));
  const observe = vi.spyOn(service, 'observe').mockResolvedValue({ observationId: randomUUID(), taskId, capturedAt: new Date().toISOString(), fingerprint: 'a'.repeat(64), text: 'Desktop', degraded: false, route: 'desktop_vision' });
  const observation = { observationId: randomUUID(), taskId, capturedAt: new Date().toISOString(), fingerprint: 'b'.repeat(64), text: 'Lesson', degraded: false, route: 'window_vision' as const };
  const window = vi.fn(async () => ({ observation, identity: { processId: 1, windowId: 2 } }));
  Reflect.set(service, 'surfaceRouter', { observeExternalWindow: window });
  await expect(service.observeLessonWindow(taskId, { processId: 1, windowId: 2 })).resolves.toMatchObject({ identity: { processId: 1, windowId: 2 }, observation });
  expect(observe).not.toHaveBeenCalled();
  expect(window).toHaveBeenCalledWith(taskId, { processId: 1, windowId: 2 }, undefined);
});

it('isolates window calls after raw desktop capture and closes both native sessions', async () => {
  const taskId = randomUUID();
  const sessions = new Map<string, boolean>();
  const receipt = { text: 'Current screen', images: [{ mimeType: 'image/png', dataBase64: 'AA==' }], isError: false, degraded: false, rawJson: '{}' };
  const driver = {
    isAvailable: () => true,
    startSession: vi.fn(async ({ session }: { session: string }) => { sessions.set(session, false); return startedWindowSession(); }),
    escalateSession: vi.fn(async ({ session }: { session: string }) => { sessions.set(session, true); return escalatedDesktopSession(); }),
    getDesktopState: vi.fn(async ({ session }: { session: string }) => { expect(sessions.get(session)).toBe(true); return receipt; }),
    callTool: vi.fn(async (_name: string, args: string) => { expect(sessions.get(JSON.parse(args).session)).toBe(false); return receipt; }),
    endSession: vi.fn(async ({ session }: { session: string }) => { sessions.delete(session); }),
  };
  const catalog = createCuaDriverCatalog({ driverVersion: '0.19.3', contractVersion: '0.6.0', toolsListSchemaVersion: '1', capabilityVersion: '1' }, {
    capability_version: '1', schema_version: '1', tools: ['get_desktop_state', 'get_window_state'].map((name) => ({ name, description: name, capabilities: [], inputSchema: { type: 'object', properties: { session: { type: 'string' }, pid: { type: 'number' }, window_id: { type: 'number' } }, required: ['session'] } })),
  });
  const service = new CuaService();
  Reflect.set(service, 'cuaModule', fakeCuaModule());
  Reflect.set(service, 'driver', driver);
  Reflect.set(service, 'driverCatalog', catalog);
  const desktop = await service.executeCuaTool(taskId, 'get_desktop_state', {}, catalog.driverCatalogDigest);
  expect(desktop).toMatchObject({ status: 'confirmed', observation: { taskId, route: 'desktop_vision' } });
  await service.executeCuaTool(taskId, 'get_window_state', { pid: 123, window_id: 45 }, catalog.driverCatalogDigest);
  expect(driver.callTool).toHaveBeenCalledWith('get_window_state', JSON.stringify({ pid: 123, window_id: 45, session: `${taskId}:window` }), undefined);
  expect((await service.executeCuaTool(taskId, 'get_window_state', { pid: process.pid, window_id: 45 }, catalog.driverCatalogDigest)).status).toBe('not_executed');
  expect(driver.callTool).toHaveBeenCalledOnce();
  await service.endTaskSession(taskId);
  expect(sessions.size).toBe(0);
});
