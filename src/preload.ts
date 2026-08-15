import { contextBridge, ipcRenderer } from 'electron';

import {
  CuaStatusSchema,
  SubmitTaskRequestSchema,
  TaskEventSchema,
  TaskSnapshotSchema,
} from './shared/contracts';
import { IPC_CHANNELS, type DesktopApi } from './shared/desktop-api';

const desktopApi: DesktopApi = {
  async submitTask(input) {
    const request = SubmitTaskRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.submitTask,
      request,
    );
    return TaskSnapshotSchema.parse(response);
  },

  async cancelTask(taskId) {
    const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.cancelTask, {
      taskId,
    });
    return TaskSnapshotSchema.parse(response);
  },

  async getComputerStatus() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getComputerStatus,
    );
    return CuaStatusSchema.parse(response);
  },

  async connectComputer() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.connectComputer,
    );
    return CuaStatusSchema.parse(response);
  },

  onTaskEvent(listener) {
    const eventHandler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      listener(TaskEventSchema.parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.taskEvent, eventHandler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.taskEvent, eventHandler);
  },
};

contextBridge.exposeInMainWorld('tro', desktopApi);
