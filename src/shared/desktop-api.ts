import type {
  AuthStatus,
  CompanionPosition,
  CompanionState,
  ConfigureVoiceRequest,
  CreateVoiceCallRequest,
  CuaStatus,
  DecideApprovalRequest,
  RecordVoiceTranscriptRequest,
  RespondToInteractionRequest,
  SteerTaskRequest,
  SubmitTaskRequest,
  SystemPermission,
  TaskSnapshot,
  TaskUpdate,
  VoiceCallAnswer,
  VoiceDiagnostic,
  VoiceShortcutEvent,
  VoiceStatus,
} from './contracts';

export const IPC_CHANNELS = {
  cancelTask: 'task:cancel',
  companionPositionChanged: 'companion:position-changed',
  companionStateChanged: 'companion:state-changed',
  configureVoice: 'voice:configure',
  connectComputer: 'cua:connect',
  createVoiceCall: 'voice:create-call',
  decideApproval: 'task:decide-approval',
  getComputerStatus: 'cua:status',
  getAuthStatus: 'auth:status',
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
  voiceShortcut: 'voice:shortcut',
} as const;

export interface DesktopApi {
  cancelTask(taskId: string): Promise<TaskSnapshot>;
  configureVoice(request: ConfigureVoiceRequest): Promise<VoiceStatus>;
  connectComputer(): Promise<CuaStatus>;
  createVoiceCall(request: CreateVoiceCallRequest): Promise<VoiceCallAnswer>;
  decideApproval(request: DecideApprovalRequest): Promise<TaskSnapshot>;
  getComputerStatus(): Promise<CuaStatus>;
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
}

export interface CompanionApi {
  onPositionChange(listener: (position: CompanionPosition) => void): () => void;
  onStateChange(listener: (state: CompanionState) => void): () => void;
}
