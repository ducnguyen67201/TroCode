import type {
  ActivateMembershipRequest,
  AgentActivityUpdate,
  AppPreferences,
  AppUpdateStatus,
  AuthStatus,
  CompanionGuidance,
  CompanionGuidanceVisual,
  CompanionInteraction,
  CompanionPosition,
  CompanionResponseActionRequest,
  CompanionResponseCard,
  CompanionSpeech,
  CompanionSpeechPlaybackReport,
  CompanionState,
  CompanionVoiceActivity,
  ConfigureVoiceRequest,
  TranscribeVoiceSegmentRequest,
  CuaStatus,
  DecideApprovalRequest,
  MembershipStatus,
  RecordVoiceTranscriptRequest,
  RespondToInteractionRequest,
  SetVoiceAudioDuckingRequest,
  SteerTaskRequest,
  SubmitTaskRequest,
  SystemPermission,
  TaskHistory,
  TaskSnapshot,
  TaskUpdate,
  UsageBudgetSnapshot,
  UpdateAppPreferencesRequest,
  VoiceSegmentTranscription,
  VoiceDiagnostic,
  VoiceShortcutEvent,
  VoiceStatus,
  WorkspaceRuntimeAvailability,
  WorkspaceSelection,
  KnowledgeCapabilities,
  KnowledgeSpaceList,
  KnowledgeSpaceSummary,
  CreateKnowledgeSpaceRequest,
  CreateKnowledgeSpaceResponse,
  KnowledgeSourceList,
  SelectKnowledgeFilesRequest,
  KnowledgeFileSelection,
  UploadKnowledgeSelectionRequest,
  KnowledgeUploadResult,
  SaveKnowledgeActivityRequest,
  KnowledgeActivityDraft,
  PublishKnowledgeActivityRequest,
  KnowledgeActivityVersion,
  CreateKnowledgeRunRequest,
  KnowledgeRun,
  AssignedActivityList,
  HostedAttemptContext,
  KnowledgeDashboard,
  AcknowledgeKnowledgeAttemptRequest,
  SetKnowledgeRunStateRequest,
  GetKnowledgeDashboardRequest,
  PrepareActivityStarterRequest,
  SubmitKnowledgeSelectionRequest,
  KnowledgeGroup,
  KnowledgeGroupList,
  CreateKnowledgeGroupRequest,
  CreateKnowledgeInviteRequest,
  KnowledgeInvite,
  RedeemKnowledgeInviteRequest,
  RedeemKnowledgeInviteResponse,
  RequestKnowledgeAttemptHelp,
} from './contracts';

