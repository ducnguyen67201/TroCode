import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CuaStatus } from '../../shared/contracts';

import {
  CuaService,
  getCuaModuleSpecifier,
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
    EndSessionInput: recordFactory(),
    GetDesktopStateInput: recordFactory(),
    HotkeyInput: recordFactory(),
    PressKeyInput: recordFactory(),
    ScrollInput: recordFactory(),
    StartSessionInput: recordFactory(),
    TypeTextInput: recordFactory(),
  };
}

describe('CUA task sessions', () => {
  it('starts a session, captures a bounded observation, and ends it', async () => {
    const taskId = randomUUID();
    const driver = {
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => ({ active: true })),
      getDesktopState: vi.fn(async () => ({
        text: 'Chrome — Gmail',
        images: [{ mimeType: 'image/png', dataBase64: 'aW1hZ2U=' }],
        structuredJson: '{"window":"Gmail"}',
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
      degraded: false,
    });
    expect(observation.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(driver.endSession).toHaveBeenCalledWith(
      { session: taskId },
      undefined,
    );
  });

  it('dispatches a typed click and reports confirmed delivery', async () => {
    const taskId = randomUUID();
    const driver = {
      isAvailable: vi.fn(() => true),
      startSession: vi.fn(async () => ({ active: true })),
      click: vi.fn(async () => ({
        text: 'Clicked.',
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
    ).resolves.toEqual({ status: 'confirmed', summary: 'Clicked.' });
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
  });
});
