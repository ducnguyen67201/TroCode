import { describe, expect, it, vi } from 'vitest';

import type { ClassroomDirective, KnowledgeClassroomSession } from '../../shared/contracts';

import { ClassroomDirectiveService } from './classroom-directive-service';
import { ClassroomSessionService } from './classroom-session-service';

const session: KnowledgeClassroomSession = {
  attemptId: '00000000-0000-4000-8000-000000000001',
  attemptState: 'in_progress',
  run: { id: '00000000-0000-4000-8000-000000000002', state: 'open', mode: 'live', status: 'live' },
  space: { id: '00000000-0000-4000-8000-000000000003', name: 'Python Lab' },
  activityVersionId: '00000000-0000-4000-8000-000000000004',
  activity: {
    title: 'Loops',
    objective: 'Practice loops.',
    launchTarget: 'current_surface',
    requiresSubmission: false,
  },
  currentDirective: null,
  joinedAt: '2026-08-25T00:00:00.000Z',
  leftAt: null,
};
const directive: ClassroomDirective = {
  id: '00000000-0000-4000-8000-000000000005',
  sequence: 4,
  kind: 'open_url',
  delivery: 'auto_eligible',
  instruction: 'Open the loop exercise.',
  criterionIds: ['loop'],
  url: 'https://learn.example.com/loops?day=1',
  origin: 'https://learn.example.com',
  createdAt: '2026-08-25T00:01:00.000Z',
};
const noTimer = (() => 1) as unknown as typeof setTimeout;
const noClear = (() => undefined) as unknown as typeof clearTimeout;

function sessionService(autoOpenConsent: boolean) {
  const service = new ClassroomSessionService({
    getCurrentClassroomSession: vi.fn(), joinRoom: vi.fn(), leaveClassroom: vi.fn(),
  });
  service.activate(session, autoOpenConsent);
  return service;
}

