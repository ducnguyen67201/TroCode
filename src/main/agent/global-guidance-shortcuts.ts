import type { GoalSpec, TaskPhase } from '../../shared/contracts';

export const GLOBAL_GUIDANCE_SHORTCUTS = {
  back: 'J',
  pause: 'K',
  next: 'L',
} as const;

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
    goal: GoalSpec | null;
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

interface GuidanceControls {
  back(taskId: string): void;
  next(taskId: string): void;
  togglePause(taskId: string): void;
}

interface GlobalGuidanceShortcutOptions {
  controls: GuidanceControls;
  logger?: Pick<Console, 'warn'>;
  registry: GlobalShortcutRegistry;
  updates: TaskUpdateSource;
}

export function registerGlobalGuidanceShortcuts({
  controls,
  logger = console,
  registry,
  updates,
}: GlobalGuidanceShortcutOptions): () => void {
  const activeGuideTaskIds = new Set<string>();
  const registered = new Set<string>();

  const activeTaskId = (): string | undefined =>
    [...activeGuideTaskIds].at(-1);

  const callbacks: Record<keyof typeof GLOBAL_GUIDANCE_SHORTCUTS, () => void> = {
    back: () => {
      const taskId = activeTaskId();
      if (taskId) controls.back(taskId);
    },
    pause: () => {
      const taskId = activeTaskId();
      if (taskId) controls.togglePause(taskId);
    },
    next: () => {
      const taskId = activeTaskId();
      if (taskId) controls.next(taskId);
    },
  };

  const unregisterAll = (): void => {
    for (const accelerator of registered) registry.unregister(accelerator);
    registered.clear();
  };

  const synchronizeShortcuts = (): void => {
    if (activeGuideTaskIds.size === 0) {
      unregisterAll();
      return;
    }
    for (const [control, accelerator] of Object.entries(
      GLOBAL_GUIDANCE_SHORTCUTS,
    ) as Array<[keyof typeof GLOBAL_GUIDANCE_SHORTCUTS, string]>) {
      if (registered.has(accelerator)) continue;
      if (registry.register(accelerator, callbacks[control])) {
        registered.add(accelerator);
      } else {
        logger.warn('[task] Could not register a guidance shortcut.', {
          accelerator,
          control,
        });
      }
    }
  };

  const handleTaskUpdate = (update: TaskLifecycleUpdate): void => {
    const { goal, phase, taskId } = update.snapshot;
    if (TERMINAL_PHASES.has(phase) || goal?.interactionMode !== 'guide') {
      activeGuideTaskIds.delete(taskId);
    } else {
      activeGuideTaskIds.delete(taskId);
      activeGuideTaskIds.add(taskId);
    }
    synchronizeShortcuts();
  };

  updates.on('task-update', handleTaskUpdate);
  return () => {
    updates.off('task-update', handleTaskUpdate);
    activeGuideTaskIds.clear();
    unregisterAll();
  };
}
