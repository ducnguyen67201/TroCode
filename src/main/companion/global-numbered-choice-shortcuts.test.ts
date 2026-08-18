import { describe, expect, it, vi } from 'vitest';

import {
  registerGlobalNumberedChoiceShortcuts,
  type GlobalNumberedChoiceShortcuts,
} from './global-numbered-choice-shortcuts';

function setup(registerResult: (accelerator: string) => boolean = () => true) {
  const callbacks = new Map<string, () => void>();
  const registry = {
    register: vi.fn((accelerator: string, callback: () => void) => {
      if (!registerResult(accelerator)) return false;
      callbacks.set(accelerator, callback);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => callbacks.delete(accelerator)),
  };
  const select = vi.fn();
  const shortcuts: GlobalNumberedChoiceShortcuts =
    registerGlobalNumberedChoiceShortcuts({ registry, select });
  return { callbacks, registry, select, shortcuts };
}

describe('global numbered choice shortcuts', () => {
  it('registers the visible numbers and dispatches a one-based selection once', () => {
    const { callbacks, registry, select, shortcuts } = setup();

    shortcuts.activate('interaction:one', 3);
    expect([...callbacks.keys()]).toEqual(['1', '2', '3']);

    callbacks.get('2')?.();

    expect(select).toHaveBeenCalledWith('interaction:one', 2);
    expect(registry.unregister).toHaveBeenCalledTimes(3);
    expect(callbacks.size).toBe(0);
  });

  it('replaces the previous scope and ignores callbacks retained by the OS', () => {
    const { callbacks, select, shortcuts } = setup();

    shortcuts.activate('response:old', 4);
    const stale = callbacks.get('1');
    shortcuts.activate('interaction:new', 2);
    stale?.();
    callbacks.get('1')?.();

    expect(select).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledWith('interaction:new', 1);
  });

  it('owns only successfully registered digits and disposes exact registrations', () => {
    const { registry, shortcuts } = setup((accelerator) => accelerator !== '2');

    expect(shortcuts.activate('response:one', 3)).toEqual([1, 3]);
    shortcuts.dispose();

    expect(registry.unregister).toHaveBeenCalledWith('1');
    expect(registry.unregister).toHaveBeenCalledWith('3');
    expect(registry.unregister).not.toHaveBeenCalledWith('2');
  });

  it('rejects empty and oversized scopes', () => {
    const { registry, shortcuts } = setup();

    expect(() => shortcuts.activate('bad', 0)).toThrow(/between 1 and 9/i);
    expect(() => shortcuts.activate('bad', 10)).toThrow(/between 1 and 9/i);
    expect(registry.register).not.toHaveBeenCalled();
  });
});
