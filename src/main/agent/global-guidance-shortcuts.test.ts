import { describe, expect, it, vi } from 'vitest';

import {
  GLOBAL_GUIDANCE_SHORTCUTS,
  registerGlobalGuidanceShortcuts,
} from './global-guidance-shortcuts';

describe('global guidance shortcuts', () => {
  it('routes only the active guidance task and unregisters exact owned keys', () => {
    const callbacks = new Map<string, () => void>();
    const registry = {
      register: vi.fn((accelerator: string, callback: () => void) => {
        callbacks.set(accelerator, callback);
        return true;
      }),
      unregister: vi.fn((accelerator: string) => callbacks.delete(accelerator)),
    };
    const back = vi.fn();
    const pause = vi.fn();
    const next = vi.fn();
    const shortcuts = registerGlobalGuidanceShortcuts({
      back,
      next,
      pause,
      platform: 'darwin',
      registry,
    });

    expect(shortcuts.activate('task-1')).toEqual({
      back: { available: true, label: '⌘⌥J' },
      pause: { available: true, label: '⌘⌥K' },
      next: { available: true, label: '⌘⌥L' },
    });
    callbacks.get(GLOBAL_GUIDANCE_SHORTCUTS.back)?.();
    callbacks.get(GLOBAL_GUIDANCE_SHORTCUTS.pause)?.();
    callbacks.get(GLOBAL_GUIDANCE_SHORTCUTS.next)?.();
    expect(back).toHaveBeenCalledWith('task-1');
    expect(pause).toHaveBeenCalledWith('task-1');
    expect(next).toHaveBeenCalledWith('task-1');

    shortcuts.deactivate('task-1');
    expect(registry.unregister).toHaveBeenCalledTimes(3);
  });

  it('reports partial collisions and never unregisters a key it did not own', () => {
    const registry = {
      register: vi.fn((accelerator: string) =>
        accelerator !== GLOBAL_GUIDANCE_SHORTCUTS.pause,
      ),
      unregister: vi.fn(),
    };
    const shortcuts = registerGlobalGuidanceShortcuts({
      back: vi.fn(),
      next: vi.fn(),
      pause: vi.fn(),
      platform: 'win32',
      registry,
    });
    const availability = shortcuts.activate('task-1');

    expect(availability.pause).toEqual({
      available: false,
      label: 'Ctrl+Alt+K',
    });
    shortcuts.dispose();
    expect(registry.unregister).toHaveBeenCalledWith(
      GLOBAL_GUIDANCE_SHORTCUTS.back,
    );
    expect(registry.unregister).toHaveBeenCalledWith(
      GLOBAL_GUIDANCE_SHORTCUTS.next,
    );
    expect(registry.unregister).not.toHaveBeenCalledWith(
      GLOBAL_GUIDANCE_SHORTCUTS.pause,
    );
  });
});
