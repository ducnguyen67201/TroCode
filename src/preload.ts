import { contextBridge, ipcRenderer } from 'electron';

import {
  ActivateMembershipRequestSchema,
  AppPreferencesSchema,
  AppUpdateStatusSchema,
  AuthStatusSchema,
  CompanionPositionSchema,
  CancelTaskRequestSchema,
  CompanionGuidanceSchema,
  CompanionSpeechSchema,
  CompanionStateSchema,
  CompanionVoiceActivitySchema,
  ConfigureVoiceRequestSchema,
  CreateVoiceCallRequestSchema,
  CuaStatusSchema,
  DecideApprovalRequestSchema,
  MembershipStatusSchema,
  RecordVoiceTranscriptRequestSchema,
  RespondToInteractionRequestSchema,
  StartTaskRequestSchema,
  SteerTaskRequestSchema,
  SubmitTaskRequestSchema,
  SystemPermissionSchema,
  TaskHistorySchema,
  TaskSnapshotSchema,
  TaskUpdateSchema,
  UpdateAppPreferencesRequestSchema,
  VoiceCallAnswerSchema,
  VoiceDiagnosticSchema,
  VoiceShortcutEventSchema,
  VoiceStatusSchema,
} from './shared/contracts';
import {
  IPC_CHANNELS,
  type CompanionApi,
  type DesktopApi,
} from './shared/desktop-api';

const desktopApi: DesktopApi = {
  async getAppUpdateStatus() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getAppUpdateStatus,
    );
    return AppUpdateStatusSchema.parse(response);
  },

  async checkForAppUpdates() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.checkForAppUpdates,
    );
    return AppUpdateStatusSchema.parse(response);
  },

  async restartAndInstallAppUpdate() {
    await ipcRenderer.invoke(IPC_CHANNELS.restartAndInstallAppUpdate);
  },

  async getMembershipStatus() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getMembershipStatus,
    );
    return MembershipStatusSchema.parse(response);
  },

  async activateMembership(input) {
    const request = ActivateMembershipRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.activateMembership,
      request,
    );
    return MembershipStatusSchema.parse(response);
  },

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

  async getAppPreferences() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getAppPreferences,
    );
    return AppPreferencesSchema.parse(response);
  },

  async getTaskHistory() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getTaskHistory,
    );
    return TaskHistorySchema.parse(response);
  },

  async updateAppPreferences(input) {
    const request = UpdateAppPreferencesRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.updateAppPreferences,
      request,
    );
    return AppPreferencesSchema.parse(response);
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

  async recordVoiceTranscript(input) {
    const request = RecordVoiceTranscriptRequestSchema.parse(input);
    await ipcRenderer.invoke(IPC_CHANNELS.recordVoiceTranscript, request);
  },

  async createVoiceCall(input) {
    const request = CreateVoiceCallRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.createVoiceCall,
      request,
    );
    return VoiceCallAnswerSchema.parse(response);
  },

  async reportVoiceDiagnostic(input) {
    const diagnostic = VoiceDiagnosticSchema.parse(input);
    await ipcRenderer.invoke(IPC_CHANNELS.reportVoiceDiagnostic, diagnostic);
  },

  async setCompanionState(input) {
    const state = CompanionStateSchema.parse(input);
    await ipcRenderer.invoke(IPC_CHANNELS.setCompanionState, state);
  },

  async setCompanionVoiceActivity(input) {
    const activity = CompanionVoiceActivitySchema.nullable().parse(input);
    await ipcRenderer.invoke(
      IPC_CHANNELS.setCompanionVoiceActivity,
      activity,
    );
  },

  onTaskUpdate(listener) {
    const eventHandler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      listener(TaskUpdateSchema.parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.taskUpdate, eventHandler);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.taskUpdate, eventHandler);
  },

  onAppUpdateStatusChanged(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(AppUpdateStatusSchema.parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.appUpdateStatusChanged, eventHandler);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.appUpdateStatusChanged,
        eventHandler,
      );
  },

  onVoiceShortcut(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(VoiceShortcutEventSchema.parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.voiceShortcut, eventHandler);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.voiceShortcut, eventHandler);
  },
};

const companionApi: CompanionApi = {
  onGuidanceChange(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(CompanionGuidanceSchema.nullable().parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.companionGuidanceChanged, eventHandler);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.companionGuidanceChanged,
        eventHandler,
      );
  },

  onPositionChange(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(CompanionPositionSchema.parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.companionPositionChanged, eventHandler);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.companionPositionChanged,
        eventHandler,
      );
  },

  onSpeechChange(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(CompanionSpeechSchema.nullable().parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.companionSpeechChanged, eventHandler);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.companionSpeechChanged,
        eventHandler,
      );
  },

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

  onVoiceActivityChange(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(CompanionVoiceActivitySchema.nullable().parse(value));
    };

    ipcRenderer.on(
      IPC_CHANNELS.companionVoiceActivityChanged,
      eventHandler,
    );
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.companionVoiceActivityChanged,
        eventHandler,
      );
  },
};

contextBridge.exposeInMainWorld('tro', desktopApi);
contextBridge.exposeInMainWorld('troCompanion', companionApi);
