import { randomUUID } from 'node:crypto';

import type {
  TaskEvent,
  TaskPhase,
  TaskSnapshot,
} from '../../shared/contracts';

const TERMINAL_PHASES: readonly TaskPhase[] = [
  'completed',
  'failed',
  'cancelled',
];

const ALLOWED_TRANSITIONS: Readonly<Record<TaskPhase, readonly TaskPhase[]>> = {
  idle: ['interpreting', 'cancelled'],
  interpreting: ['clarifying', 'ready', 'failed', 'cancelled'],
  clarifying: ['interpreting', 'cancelled'],
  ready: ['planning', 'awaiting_approval', 'cancelled'],
  awaiting_approval: ['planning', 'cancelled', 'blocked'],
  planning: ['observing', 'awaiting_approval', 'blocked', 'failed', 'cancelled'],
  observing: ['acting', 'verifying', 'blocked', 'failed', 'cancelled'],
  acting: ['observing', 'verifying', 'awaiting_approval', 'blocked', 'failed', 'cancelled'],
  verifying: ['completed', 'planning', 'observing', 'blocked', 'failed', 'cancelled'],
  paused: ['planning', 'observing', 'cancelled'],
  blocked: ['planning', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
};

interface TransitionDetails {
  status?: TaskEvent['status'];
  summary: string;
  nextActions?: string[];
  artifacts?: string[];
}

export function isTerminalPhase(phase: TaskPhase): boolean {
  return TERMINAL_PHASES.includes(phase);
}

export function canTransition(from: TaskPhase, to: TaskPhase): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transitionTask(
  snapshot: TaskSnapshot,
  nextPhase: TaskPhase,
  details: TransitionDetails,
): TaskSnapshot {
  if (!canTransition(snapshot.phase, nextPhase)) {
    throw new Error(`Invalid task transition: ${snapshot.phase} -> ${nextPhase}`);
  }

  const timestamp = new Date().toISOString();
  const lastEvent: TaskEvent = {
    eventId: randomUUID(),
    taskId: snapshot.taskId,
    phase: nextPhase,
    timestamp,
    status: details.status ?? 'success',
    summary: details.summary,
    nextActions: details.nextActions ?? [],
    artifacts: details.artifacts ?? [],
  };

  return {
    ...snapshot,
    phase: nextPhase,
    updatedAt: timestamp,
    lastEvent,
  };
}
