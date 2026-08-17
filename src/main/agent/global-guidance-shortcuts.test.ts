import { describe, expect, it, vi } from 'vitest';

import type { GoalSpec, TaskPhase } from '../../shared/contracts';

import {
  GLOBAL_GUIDANCE_SHORTCUTS,
  registerGlobalGuidanceShortcuts,
} from './global-guidance-shortcuts';

interface LifecycleUpdate {
  snapshot: {
    goal: GoalSpec | null;
    phase: TaskPhase;
    taskId: string;
  };
}

const guideGoal = {
  behavior: 'guide',
} as GoalSpec;

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

describe('global guidance shortcuts', () => {
  it('binds J/K/L only while a guide task is active', () => {
    const callbacks = new Map<string, () => void>();
    const registry = {
      register: vi.fn((accelerator: string, callback: () => void) => {
        callbacks.set(accelerator, callback);
        return true;
      }),
      unregister: vi.fn((accelerator: string) => callbacks.delete(accelerator)),
    };
    const controls = {
      back: vi.fn(),
      next: vi.fn(),
      togglePause: vi.fn(),
    };
    const updates = updateSource();
    const unregister = registerGlobalGuidanceShortcuts({
      controls,
      registry,
      updates,
    });

    updates.emit({
      snapshot: { goal: guideGoal, phase: 'planning', taskId: 'guide-1' },
    });
    expect(registry.register).toHaveBeenCalledTimes(3);

    callbacks.get(GLOBAL_GUIDANCE_SHORTCUTS.back)?.();
    callbacks.get(GLOBAL_GUIDANCE_SHORTCUTS.pause)?.();
    callbacks.get(GLOBAL_GUIDANCE_SHORTCUTS.next)?.();
    expect(controls.back).toHaveBeenCalledWith('guide-1');
    expect(controls.togglePause).toHaveBeenCalledWith('guide-1');
    expect(controls.next).toHaveBeenCalledWith('guide-1');

    updates.emit({
      snapshot: { goal: guideGoal, phase: 'completed', taskId: 'guide-1' },
    });
    expect(registry.unregister).toHaveBeenCalledTimes(3);

    unregister();
    expect(updates.off).toHaveBeenCalledOnce();
  });

  it('does not capture letter keys for non-guide tasks', () => {
    const registry = { register: vi.fn(() => true), unregister: vi.fn() };
    const updates = updateSource();
    const unregister = registerGlobalGuidanceShortcuts({
      controls: { back: vi.fn(), next: vi.fn(), togglePause: vi.fn() },
      registry,
      updates,
    });

    updates.emit({
      snapshot: {
        goal: { ...guideGoal, behavior: 'act' },
        phase: 'planning',
        taskId: 'action-1',
      },
    });
    expect(registry.register).not.toHaveBeenCalled();
    unregister();
  });

  it('warns without claiming a shortcut the OS rejected', () => {
    const logger = { warn: vi.fn() };
    const registry = { register: vi.fn(() => false), unregister: vi.fn() };
    const updates = updateSource();
    const unregister = registerGlobalGuidanceShortcuts({
      controls: { back: vi.fn(), next: vi.fn(), togglePause: vi.fn() },
      logger,
      registry,
      updates,
    });

    updates.emit({
      snapshot: { goal: guideGoal, phase: 'planning', taskId: 'guide-1' },
    });
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(registry.unregister).not.toHaveBeenCalled();
    unregister();
  });
});