export const IPC_CHANNELS = {
  activateMembership: 'membership:activate',
  continueWithFree: 'membership:continue-free',
  agentActivity: 'agent:activity',
  appUpdateStatusChanged: 'update:status-changed',
  cancelTask: 'task:cancel',
  checkForAppUpdates: 'update:check',
  companionPositionChanged: 'companion:position-changed',
  companionGuidanceChanged: 'companion:guidance-changed',
  companionGuidanceVisualChanged: 'companion:guidance-visual-changed',
  companionInteractionChanged: 'companion:interaction-changed',
  companionResponseAction: 'companion:response-action',
  companionResponseChanged: 'companion:response-changed',
  companionSpeechChanged: 'companion:speech-changed',
  companionReportSpeechPlayback: 'companion:report-speech-playback',
  companionStateChanged: 'companion:state-changed',
  companionVoiceActivityChanged: 'companion:voice-activity-changed',
  companionRevealMainWindow: 'companion:reveal-main-window',
  configureVoice: 'voice:configure',
  connectComputer: 'cua:connect',
  transcribeVoiceSegment: 'voice:transcribe-segment',
  decideApproval: 'task:decide-approval',
  getAppPreferences: 'preferences:get',
  getAppUpdateStatus: 'update:status',
  getComputerStatus: 'cua:status',
  getAuthStatus: 'auth:status',
  getMembershipStatus: 'membership:status',
  getUsageBudget: 'usage:budget',
  getTaskHistory: 'task:history',
  getVoiceStatus: 'voice:status',
  getWorkspaceRuntimeAvailability: 'workspace:runtime-availability',
  openSystemPermissionSettings: 'system:open-permission-settings',
  recordVoiceTranscript: 'voice:record-transcript',
  reportVoiceDiagnostic: 'voice:diagnostic',
  restartAndInstallAppUpdate: 'update:restart-and-install',
  respondToInteraction: 'task:respond',
  setCompanionState: 'companion:set-state',
  setCompanionVoiceActivity: 'companion:set-voice-activity',
  setVoiceAudioDucking: 'voice:set-audio-ducking',
  startTask: 'task:start',
  signInWithGoogle: 'auth:sign-in-google',
  signOutGoogle: 'auth:sign-out-google',
  steerTask: 'task:steer',
  submitTask: 'task:submit',
  selectWorkspace: 'workspace:select',
  taskUpdate: 'task:update',
  taskComposerFocusRequested: 'task:composer-focus-requested',
  updateAppPreferences: 'preferences:update',
  voiceShortcut: 'voice:shortcut',
  getKnowledgeCapabilities: 'knowledge:capabilities',
  listKnowledgeSpaces: 'knowledge:spaces:list',
  createKnowledgeSpace: 'knowledge:spaces:create',
  getKnowledgeSpace: 'knowledge:spaces:get',
  listKnowledgeSources: 'knowledge:sources:list',
  selectKnowledgeFiles: 'knowledge:files:select',
  uploadKnowledgeSelection: 'knowledge:files:upload',
  saveKnowledgeActivity: 'knowledge:activity:save',
  publishKnowledgeActivity: 'knowledge:activity:publish',
  createKnowledgeRun: 'knowledge:run:create',
  setKnowledgeRunState: 'knowledge:run:set-state',
  listAssignedActivities: 'knowledge:assignments:list',
  getHostedAttempt: 'knowledge:attempt:get',
  acknowledgeHostedAttempt: 'knowledge:attempt:acknowledge',
  getKnowledgeDashboard: 'knowledge:dashboard:get',
  prepareActivityStarter: 'knowledge:starter:prepare',
  submitKnowledgeSelection: 'knowledge:submission:upload',
  listKnowledgeGroups: 'knowledge:groups:list',
  createKnowledgeGroup: 'knowledge:groups:create',
  createKnowledgeInvite: 'knowledge:invites:create',
  redeemKnowledgeInvite: 'knowledge:invites:redeem',
  requestKnowledgeAttemptHelp: 'knowledge:attempt:help',
} as const;

