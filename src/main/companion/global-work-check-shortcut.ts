export const WORK_CHECK_SHORTCUT = 'CommandOrControl+Alt+K';
interface Registry {
  register(key: string, callback: () => void): boolean;
  unregister(key: string): void;
}

/** Owns only its accelerator; callers decide when the current assignment is eligible. */
export function registerGlobalWorkCheckShortcut(options: {
  registry: Registry;
  check(): Promise<void>;
  unavailable(): void;
  now?: () => number;
}): () => void {
  let owned = false,
    busy = false,
    disposed = false;
  let last = Number.NEGATIVE_INFINITY;
  try {
    owned = options.registry.register(WORK_CHECK_SHORTCUT, () => {
      const now = (options.now ?? Date.now)();
      if (disposed || busy || now - last < 750) return;
      last = now;
      busy = true;
      void options
        .check()
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    });
  } catch {
    owned = false;
  }
  if (!owned) options.unavailable();
  return () => {
    disposed = true;
    if (owned) {
      options.registry.unregister(WORK_CHECK_SHORTCUT);
      owned = false;
    }
  };
}
