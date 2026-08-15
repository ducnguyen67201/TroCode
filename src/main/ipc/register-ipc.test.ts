import { describe, expect, it, vi } from 'vitest';

import type { CuaStatus } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/desktop-api';

import { registerIpcHandlers } from './register-ipc';

type InvokeHandler = (event: unknown, input?: unknown) => unknown;

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, InvokeHandler>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: InvokeHandler) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMock.handle,
    removeHandler: electronMock.removeHandler,
  },
}));

function setup(authenticated: boolean): {
  authService: {
    assertSignedIn: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    signIn: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
  };
  event: unknown;
  executionCoordinator: {
    cancelActiveTasks: ReturnType<typeof vi.fn>;
  };
  cuaConnect: ReturnType<typeof vi.fn>;
  cuaGetStatus: ReturnType<typeof vi.fn>;
  callOrder: string[];
  openSystemPermissionSettings: ReturnType<typeof vi.fn>;
  requestScreenRecordingAccess: ReturnType<typeof vi.fn>;
  recordVoiceTranscript: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  unregister: () => void;
} {
  electronMock.handlers.clear();
  const mainFrame = {};
  const webContents = {
    id: 42,
    mainFrame,
    send: vi.fn(),
  };
  const mainWindow = {
    isDestroyed: () => false,
    webContents,
  } as unknown as Parameters<typeof registerIpcHandlers>[0];
  const event = {
    sender: { id: 42 },
    senderFrame: mainFrame,
  };
  const submit = vi.fn(() => ({ taskId: 'task-id' }));
  const authService = {
    assertSignedIn: vi.fn(async () => {
      if (!authenticated) throw new Error('Sign in with Google first.');
    }),
    getStatus: vi.fn(async () => ({ state: 'signed_out' })),
    signIn: vi.fn(async () => ({
      state: 'signed_in',
      user: { id: 'user-id', email: 'user@example.com', name: 'User' },
    })),
    signOut: vi.fn(async () => ({ state: 'signed_out', user: null })),
  };
  const taskRuntime = {
    off: vi.fn(),
    on: vi.fn(),
    submit,
  };
  const executionCoordinator = {
    cancelActiveTasks: vi.fn(() => []),
  };
  const callOrder: string[] = [];
  const permissionRequiredStatus: CuaStatus = {
    state: 'permission_required',
    available: false,
    platform: 'darwin',
    permissions: {
      accessibility: true,
      screenRecording: false,
    },
    summary: 'Screen Recording is required.',
    nextActions: [],
  };
  const cuaConnect = vi.fn(async () => {
    callOrder.push('request');
    return permissionRequiredStatus;
  });
  const cuaGetStatus = vi.fn(async () => {
    callOrder.push('recheck');
    return permissionRequiredStatus;
  });
  const openSystemPermissionSettings = vi.fn(async () => {
    callOrder.push('open-settings');
  });
  const requestScreenRecordingAccess = vi.fn(async () => {
    callOrder.push('register-screen');
  });
  const recordVoiceTranscript = vi.fn(async () => undefined);
  const services = {
    authService,
    cuaService: { connect: cuaConnect, getStatus: cuaGetStatus },
    executionCoordinator,
    openSystemPermissionSettings,
    recordVoiceTranscript,
    requestScreenRecordingAccess,
    taskRuntime,
    updateCompanionState: vi.fn(),
    voiceService: {},
  } as unknown as Parameters<typeof registerIpcHandlers>[1];

  return {
    authService,
    callOrder,
    cuaConnect,
    cuaGetStatus,
    event,
    executionCoordinator,
    openSystemPermissionSettings,
    recordVoiceTranscript,
    requestScreenRecordingAccess,
    submit,
    unregister: registerIpcHandlers(mainWindow, services),
  };
}

