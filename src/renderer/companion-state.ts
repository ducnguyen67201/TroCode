import type {
  CompanionState,
  TaskPhase,
} from '../shared/contracts';

import type { VoiceInputStatus } from './use-push-to-talk';

interface CompanionStateInput {
  hasError: boolean;
  isSending: boolean;
  showTaskCompleted: boolean;
  taskPhase: TaskPhase | null;
  voiceStatus: VoiceInputStatus;
}

const WORKING_TASK_PHASES: ReadonlySet<TaskPhase> = new Set([
  'idle',
  'interpreting',
  'clarifying',
  'ready',
  'planning',
  'observing',
  'acting',
  'verifying',
]);

export function getCompanionState({
  hasError,
  isSending,
  showTaskCompleted,
  taskPhase,
  voiceStatus,
}: CompanionStateInput): CompanionState {
  if (voiceStatus === 'processing') return 'processing';
  if (isSending) return 'sending';

  if (
    voiceStatus === 'connecting' ||
    voiceStatus === 'listening' ||
    voiceStatus === 'requesting_permission'
  ) {
    return 'listening';
  }

  if (hasError) return 'error';
  if (showTaskCompleted) return 'completed';
  if (taskPhase && WORKING_TASK_PHASES.has(taskPhase)) return 'working';
  return 'idle';
}
