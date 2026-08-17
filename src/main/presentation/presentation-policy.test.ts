import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { TaskSnapshot, TaskUpdate } from '../../shared/contracts';

import { PresentationCoordinator } from './presentation-coordinator';
import { derivePresentationState } from './presentation-policy';

function task(phase: TaskSnapshot['phase']): TaskSnapshot {
  const taskId = randomUUID();
  const timestamp = '2026-08-17T00:00:00.000Z';
  return {
    approvalGrant: null,
    createdAt: timestamp,
    goal: null,
    lastEvent: null,
    messages: [],
    pendingInteraction: null,
    phase,
    progress: null,
    queuedSteering: [],
    request: 'Complete a useful task.',
    taskId,
    updatedAt: timestamp,
  };
}

describe('presentation projection', () => {
  it('prioritizes errors, attention, voice, and work without changing task state', () => {
    expect(derivePresentationState({ task: task('failed') })).toBe('error');
    expect(derivePresentationState({ task: task('blocked') })).toBe(
      'needs_attention',
    );
    expect(
      derivePresentationState({
        task: task('planning'),
        voice: { appLanguage: 'en', phase: 'listening', transcript: '' },
      }),
    ).toBe('listening');
    expect(derivePresentationState({ task: task('acting') })).toBe('working');
  });

  it('coordinates only validated task updates and emits idempotent state changes', () => {
    const apply = vi.fn();
    const coordinator = new PresentationCoordinator({ apply });
    const snapshot = task('planning');
    const event = {
      artifacts: [],
      eventId: randomUUID(),
      nextActions: [],
      phase: 'planning' as const,
      status: 'success' as const,
      summary: 'Planning.',
      taskId: snapshot.taskId,
      timestamp: snapshot.updatedAt,
    };
    const update: TaskUpdate = {
      event,
      snapshot: { ...snapshot, lastEvent: event },
    };
    coordinator.handleTaskUpdate(update);
    coordinator.handleTaskUpdate(update);
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith('thinking', expect.any(Object));
  });
});
