import { describe, expect, it, vi } from 'vitest';

import {
  VOICE_TRANSCRIPTION_MODEL,
  type CuaStatus,
} from '../../shared/contracts';
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
  cursorBuddyEvent: unknown;
  interactionEvent: unknown;
  cancelActiveTasks: ReturnType<typeof vi.fn>;
  executionCoordinator: {
    resume: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  };
  cuaConnect: ReturnType<typeof vi.fn>;
  cuaGetStatus: ReturnType<typeof vi.fn>;
  dictationService: {
    begin: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
  };
  callOrder: string[];
  classroomJoin: ReturnType<typeof vi.fn>;
  classroomOpenDirective: ReturnType<typeof vi.fn>;
  createClassroomDirective: ReturnType<typeof vi.fn>;
  prepareKnowledgeActivity: ReturnType<typeof vi.fn>;
  checkForUpdates: ReturnType<typeof vi.fn>;
  companionCustomizationService: {
    activateCandidate: ReturnType<typeof vi.fn>;
    activateSaved: ReturnType<typeof vi.fn>;
    generate: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    useDefault: ReturnType<typeof vi.fn>;
  };
  transcribeVoiceSegment: ReturnType<typeof vi.fn>;
  getAppPreferences: ReturnType<typeof vi.fn>;
  getCursorBuddySnapshot: ReturnType<typeof vi.fn>;
  getTaskHistory: ReturnType<typeof vi.fn>;
  membershipService: {
    activate: ReturnType<typeof vi.fn>;
    assertActive: ReturnType<typeof vi.fn>;
    continueWithFree: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
  };
  organizationClient: {
    addMember: ReturnType<typeof vi.fn>;
    cancelMember: ReturnType<typeof vi.fn>;
    getCurrent: ReturnType<typeof vi.fn>;
    listMembers: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  connectorClient: {
    attempt: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
  onAuthSignedIn: ReturnType<typeof vi.fn>;
  restartAndInstallUpdate: ReturnType<typeof vi.fn>;
  setVoiceAudioDucking: ReturnType<typeof vi.fn>;
  openSystemPermissionSettings: ReturnType<typeof vi.fn>;
  requestScreenRecordingAccess: ReturnType<typeof vi.fn>;
  recordVoiceTranscript: ReturnType<typeof vi.fn>;
  reportCompanionSpeechPlayback: ReturnType<typeof vi.fn>;
  handleCompanionResponseAction: ReturnType<typeof vi.fn>;
  revealMainWindow: ReturnType<typeof vi.fn>;
  taskRuntime: {
    respondToInteraction: ReturnType<typeof vi.fn>;
  };
  submit: ReturnType<typeof vi.fn>;
  updateAppPreferences: ReturnType<typeof vi.fn>;
  updateCompanionVoiceActivity: ReturnType<typeof vi.fn>;
  unregister: () => void;
  workspaceAvailability: ReturnType<typeof vi.fn>;
  workspaceSelect: ReturnType<typeof vi.fn>;
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
  const interactionFrame = {};
  const interactionWebContents = {
    id: 84,
    mainFrame: interactionFrame,
  };
  const interactionWindow = {
    isDestroyed: () => false,
    webContents: interactionWebContents,
  };
  const interactionEvent = {
    sender: { id: 84 },
    senderFrame: interactionFrame,
  };
  const cursorBuddyFrame = {};
  const cursorBuddyWebContents = {
    id: 126,
    mainFrame: cursorBuddyFrame,
  };
  const cursorBuddyWindow = {
    isDestroyed: () => false,
    webContents: cursorBuddyWebContents,
  };
  const cursorBuddyEvent = {
    sender: { id: 126 },
    senderFrame: cursorBuddyFrame,
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
    continueWithFree: vi.fn(async () => ({
      expiresAt: null,
      plan: 'free',
      referenceCode: null,
      required: true,
      state: 'active',
      summary: 'Free plan active.',
    })),
    assertActive: vi.fn(async () => {
      if (!membershipActive) {
        throw new Error('An active membership is required to use Tro.');
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
  const onAuthSignedIn = vi.fn(async () => undefined);
  const taskRuntime = {
    submit,
    respondToInteraction: vi.fn((input: { taskId: string }) => ({
      taskId: input.taskId,
      phase: 'planning',
    })),
    steer: vi.fn(),
    off: vi.fn(),
    on: vi.fn(),
  };
  const executionCoordinator = {
    resume: vi.fn(),
    start: vi.fn((input: unknown) => {
      void input;
      return { taskId: 'task-id', phase: 'planning' };
    }),
  };
  const cancelActiveTasks = vi.fn(async () => undefined);
  const taskApplicationService = {
    cancel: vi.fn((input: unknown) => input),
    respond: vi.fn((input: { taskId: string }) => {
      const snapshot = taskRuntime.respondToInteraction(input);
      executionCoordinator.resume(snapshot.taskId);
      return snapshot;
    }),
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
  const transcribeVoiceSegment = vi.fn(async (input: {
    sequence: number;
    utteranceId: string;
  }) => ({
    audioDurationMs: 300,
    billedSeconds: 0.3,
    model: VOICE_TRANSCRIPTION_MODEL,
    sequence: input.sequence,
    text: 'Open YouTube',
    utteranceId: input.utteranceId,
  }));
  const recordVoiceTranscript = vi.fn(async () => undefined);
  const dictationService = {
    begin: vi.fn(async (turnId: string) => ({
      status: 'ready' as const,
      targetApplication: 'Notes',
      turnId,
    })),
    cancel: vi.fn(async () => undefined),
    commit: vi.fn(async () => ({
      disposition: 'inserted' as const,
      reason: 'confirmed' as const,
      summary: 'Tro inserted the dictated text.',
      targetApplication: 'Notes',
    })),
  };
  const getAppPreferences = vi.fn(async () => ({ primaryLanguage: null }));
  const getCursorBuddySnapshot = vi.fn(() => ({
    busy: false,
    phase: 'following' as const,
    position: { x: 31, y: 47 },
  }));
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
  const checkForUpdates = vi.fn(async () => ({
    ...appUpdateStatus,
    message: 'Checking for updates…',
    phase: 'checking' as const,
  }));
  const restartAndInstallUpdate = vi.fn(async () => undefined);
  const updateCompanionVoiceActivity = vi.fn();
  const setVoiceAudioDucking = vi.fn(async () => undefined);
  const revealMainWindow = vi.fn();
  const reportCompanionSpeechPlayback = vi.fn();
  const handleCompanionResponseAction = vi.fn();
  const workspaceAvailability = vi.fn(async () => ({
    available: true,
    runtimeVersion: null,
    summary: 'Workspace mode is available through the Tro service.',
  }));
  const workspaceSelect = vi.fn(async () => null);
  const companionStatus = {
    appearance: { kind: 'default' as const },
    candidate: null,
    quota: {
      limit: 5 as const,
      periodEndsAt: '2026-09-01T00:00:00.000Z',
      periodStartsAt: '2026-08-01T00:00:00.000Z',
      remaining: 5,
      used: 0,
    },
    savedCompanions: [],
    state: 'available' as const,
    summary: 'Ready.',
  };
  const companionCustomizationService = {
    activateCandidate: vi.fn(async () => companionStatus),
    activateSaved: vi.fn(async () => companionStatus),
    generate: vi.fn(async () => companionStatus),
    getStatus: vi.fn(async () => companionStatus),
    useDefault: vi.fn(async () => companionStatus),
  };
  const classroomSession = {
    attemptId: '11111111-1111-4111-8111-111111111111',
    attemptState: 'assigned' as const,
    run: {
      id: '22222222-2222-4222-8222-222222222222',
      state: 'draft' as const,
      mode: 'live' as const,
      status: 'lobby' as const,
    },
    space: {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Python 101',
    },
    activityVersionId: '44444444-4444-4444-8444-444444444444',
    activity: { title: 'Loops', objective: 'Practice loops.', requiresSubmission: false },
    currentDirective: null,
    joinedAt: '2026-08-25T00:00:00.000Z',
    leftAt: null,
    role: 'student' as const,
    autoOpenConsent: false,
  };
  const classroomJoin = vi.fn(async () => classroomSession);
  const classroomOpenDirective = vi.fn(async () => undefined);
  const prepareKnowledgeActivity = vi.fn(async (request: unknown) => request);
  const createClassroomDirective = vi.fn(async (request: unknown) => request);
  const classroomSessionService = {
    clear: vi.fn(),
    get: vi.fn(() => classroomSession),
    join: classroomJoin,
    leave: vi.fn(async () => undefined),
    onChange: vi.fn(() => vi.fn()),
    restore: vi.fn(async () => classroomSession),
    setAutoOpenConsent: vi.fn((consent: boolean) => ({
      ...classroomSession,
      autoOpenConsent: consent,
    })),
  };
  const classroomDirectiveService = {
    dismiss: vi.fn(),
    getNotice: vi.fn(() => null),
    onNotice: vi.fn(() => vi.fn()),
    open: classroomOpenDirective,
  };
  const organization = {
    capacity: {
      assignedSeats: 1,
      maxSeats: 10,
      remainingSeats: 9,
      state: 'available' as const,
    },
    homeBanner: null,
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Math Teachers',
    plan: 'pro' as const,
    role: 'organizer' as const,
  };
  const pendingMember = {
    createdAt: '2026-08-25T08:00:00.000Z',
    email: 'student@example.com',
    id: '22222222-2222-4222-8222-222222222222',
    joinedAt: null,
    name: null,
    role: 'member' as const,
    state: 'pending' as const,
  };
  const organizationClient = {
    addMember: vi.fn(async () => ({
      member: pendingMember,
      newlyCreated: true,
      organization,
    })),
    cancelMember: vi.fn(async (memberId: string) => ({
      kind: 'cancelled' as const,
      memberId,
      organization,
    })),
    getCurrent: vi.fn(async () => ({ organization })),
    listMembers: vi.fn(async (input: { limit: number; offset: number }) => ({
      items: [pendingMember],
      organization,
      page: { ...input, total: 1 },
    })),
    update: vi.fn(
      async (
        input:
          | { name: string }
          | { homeBannerImageDataUrl: string | null },
      ) => ({
        organization:
          'name' in input
            ? { ...organization, name: input.name }
            : {
                ...organization,
                homeBanner: input.homeBannerImageDataUrl
                  ? { imageDataUrl: input.homeBannerImageDataUrl }
                  : null,
              },
      }),
    ),
  };
  const connectorClient = {
    attempt: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    list: vi.fn(),
  };
  const services = {
    agentActivityService: { off: vi.fn(), on: vi.fn() },
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
    companionCustomizationService,
    classroomDirectiveService,
    classroomSessionService,
    cuaService: { connect: cuaConnect, getStatus: cuaGetStatus },
    dictationService,
    connectorClient,
    cancelActiveTasks,
    getCompanionInteractionWindow: () => interactionWindow,
    getCursorBuddySnapshot,
    getCursorBuddyWindow: () => cursorBuddyWindow,
    handleCompanionResponseAction,
    membershipService,
    knowledgeSpaceClient: {
      prepareActivity: prepareKnowledgeActivity,
      createDirective: createClassroomDirective,
    },
    organizationClient,
    onAuthSignedIn,
    openSystemPermissionSettings,
    recordVoiceTranscript,
    reportCompanionSpeechPlayback,
    requestScreenRecordingAccess,
    revealMainWindow,
    systemAudioDuckingService: { setActive: setVoiceAudioDucking },
    taskRuntime,
    taskApplicationService,
    taskHistoryService: { load: getTaskHistory },
    updateCompanionState: vi.fn(),
    updateCompanionVoiceActivity,
    voiceService: { transcribeSegment: transcribeVoiceSegment },
    usageBudgetService: {
      get: vi.fn(async () => ({
        actualMicroUsd: 0,
        daily: { limitMicroUsd: 2_000_000, remainingMicroUsd: 2_000_000, reservedMicroUsd: 0, settledMicroUsd: 0 },
        enforcementMode: 'enforce',
        estimatedMicroUsd: 0,
        messages: {
          limit: 750,
          periodEndsAt: '2026-08-24T00:00:00.000Z',
          periodStartsAt: '2026-08-17T00:00:00.000Z',
          remaining: 750,
          used: 0,
        },
        monthEndsAt: '2026-09-01T00:00:00.000Z',
        monthly: { limitMicroUsd: 20_000_000, remainingMicroUsd: 20_000_000, reservedMicroUsd: 0, settledMicroUsd: 0 },
        periodStartsAt: '2026-08-01T00:00:00.000Z',
        plan: 'pro',
        pricing: { currency: 'usd', monthlyCents: 5_000 },
        source: 'hosted',
        task: { limitMicroUsd: 500_000, remainingMicroUsd: 500_000, reservedMicroUsd: 0, settledMicroUsd: 0 },
        warningThresholdMicroUsd: 16_000_000,
      })),
    },
    workspaceSelectionService: {
      availability: workspaceAvailability,
      select: workspaceSelect,
    },
  } as unknown as Parameters<typeof registerIpcHandlers>[1];

  return {
    prepareKnowledgeActivity,
    authService,
    cancelActiveTasks,
    callOrder,
    classroomJoin,
    classroomOpenDirective,
    checkForUpdates,
    companionCustomizationService,
    transcribeVoiceSegment,
    cuaConnect,
    cuaGetStatus,
    dictationService,
    createClassroomDirective,
    cursorBuddyEvent,
    event,
    interactionEvent,
    executionCoordinator,
    getAppPreferences,
    getCursorBuddySnapshot,
    getTaskHistory,
    handleCompanionResponseAction,
    membershipService,
    organizationClient,
    connectorClient,
    onAuthSignedIn,
    openSystemPermissionSettings,
    recordVoiceTranscript,
    reportCompanionSpeechPlayback,
    revealMainWindow,
    restartAndInstallUpdate,
    setVoiceAudioDucking,
    requestScreenRecordingAccess,
    submit,
    taskRuntime,
    updateAppPreferences,
    updateCompanionVoiceActivity,
    unregister: registerIpcHandlers(mainWindow, services),
    workspaceAvailability,
    workspaceSelect,
  };
}

describe('registerIpcHandlers auth boundary', () => {
  it('authorizes and parses every companion customization operation', async () => {
    const {
      companionCustomizationService,
      event,
      membershipService,
      unregister,
    } = setup(true);
    const generateRequest = {
      imageBase64: Buffer.from('png').toString('base64'),
      mimeType: 'image/png',
      prompt: 'Make it blue.',
      requestId: '11111111-1111-4111-8111-111111111111',
    } as const;
    const activateRequest = {
      candidateId: '22222222-2222-4222-8222-222222222222',
    } as const;
    const activateSavedRequest = {
      companionId: 'a'.repeat(64),
    } as const;

    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.companionCustomizationStatus)
        ?.(event),
    ).resolves.toMatchObject({ state: 'available' });
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.companionGenerateImage)
        ?.(event, generateRequest),
    ).resolves.toMatchObject({ state: 'available' });
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.companionActivateCandidate)
        ?.(event, activateRequest),
    ).resolves.toMatchObject({ state: 'available' });
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.companionActivateSaved)
        ?.(event, activateSavedRequest),
    ).resolves.toMatchObject({ state: 'available' });
    await expect(
      electronMock.handlers.get(IPC_CHANNELS.companionUseDefault)?.(event),
    ).resolves.toMatchObject({ state: 'available' });
    expect(companionCustomizationService.generate).toHaveBeenCalledWith(
      generateRequest,
    );
    expect(companionCustomizationService.activateCandidate).toHaveBeenCalledWith(
      activateRequest,
    );
    expect(companionCustomizationService.activateSaved).toHaveBeenCalledWith(
      activateSavedRequest,
    );
    expect(membershipService.assertActive).toHaveBeenCalledTimes(5);

    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.companionGenerateImage)
        ?.(event, { ...generateRequest, filesystemPath: '/private/image.png' }),
    ).rejects.toThrow();
    expect(companionCustomizationService.generate).toHaveBeenCalledOnce();
    unregister();
  });

  it('rejects companion customization from subframes and inactive accounts', async () => {
    const untrusted = setup(true);
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.companionCustomizationStatus)
        ?.({ sender: { id: 42 }, senderFrame: {} }),
    ).rejects.toThrow('untrusted renderer');
    expect(untrusted.companionCustomizationService.getStatus).not.toHaveBeenCalled();
    untrusted.unregister();

    const inactive = setup(true, false);
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.companionCustomizationStatus)
        ?.(inactive.event),
    ).rejects.toThrow('active membership');
    expect(inactive.companionCustomizationService.getStatus).not.toHaveBeenCalled();
    inactive.unregister();
  });

  it('returns sign-in immediately, reveals Tro, and finishes setup in the background', async () => {
    const { event, onAuthSignedIn, revealMainWindow, unregister } = setup(false);
    let finishSetup: () => void = () => undefined;
    onAuthSignedIn.mockImplementation(
      () => new Promise<void>((resolve) => {
        finishSetup = resolve;
      }),
    );
    const handler = electronMock.handlers.get(IPC_CHANNELS.signInWithGoogle);

    await expect(handler?.(event)).resolves.toMatchObject({ state: 'signed_in' });
    expect(revealMainWindow).toHaveBeenCalledOnce();
    expect(onAuthSignedIn).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-id' }),
    );
    finishSetup();
    unregister();
  });

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
    await expect(
      electronMock.handlers.get(IPC_CHANNELS.checkForAppUpdates)?.(event),
    ).resolves.toMatchObject({ phase: 'checking' });
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

  it('routes parsed classroom join and directive actions through trusted main services', async () => {
    const {
      classroomJoin,
      classroomOpenDirective,
      createClassroomDirective,
      event,
      unregister,
    } = setup(true);
    const joinRequest = {
      autoOpenConsent: true,
      clientId: '55555555-5555-4555-8555-555555555555',
      code: 'TRO-ABCD-12',
    };
    const directive = {
      id: '66666666-6666-4666-8666-666666666666',
      sequence: 1,
      kind: 'exercise' as const,
      delivery: 'manual_only' as const,
      instruction: 'Complete exercise A.',
      criterionIds: ['exercise-a'],
      createdAt: '2026-08-25T00:00:00.000Z',
    };
    const createRequest = {
      spaceId: '33333333-3333-4333-8333-333333333333',
      runId: '22222222-2222-4222-8222-222222222222',
      clientId: '77777777-7777-4777-8777-777777777777',
      directive: {
        kind: 'exercise' as const,
        instruction: 'Complete exercise A.',
        criterionIds: ['exercise-a'],
      },
    };

    await electronMock.handlers.get(IPC_CHANNELS.joinKnowledgeRoom)?.(
      event,
      joinRequest,
    );
    await electronMock.handlers.get(IPC_CHANNELS.createClassroomDirective)?.(
      event,
      createRequest,
    );
    await electronMock.handlers.get(IPC_CHANNELS.openClassroomDirective)?.(
      event,
      { directive },
    );

    expect(classroomJoin).toHaveBeenCalledWith(joinRequest);
    expect(createClassroomDirective).toHaveBeenCalledWith(createRequest);
    expect(classroomOpenDirective).toHaveBeenCalledWith(directive);

    await expect(
      electronMock.handlers.get(IPC_CHANNELS.joinKnowledgeRoom)?.(
        event,
        { ...joinRequest, code: 'short' },
      ),
    ).rejects.toThrow();
    expect(classroomJoin).toHaveBeenCalledOnce();
    unregister();
  });

  it('lets the authenticated cursor card answer a clarification and resume', async () => {
    const {
      executionCoordinator,
      interactionEvent,
      taskRuntime,
      unregister,
    } = setup(true);
    const request = {
      interactionId: '00000000-0000-4000-8000-000000000002',
      kind: 'answer',
      taskId: '00000000-0000-4000-8000-000000000001',
      text: 'Use my work account',
    } as const;

    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.respondToInteraction)
        ?.(interactionEvent, request),
    ).resolves.toMatchObject({ taskId: request.taskId, phase: 'planning' });
    expect(taskRuntime.respondToInteraction).toHaveBeenCalledWith(request);
    expect(executionCoordinator.resume).toHaveBeenCalledWith(request.taskId);
    unregister();
  });

  it('rejects protected cursor-card commands from other renderers', async () => {
    const { revealMainWindow, taskRuntime, unregister } = setup(true);
    const untrustedEvent = { sender: { id: 99 }, senderFrame: {} };

    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.respondToInteraction)
        ?.(untrustedEvent, {}),
    ).rejects.toThrow('untrusted renderer');
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.companionRevealMainWindow)
        ?.(untrustedEvent),
    ).rejects.toThrow('untrusted renderer');
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.companionReportSpeechPlayback)
        ?.(untrustedEvent, {}),
    ).rejects.toThrow('untrusted renderer');
    expect(taskRuntime.respondToInteraction).not.toHaveBeenCalled();
    expect(revealMainWindow).not.toHaveBeenCalled();
    unregister();
  });

  it('returns the current snapshot only to the cursor-buddy renderer', async () => {
    const {
      cursorBuddyEvent,
      getCursorBuddySnapshot,
      unregister,
    } = setup(true);
    const handler = electronMock.handlers.get(
      IPC_CHANNELS.getCursorBuddySnapshot,
    );

    await expect(handler?.(cursorBuddyEvent)).resolves.toEqual({
      busy: false,
      phase: 'following',
      position: { x: 31, y: 47 },
    });
    await expect(
      handler?.({ sender: { id: 99 }, senderFrame: {} }),
    ).rejects.toThrow('untrusted renderer');
    expect(getCursorBuddySnapshot).toHaveBeenCalledOnce();
    unregister();
  });

  it('rejects cursor-card responses before authentication or membership', async () => {
    const signedOut = setup(false);
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.respondToInteraction)
        ?.(signedOut.interactionEvent, {}),
    ).rejects.toThrow('Sign in with Google first.');
    expect(signedOut.taskRuntime.respondToInteraction).not.toHaveBeenCalled();
    signedOut.unregister();

    const inactive = setup(true, false);
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.respondToInteraction)
        ?.(inactive.interactionEvent, {}),
    ).rejects.toThrow('active membership');
    expect(inactive.taskRuntime.respondToInteraction).not.toHaveBeenCalled();
    inactive.unregister();
  });

  it('lets only the signed-in cursor card reveal the fallback main window', async () => {
    const { interactionEvent, revealMainWindow, unregister } = setup(true);

    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.companionRevealMainWindow)
        ?.(interactionEvent),
    ).resolves.toBeUndefined();
    expect(revealMainWindow).toHaveBeenCalledOnce();
    unregister();
  });

  it('lets only the signed-in cursor card perform a parsed response-card action', async () => {
    const { handleCompanionResponseAction, interactionEvent, unregister } =
      setup(true);
    const handler = electronMock.handlers.get(
      IPC_CHANNELS.companionResponseAction,
    );
    const request = {
      action: 'ask_follow_up',
      cardId: '00000000-0000-4000-8000-000000000002',
      taskId: '00000000-0000-4000-8000-000000000001',
    } as const;

    await expect(handler?.(interactionEvent, request)).resolves.toBeUndefined();
    expect(handleCompanionResponseAction).toHaveBeenCalledWith(request);

    await expect(
      handler?.(interactionEvent, {
        ...request,
        action: 'delete_task',
      }),
    ).rejects.toThrow();
    expect(handleCompanionResponseAction).toHaveBeenCalledOnce();
    unregister();
  });

  it('rejects response-card actions from untrusted or signed-out renderers', async () => {
    const trusted = setup(true);
    const trustedHandler = electronMock.handlers.get(
      IPC_CHANNELS.companionResponseAction,
    );

    await expect(
      trustedHandler?.(
        trusted.event,
        {
          action: 'dismiss',
          cardId: '00000000-0000-4000-8000-000000000002',
          taskId: '00000000-0000-4000-8000-000000000001',
        },
      ),
    ).rejects.toThrow('untrusted renderer');
    expect(trusted.handleCompanionResponseAction).not.toHaveBeenCalled();
    trusted.unregister();

    const signedOut = setup(false);
    const signedOutHandler = electronMock.handlers.get(
      IPC_CHANNELS.companionResponseAction,
    );
    await expect(
      signedOutHandler?.(signedOut.interactionEvent, {
        action: 'dismiss',
        cardId: '00000000-0000-4000-8000-000000000002',
        taskId: '00000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toThrow('Sign in with Google first.');
    expect(signedOut.handleCompanionResponseAction).not.toHaveBeenCalled();
    signedOut.unregister();
  });

  it('accepts only parsed cursor-card speech playback reports', async () => {
    const {
      interactionEvent,
      reportCompanionSpeechPlayback,
      unregister,
    } = setup(true);
    const handler = electronMock.handlers.get(
      IPC_CHANNELS.companionReportSpeechPlayback,
    );
    const report = {
      id: '00000000-0000-4000-8000-000000000002',
      phase: 'playing',
      source: 'elevenlabs',
    } as const;

    await expect(handler?.(interactionEvent, report)).resolves.toBeUndefined();
    expect(reportCompanionSpeechPlayback).toHaveBeenCalledWith(report);
    await expect(
      handler?.(interactionEvent, { ...report, phase: 'buffering' }),
    ).rejects.toThrow();
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
        ?.(event, {
          classroomPetEnabled: false,
          primaryLanguage: 'vi',
          voiceMode: 'task',
        }),
    ).resolves.toEqual({
      appLanguage: 'en',
      classroomPetEnabled: false,
      muteSystemAudioWhileSpeaking: false,
      primaryLanguage: 'vi',
      voiceMode: 'task',
    });

    expect(getAppPreferences).toHaveBeenCalledOnce();
    expect(updateAppPreferences).toHaveBeenCalledWith({
      appLanguage: 'en',
      classroomPetEnabled: false,
      muteSystemAudioWhileSpeaking: false,
      primaryLanguage: 'vi',
      voiceMode: 'task',
    });
    unregister();
  });

  it('checks Workspace availability after sign-in and requires membership to pick a folder', async () => {
    const active = setup(true);
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.getWorkspaceRuntimeAvailability)
        ?.(active.event),
    ).resolves.toMatchObject({ available: true, runtimeVersion: null });
    await expect(
      electronMock.handlers.get(IPC_CHANNELS.selectWorkspace)?.(active.event),
    ).resolves.toBeNull();
    expect(active.workspaceAvailability).toHaveBeenCalledOnce();
    expect(active.workspaceSelect).toHaveBeenCalledOnce();
    active.unregister();

    const inactive = setup(true, false);
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.selectWorkspace)
        ?.(inactive.event),
    ).rejects.toThrow('active membership');
    expect(inactive.workspaceSelect).not.toHaveBeenCalled();
    inactive.unregister();
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

  it('inspects, activates, or continues Free membership after authentication', async () => {
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
    await expect(
      electronMock.handlers.get(IPC_CHANNELS.continueWithFree)?.(event),
    ).resolves.toMatchObject({ plan: 'free', state: 'active' });

    expect(membershipService.getStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-id' }),
    );
    expect(membershipService.activate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-id' }),
      activationCode,
    );
    expect(membershipService.continueWithFree).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-id' }),
    );
    unregister();
  });

  it('authorizes and validates exact organization operations at the IPC boundary', async () => {
    const { event, organizationClient, unregister } = setup(true);
    const memberId = '22222222-2222-4222-8222-222222222222';
    const bannerDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    await expect(
      electronMock.handlers.get(IPC_CHANNELS.getOrganization)?.(event),
    ).resolves.toMatchObject({
      organization: { role: 'organizer' },
    });
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.updateOrganization)
        ?.(event, { name: '  Greenfield School  ' }),
    ).resolves.toMatchObject({
      organization: { name: 'Greenfield School' },
    });
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.updateOrganization)
        ?.(event, { homeBannerImageDataUrl: bannerDataUrl }),
    ).resolves.toMatchObject({
      organization: { homeBanner: { imageDataUrl: bannerDataUrl } },
    });
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.listOrganizationMembers)
        ?.(event, { limit: 25, offset: 0 }),
    ).resolves.toMatchObject({ page: { limit: 25, offset: 0 } });
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.addOrganizationMember)
        ?.(event, { email: ' Student@Example.com ' }),
    ).resolves.toMatchObject({ newlyCreated: true });
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.cancelOrganizationMember)
        ?.(event, { memberId }),
    ).resolves.toMatchObject({ kind: 'cancelled', memberId });

    expect(organizationClient.getCurrent).toHaveBeenCalledOnce();
    expect(organizationClient.update).toHaveBeenCalledWith({
      name: 'Greenfield School',
    });
    expect(organizationClient.update).toHaveBeenCalledWith({
      homeBannerImageDataUrl: bannerDataUrl,
    });
    expect(organizationClient.listMembers).toHaveBeenCalledWith({
      limit: 25,
      offset: 0,
    });
    expect(organizationClient.addMember).toHaveBeenCalledWith({
      email: 'Student@Example.com',
    });
    expect(organizationClient.cancelMember).toHaveBeenCalledWith(memberId);
    unregister();
  });

  it('rejects malformed or unauthorized organization calls before the client', async () => {
    const active = setup(true);
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.addOrganizationMember)
        ?.(active.event, { email: 'not-an-email' }),
    ).rejects.toThrow();
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.cancelOrganizationMember)
        ?.(active.event, { memberId: 'not-a-uuid' }),
    ).rejects.toThrow();
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.updateOrganization)
        ?.(active.event, { name: '   ' }),
    ).rejects.toThrow();
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.updateOrganization)
        ?.(active.event, {
          homeBannerImageDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
        }),
    ).rejects.toThrow();
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.updateOrganization)
        ?.(active.event, {
          name: 'Greenfield School',
          organizationId: '11111111-1111-4111-8111-111111111111',
        }),
    ).rejects.toThrow();
    expect(active.organizationClient.addMember).not.toHaveBeenCalled();
    expect(active.organizationClient.cancelMember).not.toHaveBeenCalled();
    expect(active.organizationClient.update).not.toHaveBeenCalled();
    active.unregister();

    const inactive = setup(true, false);
    await expect(
      electronMock.handlers.get(IPC_CHANNELS.getOrganization)?.(inactive.event),
    ).rejects.toThrow('active membership');
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.updateOrganization)
        ?.(inactive.event, { name: 'Greenfield School' }),
    ).rejects.toThrow('active membership');
    expect(inactive.organizationClient.getCurrent).not.toHaveBeenCalled();
    expect(inactive.organizationClient.update).not.toHaveBeenCalled();
    inactive.unregister();

    const untrusted = setup(true);
    await expect(
      electronMock.handlers
        .get(IPC_CHANNELS.getOrganization)
        ?.({ sender: { id: 999 }, senderFrame: {} }),
    ).rejects.toThrow();
    expect(untrusted.organizationClient.getCurrent).not.toHaveBeenCalled();
    untrusted.unregister();
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
      handler?.(event, {
        characterCount: 19,
        destination: 'task',
        disposition: 'task_submitted',
        mode: 'task',
      }),
    ).resolves.toBeUndefined();
    expect(recordVoiceTranscript).toHaveBeenCalledWith({
      characterCount: 19,
      destination: 'task',
      disposition: 'task_submitted',
      mode: 'task',
    });
    unregister();
  });

  it('authorizes, validates, and parses dictation begin and commit', async () => {
    const { dictationService, event, unregister } = setup(true);
    const turnId = '11111111-1111-4111-8111-111111111111';
    const begin = electronMock.handlers.get(IPC_CHANNELS.beginDictation);
    const commit = electronMock.handlers.get(IPC_CHANNELS.commitDictation);

    await expect(begin?.(event, { turnId })).resolves.toEqual({
      status: 'ready',
      targetApplication: 'Notes',
      turnId,
    });
    await expect(commit?.(event, { text: 'Hello', turnId })).resolves.toEqual({
      disposition: 'inserted',
      reason: 'confirmed',
      summary: 'Tro inserted the dictated text.',
      targetApplication: 'Notes',
    });
    expect(dictationService.begin).toHaveBeenCalledWith(turnId);
    expect(dictationService.commit).toHaveBeenCalledWith(turnId, 'Hello');
    unregister();
  });

  it('rejects unauthorized or malformed dictation without invoking the service', async () => {
    const signedOut = setup(false);
    const turnId = '11111111-1111-4111-8111-111111111111';
    const begin = electronMock.handlers.get(IPC_CHANNELS.beginDictation);
    await expect(begin?.(signedOut.event, { turnId })).rejects.toThrow();
    expect(signedOut.dictationService.begin).not.toHaveBeenCalled();
    signedOut.unregister();

    const inactive = setup(true, false);
    const commit = electronMock.handlers.get(IPC_CHANNELS.commitDictation);
    await expect(
      commit?.(inactive.event, { text: 'Hello', turnId }),
    ).rejects.toThrow();
    expect(inactive.dictationService.commit).not.toHaveBeenCalled();
    inactive.unregister();

    const malformed = setup(true);
    const malformedBegin = electronMock.handlers.get(
      IPC_CHANNELS.beginDictation,
    );
    await expect(
      malformedBegin?.(malformed.event, { extra: true, turnId }),
    ).rejects.toThrow();
    expect(malformed.dictationService.begin).not.toHaveBeenCalled();
    malformed.unregister();

    const untrusted = setup(true);
    const untrustedBegin = electronMock.handlers.get(
      IPC_CHANNELS.beginDictation,
    );
    await expect(
      untrustedBegin?.(untrusted.interactionEvent, { turnId }),
    ).rejects.toThrow();
    expect(untrusted.dictationService.begin).not.toHaveBeenCalled();
    untrusted.unregister();
  });

  it('allows trusted dictation cancellation after sign-out but rejects auxiliary renderers', async () => {
    const {
      dictationService,
      event,
      interactionEvent,
      unregister,
    } = setup(false);
    const cancel = electronMock.handlers.get(IPC_CHANNELS.cancelDictation);
    const request = { turnId: '11111111-1111-4111-8111-111111111111' };

    await expect(cancel?.(event, request)).resolves.toBeUndefined();
    expect(dictationService.cancel).toHaveBeenCalledWith(request.turnId);
    await expect(cancel?.(interactionEvent, request)).rejects.toThrow();
    expect(dictationService.cancel).toHaveBeenCalledOnce();
    unregister();
  });

  it('validates live transcript activity before forwarding it to the island', () => {
    const { event, unregister, updateCompanionVoiceActivity } = setup(false);
    const handler = electronMock.handlers.get(
      IPC_CHANNELS.setCompanionVoiceActivity,
    );

    expect(
      handler?.(event, {
        destination: { kind: 'task', label: 'Tro task' },
        mode: 'task',
        phase: 'listening',
        transcript: 'Open YouTube',
      }),
    ).toBeUndefined();
    expect(updateCompanionVoiceActivity).toHaveBeenCalledWith({
      appLanguage: 'en',
      destination: { kind: 'task', label: 'Tro task' },
      mode: 'task',
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

  it('routes bounded voice segments through the main process after authentication', async () => {
    const { event, transcribeVoiceSegment, unregister } = setup(true);
    const handler = electronMock.handlers.get(
      IPC_CHANNELS.transcribeVoiceSegment,
    );
    const request = {
      audioBase64: Buffer.from(new Uint8Array(60)).toString('base64'),
      durationMs: 300,
      requestId: '22222222-2222-4222-8222-222222222222',
      sequence: 0,
      utteranceId: '11111111-1111-4111-8111-111111111111',
    };

    await expect(handler?.(event, request)).resolves.toMatchObject({
      model: VOICE_TRANSCRIPTION_MODEL,
      sequence: 0,
    });
    expect(transcribeVoiceSegment).toHaveBeenCalledWith(request);
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

  it('rejects voice segment uploads without an active membership', async () => {
    const { event, transcribeVoiceSegment, unregister } = setup(true, false);
    const handler = electronMock.handlers.get(
      IPC_CHANNELS.transcribeVoiceSegment,
    );

    await expect(
      handler?.(event, {
        audioBase64: Buffer.from(new Uint8Array(60)).toString('base64'),
        durationMs: 300,
        requestId: '22222222-2222-4222-8222-222222222222',
        sequence: 0,
        utteranceId: '11111111-1111-4111-8111-111111111111',
      }),
    ).rejects.toThrow('active membership');
    expect(transcribeVoiceSegment).not.toHaveBeenCalled();
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
    const { cancelActiveTasks, event, unregister } = setup(true);
    const handler = electronMock.handlers.get(IPC_CHANNELS.signOutGoogle);

    await expect(handler?.(event)).resolves.toMatchObject({
      state: 'signed_out',
      user: null,
    });
    expect(cancelActiveTasks).toHaveBeenCalledOnce();
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
        step: 'segment_upload',
      }),
    ).toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      '[voice] GPT Transcribe transcription failed.',
      {
        error: {
          message: 'Failed to fetch',
          name: 'TypeError',
        },
        step: 'segment_upload',
      },
    );

    consoleError.mockRestore();
    unregister();
  });
});

describe('activity preparation IPC boundary', () => {
  const input = {
    spaceId: '11111111-1111-4111-8111-111111111111',
    requestId: '22222222-2222-4222-8222-222222222222',
    description: 'Practice a skill', language: 'en', sourceVersionIds: [],
  };
  it('validates input before calling the authenticated activity client', async () => {
    const fixture = setup(true);
    const handler = electronMock.handlers.get(IPC_CHANNELS.prepareKnowledgeActivity)!;
    await expect(handler(fixture.event, { ...input, description: '' })).rejects.toThrow();
    expect(fixture.prepareKnowledgeActivity).not.toHaveBeenCalled();
    await expect(handler(fixture.event, input)).resolves.toEqual(input);
    expect(fixture.prepareKnowledgeActivity).toHaveBeenCalledOnce();
  });
  it('blocks preparation before membership is active', async () => {
    const fixture = setup(true, false);
    const handler = electronMock.handlers.get(IPC_CHANNELS.prepareKnowledgeActivity)!;
    await expect(handler(fixture.event, input)).rejects.toThrow('membership');
    expect(fixture.prepareKnowledgeActivity).not.toHaveBeenCalled();
  });
});
