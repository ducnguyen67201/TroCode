import type { CompanionGuidance } from '../../shared/contracts';

export const GLOBAL_GUIDANCE_SHORTCUTS = {
  back: 'CommandOrControl+Alt+J',
  pause: 'CommandOrControl+Alt+K',
  next: 'CommandOrControl+Alt+L',
} as const;

type GuidanceShortcutName = keyof typeof GLOBAL_GUIDANCE_SHORTCUTS;
export type GuidanceShortcutMetadata = NonNullable<
  CompanionGuidance['shortcuts']
>;

interface GlobalShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

interface GlobalGuidanceShortcutsOptions {
  back(taskId: string): void;
  logger?: Pick<Console, 'warn'>;
  next(taskId: string): void;
  pause(taskId: string): void;
  platform?: NodeJS.Platform;
  registry: GlobalShortcutRegistry;
}

export interface GlobalGuidanceShortcuts {
  activate(taskId: string): GuidanceShortcutMetadata;
  deactivate(taskId?: string): void;
  dispose(): void;
}

export function registerGlobalGuidanceShortcuts({
  back,
  logger = console,
  next,
  pause,
  platform = process.platform,
  registry,
}: GlobalGuidanceShortcutsOptions): GlobalGuidanceShortcuts {
  let activeTaskId: string | null = null;
  const owned = new Set<GuidanceShortcutName>();

  const callbacks: Record<GuidanceShortcutName, (taskId: string) => void> = {
    back,
    pause,
    next,
  };

  const deactivate = (taskId?: string): void => {
    if (taskId && activeTaskId !== taskId) return;
    for (const name of owned) {
      registry.unregister(GLOBAL_GUIDANCE_SHORTCUTS[name]);
    }
    owned.clear();
    activeTaskId = null;
  };

  return {
    activate(taskId) {
      if (activeTaskId === taskId) return metadata(owned, platform);
      deactivate();
      activeTaskId = taskId;
      for (const name of Object.keys(
        GLOBAL_GUIDANCE_SHORTCUTS,
      ) as GuidanceShortcutName[]) {
        const accelerator = GLOBAL_GUIDANCE_SHORTCUTS[name];
        let registered = false;
        try {
          registered = registry.register(accelerator, () => {
            if (activeTaskId) callbacks[name](activeTaskId);
          });
        } catch {
          registered = false;
        }
        if (registered) owned.add(name);
        else {
          logger.warn('[guidance] Could not register global shortcut.', {
            accelerator,
          });
        }
      }
      return metadata(owned, platform);
    },
    deactivate,
    dispose: () => deactivate(),
  };
}

function metadata(
  owned: ReadonlySet<GuidanceShortcutName>,
  platform: NodeJS.Platform,
): GuidanceShortcutMetadata {
  const prefix = platform === 'darwin' ? '⌘⌥' : 'Ctrl+Alt+';
  return {
    back: { available: owned.has('back'), label: `${prefix}J` },
    pause: { available: owned.has('pause'), label: `${prefix}K` },
    next: { available: owned.has('next'), label: `${prefix}L` },
  };
}
