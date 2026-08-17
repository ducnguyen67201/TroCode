import type {
  CompanionVoiceActivity,
  PresentationState,
  TaskSnapshot,
  UsageBudgetSnapshot,
} from '../../shared/contracts';

const THINKING_PHASES: ReadonlySet<TaskSnapshot['phase']> = new Set([
  'interpreting',
  'clarifying',
  'planning',
]);
const WORKING_PHASES: ReadonlySet<TaskSnapshot['phase']> = new Set([
  'observing',
  'acting',
  'verifying',
  'paused',
]);

export function derivePresentationState(input: {
  budget?: UsageBudgetSnapshot | null;
  task?: TaskSnapshot | null;
  voice?: CompanionVoiceActivity | null;
}): PresentationState {
  if (input.task?.phase === 'failed') return 'error';
  if (
    input.task?.pendingInteraction ||
    input.task?.phase === 'blocked' ||
    (input.budget &&
      input.budget.monthly.remainingMicroUsd === 0 &&
      input.budget.monthly.limitMicroUsd > 0)
  ) {
    return 'needs_attention';
  }
  if (input.voice) return 'listening';
  if (input.task?.phase === 'completed') return 'done';
  if (input.task && THINKING_PHASES.has(input.task.phase)) return 'thinking';
  if (input.task && WORKING_PHASES.has(input.task.phase)) return 'working';
  if (input.task?.phase === 'cancelled') return 'ready';
  return 'ready';
}
