import { describe, expect, it, vi } from 'vitest';

import {
  registerGlobalWorkCheckShortcut,
  WORK_CHECK_SHORTCUT,
} from './global-work-check-shortcut';

describe('assignment global shortcut', () => {
  it('debounces repeat keys and owns only its accelerator', async () => {
    let press: () => void = () => undefined;
    let now = 0;
    let finish!: () => void;
    const check = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const registry = {
      register: vi.fn((_key: string, callback: () => void) => {
        press = callback;
        return true;
      }),
      unregister: vi.fn(),
    };
    const dispose = registerGlobalWorkCheckShortcut({
      registry,
      check,
      unavailable: vi.fn(),
      now: () => now,
    });
    press();
    now += 1000;
    press();
    expect(check).toHaveBeenCalledOnce();
    finish();
    await Promise.resolve();
    await Promise.resolve();
    now += 1000;
    press();
    expect(check).toHaveBeenCalledTimes(2);
    dispose();
    dispose();
    press();
    expect(check).toHaveBeenCalledTimes(2);
    expect(registry.unregister).toHaveBeenCalledExactlyOnceWith(
      WORK_CHECK_SHORTCUT,
    );
    finish();
  });
  it.each([false, true])(
    'reports registration failure without unregistering another owner (%s)',
    (throws) => {
      const registry = {
        register: vi.fn(() => {
          if (throws) throw new Error('conflict');
          return false;
        }),
        unregister: vi.fn(),
      };
      const unavailable = vi.fn();
      registerGlobalWorkCheckShortcut({
        registry,
        check: vi.fn(),
        unavailable,
      })();
      expect(unavailable).toHaveBeenCalledOnce();
      expect(registry.unregister).not.toHaveBeenCalled();
    },
  );
});
