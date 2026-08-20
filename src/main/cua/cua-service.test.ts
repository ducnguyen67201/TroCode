import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CuaStatus } from '../../shared/contracts';

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
  it('uses the native platform paste shortcut', () => {
    expect(pasteShortcutForPlatform('darwin')).toEqual(['cmd', 'v']);
    expect(pasteShortcutForPlatform('win32')).toEqual(['ctrl', 'v']);
    expect(pasteShortcutForPlatform('linux')).toEqual(['ctrl', 'v']);
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
