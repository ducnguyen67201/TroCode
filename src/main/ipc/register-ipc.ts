import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import {
  ActivateMembershipRequestSchema,
  CompanionSpeechPlaybackReportSchema,
  CompanionStateSchema,
  CompanionVoiceActivitySchema,
  DecideApprovalRequestSchema,
  GetUsageBudgetRequestSchema,
  RecordVoiceTranscriptRequestSchema,
  RespondToInteractionRequestSchema,
  SetVoiceAudioDuckingRequestSchema,
  SystemPermissionSchema,
  TaskUpdateSchema,
  UpdateAppPreferencesRequestSchema,
  VoiceDiagnosticSchema,
  type AuthUser,
  type CompanionState,
  type CompanionVoiceActivity,
  type CompanionSpeechPlaybackReport,
  type RecordVoiceTranscriptRequest,
  type SystemPermission,
  type UsageBudgetSnapshot,
} from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/desktop-api';
import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';
import type { TaskRuntime } from '../agent/task-runtime';
import type { TaskApplicationService } from '../application/task-application-service';
import type { GoogleAuthService } from '../auth/google-auth-service';
import type { UsageBudgetService } from '../budget/usage-budget-service';
import type { CuaService } from '../cua/cua-service';
import type { TaskHistoryService } from '../history/task-history-service';
import type { MembershipService } from '../membership/membership-service';
import type { AppPreferencesService } from '../preferences/app-preferences-service';
import type { AppUpdateService } from '../update/app-update-service';
import type { SystemAudioDuckingService } from '../voice/system-audio-ducking-service';
import type { VoiceService } from '../voice/voice-service';

interface IpcServices {
  appUpdateService: Pick<
    AppUpdateService,
    | 'checkForUpdates'
    | 'getStatus'
    | 'onStatusChange'
    | 'restartAndInstall'
  >;
  appPreferencesService: AppPreferencesService;
  authService: GoogleAuthService;
  cuaService: CuaService;
  executionCoordinator: TaskExecutionCoordinator;
  getCompanionInteractionWindow(): BrowserWindow | null;
  membershipService: MembershipService;
  onAuthSignedIn?(user: AuthUser): Promise<void> | void;
  onAuthSignedOut?(): Promise<void> | void;
  onUsageBudgetSnapshot?(snapshot: UsageBudgetSnapshot): void;
  openSystemPermissionSettings(
    permission: SystemPermission,
  ): Promise<unknown> | unknown;
  recordVoiceTranscript(
    input: RecordVoiceTranscriptRequest,
  ): Promise<void> | void;
  reportCompanionSpeechPlayback(
    report: CompanionSpeechPlaybackReport,
  ): Promise<void> | void;
  requestScreenRecordingAccess(): Promise<unknown> | unknown;
  revealMainWindow(): void;
  taskRuntime: TaskRuntime;
  taskApplicationService: TaskApplicationService;
  taskHistoryService: TaskHistoryService;
  systemAudioDuckingService: Pick<SystemAudioDuckingService, 'setActive'>;
  updateCompanionState(state: CompanionState): void;
  updateCompanionVoiceActivity(
    activity: CompanionVoiceActivity | null,
  ): void;
  voiceService: VoiceService;
  usageBudgetService: UsageBudgetService;
}

async function assertAuthorizedSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
  authService: GoogleAuthService,
): Promise<AuthUser> {
  assertTrustedSender(event, mainWindow);
  return authService.assertSignedIn();
}

async function assertMembershipAuthorizedSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
  services: Pick<IpcServices, 'authService' | 'membershipService'>,
): Promise<void> {
  const user = await assertAuthorizedSender(
    event,
    mainWindow,
    services.authService,
  );
  await services.membershipService.assertActive(user);
}

function isTrustedWindowSender(
  event: IpcMainInvokeEvent,
  window: BrowserWindow | null,
): boolean {
  return Boolean(
    window &&
      !window.isDestroyed() &&
      event.sender.id === window.webContents.id &&
      event.senderFrame === window.webContents.mainFrame,
  );
}

function assertTrustedInteractionSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
  services: Pick<IpcServices, 'getCompanionInteractionWindow'>,
): void {
  if (
    !isTrustedWindowSender(event, mainWindow) &&
    !isTrustedWindowSender(event, services.getCompanionInteractionWindow())
  ) {
    throw new Error('Rejected IPC call from an untrusted renderer.');
  }
}

function assertTrustedCompanionSender(
  event: IpcMainInvokeEvent,
  services: Pick<IpcServices, 'getCompanionInteractionWindow'>,
): void {
  if (!isTrustedWindowSender(event, services.getCompanionInteractionWindow())) {
    throw new Error('Rejected IPC call from an untrusted renderer.');
  }
}

async function assertMembershipAuthorizedInteractionSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
  services: Pick<
    IpcServices,
    'authService' | 'getCompanionInteractionWindow' | 'membershipService'
  >,
): Promise<void> {
  assertTrustedInteractionSender(event, mainWindow, services);
  const user = await services.authService.assertSignedIn();
  await services.membershipService.assertActive(user);
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
): void {
  if (
    event.sender.id !== mainWindow.webContents.id ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('Rejected IPC call from an untrusted renderer.');
  }
}

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  services: IpcServices,
): () => void {
  const channels = [
    IPC_CHANNELS.activateMembership,
    IPC_CHANNELS.checkForAppUpdates,
    IPC_CHANNELS.cancelTask,
    IPC_CHANNELS.configureVoice,
    IPC_CHANNELS.connectComputer,
    IPC_CHANNELS.companionReportSpeechPlayback,
    IPC_CHANNELS.companionRevealMainWindow,
    IPC_CHANNELS.createVoiceCall,
    IPC_CHANNELS.decideApproval,
    IPC_CHANNELS.getAppPreferences,
    IPC_CHANNELS.getAppUpdateStatus,
    IPC_CHANNELS.getComputerStatus,
    IPC_CHANNELS.getAuthStatus,
    IPC_CHANNELS.getMembershipStatus,
    IPC_CHANNELS.getUsageBudget,
    IPC_CHANNELS.getTaskHistory,
    IPC_CHANNELS.getVoiceStatus,
    IPC_CHANNELS.openSystemPermissionSettings,
    IPC_CHANNELS.recordVoiceTranscript,
    IPC_CHANNELS.respondToInteraction,
    IPC_CHANNELS.reportVoiceDiagnostic,
    IPC_CHANNELS.restartAndInstallAppUpdate,
    IPC_CHANNELS.setCompanionState,
    IPC_CHANNELS.setCompanionVoiceActivity,
    IPC_CHANNELS.setVoiceAudioDucking,
    IPC_CHANNELS.startTask,
    IPC_CHANNELS.signInWithGoogle,
    IPC_CHANNELS.signOutGoogle,
    IPC_CHANNELS.steerTask,
    IPC_CHANNELS.submitTask,
    IPC_CHANNELS.updateAppPreferences,
  ];

  for (const channel of channels) ipcMain.removeHandler(channel);

  ipcMain.handle(IPC_CHANNELS.getAppUpdateStatus, (event) => {
    assertTrustedSender(event, mainWindow);
    return services.appUpdateService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.checkForAppUpdates, (event) => {
    assertTrustedSender(event, mainWindow);
    return services.appUpdateService.checkForUpdates();
  });

  ipcMain.handle(IPC_CHANNELS.restartAndInstallAppUpdate, async (event) => {
    assertTrustedSender(event, mainWindow);
    await services.appUpdateService.restartAndInstall();
  });

  ipcMain.handle(IPC_CHANNELS.getAuthStatus, (event) => {
    assertTrustedSender(event, mainWindow);
    return services.authService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.signInWithGoogle, async (event) => {
    assertTrustedSender(event, mainWindow);
    const status = await services.authService.signIn();
    if (status.user) await services.onAuthSignedIn?.(status.user);
    return status;
  });

  ipcMain.handle(IPC_CHANNELS.signOutGoogle, async (event) => {
    assertTrustedSender(event, mainWindow);
    services.executionCoordinator.cancelActiveTasks();
    const status = await services.authService.signOut();
    await services.onAuthSignedOut?.();
    return status;
  });

  ipcMain.handle(IPC_CHANNELS.getMembershipStatus, async (event) => {
    const user = await assertAuthorizedSender(
      event,
      mainWindow,
      services.authService,
    );
    return services.membershipService.getStatus(user);
  });

  ipcMain.handle(
    IPC_CHANNELS.activateMembership,
    async (event, input: unknown) => {
      const user = await assertAuthorizedSender(
        event,
        mainWindow,
        services.authService,
      );
      const request = ActivateMembershipRequestSchema.parse(input);
      return services.membershipService.activate(user, request.code);
    },
  );

  ipcMain.handle(IPC_CHANNELS.getAppPreferences, async (event) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    return services.appPreferencesService.get();
  });

  ipcMain.handle(IPC_CHANNELS.getTaskHistory, async (event) => {
    const user = await assertAuthorizedSender(
      event,
      mainWindow,
      services.authService,
    );
    return services.taskHistoryService.load(user.id);
  });

  ipcMain.handle(IPC_CHANNELS.getUsageBudget, async (event, input: unknown) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    const request = GetUsageBudgetRequestSchema.parse(input ?? {});
    const snapshot = await services.usageBudgetService.get(request.taskId);
    services.onUsageBudgetSnapshot?.(snapshot);
    return snapshot;
  });

  ipcMain.handle(
    IPC_CHANNELS.updateAppPreferences,
    async (event, input: unknown) => {
      await assertAuthorizedSender(event, mainWindow, services.authService);
      return services.appPreferencesService.update(
        UpdateAppPreferencesRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.submitTask, async (event, input: unknown) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.taskApplicationService.submitAndStart(input);
  });

  ipcMain.handle(IPC_CHANNELS.cancelTask, async (event, input: unknown) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.taskApplicationService.cancel(input);
  });

  ipcMain.handle(IPC_CHANNELS.startTask, async (event, input: unknown) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.taskApplicationService.start(input);
  });

  ipcMain.handle(
    IPC_CHANNELS.respondToInteraction,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedInteractionSender(
        event,
        mainWindow,
        services,
      );
      const request = RespondToInteractionRequestSchema.parse(input);
      return services.taskApplicationService.respond(request);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.decideApproval,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedInteractionSender(
        event,
        mainWindow,
        services,
      );
      const request = DecideApprovalRequestSchema.parse(input);
      return services.taskApplicationService.decideApproval(request);
    },
  );

  ipcMain.handle(IPC_CHANNELS.companionRevealMainWindow, async (event) => {
    assertTrustedCompanionSender(event, services);
    await services.authService.assertSignedIn();
    services.revealMainWindow();
  });

  ipcMain.handle(
    IPC_CHANNELS.companionReportSpeechPlayback,
    async (event, input: unknown) => {
      assertTrustedCompanionSender(event, services);
      const report = CompanionSpeechPlaybackReportSchema.parse(input);
      await services.reportCompanionSpeechPlayback(report);
    },
  );

  ipcMain.handle(IPC_CHANNELS.steerTask, async (event, input: unknown) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.taskApplicationService.steer(input);
  });

  ipcMain.handle(IPC_CHANNELS.getComputerStatus, async (event) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    return services.cuaService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.connectComputer, async (event) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    let status = await services.cuaService.connect();
    if (
      status.platform === 'darwin' &&
      status.permissions?.screenRecording === false
    ) {
      try {
        await services.requestScreenRecordingAccess();
        status = await services.cuaService.getStatus();
      } catch (error) {
        console.warn(
          'TroCode could not start its Screen Recording registration stream.',
          error,
        );
        // Opening the privacy pane is still useful if Chromium cannot enumerate
        // sources, for example after a previous denial.
      }
      if (
        status.platform === 'darwin' &&
        status.permissions?.screenRecording === false
      ) {
        await services.openSystemPermissionSettings('screen_recording');
      }
    }
    return status;
  });

  ipcMain.handle(
    IPC_CHANNELS.openSystemPermissionSettings,
    async (event, input: unknown) => {
      await assertAuthorizedSender(event, mainWindow, services.authService);
      await services.openSystemPermissionSettings(
        SystemPermissionSchema.parse(input),
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.getVoiceStatus, async (event) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    return services.voiceService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.configureVoice, async (event, input: unknown) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.voiceService.configure(input);
  });

  ipcMain.handle(
    IPC_CHANNELS.recordVoiceTranscript,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = RecordVoiceTranscriptRequestSchema.parse(input);
      await services.recordVoiceTranscript(request);
    },
  );

  ipcMain.handle(IPC_CHANNELS.createVoiceCall, async (event, input: unknown) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.voiceService.createCall(input);
  });

  ipcMain.handle(
    IPC_CHANNELS.setVoiceAudioDucking,
    async (event, input: unknown) => {
      assertTrustedSender(event, mainWindow);
      const request = SetVoiceAudioDuckingRequestSchema.parse(input);
      if (request.active) {
        await assertMembershipAuthorizedSender(event, mainWindow, services);
      }
      await services.systemAudioDuckingService.setActive(request.active);
    },
  );

  ipcMain.handle(IPC_CHANNELS.reportVoiceDiagnostic, (event, input: unknown) => {
    assertTrustedSender(event, mainWindow);
    const diagnostic = VoiceDiagnosticSchema.parse(input);
    console.error('[voice] OpenAI Realtime connection failed.', diagnostic);
  });

  ipcMain.handle(IPC_CHANNELS.setCompanionState, (event, input: unknown) => {
    assertTrustedSender(event, mainWindow);
    services.updateCompanionState(CompanionStateSchema.parse(input));
  });

  ipcMain.handle(
    IPC_CHANNELS.setCompanionVoiceActivity,
    (event, input: unknown) => {
      assertTrustedSender(event, mainWindow);
      services.updateCompanionVoiceActivity(
        CompanionVoiceActivitySchema.nullable().parse(input),
      );
    },
  );

  const forwardTaskUpdate = (value: unknown): void => {
    if (mainWindow.isDestroyed()) return;
    const taskUpdate = TaskUpdateSchema.parse(value);
    mainWindow.webContents.send(IPC_CHANNELS.taskUpdate, taskUpdate);
  };

  services.taskRuntime.on('task-update', forwardTaskUpdate);
  const stopForwardingAppUpdateStatus = services.appUpdateService.onStatusChange(
    (status) => {
      if (mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(IPC_CHANNELS.appUpdateStatusChanged, status);
    },
  );

  return () => {
    stopForwardingAppUpdateStatus();
    services.taskRuntime.off('task-update', forwardTaskUpdate);
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
