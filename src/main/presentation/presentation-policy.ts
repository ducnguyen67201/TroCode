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

const AUDIBLE_READING_REQUEST =
  /\b(?:read\b(?:\s+\S+){0,16}\s+(?:aloud|out\s+loud|to\s+me)|doc\b(?:\s+\S+){0,16}\s+(?:thanh\s+tieng|to|len|cho\s+(?:toi|minh)(?:\s+nghe)?))\b/u;
const HUMAN_MESSAGE = /\b(?:e-?mail|mail|message|inbox|thu|tin\s+nhan|hop\s+thu)\b/u;
const READ_VERB = /\b(?:read|doc)\b/u;
const NON_READING_ACTION =
  /\b(?:check|inspect|summari[sz]e|kiem\s+tra|tom\s+tat)\b/u;
const TECHNICAL_READING_TARGET =
  /\b(?:code|codebase|config(?:uration)?\s+file|dockerfile|makefile|package\s+json|readme|repo(?:sitory)?|source\s+file|source\s+code|test\s+file)\b/u;
const TECHNICAL_FILE_EXTENSION =
  /\.(?:[cm]?[jt]sx?|css|env|go|html|java|json|kt|md|py|rs|scss|sh|sql|swift|toml|tsx?|xml|ya?ml)\b/iu;

export function shouldReadTaskCompletionAloud(
  task: Pick<TaskSnapshot, 'request'>,
): boolean {
  const request = normalizeRequest(task.request);
  if (!request) return false;
  if (
    TECHNICAL_READING_TARGET.test(request) ||
    TECHNICAL_FILE_EXTENSION.test(task.request)
  ) {
    return false;
  }
  if (AUDIBLE_READING_REQUEST.test(request)) return true;
  if (NON_READING_ACTION.test(request)) return false;
  return READ_VERB.test(request) && HUMAN_MESSAGE.test(request);
}

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

function normalizeRequest(request: string): string {
  return request
    .normalize('NFD')
    .replace(/\p{Mark}+/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/đ/gu, 'd')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}