describe('ClassroomDirectiveService', () => {
  it('claims then opens an eligible directive once after joining with the default preference', async () => {
    const classroom = new ClassroomSessionService({
      getCurrentClassroomSession: vi.fn(),
      joinRoom: vi.fn(async () => session),
      leaveClassroom: vi.fn(),
    });
    await classroom.join({ code: 'TRO-ABCD-EFGH-JKLM', clientId: session.attemptId });
    const openExternal = vi.fn(async () => undefined);
    const claimDirective = vi.fn(async () => ({ execute: true as const, url: directive.url, origin: directive.origin, claimedAt: '2026-08-25T00:01:01.000Z' }));
    const service = new ClassroomDirectiveService({
      client: {
        claimDirective,
        listDirectives: vi.fn(async () => ({ attemptState: 'in_progress' as const, runState: 'open' as const, items: [directive], maxSequence: 4 })),
      },
      sessionService: classroom,
      openExternal,
      setTimer: noTimer,
      clearTimer: noClear,
    });
    service.start();
    await service.pollNow();
    expect(claimDirective).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith(directive.url);
    expect(service.getNotice()?.status).toBe('opened');
    expect(classroom.latestDirective()?.id).toBe(directive.id);
    service.stop();
  });

  it('starts from the current directive instead of consuming the room backlog', async () => {
    const classroom = new ClassroomSessionService({
      getCurrentClassroomSession: vi.fn(),
      joinRoom: vi.fn(),
      leaveClassroom: vi.fn(),
    });
    classroom.activate({ ...session, currentDirective: directive }, true);
    const listDirectives = vi.fn(async () => ({
      attemptState: 'in_progress' as const,
      runState: 'open' as const,
      items: [directive],
      maxSequence: directive.sequence,
    }));
    const service = new ClassroomDirectiveService({
      client: {
        claimDirective: vi.fn(async () => ({
          execute: true as const,
          url: directive.url,
          origin: directive.origin,
          claimedAt: '2026-08-25T00:01:01.000Z',
        })),
        listDirectives,
      },
      sessionService: classroom,
      openExternal: vi.fn(async () => undefined),
      setTimer: noTimer,
      clearTimer: noClear,
    });
    service.start();
    await service.pollNow();
    expect(listDirectives).toHaveBeenCalledWith(
      session.attemptId,
      directive.sequence - 1,
      expect.any(AbortSignal),
    );
    service.stop();
  });

  it('delivers manual links without claiming or opening automatically', async () => {
    const classroom = sessionService(true);
    const manual = { ...directive, delivery: 'manual_only' as const };
    const openExternal = vi.fn(async () => undefined);
    const claimDirective = vi.fn();
    const service = new ClassroomDirectiveService({
      client: { claimDirective, listDirectives: vi.fn(async () => ({ attemptState: 'in_progress' as const, runState: 'open' as const, items: [manual], maxSequence: 4 })) },
      sessionService: classroom, openExternal, setTimer: noTimer, clearTimer: noClear,
    });
    service.start();
    await service.pollNow();
    expect(claimDirective).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(service.getNotice()).toEqual({ directive: manual, status: 'received' });
    await service.open(manual);
    expect(openExternal).toHaveBeenCalledOnce();
    service.stop();
  });

  it('drops a stale poll response after the active Attempt changes', async () => {
    const classroom = sessionService(false);
    let resolveList!: (value: { attemptState: 'in_progress'; runState: 'open'; items: ClassroomDirective[]; maxSequence: number }) => void;
    const list = new Promise<{ attemptState: 'in_progress'; runState: 'open'; items: ClassroomDirective[]; maxSequence: number }>((resolve) => { resolveList = resolve; });
    const openExternal = vi.fn(async () => undefined);
    const service = new ClassroomDirectiveService({
      client: { claimDirective: vi.fn(), listDirectives: vi.fn(async () => list) },
      sessionService: classroom, openExternal, setTimer: noTimer, clearTimer: noClear,
    });
    service.start();
    const polling = service.pollNow();
    classroom.activate({ ...session, attemptId: '00000000-0000-4000-8000-000000000009' }, false);
    resolveList({ attemptState: 'in_progress', runState: 'open', items: [directive], maxSequence: 4 });
    await polling;
    expect(service.getNotice()).toBeNull();
    expect(openExternal).not.toHaveBeenCalled();
    service.stop();
  });

  it('rejects renderer-authored links that are not the current trusted directive', async () => {
    const classroom = sessionService(false);
    const openExternal = vi.fn(async () => undefined);
    const service = new ClassroomDirectiveService({
      client: {
        claimDirective: vi.fn(),
        listDirectives: vi.fn(async () => ({ attemptState: 'in_progress' as const, runState: 'open' as const, items: [], maxSequence: 0 })),
      },
      sessionService: classroom,
      openExternal,
      setTimer: noTimer,
      clearTimer: noClear,
    });
    service.start();
    await expect(service.open(directive)).rejects.toThrow('current trusted directive');
    expect(openExternal).not.toHaveBeenCalled();
    service.stop();
  });

  it('ends sticky task inheritance when the teacher closes the Run', async () => {
    const classroom = sessionService(false);
    const service = new ClassroomDirectiveService({
      client: {
        claimDirective: vi.fn(),
        listDirectives: vi.fn(async () => ({
          attemptState: 'completed' as const,
          runState: 'closed' as const,
          items: [],
          maxSequence: 0,
        })),
      },
      sessionService: classroom,
      openExternal: vi.fn(async () => undefined),
      setTimer: noTimer,
      clearTimer: noClear,
    });
    service.start();
    await service.pollNow();
    expect(classroom.get()?.attemptState).toBe('completed');
    expect(classroom.get()?.run.status).toBe('ended');
    expect(classroom.activeStudentAttemptId()).toBeNull();
    service.stop();
  });

  it('does not retry an uncertain automatic claim and continues with later directives', async () => {
    const classroom = sessionService(true);
    const later: ClassroomDirective = {
      id: '00000000-0000-4000-8000-000000000006',
      sequence: 5,
      kind: 'exercise',
      delivery: 'manual_only',
      instruction: 'Continue with the next exercise.',
      criterionIds: ['loop'],
      createdAt: '2026-08-25T00:02:00.000Z',
    };
    const listDirectives = vi.fn()
      .mockResolvedValueOnce({
        attemptState: 'in_progress' as const,
        runState: 'open' as const,
        items: [directive, later],
        maxSequence: 5,
      })
      .mockResolvedValueOnce({
        attemptState: 'in_progress' as const,
        runState: 'open' as const,
        items: [],
        maxSequence: 5,
      });
    const service = new ClassroomDirectiveService({
      client: {
        claimDirective: vi.fn(async () => { throw new Error('claim response lost'); }),
        listDirectives,
      },
      sessionService: classroom,
      openExternal: vi.fn(async () => undefined),
      setTimer: noTimer,
      clearTimer: noClear,
    });
    service.start();
    await service.pollNow();
    expect(service.getNotice()).toEqual({ directive: later, status: 'received' });
    await service.pollNow();
    expect(listDirectives.mock.calls[1]?.[1]).toBe(5);
    service.stop();
  });
});
