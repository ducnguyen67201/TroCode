import { contextBridge, ipcRenderer } from 'electron';

import { classroomDesktopApi } from './classroom-preload';
import { activityAuthoringApi } from './preload/activity-authoring-api';
import {
  ActivateMembershipRequestSchema,
  AgentActivityUpdateSchema,
  AppPreferencesSchema,
  AppUpdateStatusSchema,
  AuthStatusSchema,
  ActivateCompanionCandidateRequestSchema,
  ActivateSavedCompanionRequestSchema,
  BeginDictationRequestSchema,
  BeginDictationResultSchema,
  CancelDictationRequestSchema,
  CompanionAppearanceSchema,
  CompanionCustomizationStatusSchema,
  CompanionPositionSchema,
  CancelTaskRequestSchema,
  CompanionGuidanceSchema,
  CompanionGuidanceVisualSchema,
  CursorBuddySnapshotSchema,
  CompanionHoverSchema,
  CompanionInteractionSchema,
  CompanionPetNudgeSchema,
  CompanionResponseActionRequestSchema,
  CompanionResponseCardSchema,
  CompanionSpeechSchema,
  CompanionSpeechPlaybackReportSchema,
  CompanionStateSchema,
  CompanionVoiceActivitySchema,
  GenerateCompanionImageRequestSchema,
  ConfigureVoiceRequestSchema,
  CommitDictationRequestSchema,
  DictationCommitResultSchema,
  TranscribeVoiceSegmentRequestSchema,
  CuaStatusSchema,
  ConnectConnectorRequestSchema,
  ConnectorAttemptRequestSchema,
  ConnectorAttemptStatusSchema,
  ConnectorListSchema,
  DisconnectConnectorRequestSchema,
  MembershipStatusSchema,
  AddOrganizationMemberRequestSchema,
  AddOrganizationMemberResponseSchema,
  CancelOrganizationMemberRequestSchema,
  CancelOrganizationMemberResponseSchema,
  ListOrganizationMembersRequestSchema,
  OrganizationCurrentResponseSchema,
  OrganizationMemberListSchema,
  UpdateOrganizationRequestSchema,
  UpdateOrganizationResponseSchema,
  RecordVoiceTranscriptRequestSchema,
  RespondToInteractionRequestSchema,
  ResolveComputerPermissionRequestSchema,
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
  VoiceModeToggleEventSchema,
  VoiceShortcutEventSchema,
  VoiceStatusSchema,
  WorkspaceRuntimeAvailabilitySchema,
  WorkspaceSelectionSchema,
  KnowledgeCapabilitiesSchema,
  KnowledgeSpaceListSchema,
  CreateKnowledgeSpaceRequestSchema,
  CreateKnowledgeSpaceResponseSchema,
  KnowledgeSpaceSummarySchema,
  KnowledgeSourceListSchema,
  KnowledgeSpaceIdRequestSchema,
  SelectKnowledgeFilesRequestSchema,
  KnowledgeFileSelectionSchema,
  UploadKnowledgeSelectionRequestSchema,
  KnowledgeUploadResultSchema,
  CreateKnowledgeRunRequestSchema,
  KnowledgeRunSchema,
  SetKnowledgeRunStateRequestSchema,
  AssignedActivityListSchema,
  KnowledgeAttemptIdRequestSchema,
  HostedAttemptContextSchema,
  AcknowledgeKnowledgeAttemptRequestSchema,
  GetKnowledgeDashboardRequestSchema,
  KnowledgeDashboardSchema,
  PrepareActivityStarterRequestSchema,
  SubmitKnowledgeSelectionRequestSchema,
  KnowledgeGroupListSchema,
  CreateKnowledgeGroupRequestSchema,
  KnowledgeGroupSchema,
  KnowledgeSpaceMemberListSchema,
  AddKnowledgeSpaceMembersRequestSchema,
  AddKnowledgeSpaceMembersResultSchema,
  CreateKnowledgeInviteRequestSchema,
  KnowledgeInviteSchema,
  RedeemKnowledgeInviteRequestSchema,
  RedeemKnowledgeInviteResponseSchema,
  RequestKnowledgeAttemptHelpSchema,
  ClassroomDirectiveNoticeSchema,
  ClassroomDirectiveSchema,
  ClassroomSessionProjectionSchema,
  CreateClassroomDirectiveRequestSchema,
  CreateKnowledgeRoomCodeRequestSchema,
  DismissClassroomDirectiveRequestSchema,
  JoinClassroomSessionRequestSchema,
  KnowledgeAttemptMutationRequestSchema,
  KnowledgeAttemptTransitionSchema,
  KnowledgeRoomCodeSchema,
  KnowledgeRoomRevocationSchema,
  OpenClassroomDirectiveRequestSchema,
  ResolveKnowledgeAttemptHelpRequestSchema,
  ReviewKnowledgeAttemptRequestSchema,
  RevokeKnowledgeRoomCodeRequestSchema,
  SetClassroomLinkConsentRequestSchema,
} from './shared/contracts';
import {
  IPC_CHANNELS,
  type CompanionApi,
  type DesktopApi,
} from './shared/desktop-api';

