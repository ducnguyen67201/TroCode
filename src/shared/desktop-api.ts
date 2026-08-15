import type {
  CuaStatus,
  SubmitTaskRequest,
  TaskEvent,
  TaskSnapshot,
} from './contracts';

export const IPC_CHANNELS = {
  cancelTask: 'task:cancel',
  connectComputer: 'cua:connect',
  getComputerStatus: 'cua:status',
  submitTask: 'task:submit',
  taskEvent: 'task:event',
} as const;

export interface DesktopApi {
  cancelTask(taskId: string): Promise<TaskSnapshot>;
  connectComputer(): Promise<CuaStatus>;
  getComputerStatus(): Promise<CuaStatus>;
  onTaskEvent(listener: (event: TaskEvent) => void): () => void;
  submitTask(request: SubmitTaskRequest): Promise<TaskSnapshot>;
}
