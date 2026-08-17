export type GuidanceNavigation = 'back' | 'next';

interface PendingWait {
  cancelAutoAdvance: () => void;
  cleanup: () => void;
  resolve: (navigation: GuidanceNavigation) => void;
  scheduleAutoAdvance: () => void;
}

const DEFAULT_AUTO_ADVANCE_MS = 15_000;
const MAX_BUFFERED_NAVIGATION = 8;

function abortError(): Error {
  const error = new Error('Guidance playback was cancelled.');
  error.name = 'AbortError';
  return error;
}

/**
 * Owns only walkthrough transport state. The execution coordinator still owns
 * desktop observation, pointer movement, policy, and task lifecycle state.
 */
export class GuidancePlaybackController {
  private readonly autoAdvanceMs: number;

  private readonly bufferedNavigation: GuidanceNavigation[] = [];

  private paused = false;

  private pendingWait: PendingWait | null = null;

  constructor(autoAdvanceMs = DEFAULT_AUTO_ADVANCE_MS) {
    this.autoAdvanceMs = Math.max(0, autoAdvanceMs);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  back(): void {
    this.navigate('back');
  }

  next(): void {
    this.navigate('next');
  }

  togglePause(): boolean {
    this.paused = !this.paused;
    if (this.paused) this.pendingWait?.cancelAutoAdvance();
    else this.pendingWait?.scheduleAutoAdvance();
    return this.paused;
  }

  async wait(signal: AbortSignal): Promise<GuidanceNavigation> {
    if (signal.aborted) throw abortError();
    const buffered = this.bufferedNavigation.shift();
    if (buffered) return buffered;
    if (this.pendingWait) {
      throw new Error('Guidance playback already has a pending wait.');
    }

    return new Promise<GuidanceNavigation>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const handleAbort = (): void => {
        cleanup();
        reject(abortError());
      };
      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        timer = null;
        signal.removeEventListener('abort', handleAbort);
        if (this.pendingWait?.cleanup === cleanup) this.pendingWait = null;
      };
      const settle = (navigation: GuidanceNavigation): void => {
        cleanup();
        resolve(navigation);
      };
      const cancelAutoAdvance = (): void => {
        if (timer) clearTimeout(timer);
        timer = null;
      };
      const scheduleAutoAdvance = (): void => {
        if (this.paused || timer) return;
        timer = setTimeout(() => settle('next'), this.autoAdvanceMs);
      };

      this.pendingWait = {
        cancelAutoAdvance,
        cleanup,
        resolve: settle,
        scheduleAutoAdvance,
      };
      signal.addEventListener('abort', handleAbort, { once: true });
      scheduleAutoAdvance();
    });
  }

  private navigate(navigation: GuidanceNavigation): void {
    const pending = this.pendingWait;
    if (pending) {
      pending.resolve(navigation);
      return;
    }
    if (this.bufferedNavigation.length < MAX_BUFFERED_NAVIGATION) {
      this.bufferedNavigation.push(navigation);
    }
  }
}
