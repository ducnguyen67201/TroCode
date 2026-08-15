import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import { TaskUpdateSchema } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/desktop-api';
import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';
import type { TaskRuntime } from '../agent/task-runtime';
import type { CuaService } from '../cua/cua-service';
import type { VoiceService } from '../voice/voice-service';

interface IpcServices {
  cuaService: CuaService;
  executionCoordinator: TaskExecutionCoordinator;
  taskRuntime: TaskRuntime;
  voiceService: VoiceService;
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
    IPC_CHANNELS.getVoiceStatus,
    IPC_CHANNELS.respondToInteraction,
    IPC_CHANNELS.startTask,
    IPC_CHANNELS.steerTask,
    IPC_CHANNELS.submitTask,
  ];

  for (const channel of channels) ipcMain.removeHandler(channel);

  ipcMain.handle(IPC_CHANNELS.submitTask, (event, input: unknown) => {
    assertTrustedSender(event, mainWindow);
    return services.taskRuntime.submit(input);
  });

  ipcMain.handle(IPC_CHANNELS.cancelTask, (event, input: unknown) => {
    assertTrustedSender(event, mainWindow);
    return services.executionCoordinator.cancel(input);
  });

  ipcMain.handle(IPC_CHANNELS.startTask, (event, input: unknown) => {
    assertTrustedSender(event, mainWindow);
    return services.executionCoordinator.start(input);
  });

  ipcMain.handle(IPC_CHANNELS.respondToInteraction, (event, input: unknown) => {
    assertTrustedSender(event, mainWindow);
    const snapshot = services.taskRuntime.respondToInteraction(input);
    services.executionCoordinator.resume(snapshot.taskId);
    return snapshot;
  });

  ipcMain.handle(IPC_CHANNELS.decideApproval, (event, input: unknown) => {
    assertTrustedSender(event, mainWindow);
    const snapshot = services.taskRuntime.decideApproval(input);
    services.executionCoordinator.resume(snapshot.taskId);
    return snapshot;
  });

  ipcMain.handle(IPC_CHANNELS.steerTask, (event, input: unknown) => {
    assertTrustedSender(event, mainWindow);
    const snapshot = services.taskRuntime.steer(input);
    services.executionCoordinator.resume(snapshot.taskId);
    return snapshot;
  });

  ipcMain.handle(IPC_CHANNELS.getComputerStatus, (event) => {
    assertTrustedSender(event, mainWindow);
    return services.cuaService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.connectComputer, (event) => {
    assertTrustedSender(event, mainWindow);
    return services.cuaService.connect();
  });

  ipcMain.handle(IPC_CHANNELS.getVoiceStatus, (event) => {
    assertTrustedSender(event, mainWindow);
    return services.voiceService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.configureVoice, (event, input: unknown) => {
    assertTrustedSender(event, mainWindow);
    return services.voiceService.configure(input);
  });

  ipcMain.handle(IPC_CHANNELS.createVoiceSession, (event) => {
    assertTrustedSender(event, mainWindow);
    return services.voiceService.createSession();
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
