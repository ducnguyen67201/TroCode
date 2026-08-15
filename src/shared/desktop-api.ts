import type {
  AuthStatus,
  CompanionState,
  ConfigureVoiceRequest,
  CuaStatus,
  DecideApprovalRequest,
  RespondToInteractionRequest,
  SteerTaskRequest,
  SubmitTaskRequest,
  TaskSnapshot,
  TaskUpdate,
  VoiceSession,
  VoiceStatus,
} from './contracts';

export const IPC_CHANNELS = {
  cancelTask: 'task:cancel',
  companionStateChanged: 'companion:state-changed',
  configureVoice: 'voice:configure',
  connectComputer: 'cua:connect',
  createVoiceSession: 'voice:create-session',
  decideApproval: 'task:decide-approval',
  getComputerStatus: 'cua:status',
  getAuthStatus: 'auth:status',
  getVoiceStatus: 'voice:status',
  respondToInteraction: 'task:respond',
  setCompanionState: 'companion:set-state',
  startTask: 'task:start',
  signInWithGoogle: 'auth:sign-in-google',
  signOutGoogle: 'auth:sign-out-google',
  steerTask: 'task:steer',
  submitTask: 'task:submit',
  taskUpdate: 'task:update',
} as const;

export interface DesktopApi {
  cancelTask(taskId: string): Promise<TaskSnapshot>;
  configureVoice(request: ConfigureVoiceRequest): Promise<VoiceStatus>;
  connectComputer(): Promise<CuaStatus>;
  createVoiceSession(): Promise<VoiceSession>;
  decideApproval(request: DecideApprovalRequest): Promise<TaskSnapshot>;
  getComputerStatus(): Promise<CuaStatus>;
  getAuthStatus(): Promise<AuthStatus>;
  getVoiceStatus(): Promise<VoiceStatus>;
  onTaskUpdate(listener: (update: TaskUpdate) => void): () => void;
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
  onStateChange(listener: (state: CompanionState) => void): () => void;
}
