import { describe, expect, it, vi } from 'vitest';

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
  const services = {
    authService,
    cuaService: {},
    executionCoordinator,
    taskRuntime,
    updateCompanionState: vi.fn(),
    voiceService: {},
  } as unknown as Parameters<typeof registerIpcHandlers>[1];

  return {
    authService,
    event,
    executionCoordinator,
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
});
