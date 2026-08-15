import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import {
  CompanionStateSchema,
  RecordVoiceTranscriptRequestSchema,
  TaskUpdateSchema,
  type AuthUser,
  type CompanionState,
  type RecordVoiceTranscriptRequest,
  type SystemPermission,
} from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/desktop-api';
import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';
import type { TaskRuntime } from '../agent/task-runtime';
import type { GoogleAuthService } from '../auth/google-auth-service';
import type { CuaService } from '../cua/cua-service';
import type { VoiceService } from '../voice/voice-service';

interface IpcServices {
  authService: GoogleAuthService;
  cuaService: CuaService;
  executionCoordinator: TaskExecutionCoordinator;
  onAuthSignedIn?(user: AuthUser): Promise<void> | void;
  onAuthSignedOut?(): Promise<void> | void;
  openSystemPermissionSettings(
    permission: SystemPermission,
  ): Promise<unknown> | unknown;
  recordVoiceTranscript(
    input: RecordVoiceTranscriptRequest,
  ): Promise<void> | void;
  requestScreenRecordingAccess(): Promise<unknown> | unknown;
  taskRuntime: TaskRuntime;
  updateCompanionState(state: CompanionState): void;
  voiceService: VoiceService;
}

async function assertAuthorizedSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
  authService: GoogleAuthService,
): Promise<void> {
  assertTrustedSender(event, mainWindow);
  await authService.assertSignedIn();
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
    IPC_CHANNELS.cancelTask,
    IPC_CHANNELS.configureVoice,
    IPC_CHANNELS.connectComputer,
    IPC_CHANNELS.createVoiceSession,
    IPC_CHANNELS.decideApproval,
    IPC_CHANNELS.getComputerStatus,
    IPC_CHANNELS.getAuthStatus,
    IPC_CHANNELS.getVoiceStatus,
    IPC_CHANNELS.recordVoiceTranscript,
    IPC_CHANNELS.respondToInteraction,
    IPC_CHANNELS.setCompanionState,
    IPC_CHANNELS.startTask,
    IPC_CHANNELS.signInWithGoogle,
    IPC_CHANNELS.signOutGoogle,
    IPC_CHANNELS.steerTask,
    IPC_CHANNELS.submitTask,
  ];

  for (const channel of channels) ipcMain.removeHandler(channel);

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

  ipcMain.handle(IPC_CHANNELS.submitTask, async (event, input: unknown) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    return services.taskRuntime.submit(input);
  });

  ipcMain.handle(IPC_CHANNELS.cancelTask, async (event, input: unknown) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    return services.executionCoordinator.cancel(input);
  });

  ipcMain.handle(IPC_CHANNELS.startTask, async (event, input: unknown) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    return services.executionCoordinator.start(input);
  });

  ipcMain.handle(IPC_CHANNELS.respondToInteraction, async (event, input: unknown) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    const snapshot = services.taskRuntime.respondToInteraction(input);
    services.executionCoordinator.resume(snapshot.taskId);
    return snapshot;
  });

  ipcMain.handle(IPC_CHANNELS.decideApproval, async (event, input: unknown) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    const snapshot = services.taskRuntime.decideApproval(input);
    services.executionCoordinator.resume(snapshot.taskId);
    return snapshot;
  });

  ipcMain.handle(IPC_CHANNELS.steerTask, async (event, input: unknown) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    const snapshot = services.taskRuntime.steer(input);
    services.executionCoordinator.resume(snapshot.taskId);
    return snapshot;
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
      } catch {
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

  ipcMain.handle(IPC_CHANNELS.getVoiceStatus, async (event) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    return services.voiceService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.configureVoice, async (event, input: unknown) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    return services.voiceService.configure(input);
  });

  ipcMain.handle(IPC_CHANNELS.createVoiceSession, async (event) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    return services.voiceService.createSession();
  });

  ipcMain.handle(
    IPC_CHANNELS.recordVoiceTranscript,
    async (event, input: unknown) => {
      await assertAuthorizedSender(event, mainWindow, services.authService);
      const request = RecordVoiceTranscriptRequestSchema.parse(input);
      await services.recordVoiceTranscript(request);
    },
  );

  ipcMain.handle(IPC_CHANNELS.setCompanionState, (event, input: unknown) => {
    assertTrustedSender(event, mainWindow);
    services.updateCompanionState(CompanionStateSchema.parse(input));
  });

  const forwardTaskUpdate = (value: unknown): void => {
    if (mainWindow.isDestroyed()) return;
    const taskUpdate = TaskUpdateSchema.parse(value);
    mainWindow.webContents.send(IPC_CHANNELS.taskUpdate, taskUpdate);
  };

  services.taskRuntime.on('task-update', forwardTaskUpdate);

  return () => {
    services.taskRuntime.off('task-update', forwardTaskUpdate);
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