const desktopApi: DesktopApi = {
  ...classroomDesktopApi,
  async beginDictation(input) {
    const request = BeginDictationRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.beginDictation,
      request,
    );
    return BeginDictationResultSchema.parse(response);
  },

  async cancelDictation(input) {
    const request = CancelDictationRequestSchema.parse(input);
    await ipcRenderer.invoke(IPC_CHANNELS.cancelDictation, request);
  },

  async commitDictation(input) {
    const request = CommitDictationRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.commitDictation,
      request,
    );
    return DictationCommitResultSchema.parse(response);
  },

  async activateCompanionCandidate(input) {
    const request = ActivateCompanionCandidateRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.companionActivateCandidate,
      request,
    );
    return CompanionCustomizationStatusSchema.parse(response);
  },

  async activateSavedCompanion(input) {
    const request = ActivateSavedCompanionRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.companionActivateSaved,
      request,
    );
    return CompanionCustomizationStatusSchema.parse(response);
  },

  async generateCompanionImage(input) {
    const request = GenerateCompanionImageRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.companionGenerateImage,
      request,
    );
    return CompanionCustomizationStatusSchema.parse(response);
  },

  async getCompanionCustomizationStatus() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.companionCustomizationStatus,
    );
    return CompanionCustomizationStatusSchema.parse(response);
  },

  async getKnowledgeCapabilities() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getKnowledgeCapabilities,
    );
    return KnowledgeCapabilitiesSchema.parse(response);
  },

  async listKnowledgeSpaces() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.listKnowledgeSpaces,
    );
    return KnowledgeSpaceListSchema.parse(response);
  },

  async createKnowledgeSpace(input) {
    const request = CreateKnowledgeSpaceRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.createKnowledgeSpace,
      request,
    );
    return CreateKnowledgeSpaceResponseSchema.parse(response);
  },

  async getKnowledgeSpace(spaceId) {
    const request = KnowledgeSpaceIdRequestSchema.parse({ spaceId });
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getKnowledgeSpace,
      request,
    );
    return KnowledgeSpaceSummarySchema.parse(response);
  },

  async listKnowledgeSources(spaceId) {
    const request = KnowledgeSpaceIdRequestSchema.parse({ spaceId });
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.listKnowledgeSources,
      request,
    );
    return KnowledgeSourceListSchema.parse(response);
  },

  async selectKnowledgeFiles(input) {
    const request = SelectKnowledgeFilesRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.selectKnowledgeFiles,
      request,
    );
    return response === null
      ? null
      : KnowledgeFileSelectionSchema.parse(response);
  },

  async uploadKnowledgeSelection(input) {
    const request = UploadKnowledgeSelectionRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.uploadKnowledgeSelection,
      request,
    );
    return KnowledgeUploadResultSchema.parse(response);
  },

  ...activityAuthoringApi,

  async createKnowledgeRun(input) {
    const request = CreateKnowledgeRunRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.createKnowledgeRun,
      request,
    );
    return KnowledgeRunSchema.parse(response);
  },

  async setKnowledgeRunState(input) {
    const request = SetKnowledgeRunStateRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.setKnowledgeRunState,
      request,
    );
    return KnowledgeRunSchema.parse(response);
  },

  async listAssignedActivities() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.listAssignedActivities,
    );
    return AssignedActivityListSchema.parse(response);
  },

  async getHostedAttempt(attemptId) {
    const request = KnowledgeAttemptIdRequestSchema.parse({ attemptId });
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getHostedAttempt,
      request,
    );
    return HostedAttemptContextSchema.parse(response);
  },

  async acknowledgeHostedAttempt(input) {
    const request = AcknowledgeKnowledgeAttemptRequestSchema.parse(input);
    await ipcRenderer.invoke(IPC_CHANNELS.acknowledgeHostedAttempt, request);
  },

  async getKnowledgeDashboard(input) {
    const request = GetKnowledgeDashboardRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getKnowledgeDashboard,
      request,
    );
    return KnowledgeDashboardSchema.parse(response);
  },

  async prepareActivityStarter(input) {
    const request = PrepareActivityStarterRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.prepareActivityStarter,
      request,
    );
    return response === null ? null : WorkspaceSelectionSchema.parse(response);
  },

  async submitKnowledgeSelection(input) {
    const request = SubmitKnowledgeSelectionRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.submitKnowledgeSelection,
      request,
    );
    return KnowledgeUploadResultSchema.parse(response);
  },

  async listKnowledgeGroups(spaceId) {
    const request = KnowledgeSpaceIdRequestSchema.parse({ spaceId });
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.listKnowledgeGroups,
      request,
    );
    return KnowledgeGroupListSchema.parse(response);
  },

  async createKnowledgeGroup(input) {
    const request = CreateKnowledgeGroupRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.createKnowledgeGroup,
      request,
    );
    return KnowledgeGroupSchema.parse(response);
  },

  async listKnowledgeMembers(spaceId) {
    const request = KnowledgeSpaceIdRequestSchema.parse({ spaceId });
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.listKnowledgeMembers,
      request,
    );
    return KnowledgeSpaceMemberListSchema.parse(response);
  },

  async addKnowledgeSpaceMembers(input) {
    const request = AddKnowledgeSpaceMembersRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.addKnowledgeSpaceMembers,
      request,
    );
    return AddKnowledgeSpaceMembersResultSchema.parse(response);
  },

  async createKnowledgeInvite(input) {
    const request = CreateKnowledgeInviteRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.createKnowledgeInvite,
      request,
    );
    return KnowledgeInviteSchema.parse(response);
  },

  async redeemKnowledgeInvite(input) {
    const request = RedeemKnowledgeInviteRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.redeemKnowledgeInvite,
      request,
    );
    return RedeemKnowledgeInviteResponseSchema.parse(response);
  },

  async requestKnowledgeAttemptHelp(input) {
    const request = RequestKnowledgeAttemptHelpSchema.parse(input);
    await ipcRenderer.invoke(IPC_CHANNELS.requestKnowledgeAttemptHelp, request);
  },

  async createKnowledgeRoomCode(input) {
    const request = CreateKnowledgeRoomCodeRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.createKnowledgeRoomCode,
      request,
    );
    return KnowledgeRoomCodeSchema.parse(response);
  },

  async revokeKnowledgeRoomCode(input) {
    const request = RevokeKnowledgeRoomCodeRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.revokeKnowledgeRoomCode,
      request,
    );
    return KnowledgeRoomRevocationSchema.parse(response);
  },

  async joinKnowledgeRoom(input) {
    const request = JoinClassroomSessionRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.joinKnowledgeRoom,
      request,
    );
    return ClassroomSessionProjectionSchema.parse(response);
  },

  async restoreClassroomSession() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.restoreClassroomSession,
    );
    return ClassroomSessionProjectionSchema.nullable().parse(response);
  },

  async getClassroomSession() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getClassroomSession,
    );
    return ClassroomSessionProjectionSchema.nullable().parse(response);
  },

  async leaveClassroomSession(input) {
    const request = KnowledgeAttemptMutationRequestSchema.parse(input);
    await ipcRenderer.invoke(IPC_CHANNELS.leaveClassroomSession, request);
  },

  async setClassroomLinkConsent(input) {
    const request = SetClassroomLinkConsentRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.setClassroomLinkConsent,
      request,
    );
    return ClassroomSessionProjectionSchema.nullable().parse(response);
  },

  async createClassroomDirective(input) {
    const request = CreateClassroomDirectiveRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.createClassroomDirective,
      request,
    );
    return ClassroomDirectiveSchema.parse(response);
  },

  async openClassroomDirective(input) {
    const request = OpenClassroomDirectiveRequestSchema.parse(input);
    await ipcRenderer.invoke(IPC_CHANNELS.openClassroomDirective, request);
  },

  async dismissClassroomDirective(directiveId) {
    const request = DismissClassroomDirectiveRequestSchema.parse({
      directiveId,
    });
    await ipcRenderer.invoke(IPC_CHANNELS.dismissClassroomDirective, request);
  },

  async readyKnowledgeAttempt(input) {
    const request = KnowledgeAttemptMutationRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.readyKnowledgeAttempt,
      request,
    );
    return KnowledgeAttemptTransitionSchema.parse(response);
  },

  async reviewKnowledgeAttempt(input) {
    const request = ReviewKnowledgeAttemptRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.reviewKnowledgeAttempt,
      request,
    );
    return KnowledgeAttemptTransitionSchema.parse(response);
  },

  async resolveKnowledgeAttemptHelp(input) {
    const request = ResolveKnowledgeAttemptHelpRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.resolveKnowledgeAttemptHelp,
      request,
    );
    return KnowledgeAttemptTransitionSchema.parse(response);
  },

  onClassroomSessionChanged(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(ClassroomSessionProjectionSchema.nullable().parse(value));
    };
    ipcRenderer.on(IPC_CHANNELS.classroomSessionChanged, eventHandler);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.classroomSessionChanged,
        eventHandler,
      );
  },

  onClassroomDirectiveChanged(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(ClassroomDirectiveNoticeSchema.nullable().parse(value));
    };
    ipcRenderer.on(IPC_CHANNELS.classroomDirectiveChanged, eventHandler);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.classroomDirectiveChanged,
        eventHandler,
      );
  },

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

  async getOrganization() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getOrganization,
    );
    return OrganizationCurrentResponseSchema.parse(response);
  },

  async updateOrganization(input) {
    const request = UpdateOrganizationRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.updateOrganization,
      request,
    );
    return UpdateOrganizationResponseSchema.parse(response);
  },

  async listOrganizationMembers(input) {
    const request = ListOrganizationMembersRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.listOrganizationMembers,
      request,
    );
    return OrganizationMemberListSchema.parse(response);
  },

  async addOrganizationMember(input) {
    const request = AddOrganizationMemberRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.addOrganizationMember,
      request,
    );
    return AddOrganizationMemberResponseSchema.parse(response);
  },

  async cancelOrganizationMember(input) {
    const request = CancelOrganizationMemberRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.cancelOrganizationMember,
      request,
    );
    return CancelOrganizationMemberResponseSchema.parse(response);
  },

  async activateMembership(input) {
    const request = ActivateMembershipRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.activateMembership,
      request,
    );
    return MembershipStatusSchema.parse(response);
  },

  async continueWithFree() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.continueWithFree,
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

  async cancelTask(taskId, source = 'stop_button') {
    const request = CancelTaskRequestSchema.parse({ taskId, source });
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

  async listConnectors() {
    const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.listConnectors);
    return ConnectorListSchema.parse(response);
  },

  async connectConnector(input) {
    const request = ConnectConnectorRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.connectConnector, request);
    return ConnectorAttemptStatusSchema.parse(response);
  },

  async getConnectorAttempt(input) {
    const request = ConnectorAttemptRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.getConnectorAttempt, request);
    return ConnectorAttemptStatusSchema.parse(response);
  },

  async disconnectConnector(input) {
    const request = DisconnectConnectorRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.disconnectConnector, request);
    return ConnectorListSchema.parse(response);
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

  async resolveComputerPermission(input) {
    const request = ResolveComputerPermissionRequestSchema.parse(input);
    await ipcRenderer.invoke(IPC_CHANNELS.resolveComputerPermission, request);
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
    await ipcRenderer.invoke(IPC_CHANNELS.setCompanionVoiceActivity, activity);
  },

  async setVoiceAudioDucking(input) {
    const request = SetVoiceAudioDuckingRequestSchema.parse(input);
    await ipcRenderer.invoke(IPC_CHANNELS.setVoiceAudioDucking, request);
  },

  onTaskUpdate(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
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

  onVoiceModeToggleRequested(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(VoiceModeToggleEventSchema.parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.voiceModeToggleRequested, eventHandler);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.voiceModeToggleRequested,
        eventHandler,
      );
  },

  async useDefaultCompanion() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.companionUseDefault,
    );
    return CompanionCustomizationStatusSchema.parse(response);
  },
};