export interface DesktopApi {
  activateMembership(
    request: ActivateMembershipRequest,
  ): Promise<MembershipStatus>;
  continueWithFree(): Promise<MembershipStatus>;
  cancelTask(taskId: string): Promise<TaskSnapshot>;
  checkForAppUpdates(): Promise<AppUpdateStatus>;
  configureVoice(request: ConfigureVoiceRequest): Promise<VoiceStatus>;
  connectComputer(): Promise<CuaStatus>;
  transcribeVoiceSegment(
    request: TranscribeVoiceSegmentRequest,
  ): Promise<VoiceSegmentTranscription>;
  decideApproval(request: DecideApprovalRequest): Promise<TaskSnapshot>;
  getAppPreferences(): Promise<AppPreferences>;
  getAppUpdateStatus(): Promise<AppUpdateStatus>;
  getComputerStatus(): Promise<CuaStatus>;
  getMembershipStatus(): Promise<MembershipStatus>;
  getUsageBudget(taskId?: string): Promise<UsageBudgetSnapshot>;
  getTaskHistory(): Promise<TaskHistory>;
  getAuthStatus(): Promise<AuthStatus>;
  getVoiceStatus(): Promise<VoiceStatus>;
  getWorkspaceRuntimeAvailability(): Promise<WorkspaceRuntimeAvailability>;
  getKnowledgeCapabilities(): Promise<KnowledgeCapabilities>;
  listKnowledgeSpaces(): Promise<KnowledgeSpaceList>;
  createKnowledgeSpace(request: CreateKnowledgeSpaceRequest): Promise<CreateKnowledgeSpaceResponse>;
  getKnowledgeSpace(spaceId: string): Promise<KnowledgeSpaceSummary>;
  listKnowledgeSources(spaceId: string): Promise<KnowledgeSourceList>;
  selectKnowledgeFiles(request: SelectKnowledgeFilesRequest): Promise<KnowledgeFileSelection | null>;
  uploadKnowledgeSelection(request: UploadKnowledgeSelectionRequest): Promise<KnowledgeUploadResult>;
  saveKnowledgeActivity(request: SaveKnowledgeActivityRequest): Promise<KnowledgeActivityDraft>;
  publishKnowledgeActivity(request: PublishKnowledgeActivityRequest): Promise<KnowledgeActivityVersion>;
  createKnowledgeRun(request: CreateKnowledgeRunRequest): Promise<KnowledgeRun>;
  setKnowledgeRunState(request: SetKnowledgeRunStateRequest): Promise<KnowledgeRun>;
  listAssignedActivities(): Promise<AssignedActivityList>;
  getHostedAttempt(attemptId: string): Promise<HostedAttemptContext>;
  acknowledgeHostedAttempt(request: AcknowledgeKnowledgeAttemptRequest): Promise<void>;
  getKnowledgeDashboard(request: GetKnowledgeDashboardRequest): Promise<KnowledgeDashboard>;
  prepareActivityStarter(request: PrepareActivityStarterRequest): Promise<WorkspaceSelection | null>;
  submitKnowledgeSelection(request: SubmitKnowledgeSelectionRequest): Promise<KnowledgeUploadResult>;
  listKnowledgeGroups(spaceId: string): Promise<KnowledgeGroupList>;
  createKnowledgeGroup(request: CreateKnowledgeGroupRequest): Promise<KnowledgeGroup>;
  createKnowledgeInvite(request: CreateKnowledgeInviteRequest): Promise<KnowledgeInvite>;
  redeemKnowledgeInvite(request: RedeemKnowledgeInviteRequest): Promise<RedeemKnowledgeInviteResponse>;
  requestKnowledgeAttemptHelp(request: RequestKnowledgeAttemptHelp): Promise<void>;
  onTaskUpdate(listener: (update: TaskUpdate) => void): () => void;
  onTaskComposerFocusRequested(
    listener: (taskId: string) => void,
  ): () => void;
  onAgentActivity(
    listener: (activity: AgentActivityUpdate) => void,
  ): () => void;
  onAppUpdateStatusChanged(
    listener: (status: AppUpdateStatus) => void,
  ): () => void;
  onVoiceShortcut(listener: (event: VoiceShortcutEvent) => void): () => void;
  openSystemPermissionSettings(permission: SystemPermission): Promise<void>;
  recordVoiceTranscript(request: RecordVoiceTranscriptRequest): Promise<void>;
  reportVoiceDiagnostic(diagnostic: VoiceDiagnostic): Promise<void>;
  restartAndInstallAppUpdate(): Promise<void>;
  respondToInteraction(
    request: RespondToInteractionRequest,
  ): Promise<TaskSnapshot>;
  setCompanionState(state: CompanionState): Promise<void>;
  setCompanionVoiceActivity(
    activity: CompanionVoiceActivity | null,
  ): Promise<void>;
  setVoiceAudioDucking(request: SetVoiceAudioDuckingRequest): Promise<void>;
  startTask(taskId: string): Promise<TaskSnapshot>;
  signInWithGoogle(): Promise<AuthStatus>;
  signOutGoogle(): Promise<AuthStatus>;
  selectWorkspace(): Promise<WorkspaceSelection | null>;
  steerTask(request: SteerTaskRequest): Promise<TaskSnapshot>;
  submitTask(request: SubmitTaskRequest): Promise<TaskSnapshot>;
  updateAppPreferences(
    request: UpdateAppPreferencesRequest,
  ): Promise<AppPreferences>;
}

export interface CompanionApi {
  decideApproval(request: DecideApprovalRequest): Promise<TaskSnapshot>;
  onGuidanceChange(
    listener: (guidance: CompanionGuidance | null) => void,
  ): () => void;
  onGuidanceVisualChange(
    listener: (visual: CompanionGuidanceVisual | null) => void,
  ): () => void;
  onInteractionChange(
    listener: (interaction: CompanionInteraction | null) => void,
  ): () => void;
  onPositionChange(listener: (position: CompanionPosition) => void): () => void;
  onResponseChange(
    listener: (response: CompanionResponseCard | null) => void,
  ): () => void;
  onSpeechChange(listener: (speech: CompanionSpeech | null) => void): () => void;
  onStateChange(listener: (state: CompanionState) => void): () => void;
  onVoiceActivityChange(
    listener: (activity: CompanionVoiceActivity | null) => void,
  ): () => void;
  reportSpeechPlayback(report: CompanionSpeechPlaybackReport): Promise<void>;
  performResponseAction(
    request: CompanionResponseActionRequest,
  ): Promise<void>;
  respondToInteraction(
    request: RespondToInteractionRequest,
  ): Promise<TaskSnapshot>;
  revealMainWindow(): Promise<void>;
}
