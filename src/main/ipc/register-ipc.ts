import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import { TaskEventSchema } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/desktop-api';
import type { TaskRuntime } from '../agent/task-runtime';
import type { CuaService } from '../cua/cua-service';

interface IpcServices {
  cuaService: CuaService;
  taskRuntime: TaskRuntime;
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
): void {
  if (event.sender.id !== mainWindow.webContents.id) {
    throw new Error('Rejected IPC call from an untrusted renderer.');
  }
}

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  services: IpcServices,
): () => void {
  const channels = [
    IPC_CHANNELS.cancelTask,
    IPC_CHANNELS.connectComputer,
    IPC_CHANNELS.getComputerStatus,
    IPC_CHANNELS.submitTask,
  ];

  for (const channel of channels) ipcMain.removeHandler(channel);

  ipcMain.handle(IPC_CHANNELS.submitTask, (event, input: unknown) => {
    assertTrustedSender(event, mainWindow);
    return services.taskRuntime.submit(input);
  });

  ipcMain.handle(IPC_CHANNELS.cancelTask, (event, input: unknown) => {
    assertTrustedSender(event, mainWindow);
    return services.taskRuntime.cancel(input);
  });

  ipcMain.handle(IPC_CHANNELS.getComputerStatus, (event) => {
    assertTrustedSender(event, mainWindow);
    return services.cuaService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.connectComputer, (event) => {
    assertTrustedSender(event, mainWindow);
    return services.cuaService.connect();
  });

  const forwardTaskEvent = (value: unknown): void => {
    if (mainWindow.isDestroyed()) return;
    const taskEvent = TaskEventSchema.parse(value);
    mainWindow.webContents.send(IPC_CHANNELS.taskEvent, taskEvent);
  };

  services.taskRuntime.on('task-event', forwardTaskEvent);

  return () => {
    services.taskRuntime.off('task-event', forwardTaskEvent);
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
