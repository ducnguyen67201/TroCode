import type {
  ActivateMembershipRequest,
  AppPreferences,
  AppUpdateStatus,
  AuthStatus,
  CompanionGuidance,
  CompanionPosition,
  CompanionSpeech,
  CompanionState,
  CompanionVoiceActivity,
  ConfigureVoiceRequest,
  CreateVoiceCallRequest,
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
  UpdateAppPreferencesRequest,
  VoiceCallAnswer,
  VoiceDiagnostic,
  VoiceShortcutEvent,
  VoiceStatus,
} from './contracts';

export const IPC_CHANNELS = {
  activateMembership: 'membership:activate',
  appUpdateStatusChanged: 'update:status-changed',
  cancelTask: 'task:cancel',
  checkForAppUpdates: 'update:check',
  companionPositionChanged: 'companion:position-changed',
  companionGuidanceChanged: 'companion:guidance-changed',
  companionSpeechChanged: 'companion:speech-changed',
  companionStateChanged: 'companion:state-changed',
  companionVoiceActivityChanged: 'companion:voice-activity-changed',
  configureVoice: 'voice:configure',
  connectComputer: 'cua:connect',
  createVoiceCall: 'voice:create-call',
  decideApproval: 'task:decide-approval',
  getAppPreferences: 'preferences:get',
  getAppUpdateStatus: 'update:status',
  getComputerStatus: 'cua:status',
  getAuthStatus: 'auth:status',
  getMembershipStatus: 'membership:status',
  getTaskHistory: 'task:history',
  getVoiceStatus: 'voice:status',
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
  taskUpdate: 'task:update',
  updateAppPreferences: 'preferences:update',
  voiceShortcut: 'voice:shortcut',
} as const;

export interface DesktopApi {
  activateMembership(
    request: ActivateMembershipRequest,
  ): Promise<MembershipStatus>;
  cancelTask(taskId: string): Promise<TaskSnapshot>;
  checkForAppUpdates(): Promise<AppUpdateStatus>;
  configureVoice(request: ConfigureVoiceRequest): Promise<VoiceStatus>;
  connectComputer(): Promise<CuaStatus>;
  createVoiceCall(request: CreateVoiceCallRequest): Promise<VoiceCallAnswer>;
  decideApproval(request: DecideApprovalRequest): Promise<TaskSnapshot>;
  getAppPreferences(): Promise<AppPreferences>;
  getAppUpdateStatus(): Promise<AppUpdateStatus>;
  getComputerStatus(): Promise<CuaStatus>;
  getMembershipStatus(): Promise<MembershipStatus>;
  getTaskHistory(): Promise<TaskHistory>;
  getAuthStatus(): Promise<AuthStatus>;
  getVoiceStatus(): Promise<VoiceStatus>;
  onTaskUpdate(listener: (update: TaskUpdate) => void): () => void;
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
  steerTask(request: SteerTaskRequest): Promise<TaskSnapshot>;
  submitTask(request: SubmitTaskRequest): Promise<TaskSnapshot>;
  updateAppPreferences(
    request: UpdateAppPreferencesRequest,
  ): Promise<AppPreferences>;
}

export interface CompanionApi {
  onGuidanceChange(
    listener: (guidance: CompanionGuidance | null) => void,
  ): () => void;
  onPositionChange(listener: (position: CompanionPosition) => void): () => void;
  onSpeechChange(listener: (speech: CompanionSpeech | null) => void): () => void;
  onStateChange(listener: (state: CompanionState) => void): () => void;
  onVoiceActivityChange(
    listener: (activity: CompanionVoiceActivity | null) => void,
  ): () => void;
}
