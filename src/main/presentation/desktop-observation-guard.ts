export interface ObservationWindow {
  hide(): void;
  isDestroyed(): boolean;
  isVisible(): boolean;
  showInactive(): void;
}

export interface ObservationSurface {
  getWindow(): ObservationWindow | null;
  restoreIdentity?(): string | null;
  shouldRestore(): boolean;
}

interface DesktopObservationGuardOptions {
  settle(): Promise<void>;
  surfaces: readonly ObservationSurface[];
}

interface HiddenSurface {
  restoreIdentity: string | null;
  surface: ObservationSurface;
  window: ObservationWindow;
}

/**
 * Temporarily removes Tro-owned windows from desktop evidence.
 * Leases are serialized and reference-counted so overlapping captures cannot
 * restore an overlay while another capture is still active.
 */
export class DesktopObservationGuard {
  private activeLeases = 0;
  private retainedWindow: ObservationWindow | null = null;

  private hiddenSurfaces: HiddenSurface[] = [];

  private transition: Promise<void> = Promise.resolve();

  constructor(private readonly options: DesktopObservationGuardOptions) {}

  async prepare(keepVisible: ObservationWindow | null = null): Promise<() => Promise<void>> {
    await this.serialize(async () => {
      if (this.activeLeases > 0 && this.retainedWindow !== keepVisible)
        throw new Error('A conflicting desktop observation is still active.');
      this.retainedWindow = keepVisible;
      this.activeLeases += 1;
      if (this.activeLeases > 1) return;

      this.hiddenSurfaces = this.options.surfaces.flatMap((surface) => {
        const window = surface.getWindow();
        if (!window || window === keepVisible || window.isDestroyed() || !window.isVisible()) return [];
        try {
          window.hide();
          return [{
            restoreIdentity: surface.restoreIdentity?.() ?? null,
            surface,
            window,
          }];
        } catch {
          // Electron windows can be destroyed between the visibility check and hide.
          return [];
        }
      });

      try {
        await this.options.settle();
      } catch (error) {
        this.activeLeases = 0;
        this.restoreHiddenSurfaces();
        throw error;
      }
    });

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await this.serialize(async () => {
        this.activeLeases = Math.max(0, this.activeLeases - 1);
        if (this.activeLeases > 0) return;
        this.restoreHiddenSurfaces();
      });
    };
  }

  private restoreHiddenSurfaces(): void {
    const surfaces = this.hiddenSurfaces;
    this.hiddenSurfaces = [];
    for (const { restoreIdentity, surface, window } of surfaces) {
      try {
        if (
          surface.shouldRestore() &&
          (surface.restoreIdentity?.() ?? null) === restoreIdentity &&
          !window.isDestroyed() &&
          !window.isVisible()
        ) {
          window.showInactive();
        }
      } catch {
        // Cleanup is best-effort and must not mask the CUA capture outcome.
      }
    }
  }

  private async serialize<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.transition.then(operation, operation);
    this.transition = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