const companionApi: CompanionApi = {
  async getCursorBuddySnapshot() {
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.getCursorBuddySnapshot,
    );
    return CursorBuddySnapshotSchema.parse(response);
  },

  async reportSpeechPlayback(input) {
    const report = CompanionSpeechPlaybackReportSchema.parse(input);
    await ipcRenderer.invoke(
      IPC_CHANNELS.companionReportSpeechPlayback,
      report,
    );
  },

  onAppearanceChange(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(CompanionAppearanceSchema.parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.companionAppearanceChanged, eventHandler);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.companionAppearanceChanged,
        eventHandler,
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

    ipcRenderer.on(IPC_CHANNELS.companionGuidanceVisualChanged, eventHandler);
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

  onHoverChange(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(CompanionHoverSchema.parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.companionHoverChanged, eventHandler);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.companionHoverChanged,
        eventHandler,
      );
  },

  onCursorBuddySnapshotChange(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(CursorBuddySnapshotSchema.parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.cursorBuddySnapshotChanged, eventHandler);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.cursorBuddySnapshotChanged,
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

  onPetNudgeChange(listener) {
    const eventHandler = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ): void => {
      listener(CompanionPetNudgeSchema.nullable().parse(value));
    };

    ipcRenderer.on(IPC_CHANNELS.companionPetNudgeChanged, eventHandler);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.companionPetNudgeChanged,
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

    ipcRenderer.on(IPC_CHANNELS.companionVoiceActivityChanged, eventHandler);
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
