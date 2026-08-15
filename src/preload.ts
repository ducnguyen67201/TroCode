import { contextBridge, ipcRenderer } from 'electron';

import {
  AuthStatusSchema,
  CancelTaskRequestSchema,
  CompanionStateSchema,
  ConfigureVoiceRequestSchema,
  CuaStatusSchema,
  DecideApprovalRequestSchema,
  RespondToInteractionRequestSchema,
  StartTaskRequestSchema,
  SteerTaskRequestSchema,
  SubmitTaskRequestSchema,
  SystemPermissionSchema,
  TaskSnapshotSchema,
  TaskUpdateSchema,
  VoiceSessionSchema,
  VoiceStatusSchema,
} from './shared/contracts';
import {
  IPC_CHANNELS,
  type CompanionApi,
  type DesktopApi,
} from './shared/desktop-api';

const desktopApi: DesktopApi = {
  async getAuthStatus() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getAuthStatus,
    );
    return AuthStatusSchema.parse(response);
  },

  async signInWithGoogle() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.signInWithGoogle,
    );
    return AuthStatusSchema.parse(response);
  },

  async signOutGoogle() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.signOutGoogle,
    );
    return AuthStatusSchema.parse(response);
  },

  async submitTask(input) {
    const request = SubmitTaskRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.submitTask,
      request,
    );
    return TaskSnapshotSchema.parse(response);
  },

  async cancelTask(taskId) {
    const request = CancelTaskRequestSchema.parse({ taskId });
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.cancelTask,
      request,
    );
    return TaskSnapshotSchema.parse(response);
  },

  async startTask(taskId) {
    const request = StartTaskRequestSchema.parse({ taskId });
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.startTask,
      request,
    );
    return TaskSnapshotSchema.parse(response);
  },

  async respondToInteraction(input) {
    const request = RespondToInteractionRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.respondToInteraction,
      request,
    );
    return TaskSnapshotSchema.parse(response);
  },

  async decideApproval(input) {
    const request = DecideApprovalRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.decideApproval,
      request,
    );
    return TaskSnapshotSchema.parse(response);
  },

  async steerTask(input) {
    const request = SteerTaskRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.steerTask,
      request,
    );
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

  async openSystemPermissionSettings(input) {
    const permission = SystemPermissionSchema.parse(input);
    await ipcRenderer.invoke(
      IPC_CHANNELS.openSystemPermissionSettings,
      permission,
    );
  },

  async getVoiceStatus() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getVoiceStatus,
    );
    return VoiceStatusSchema.parse(response);
  },

  async configureVoice(input) {
    const request = ConfigureVoiceRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.configureVoice,
      request,
    );
    return VoiceStatusSchema.parse(response);
  },

  async createVoiceSession() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.createVoiceSession,
    );
    return VoiceSessionSchema.parse(response);
  },

  async setCompanionState(input) {
    const state = CompanionStateSchema.parse(input);
    await ipcRenderer.invoke(IPC_CHANNELS.setCompanionState, state);
  },

  onTaskUpdate(listener) {
    const eventHandler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      listener(TaskUpdateSchema.parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.taskUpdate, eventHandler);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.taskUpdate, eventHandler);
  },
};

const companionApi: CompanionApi = {
  onStateChange(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(CompanionStateSchema.parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.companionStateChanged, eventHandler);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.companionStateChanged,
        eventHandler,
      );
  },
};

contextBridge.exposeInMainWorld('tro', desktopApi);
contextBridge.exposeInMainWorld('troCompanion', companionApi);
