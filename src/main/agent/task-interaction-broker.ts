type InteractionKind = 'approval' | 'input';

interface PendingInteractionGate {
  kind: InteractionKind;
  reject: (error: Error) => void;
  resolve: () => void;
}

function cancelledError(): Error {
  const error = new Error('Task execution was cancelled.');
  error.name = 'AbortError';
  return error;
}

/** Cancellation-aware, exact-task interaction waits used by both runtimes. */
export class TaskInteractionBroker {
  private readonly pending = new Map<string, PendingInteractionGate>();

  wait(taskId: string, kind: InteractionKind, signal: AbortSignal): Promise<void> {
    if (this.pending.has(taskId)) {
      throw new Error(`Task ${taskId} already has a pending interaction.`);
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        this.pending.delete(taskId);
        reject(cancelledError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.pending.set(taskId, {
        kind,
        reject,
        resolve: () => {
          signal.removeEventListener('abort', onAbort);
          this.pending.delete(taskId);
          resolve();
        },
      });
    });
  }

  has(taskId: string, kind?: InteractionKind): boolean {
    const pending = this.pending.get(taskId);
    return Boolean(pending && (kind === undefined || pending.kind === kind));
  }

  release(taskId: string, kind: InteractionKind): void {
    const pending = this.pending.get(taskId);
    if (!pending || pending.kind !== kind) {
      throw new Error(`Task ${taskId} is not waiting for ${kind}.`);
    }
    pending.resolve();
  }

  cancel(taskId: string): void {
    const pending = this.pending.get(taskId);
    if (!pending) return;
    this.pending.delete(taskId);
    pending.reject(cancelledError());
  }
}
