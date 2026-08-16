import type { TaskPhase } from '../../shared/contracts';

export const GLOBAL_TASK_CANCEL_SHORTCUT = 'Escape';

const TERMINAL_PHASES: ReadonlySet<TaskPhase> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

interface GlobalShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

interface TaskLifecycleUpdate {
  snapshot: {
    phase: TaskPhase;
    taskId: string;
  };
}

interface TaskUpdateSource {
  off(
    event: 'task-update',
    listener: (update: TaskLifecycleUpdate) => void,
  ): unknown;
  on(
    event: 'task-update',
    listener: (update: TaskLifecycleUpdate) => void,
  ): unknown;
}

interface GlobalTaskCancelShortcutOptions {
  cancelTask(taskId: string): void;
  logger?: Pick<Console, 'warn'>;
  registry: GlobalShortcutRegistry;
  updates: TaskUpdateSource;
}

export function registerGlobalTaskCancelShortcut({
  cancelTask,
  logger = console,
  registry,
  updates,
}: GlobalTaskCancelShortcutOptions): () => void {
  const activeTaskIds = new Set<string>();
  let registrationAttempted = false;
  let shortcutRegistered = false;

  const cancelActiveTasks = (): void => {
    for (const taskId of [...activeTaskIds]) {
      try {
        cancelTask(taskId);
      } catch (error) {
        logger.warn('[task] Global task cancellation failed.', {
          error:
            error instanceof Error
              ? { message: error.message, name: error.name }
              : { message: String(error) },
        });
      }
    }
  };

  const synchronizeShortcut = (): void => {
    if (activeTaskIds.size === 0) {
      registrationAttempted = false;
      if (shortcutRegistered) {
        registry.unregister(GLOBAL_TASK_CANCEL_SHORTCUT);
        shortcutRegistered = false;
      }
      return;
    }

    if (shortcutRegistered || registrationAttempted) return;
    registrationAttempted = true;
    shortcutRegistered = registry.register(
      GLOBAL_TASK_CANCEL_SHORTCUT,
      cancelActiveTasks,
    );
    if (!shortcutRegistered) {
      logger.warn('[task] Could not register the global cancel shortcut.', {
        accelerator: GLOBAL_TASK_CANCEL_SHORTCUT,
      });
    }
  };

  const handleTaskUpdate = (update: TaskLifecycleUpdate): void => {
    const { phase, taskId } = update.snapshot;
    if (TERMINAL_PHASES.has(phase)) activeTaskIds.delete(taskId);
    else activeTaskIds.add(taskId);
    synchronizeShortcut();
  };

  updates.on('task-update', handleTaskUpdate);
  return () => {
    updates.off('task-update', handleTaskUpdate);
    activeTaskIds.clear();
    if (shortcutRegistered) {
      registry.unregister(GLOBAL_TASK_CANCEL_SHORTCUT);
      shortcutRegistered = false;
    }
  };
}
