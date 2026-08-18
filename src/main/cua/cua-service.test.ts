import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CuaStatus } from '../../shared/contracts';

import {
  CuaService,
  getCuaModuleSpecifier,
  pasteShortcutForPlatform,
  shouldAutoConnect,
} from './cua-service';

describe('getCuaModuleSpecifier', () => {
  it('uses the installed package during development', () => {
    expect(getCuaModuleSpecifier(false, '/unused')).toBe('@trycua/cua-driver');
  });

  it('loads the unpacked dependency island in a packaged app', () => {
    const moduleUrl = getCuaModuleSpecifier(true, '/Applications/TroCode/Resources');

    expect(moduleUrl).toBe(
      'file:///Applications/TroCode/Resources/app.asar.unpacked/cua-runtime/node_modules/@trycua/cua-driver/dist/index.js',
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
    CaptureScope: { Desktop: 2 },
    ClickButton: { Left: 0, Right: 1, Middle: 2 },
    DesktopScope: { Desktop: 0 },
    ScrollDirection: { Up: 0, Down: 1, Left: 2, Right: 3 },
    ClickInput: recordFactory(),
    ClipboardWriteInput: recordFactory(),
    DragInput: recordFactory(),
    EndSessionInput: recordFactory(),
    GetDesktopStateInput: recordFactory(),
    HotkeyInput: recordFactory(),
    MoveCursorInput: recordFactory(),
    PressKeyInput: recordFactory(),
    ScrollInput: recordFactory(),
    StartSessionInput: recordFactory(),
    TypeTextInput: recordFactory(),
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
      startSession: vi.fn(async () => ({ active: true })),
      getDesktopState: vi.fn(async () => ({
        text: 'Chrome — Gmail',
        images: [{ mimeType: 'image/png', dataBase64: 'aW1hZ2U=' }],
        structuredJson: JSON.stringify({
          window: 'Gmail',
          screen_height: 1_117,
          screen_width: 1_728,
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
      { session: taskId, captureScope: 2 },
      undefined,
    );
    expect(observation).toMatchObject({
      taskId,
      text: 'Chrome — Gmail',
      screenshot: { mimeType: 'image/png', dataBase64: 'aW1hZ2U=' },
      coordinateSpace: {
        screenHeight: 1_117,
        screenWidth: 1_728,
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

  it('moves the real pointer before dispatching a typed click', async () => {
    const taskId = randomUUID();
    const actionOrder: string[] = [];
    const driver = {
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => ({ active: true })),
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
    expect(actionOrder).toEqual(['move', 'click']);
  });

  it('dispatches a bounded drag through the typed CUA driver contract', async () => {
    const taskId = randomUUID();
    const driver = {
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => ({ active: true })),
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
      startSession: vi.fn(async () => ({ active: true })),
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
      startSession: vi.fn(async () => ({ active: true })),
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
      startSession: vi.fn(async () => ({ active: true })),
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
      startSession: vi.fn(async () => ({ active: true })),
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
      startSession: vi.fn(async () => ({ active: true })),
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
