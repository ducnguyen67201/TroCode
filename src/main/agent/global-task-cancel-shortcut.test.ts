import { describe, expect, it, vi } from 'vitest';

import type { TaskPhase } from '../../shared/contracts';

import {
  GLOBAL_TASK_CANCEL_SHORTCUT,
  registerGlobalTaskCancelShortcut,
} from './global-task-cancel-shortcut';

interface LifecycleUpdate {
  snapshot: {
    phase: TaskPhase;
    taskId: string;
  };
}

function updateSource() {
  const listeners = new Set<(update: LifecycleUpdate) => void>();
  return {
    emit(update: LifecycleUpdate) {
      for (const listener of listeners) listener(update);
    },
    off: vi.fn((_event: string, listener: (update: LifecycleUpdate) => void) => {
      listeners.delete(listener);
    }),
    on: vi.fn((_event: string, listener: (update: LifecycleUpdate) => void) => {
      listeners.add(listener);
    }),
  };
}

describe('global task cancel shortcut', () => {
  it('registers Escape only while tasks are active and cancels every active task', () => {
    const callbacks = new Map<string, () => void>();
    const registry = {
      register: vi.fn((accelerator: string, callback: () => void) => {
        callbacks.set(accelerator, callback);
        return true;
      }),
      unregister: vi.fn((accelerator: string) => {
        callbacks.delete(accelerator);
      }),
    };
    const updates = updateSource();
    const cancelTask = vi.fn();
    const unregister = registerGlobalTaskCancelShortcut({
      cancelTask,
      registry,
      updates,
    });

    expect(registry.register).not.toHaveBeenCalled();
    updates.emit({ snapshot: { phase: 'ready', taskId: 'task-1' } });
    updates.emit({ snapshot: { phase: 'planning', taskId: 'task-2' } });
    expect(registry.register).toHaveBeenCalledOnce();
    expect(registry.register).toHaveBeenCalledWith(
      GLOBAL_TASK_CANCEL_SHORTCUT,
      expect.any(Function),
    );

    callbacks.get(GLOBAL_TASK_CANCEL_SHORTCUT)?.();
    expect(cancelTask).toHaveBeenCalledTimes(2);
    expect(cancelTask).toHaveBeenCalledWith('task-1');
    expect(cancelTask).toHaveBeenCalledWith('task-2');

    updates.emit({ snapshot: { phase: 'completed', taskId: 'task-1' } });
    expect(registry.unregister).not.toHaveBeenCalled();
    updates.emit({ snapshot: { phase: 'cancelled', taskId: 'task-2' } });
    expect(registry.unregister).toHaveBeenCalledWith(
      GLOBAL_TASK_CANCEL_SHORTCUT,
    );

    unregister();
    expect(updates.off).toHaveBeenCalledOnce();
  });

  it('does not capture Escape for terminal-only updates', () => {
    const updates = updateSource();
    const registry = {
      register: vi.fn(() => true),
      unregister: vi.fn(),
    };
    const unregister = registerGlobalTaskCancelShortcut({
      cancelTask: vi.fn(),
      registry,
      updates,
    });

    updates.emit({ snapshot: { phase: 'completed', taskId: 'task-1' } });

    expect(registry.register).not.toHaveBeenCalled();
    unregister();
    expect(registry.unregister).not.toHaveBeenCalled();
  });

  it('warns and leaves Escape alone when global registration is unavailable', () => {
    const updates = updateSource();
    const logger = { warn: vi.fn() };
    const registry = {
      register: vi.fn(() => false),
      unregister: vi.fn(),
    };
    const unregister = registerGlobalTaskCancelShortcut({
      cancelTask: vi.fn(),
      logger,
      registry,
      updates,
    });

    updates.emit({ snapshot: { phase: 'planning', taskId: 'task-1' } });

    expect(logger.warn).toHaveBeenCalledWith(
      '[task] Could not register the global cancel shortcut.',
      { accelerator: GLOBAL_TASK_CANCEL_SHORTCUT },
    );
    expect(registry.unregister).not.toHaveBeenCalled();
    unregister();
  });
});