describe('registerIpcHandlers auth boundary', () => {
  it('allows the renderer to inspect auth status while signed out', async () => {
    const { authService, event, unregister } = setup(false);
    const handler = electronMock.handlers.get(IPC_CHANNELS.getAuthStatus);

    await expect(handler?.(event)).resolves.toEqual({ state: 'signed_out' });
    expect(authService.assertSignedIn).not.toHaveBeenCalled();
    unregister();
  });

  it('rejects protected task IPC before invoking the task runtime', async () => {
    const { authService, event, submit, unregister } = setup(false);
    const handler = electronMock.handlers.get(IPC_CHANNELS.submitTask);

    await expect(handler?.(event, { text: 'Open YouTube' })).rejects.toThrow(
      'Sign in with Google first.',
    );
    expect(authService.assertSignedIn).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    unregister();
  });

  it('admits protected task IPC after authentication', async () => {
    const { event, submit, unregister } = setup(true);
    const handler = electronMock.handlers.get(IPC_CHANNELS.submitTask);

    await expect(handler?.(event, { text: 'Open YouTube' })).resolves.toEqual({
      taskId: 'task-id',
    });
    expect(submit).toHaveBeenCalledWith({ text: 'Open YouTube' });
    unregister();
  });

  it('validates and persists a completed voice transcript after authentication', async () => {
    const { event, recordVoiceTranscript, unregister } = setup(true);
    const handler = electronMock.handlers.get(
      IPC_CHANNELS.recordVoiceTranscript,
    );

    expect(handler).toBeTypeOf('function');
    await expect(
      handler?.(event, { text: '  Open YouTube for me  ' }),
    ).resolves.toBeUndefined();
    expect(recordVoiceTranscript).toHaveBeenCalledWith({
      text: 'Open YouTube for me',
    });
    unregister();
  });

  it('cancels active execution before signing out', async () => {
    const { event, executionCoordinator, unregister } = setup(true);
    const handler = electronMock.handlers.get(IPC_CHANNELS.signOutGoogle);

    await expect(handler?.(event)).resolves.toMatchObject({
      state: 'signed_out',
      user: null,
    });
    expect(executionCoordinator.cancelActiveTasks).toHaveBeenCalledOnce();
    unregister();
  });

  it('requests native computer permission before opening the macOS fallback pane', async () => {
    const {
      callOrder,
      cuaConnect,
      cuaGetStatus,
      event,
      openSystemPermissionSettings,
      requestScreenRecordingAccess,
      unregister,
    } = setup(true);
    const handler = electronMock.handlers.get(IPC_CHANNELS.connectComputer);

    await expect(handler?.(event)).resolves.toMatchObject({
      state: 'permission_required',
    });
    expect(cuaConnect).toHaveBeenCalledOnce();
    expect(requestScreenRecordingAccess).toHaveBeenCalledOnce();
    expect(cuaGetStatus).toHaveBeenCalledOnce();
    expect(openSystemPermissionSettings).toHaveBeenCalledWith(
      'screen_recording',
    );
    expect(callOrder).toEqual([
      'request',
      'register-screen',
      'recheck',
      'open-settings',
    ]);
    unregister();
  });

  it('returns the refreshed status when capture registration completes the grant', async () => {
    const {
      callOrder,
      cuaGetStatus,
      event,
      openSystemPermissionSettings,
      requestScreenRecordingAccess,
      unregister,
    } = setup(true);
    cuaGetStatus.mockImplementation(async () => {
      callOrder.push('recheck');
      return {
        state: 'ready',
        available: true,
        platform: 'darwin',
        permissions: {
          accessibility: true,
          screenRecording: true,
        },
        summary: 'Connected.',
        nextActions: [],
      };
    });
    const handler = electronMock.handlers.get(IPC_CHANNELS.connectComputer);

    await expect(handler?.(event)).resolves.toMatchObject({ state: 'ready' });
    expect(requestScreenRecordingAccess).toHaveBeenCalledOnce();
    expect(openSystemPermissionSettings).not.toHaveBeenCalled();
    expect(callOrder).toEqual(['request', 'register-screen', 'recheck']);
    unregister();
  });

  it('does not open System Settings when the native request completes the grant', async () => {
    const {
      cuaConnect,
      cuaGetStatus,
      event,
      openSystemPermissionSettings,
      requestScreenRecordingAccess,
      unregister,
    } = setup(true);
    cuaConnect.mockResolvedValue({
      state: 'ready',
      available: true,
      platform: 'darwin',
      permissions: {
        accessibility: true,
        screenRecording: true,
      },
      summary: 'Connected.',
      nextActions: [],
    });
    const handler = electronMock.handlers.get(IPC_CHANNELS.connectComputer);

    await expect(handler?.(event)).resolves.toMatchObject({ state: 'ready' });
    expect(cuaGetStatus).not.toHaveBeenCalled();
    expect(requestScreenRecordingAccess).not.toHaveBeenCalled();
    expect(openSystemPermissionSettings).not.toHaveBeenCalled();
    unregister();
  });
});
