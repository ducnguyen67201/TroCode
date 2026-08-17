import type { TaskPhase, TaskSnapshot } from '../shared/contracts';

const TERMINAL_PHASES: ReadonlySet<TaskPhase> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

type PhaseSnapshot = Pick<TaskSnapshot, 'phase'>;

export function isTaskCancellable(
  snapshot: PhaseSnapshot | null,
): boolean {
  return Boolean(snapshot && !TERMINAL_PHASES.has(snapshot.phase));
}

export function shouldAutoStartTask(
  snapshot: PhaseSnapshot | null,
  options: { agentReady: boolean; isBusy: boolean },
): boolean {
  return (
    snapshot?.phase === 'ready' &&
    options.agentReady &&
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
