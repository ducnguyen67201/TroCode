import type {
  ActivateMembershipRequest,
  AppPreferences,
  AuthStatus,
  CompanionGuidance,
  CompanionPosition,
  CompanionState,
  ConfigureVoiceRequest,
  CreateVoiceCallRequest,
  CuaStatus,
  DecideApprovalRequest,
  MembershipStatus,
  RecordVoiceTranscriptRequest,
  RespondToInteractionRequest,
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
  cancelTask: 'task:cancel',
  companionPositionChanged: 'companion:position-changed',
  companionGuidanceChanged: 'companion:guidance-changed',
  companionStateChanged: 'companion:state-changed',
  configureVoice: 'voice:configure',
  connectComputer: 'cua:connect',
  createVoiceCall: 'voice:create-call',
  decideApproval: 'task:decide-approval',
  getAppPreferences: 'preferences:get',
  getComputerStatus: 'cua:status',
  getAuthStatus: 'auth:status',
  getMembershipStatus: 'membership:status',
  getTaskHistory: 'task:history',
  getVoiceStatus: 'voice:status',
  openSystemPermissionSettings: 'system:open-permission-settings',
  recordVoiceTranscript: 'voice:record-transcript',
  reportVoiceDiagnostic: 'voice:diagnostic',
  respondToInteraction: 'task:respond',
  setCompanionState: 'companion:set-state',
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
  configureVoice(request: ConfigureVoiceRequest): Promise<VoiceStatus>;
  connectComputer(): Promise<CuaStatus>;
  createVoiceCall(request: CreateVoiceCallRequest): Promise<VoiceCallAnswer>;
  decideApproval(request: DecideApprovalRequest): Promise<TaskSnapshot>;
  getAppPreferences(): Promise<AppPreferences>;
  getComputerStatus(): Promise<CuaStatus>;
  getMembershipStatus(): Promise<MembershipStatus>;
  getTaskHistory(): Promise<TaskHistory>;
  getAuthStatus(): Promise<AuthStatus>;
  getVoiceStatus(): Promise<VoiceStatus>;
  onTaskUpdate(listener: (update: TaskUpdate) => void): () => void;
  onVoiceShortcut(listener: (event: VoiceShortcutEvent) => void): () => void;
  openSystemPermissionSettings(permission: SystemPermission): Promise<void>;
  recordVoiceTranscript(request: RecordVoiceTranscriptRequest): Promise<void>;
  reportVoiceDiagnostic(diagnostic: VoiceDiagnostic): Promise<void>;
  respondToInteraction(
    request: RespondToInteractionRequest,
  ): Promise<TaskSnapshot>;
  setCompanionState(state: CompanionState): Promise<void>;
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
  onStateChange(listener: (state: CompanionState) => void): () => void;
}
