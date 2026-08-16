import type { TaskPhase, TaskSnapshot } from '../shared/contracts';

const TERMINAL_PHASES: ReadonlySet<TaskPhase> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

type PhaseSnapshot = Pick<TaskSnapshot, 'phase'>;

export function approvalSafeguardMessage(phase: TaskPhase): string {
  if (phase === 'awaiting_approval') {
    return 'TroCode is waiting for approval for the exact action shown below.';
  }

  return 'No sensitive action is awaiting approval. TroCode asks first only if a later step would log in, send, submit, upload, delete, purchase, or install.';
}

export function isTaskCancellable(
  snapshot: PhaseSnapshot | null,
): boolean {
  return Boolean(snapshot && !TERMINAL_PHASES.has(snapshot.phase));
}

export function shouldAutoStartTask(
  snapshot: PhaseSnapshot | null,
  options: { executionReady: boolean; isBusy: boolean },
): boolean {
  return (
    snapshot?.phase === 'ready' &&
    options.executionReady &&
    !options.isBusy
  );
}

export function shouldStopTaskForEscape(
  event: Pick<KeyboardEvent, 'key' | 'repeat'>,
  snapshot: PhaseSnapshot | null,
): boolean {
  return (
    event.key === 'Escape' && !event.repeat && isTaskCancellable(snapshot)
  );
}
