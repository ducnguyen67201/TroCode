interface GlobalShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

interface GlobalNumberedChoiceShortcutsOptions {
  logger?: Pick<Console, 'warn'>;
  registry: GlobalShortcutRegistry;
  select(scopeId: string, selection: number): void;
}

export interface GlobalNumberedChoiceShortcuts {
  activate(scopeId: string, count: number): readonly number[];
  deactivate(scopeId?: string): void;
  dispose(): void;
}

export function registerGlobalNumberedChoiceShortcuts({
  logger = console,
  registry,
  select,
}: GlobalNumberedChoiceShortcutsOptions): GlobalNumberedChoiceShortcuts {
  let activeScopeId: string | null = null;
  let activeCount = 0;
  const owned = new Set<number>();

  const deactivate = (scopeId?: string): void => {
    if (scopeId && activeScopeId !== scopeId) return;
    for (const number of owned) registry.unregister(String(number));
    owned.clear();
    activeScopeId = null;
    activeCount = 0;
  };

  return {
    activate(scopeId, count) {
      if (!Number.isInteger(count) || count < 1 || count > 9) {
        throw new Error('Numbered shortcut count must be between 1 and 9.');
      }
      if (activeScopeId === scopeId && activeCount === count) {
        return [...owned];
      }

      deactivate();
      activeScopeId = scopeId;
      activeCount = count;
      for (let number = 1; number <= count; number += 1) {
        const accelerator = String(number);
        let registered = false;
        try {
          registered = registry.register(accelerator, () => {
            if (activeScopeId !== scopeId || !owned.has(number)) return;
            deactivate(scopeId);
            try {
              select(scopeId, number);
            } catch (error) {
              logger.warn('[companion] Numbered shortcut failed.', {
                error,
                number,
                scopeId,
              });
            }
          });
        } catch {
          registered = false;
        }
        if (registered) owned.add(number);
        else {
          logger.warn('[companion] Could not register numbered shortcut.', {
            accelerator,
            scopeId,
          });
        }
      }
      return [...owned];
    },
    deactivate,
    dispose: () => deactivate(),
  };
}
