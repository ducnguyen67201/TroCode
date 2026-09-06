import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  BroadcastNotice,
  GuidanceClaim,
  GuidanceStartRequest,
  LocalGuidanceStartJournal,
} from '../../shared/contracts';
import type { EncryptedAgentStateStore } from '../agent-runtime/encrypted-agent-state-store';
import type { TaskApplicationService } from '../application/task-application-service';

import { ActivityContextService } from './activity-context-service';
import type { ClassroomBroadcastService } from './classroom-broadcast-service';
import { classroomFixture } from './classroom-broadcast.fixture';
import { ClassroomGuidanceCoordinator } from './classroom-guidance-coordinator';
import type { KnowledgeSpaceClient } from './knowledge-space-client';

afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const f = classroomFixture();
  const journals = new Map<string, LocalGuidanceStartJournal>();
  let reserved = false;
  const tasks = {
    isDeviceBusy: () => reserved,
    reserveClassroomExplanation: vi.fn(() => {
      if (reserved) throw new Error('busy');
      reserved = true;
    }),
    releaseReservation: vi.fn(() => {
      reserved = false;
    }),
    submitClassroomExplanation: vi.fn(async () => {
      reserved = false;
      return {};
    }),
    cancel: vi.fn(async () => undefined),
    finish: vi.fn(),
  };
  const client = {
    capabilities: async () => ({
      knowledgeSpaces: { enabled: true, contractVersion: 2 },
      classroomGuidance: { contractVersion: 1 },
    }),
    getAttempt: vi.fn(async () => f.attempt),
    claimClassroomGuidance: vi.fn(
      async (
        _anchor: string,
        _broadcast: string,
        input: GuidanceStartRequest,
      ): Promise<GuidanceClaim> => ({
        id: randomUUID(),
        broadcastId: f.broadcast.id,
        sessionId: f.binding.sessionId,
        anchorAttemptId: f.session.attemptId,
        attemptId: f.attempt.attemptId,
        activityVersionId: f.attempt.activityVersionId,
        workSessionId: randomUUID(),
        taskId: input.taskId,
        clientStartId: input.clientStartId,
        clientInstanceId: input.clientInstanceId,
        contextMode: input.contextMode,
        status: 'accepted',
        revision: 0,
        createdAt: new Date().toISOString(),
        ownedByThisRequest: true,
      }),
    ),
    lookupClassroomGuidance: vi.fn(async () => ({ claim: null })),
    reportClassroomGuidance: vi.fn(async () => {
      throw new Error('offline');
    }),
  };
  const store = {
    readGuidanceJournal: async (_owner: string, id: string) =>
      journals.get(id) ?? null,
    writeGuidanceJournal: vi.fn(async (journal: LocalGuidanceStartJournal) => {
      journals.set(journal.broadcastId, structuredClone(journal));
    }),
  };
  const feedEvents = new EventEmitter();
  let notice: BroadcastNotice | null = {
    sessionId: f.binding.sessionId,
    anchorAttemptId: f.session.attemptId,
    revision: 1,
    broadcast: null,
    offline: false,
  };
  const publishNotice = (next: BroadcastNotice | null) => {
    notice = next;
    feedEvents.emit('change', next);
  };
  const broadcasts = {
    retain: vi.fn(),
    release: vi.fn(),
    trusted: () => ({ anchor: f.session.attemptId, broadcast: f.broadcast }),
    get: () => notice,
    onChange: (listener: Parameters<ClassroomBroadcastService['onChange']>[0]) => {
      feedEvents.on('change', listener);
      return () => { feedEvents.off('change', listener); };
    },
    onBroadcast: (listener: Parameters<ClassroomBroadcastService['onBroadcast']>[0]) => {
      feedEvents.on('broadcast', listener);
      return () => { feedEvents.off('broadcast', listener); };
    },
    openAssignment: async () => ({ attemptId: f.attempt.attemptId }),
  };
  const onExplanationText = vi.fn();
  const coordinator = new ClassroomGuidanceCoordinator({
    broadcasts: broadcasts as unknown as ClassroomBroadcastService,
    client: client as unknown as KnowledgeSpaceClient,
    tasks: tasks as unknown as TaskApplicationService,
    activity: new ActivityContextService(
      client as unknown as KnowledgeSpaceClient,
    ),
    store: store as unknown as EncryptedAgentStateStore,
    owner: async () => 'student',
    screenPermitted: async () => false,
    language: async () => 'vi',
    onExplanationText,
  });
  return { ...f, journals, tasks, client, coordinator, broadcasts, onExplanationText, store, feedEvents, publishNotice };
}
describe('independent student explanation starts', () => {
  it('enables new explanations by default but waits for a fresh live broadcast', async () => {
    const f = fixture();
    f.coordinator.start();
    f.publishNotice(f.broadcasts.get());
    expect(f.coordinator.get().consent).toEqual({
      sessionId: f.binding.sessionId, enabled: true, contextMode: 'screen_if_permitted',
    });
    f.feedEvents.emit('broadcast', f.broadcast, 'initial_snapshot');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.tasks.submitClassroomExplanation).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    f.broadcast.createdAt = new Date().toISOString();
    f.feedEvents.emit('broadcast', f.broadcast, 'live_delta');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.tasks.submitClassroomExplanation).toHaveBeenCalledOnce();
    // Auto-start does not grant screen permissions.
    expect(f.tasks.submitClassroomExplanation).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ contextMode: 'text_only' }),
    );
    await f.coordinator.shutdown();
  });

  it.each(['opted_out', 'busy'] as const)('does not auto-start while %s or reset an opt-out on feed updates', async (reason) => {
    const f = fixture();
    f.coordinator.start();
    f.publishNotice(f.broadcasts.get());
    if (reason === 'opted_out') {
      f.coordinator.setConsent({ sessionId: f.binding.sessionId, enabled: false, contextMode: 'screen_if_permitted' });
    } else {
      f.tasks.reserveClassroomExplanation();
    }
    await vi.advanceTimersByTimeAsync(1);
    f.broadcast.createdAt = new Date().toISOString();
    f.publishNotice({ ...f.broadcasts.get()!, revision: 2, broadcast: f.broadcast });
    f.feedEvents.emit('broadcast', f.broadcast, 'live_delta');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.tasks.submitClassroomExplanation).not.toHaveBeenCalled();
    if (reason === 'opted_out') expect(f.coordinator.get().consent?.enabled).toBe(false);
    await f.coordinator.shutdown();
  });

  it('does not arm an expiry timer after completion during the final start write', async () => {
    const f = fixture();
    const original = f.store.writeGuidanceJournal.getMockImplementation()!;
    let completed = false;
    f.store.writeGuidanceJournal.mockImplementation(async (journal) => {
      await original(journal);
      if (journal.phase === 'running' && !completed) {
        completed = true;
        await f.coordinator.onTerminal(journal.request.taskId, { status: 'completed', finalOutput: 'Explanation finished.', message: 'Finished.' });
      }
    });
    await f.coordinator.startExplanation({ broadcastId: f.broadcast.id, contextMode: 'text_only' });
    expect(f.coordinator.get().active?.phase).toBe('finished');
    await vi.advanceTimersByTimeAsync(600_001);
    expect(f.coordinator.get().active?.phase).toBe('finished');
    expect(f.tasks.cancel).not.toHaveBeenCalled();
  });
  it('writes before claiming, uses text when permission is absent, and never creates a Help request', async () => {
    const f = fixture();
    await f.coordinator.startExplanation({
      broadcastId: f.broadcast.id,
      contextMode: 'screen_if_permitted',
    });
    expect(f.client.claimClassroomGuidance).toHaveBeenCalledOnce();
    expect(f.tasks.submitClassroomExplanation).toHaveBeenCalledOnce();
    const args = f.tasks.submitClassroomExplanation.mock
      .calls[0] as unknown as [
      unknown,
      LocalGuidanceStartJournal,
      { contextMode: string; language: string },
    ];
    expect(args[1].claim?.attemptId).toBe(f.attempt.attemptId);
    expect(args[2]).toMatchObject({ contextMode: 'text_only', language: 'vi' });
    expect(f.coordinator.get().active?.taskId).toBe(args[1].request.taskId);
    await f.coordinator.startExplanation({
      broadcastId: f.broadcast.id,
      contextMode: 'text_only',
    });
    expect(f.tasks.submitClassroomExplanation).toHaveBeenCalledOnce();
  });
  it('keeps an unknown claim durable and does not retry it', async () => {
    const f = fixture();
    f.client.claimClassroomGuidance.mockRejectedValueOnce(
      new Error('connection lost'),
    );
    await expect(
      f.coordinator.startExplanation({
        broadcastId: f.broadcast.id,
        contextMode: 'text_only',
      }),
    ).rejects.toThrow('connection lost');
    expect(f.journals.get(f.broadcast.id)?.phase).toBe('unknown');
    await f.coordinator.startExplanation({
      broadcastId: f.broadcast.id,
      contextMode: 'text_only',
    });
    expect(f.client.claimClassroomGuidance).toHaveBeenCalledOnce();
    expect(f.tasks.submitClassroomExplanation).not.toHaveBeenCalled();
    expect(f.tasks.releaseReservation).toHaveBeenCalled();
  });
  it('does not start on a second device or preempt a busy student', async () => {
    const f = fixture();
    const claim = await f.client.claimClassroomGuidance('', '', {
      clientStartId: randomUUID(),
      taskId: randomUUID(),
      clientInstanceId: randomUUID(),
      contextMode: 'text_only',
    });
    f.client.claimClassroomGuidance.mockResolvedValueOnce({
      ...claim,
      ownedByThisRequest: false,
    });
    await expect(
      f.coordinator.startExplanation({
        broadcastId: f.broadcast.id,
        contextMode: 'text_only',
      }),
    ).rejects.toThrow('another device');
    expect(f.tasks.submitClassroomExplanation).not.toHaveBeenCalled();
    expect(f.tasks.cancel).not.toHaveBeenCalled();
    const busy = fixture();
    busy.tasks.reserveClassroomExplanation.mockImplementation(() => {
      throw new Error('busy');
    });
    await expect(
      busy.coordinator.startExplanation({
        broadcastId: busy.broadcast.id,
        contextMode: 'text_only',
      }),
    ).rejects.toThrow('busy');
    expect(busy.client.claimClassroomGuidance).not.toHaveBeenCalled();
  });
  it('matches continuation id and revision exactly and rejects duplicates', async () => {
    const f = fixture();
    await f.coordinator.startExplanation({
      broadcastId: f.broadcast.id,
      contextMode: 'text_only',
    });
    const active = f.coordinator.get().active!;
    const pending = f.coordinator.awaitContinuation(
      active.taskId,
      'A loop repeats.',
      new AbortController().signal,
    );
    await vi.waitFor(() =>
      expect(f.coordinator.get().active?.phase).toBe('waiting'),
    );
    expect(f.journals.get(f.broadcast.id)?.lastText).toBe('A loop repeats.');
    expect(f.onExplanationText).toHaveBeenCalledWith(active.taskId, 'A loop repeats.');
    // Clicking the same notice again must preserve the live continuation.
    await f.coordinator.startExplanation({ broadcastId: f.broadcast.id, contextMode: 'text_only' });
    expect(f.coordinator.get().active?.phase).toBe('waiting');
    const step = f.coordinator.get().active!;
    expect(() =>
      f.coordinator.continue({
        guidanceId: step.guidanceId,
        stepRevision: step.stepRevision + 1,
        action: 'next',
        text: null,
      }),
    ).toThrow('changed');
    const input = {
      guidanceId: step.guidanceId,
      stepRevision: step.stepRevision,
      action: 'next' as const,
      text: null,
    };
    f.coordinator.continue(input);
    expect((await pending).action).toBe('next');
    expect(() => f.coordinator.continue(input)).toThrow('changed');
  });

  it('does not dispatch or restore a stale active card when the session changes during claim', async () => {
    const f = fixture();
    const original = f.client.claimClassroomGuidance.getMockImplementation()!;
    let release!: () => void;
    f.client.claimClassroomGuidance.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return original(...args);
    });
    const start = f.coordinator.startExplanation({ broadcastId: f.broadcast.id, contextMode: 'text_only' });
    const rejected = expect(start).rejects.toThrow('session changed');
    await vi.waitFor(() => expect(f.client.claimClassroomGuidance).toHaveBeenCalled());
    await f.coordinator.invalidate();
    release();
    await rejected;
    expect(f.tasks.submitClassroomExplanation).not.toHaveBeenCalled();
    expect(f.coordinator.get().active).toBeNull();
    expect(f.tasks.releaseReservation).toHaveBeenCalled();
  });

  it('accepts a synchronous continuation from a waiting subscriber', async () => {
    const f = fixture();
    await f.coordinator.startExplanation({ broadcastId: f.broadcast.id, contextMode: 'text_only' });
    const taskId = f.coordinator.get().active!.taskId;
    f.coordinator.onChange((state) => {
      if (state.active?.phase === 'waiting')
        f.coordinator.continue({ guidanceId: state.active.guidanceId, stepRevision: state.active.stepRevision, action: 'next', text: null });
    });
    await expect(f.coordinator.awaitContinuation(taskId, 'Next step.', new AbortController().signal)).resolves.toMatchObject({ action: 'next' });
  });

  it('persists bounded unique model identities before dispatch', async () => {
    const f = fixture();
    await f.coordinator.startExplanation({ broadcastId: f.broadcast.id, contextMode: 'text_only' });
    const taskId = f.coordinator.get().active!.taskId;
    const requestIds = Array.from({ length: 8 }, () => randomUUID());
    for (const id of requestIds) await f.coordinator.consume(taskId, 'model', id);
    expect(f.journals.get(f.broadcast.id)).toMatchObject({ modelRequests: 8, modelRequestIds: requestIds });
    await expect(f.coordinator.consume(taskId, 'model', requestIds[0])).rejects.toThrow('new durable identity');
    await expect(f.coordinator.consume(taskId, 'model', randomUUID())).rejects.toThrow('limit');
    expect(f.journals.get(f.broadcast.id)?.modelRequests).toBe(8);
  });
});
