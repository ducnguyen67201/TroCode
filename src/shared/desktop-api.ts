import type {
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
  configureVoice: 'voice:configure',
  connectComputer: 'cua:connect',
  createVoiceSession: 'voice:create-session',
  decideApproval: 'task:decide-approval',
  getComputerStatus: 'cua:status',
  getVoiceStatus: 'voice:status',
  respondToInteraction: 'task:respond',
  startTask: 'task:start',
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
  getVoiceStatus(): Promise<VoiceStatus>;
  onTaskUpdate(listener: (update: TaskUpdate) => void): () => void;
  respondToInteraction(
    request: RespondToInteractionRequest,
  ): Promise<TaskSnapshot>;
  startTask(taskId: string): Promise<TaskSnapshot>;
  steerTask(request: SteerTaskRequest): Promise<TaskSnapshot>;
  submitTask(request: SubmitTaskRequest): Promise<TaskSnapshot>;
}
