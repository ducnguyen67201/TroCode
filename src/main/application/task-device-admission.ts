import type { TaskRuntime } from '../agent/task-runtime';

export function isTaskDeviceBusy(runtime: TaskRuntime, taskIds: Iterable<string>, reservation: string | null): boolean {
  return (
    Boolean(reservation) ||
    [...taskIds].some((id) => !['completed', 'failed', 'cancelled', 'blocked'].includes(runtime.getSnapshot(id).phase))
  );
}
