import { contextBridge, ipcRenderer } from 'electron';

import {
  ActivateMembershipRequestSchema,
  AgentActivityUpdateSchema,
  AppPreferencesSchema,
  AppUpdateStatusSchema,
  AuthStatusSchema,
  CompanionPositionSchema,
  CancelTaskRequestSchema,
  CompanionGuidanceSchema,
  CompanionGuidanceVisualSchema,
  CompanionInteractionSchema,
  CompanionResponseActionRequestSchema,
  CompanionResponseCardSchema,
  CompanionSpeechSchema,
  CompanionSpeechPlaybackReportSchema,
  CompanionStateSchema,
  CompanionVoiceActivitySchema,
  ConfigureVoiceRequestSchema,
  TranscribeVoiceSegmentRequestSchema,
  CuaStatusSchema,
  DecideApprovalRequestSchema,
  MembershipStatusSchema,
  RecordVoiceTranscriptRequestSchema,
  RespondToInteractionRequestSchema,
  SetVoiceAudioDuckingRequestSchema,
  StartTaskRequestSchema,
  SteerTaskRequestSchema,
  SubmitTaskRequestSchema,
  SystemPermissionSchema,
  TaskHistorySchema,
  TaskComposerFocusRequestSchema,
  TaskSnapshotSchema,
  TaskUpdateSchema,
  UsageBudgetSnapshotSchema,
  GetUsageBudgetRequestSchema,
  UpdateAppPreferencesRequestSchema,
  VoiceSegmentTranscriptionSchema,
  VoiceDiagnosticSchema,
  VoiceShortcutEventSchema,
  VoiceStatusSchema,
  WorkspaceRuntimeAvailabilitySchema,
  WorkspaceSelectionSchema,
} from './shared/contracts';
import {
  IPC_CHANNELS,
  type CompanionApi,
  type DesktopApi,
} from './shared/desktop-api';

const desktopApi: DesktopApi = {
  onAgentActivity(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(AgentActivityUpdateSchema.parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.agentActivity, eventHandler);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.agentActivity, eventHandler);
  },

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

  async getWorkspaceRuntimeAvailability() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getWorkspaceRuntimeAvailability,
    );
    return WorkspaceRuntimeAvailabilitySchema.parse(response);
  },

  async selectWorkspace() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.selectWorkspace,
    );
    return response === null ? null : WorkspaceSelectionSchema.parse(response);
  },

  async getTaskHistory() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getTaskHistory,
    );
    return TaskHistorySchema.parse(response);
  },

  async getUsageBudget(taskId) {
    const request = GetUsageBudgetRequestSchema.parse({ taskId });
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getUsageBudget,
      request,
    );
    return UsageBudgetSnapshotSchema.parse(response);
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

  async transcribeVoiceSegment(input) {
    const request = TranscribeVoiceSegmentRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.transcribeVoiceSegment,
      request,
    );
    return VoiceSegmentTranscriptionSchema.parse(response);
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

  async setVoiceAudioDucking(input) {
    const request = SetVoiceAudioDuckingRequestSchema.parse(input);
    await ipcRenderer.invoke(IPC_CHANNELS.setVoiceAudioDucking, request);
  },

  onTaskUpdate(listener) {
    const eventHandler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      listener(TaskUpdateSchema.parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.taskUpdate, eventHandler);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.taskUpdate, eventHandler);
  },

  onTaskComposerFocusRequested(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      const request = TaskComposerFocusRequestSchema.parse({ taskId: value });
      listener(request.taskId);
    };

    ipcRenderer.on(IPC_CHANNELS.taskComposerFocusRequested, eventHandler);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.taskComposerFocusRequested,
        eventHandler,
      );
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
  async decideApproval(input) {
    const request = DecideApprovalRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.decideApproval,
      request,
    );
    return TaskSnapshotSchema.parse(response);
  },

  async reportSpeechPlayback(input) {
    const report = CompanionSpeechPlaybackReportSchema.parse(input);
    await ipcRenderer.invoke(
      IPC_CHANNELS.companionReportSpeechPlayback,
      report,
    );
  },

  async performResponseAction(input) {
    const request = CompanionResponseActionRequestSchema.parse(input);
    await ipcRenderer.invoke(IPC_CHANNELS.companionResponseAction, request);
  },

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

  onGuidanceVisualChange(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(CompanionGuidanceVisualSchema.nullable().parse(value));
    };

    ipcRenderer.on(
      IPC_CHANNELS.companionGuidanceVisualChanged,
      eventHandler,
    );
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.companionGuidanceVisualChanged,
        eventHandler,
      );
  },

  onInteractionChange(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(CompanionInteractionSchema.nullable().parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.companionInteractionChanged, eventHandler);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.companionInteractionChanged,
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

  onResponseChange(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(CompanionResponseCardSchema.nullable().parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.companionResponseChanged, eventHandler);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.companionResponseChanged,
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

  async respondToInteraction(input) {
    const request = RespondToInteractionRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.respondToInteraction,
      request,
    );
    return TaskSnapshotSchema.parse(response);
  },

  async revealMainWindow() {
    await ipcRenderer.invoke(IPC_CHANNELS.companionRevealMainWindow);
  },
};

contextBridge.exposeInMainWorld('tro', desktopApi);
contextBridge.exposeInMainWorld('troCompanion', companionApi);
