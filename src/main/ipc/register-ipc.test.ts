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

function setup(authenticated: boolean, membershipActive = authenticated): {
  authService: {
    assertSignedIn: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    signIn: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
  };
  event: unknown;
  executionCoordinator: {
    cancelActiveTasks: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  };
  cuaConnect: ReturnType<typeof vi.fn>;
  cuaGetStatus: ReturnType<typeof vi.fn>;
  callOrder: string[];
  checkForUpdates: ReturnType<typeof vi.fn>;
  createVoiceCall: ReturnType<typeof vi.fn>;
  getAppPreferences: ReturnType<typeof vi.fn>;
  getTaskHistory: ReturnType<typeof vi.fn>;
  membershipService: {
    activate: ReturnType<typeof vi.fn>;
    assertActive: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
  };
  restartAndInstallUpdate: ReturnType<typeof vi.fn>;
  setVoiceAudioDucking: ReturnType<typeof vi.fn>;
  openSystemPermissionSettings: ReturnType<typeof vi.fn>;
  requestScreenRecordingAccess: ReturnType<typeof vi.fn>;
  recordVoiceTranscript: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  updateAppPreferences: ReturnType<typeof vi.fn>;
  updateCompanionVoiceActivity: ReturnType<typeof vi.fn>;
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
  const submit = vi.fn((input: unknown) => {
    void input;
    return { taskId: 'task-id' };
  });
  const authService = {
    assertSignedIn: vi.fn(async () => {
      if (!authenticated) throw new Error('Sign in with Google first.');
      return { id: 'user-id', email: 'user@example.com', name: 'User' };
    }),
    getStatus: vi.fn(async () => ({ state: 'signed_out' })),
    signIn: vi.fn(async () => ({
      state: 'signed_in',
      user: { id: 'user-id', email: 'user@example.com', name: 'User' },
    })),
    signOut: vi.fn(async () => ({ state: 'signed_out', user: null })),
  };
  const membershipService = {
    activate: vi.fn(async () => ({
      expiresAt: '2026-09-15T08:00:00.000Z',
      referenceCode: 'TRC-AAAA-BBBB-CCCC',
      required: true,
      state: 'active',
      summary: 'Membership active.',
    })),
    assertActive: vi.fn(async () => {
      if (!membershipActive) {
        throw new Error('An active membership is required to use TroCode.');
      }
    }),
    getStatus: vi.fn(async () => ({
      expiresAt: null,
      referenceCode: 'TRC-AAAA-BBBB-CCCC',
      required: true,
      state: 'inactive',
      summary: 'Enter an activation code to continue.',
    })),
  };
  const taskRuntime = {
    submit,
    respondToInteraction: vi.fn(),
    decideApproval: vi.fn(),
    steer: vi.fn(),
    off: vi.fn(),
    on: vi.fn(),
  };
  const executionCoordinator = {
    cancelActiveTasks: vi.fn(() => []),
    start: vi.fn((input: unknown) => {
      void input;
      return { taskId: 'task-id', phase: 'planning' };
    }),
  };
  const taskApplicationService = {
    cancel: vi.fn((input: unknown) => input),
    decideApproval: vi.fn((input: unknown) => input),
    respond: vi.fn((input: unknown) => input),
    start: executionCoordinator.start,
    steer: vi.fn((input: unknown) => input),
    submitAndStart: vi.fn((input: unknown) => {
      const submitted = submit(input);
      return executionCoordinator.start({ taskId: submitted.taskId });
    }),
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
  const createVoiceCall = vi.fn(async () => ({
    answerSdp: 'v=0\r\nanswer',
  }));
  const recordVoiceTranscript = vi.fn(async () => undefined);
  const getAppPreferences = vi.fn(async () => ({ primaryLanguage: null }));
  const getTaskHistory = vi.fn(async () => ({
    events: [],
    persistence: {
      mode: 'postgres',
      summary: 'Task history is saved to PostgreSQL.',
    },
    snapshots: [],
  }));
  const updateAppPreferences = vi.fn(async (input: unknown) => input);
  const appUpdateStatus = {
    currentVersion: '0.1.0',
    message: 'Ready to check for updates.',
    phase: 'idle',
    targetVersion: null,
  } as const;
  const checkForUpdates = vi.fn(() => ({
    ...appUpdateStatus,
    message: 'Checking for updates…',
    phase: 'checking' as const,
  }));
  const restartAndInstallUpdate = vi.fn(async () => undefined);
  const updateCompanionVoiceActivity = vi.fn();
  const setVoiceAudioDucking = vi.fn(async () => undefined);
  const services = {
    appUpdateService: {
      checkForUpdates,
      getStatus: vi.fn(() => appUpdateStatus),
      onStatusChange: vi.fn(() => vi.fn()),
      restartAndInstall: restartAndInstallUpdate,
    },
    appPreferencesService: {
      get: getAppPreferences,
      update: updateAppPreferences,
    },
    authService,
    cuaService: { connect: cuaConnect, getStatus: cuaGetStatus },
    executionCoordinator,
    membershipService,
    openSystemPermissionSettings,
    recordVoiceTranscript,
    requestScreenRecordingAccess,
    systemAudioDuckingService: { setActive: setVoiceAudioDucking },
    taskRuntime,
    taskApplicationService,
    taskHistoryService: { load: getTaskHistory },
    updateCompanionState: vi.fn(),
    updateCompanionVoiceActivity,
    voiceService: { createCall: createVoiceCall },
    usageBudgetService: {
      get: vi.fn(async () => ({
        actualMicroUsd: 0,
        daily: { limitMicroUsd: 2_000_000, remainingMicroUsd: 2_000_000, reservedMicroUsd: 0, settledMicroUsd: 0 },
        enforcementMode: 'enforce',
        estimatedMicroUsd: 0,
        monthEndsAt: '2026-09-01T00:00:00.000Z',
        monthly: { limitMicroUsd: 20_000_000, remainingMicroUsd: 20_000_000, reservedMicroUsd: 0, settledMicroUsd: 0 },
        periodStartsAt: '2026-08-01T00:00:00.000Z',
        source: 'hosted',
        task: { limitMicroUsd: 500_000, remainingMicroUsd: 500_000, reservedMicroUsd: 0, settledMicroUsd: 0 },
        warningThresholdMicroUsd: 16_000_000,
      })),
    },
  } as unknown as Parameters<typeof registerIpcHandlers>[1];

  return {
    authService,
    callOrder,
    checkForUpdates,
    createVoiceCall,
    cuaConnect,
    cuaGetStatus,
    event,
    executionCoordinator,
    getAppPreferences,
    getTaskHistory,
    membershipService,
    openSystemPermissionSettings,
    recordVoiceTranscript,
    restartAndInstallUpdate,
    setVoiceAudioDucking,
    requestScreenRecordingAccess,
    submit,
    updateAppPreferences,
    updateCompanionVoiceActivity,
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

  it('keeps update checks available before sign-in without exposing feed control', async () => {
    const {
      checkForUpdates,
      event,
      restartAndInstallUpdate,
      unregister,
    } = setup(false);

    expect(
      electronMock.handlers.get(IPC_CHANNELS.getAppUpdateStatus)?.(event),
    ).toMatchObject({ currentVersion: '0.1.0', phase: 'idle' });
    expect(
      electronMock.handlers.get(IPC_CHANNELS.checkForAppUpdates)?.(event),
    ).toMatchObject({ phase: 'checking' });
    await expect(
      electronMock.handlers.get(IPC_CHANNELS.restartAndInstallAppUpdate)?.(
        event,
      ),
    ).resolves.toBeUndefined();

    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(restartAndInstallUpdate).toHaveBeenCalledOnce();
    expect(electronMock.handlers.has('update:set-feed-url')).toBe(false);
    unregister();
  });

  it('rejects update checks from an untrusted renderer', () => {
    const { checkForUpdates, unregister } = setup(false);
    const handler = electronMock.handlers.get(IPC_CHANNELS.checkForAppUpdates);

    expect(() =>
      handler?.({ sender: { id: 99 }, senderFrame: {} }),
    ).toThrow('untrusted renderer');
    expect(checkForUpdates).not.toHaveBeenCalled();
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

  it('rejects protected task IPC when signed in without an active membership', async () => {
    const { event, membershipService, submit, unregister } = setup(true, false);
    const handler = electronMock.handlers.get(IPC_CHANNELS.submitTask);

    await expect(handler?.(event, { text: 'Open YouTube' })).rejects.toThrow(
      'active membership',
    );
    expect(membershipService.assertActive).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    unregister();
  });

  it('admits protected task IPC after authentication', async () => {
    const { event, executionCoordinator, submit, unregister } = setup(true);
    const handler = electronMock.handlers.get(IPC_CHANNELS.submitTask);

    await expect(handler?.(event, { text: 'Open YouTube' })).resolves.toEqual({
      taskId: 'task-id',
      phase: 'planning',
    });
    expect(submit).toHaveBeenCalledWith({ text: 'Open YouTube' });
    expect(executionCoordinator.start).toHaveBeenCalledWith({
      taskId: 'task-id',
    });
    unregister();
  });

  it('loads and updates persisted app preferences after authentication', async () => {
    const {
      event,
      getAppPreferences,
      unregister,
      updateAppPreferences,
    } = setup(true);

    await expect(
      electronMock.handlers.get(IPC_CHANNELS.getAppPreferences)?.(event),
    ).resolves.toEqual({ primaryLanguage: null });
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.updateAppPreferences)
        ?.(event, { primaryLanguage: 'vi' }),
    ).resolves.toEqual({
      appLanguage: 'en',
      muteSystemAudioWhileSpeaking: false,
      primaryLanguage: 'vi',
    });

    expect(getAppPreferences).toHaveBeenCalledOnce();
    expect(updateAppPreferences).toHaveBeenCalledWith({
      appLanguage: 'en',
      muteSystemAudioWhileSpeaking: false,
      primaryLanguage: 'vi',
    });
    unregister();
  });

  it('loads only the signed-in user task history', async () => {
    const { event, getTaskHistory, unregister } = setup(true);

    await expect(
      electronMock.handlers.get(IPC_CHANNELS.getTaskHistory)?.(event),
    ).resolves.toMatchObject({
      persistence: { mode: 'postgres' },
    });
    expect(getTaskHistory).toHaveBeenCalledWith('user-id');
    unregister();
  });

  it('inspects and activates membership after authentication', async () => {
    const { event, membershipService, unregister } = setup(true, false);
    const activationCode = `${'a'.repeat(80)}.${'b'.repeat(86)}`;

    await expect(
      electronMock.handlers.get(IPC_CHANNELS.getMembershipStatus)?.(event),
    ).resolves.toMatchObject({ state: 'inactive' });
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.activateMembership)
        ?.(event, { code: `  ${activationCode}  ` }),
    ).resolves.toMatchObject({ state: 'active' });

    expect(membershipService.getStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-id' }),
    );
    expect(membershipService.activate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-id' }),
      activationCode,
    );
    unregister();
  });

  it('rejects unsupported primary languages at the IPC boundary', async () => {
    const { event, unregister, updateAppPreferences } = setup(true);

    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.updateAppPreferences)
        ?.(event, { primaryLanguage: 'xx' }),
    ).rejects.toThrow();
    expect(updateAppPreferences).not.toHaveBeenCalled();
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

  it('validates live transcript activity before forwarding it to the island', () => {
    const { event, unregister, updateCompanionVoiceActivity } = setup(false);
    const handler = electronMock.handlers.get(
      IPC_CHANNELS.setCompanionVoiceActivity,
    );

    expect(
      handler?.(event, {
        phase: 'listening',
        transcript: 'Open YouTube',
      }),
    ).toBeUndefined();
    expect(updateCompanionVoiceActivity).toHaveBeenCalledWith({
      appLanguage: 'en',
      phase: 'listening',
      transcript: 'Open YouTube',
    });
    expect(() =>
      handler?.(event, { phase: 'idle', transcript: '' }),
    ).toThrow();
    expect(handler?.(event, null)).toBeUndefined();
    expect(updateCompanionVoiceActivity).toHaveBeenLastCalledWith(null);
    unregister();
  });

  it('routes realtime voice calls through the main process after authentication', async () => {
    const { createVoiceCall, event, unregister } = setup(true);
    const handler = electronMock.handlers.get(IPC_CHANNELS.createVoiceCall);

    await expect(
      handler?.(event, { offerSdp: 'v=0\r\noffer' }),
    ).resolves.toEqual({ answerSdp: 'v=0\r\nanswer' });
    expect(createVoiceCall).toHaveBeenCalledWith({
      offerSdp: 'v=0\r\noffer',
    });
    unregister();
  });

  it('mutes system audio for an active member and always permits restoration', async () => {
    const active = setup(true);
    const activeHandler = electronMock.handlers.get(
      IPC_CHANNELS.setVoiceAudioDucking,
    );

    await expect(
      activeHandler?.(active.event, { active: true }),
    ).resolves.toBeUndefined();
    expect(active.setVoiceAudioDucking).toHaveBeenCalledWith(true);
    expect(active.membershipService.assertActive).toHaveBeenCalledOnce();
    active.unregister();

    const signedOut = setup(false);
    const restoreHandler = electronMock.handlers.get(
      IPC_CHANNELS.setVoiceAudioDucking,
    );
    await expect(
      restoreHandler?.(signedOut.event, { active: false }),
    ).resolves.toBeUndefined();
    expect(signedOut.setVoiceAudioDucking).toHaveBeenCalledWith(false);
    expect(signedOut.authService.assertSignedIn).not.toHaveBeenCalled();
    signedOut.unregister();
  });

  it('rejects realtime voice calls without an active membership', async () => {
    const { createVoiceCall, event, unregister } = setup(true, false);
    const handler = electronMock.handlers.get(IPC_CHANNELS.createVoiceCall);

    await expect(
      handler?.(event, { offerSdp: 'v=0\r\noffer' }),
    ).rejects.toThrow('active membership');
    expect(createVoiceCall).not.toHaveBeenCalled();
    unregister();
  });

  it('keeps computer permission onboarding available before membership', async () => {
    const { cuaGetStatus, event, membershipService, unregister } = setup(
      true,
      false,
    );

    await expect(
      electronMock.handlers.get(IPC_CHANNELS.getComputerStatus)?.(event),
    ).resolves.toMatchObject({ state: 'permission_required' });
    expect(cuaGetStatus).toHaveBeenCalledOnce();
    expect(membershipService.assertActive).not.toHaveBeenCalled();
    unregister();
  });

  it('does not expose legacy voice client-secret sessions to the renderer', () => {
    const { unregister } = setup(true);

    expect(electronMock.handlers.has('voice:create-session')).toBe(false);
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

  it('logs sanitized voice diagnostics from the trusted renderer', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { event, unregister } = setup(false);
    const handler = electronMock.handlers.get(
      IPC_CHANNELS.reportVoiceDiagnostic,
    );

    expect(handler).toBeDefined();
    expect(
      handler?.(event, {
        error: {
          message: 'Failed to fetch',
          name: 'TypeError',
        },
        step: 'realtime_call',
      }),
    ).toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      '[voice] OpenAI Realtime connection failed.',
      {
        error: {
          message: 'Failed to fetch',
          name: 'TypeError',
        },
        step: 'realtime_call',
      },
    );

    consoleError.mockRestore();
    unregister();
  });
});
