import { describe, expect, it, vi } from 'vitest';

import type { KnowledgeClassroomSession } from '../../shared/contracts';

import { ClassroomSessionService } from './classroom-session-service';

const firstSession: KnowledgeClassroomSession = {
  attemptId: '00000000-0000-4000-8000-000000000001',
  attemptState: 'assigned',
  run: { id: '00000000-0000-4000-8000-000000000002', state: 'draft', mode: 'live', status: 'lobby' },
  space: { id: '00000000-0000-4000-8000-000000000003', name: 'Python Lab' },
  activityVersionId: '00000000-0000-4000-8000-000000000004',
  activity: {
    title: 'Loops',
    objective: 'Practice loops safely.',
    launchTarget: 'workspace',
    requiresSubmission: false,
  },
  currentDirective: null,
  joinedAt: '2026-08-25T00:00:00.000Z',
  leftAt: null,
};

describe('ClassroomSessionService', () => {
  it.each([undefined, false, true])('defaults new joins to automatic links while honoring an explicit %s preference', async (autoOpenConsent) => {
    const service = new ClassroomSessionService({
      getCurrentClassroomSession: vi.fn(async () => firstSession),
      joinRoom: vi.fn(async () => firstSession),
      leaveClassroom: vi.fn(),
    });
    const joined = await service.join({
      code: 'TRO-ABCD-EFGH-JKLM',
      clientId: '00000000-0000-4000-8000-000000000005',
      autoOpenConsent,
    });
    expect(joined.autoOpenConsent).toBe(autoOpenConsent ?? true);
    expect(service.lessonConsent()).toBe(autoOpenConsent ?? true);
  });

  it('preserves a student opt-out when refreshing or rejoining the same Attempt', async () => {
    const service = new ClassroomSessionService({
      getCurrentClassroomSession: vi.fn(async () => firstSession),
      joinRoom: vi.fn(async () => firstSession),
      leaveClassroom: vi.fn(),
    });
    const request = { code: 'TRO-ABCD-EFGH-JKLM', clientId: '00000000-0000-4000-8000-000000000005' };
    await service.join(request);
    service.setAutoOpenConsent(false);
    expect((await service.restore())?.autoOpenConsent).toBe(false);
    expect((await service.join(request)).autoOpenConsent).toBe(false);
    expect(service.lessonConsent()).toBe(false);
  });

  it('keeps trusted join context in main and only inherits an open active Attempt', async () => {
    const client = {
      getCurrentClassroomSession: vi.fn(async () => firstSession),
      joinRoom: vi.fn(async () => firstSession),
      leaveClassroom: vi.fn(async () => ({ attemptId: firstSession.attemptId, leftAt: '2026-08-25T01:00:00.000Z' })),
    };
    const service = new ClassroomSessionService(client);
    const changes: Array<string | null> = [];
    service.onChange((session) => changes.push(session?.run.status ?? null));

    const lobby = await service.join({
      autoOpenConsent: true,
      clientId: '00000000-0000-4000-8000-000000000005',
      code: 'TRO-ABCD-EFGH-JKLM',
    });
    expect(lobby.autoOpenConsent).toBe(true);
    expect(client.joinRoom).toHaveBeenCalledWith({
      clientId: '00000000-0000-4000-8000-000000000005',
      code: 'TRO-ABCD-EFGH-JKLM',
    });
    expect(service.activeStudentAttemptId()).toBeNull();

    service.updateRunState('open');
    expect(service.activeStudentAttemptId()).toBe(firstSession.attemptId);
    expect(service.get()?.autoOpenConsent).toBe(true);

    await service.leave();
    expect(client.leaveClassroom).toHaveBeenCalledOnce();
    expect(service.get()).toBeNull();
    expect(changes).toEqual(['lobby', 'live', null]);
  });

  it('does not carry link consent when restoring another Attempt', async () => {
    const other = { ...firstSession, attemptId: '00000000-0000-4000-8000-000000000006' };
    const client = {
      getCurrentClassroomSession: vi.fn(async () => other),
      joinRoom: vi.fn(async () => firstSession),
      leaveClassroom: vi.fn(),
    };
    const service = new ClassroomSessionService(client);
    service.activate({ ...firstSession, run: { ...firstSession.run, state: 'open', status: 'live' } }, true);
    const restored = await service.restore();
    expect(restored?.attemptId).toBe(other.attemptId);
    expect(restored?.autoOpenConsent).toBe(true);
    expect(service.lessonConsent()).toBe(true);
  });

  it('clears stale local context when the server has no current class', async () => {
    const client = {
      getCurrentClassroomSession: vi.fn(async () => null),
      joinRoom: vi.fn(async () => firstSession),
      leaveClassroom: vi.fn(),
    };
    const service = new ClassroomSessionService(client);
    service.activate(firstSession, true);
    await expect(service.restore()).resolves.toBeNull();
    expect(service.get()).toBeNull();
  });

  it('stops inheriting task context once work is submitted or terminal', () => {
    const service = new ClassroomSessionService({
      getCurrentClassroomSession: vi.fn(),
      joinRoom: vi.fn(),
      leaveClassroom: vi.fn(),
    });
    service.activate({
      ...firstSession,
      attemptState: 'in_progress',
      run: { ...firstSession.run, state: 'open', status: 'live' },
    });
    expect(service.activeStudentAttemptId()).toBe(firstSession.attemptId);
    service.updateAttemptState('submitted');
    expect(service.activeStudentAttemptId()).toBeNull();
    expect(service.get()?.attemptState).toBe('submitted');
  });
});
