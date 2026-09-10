import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { LessonLocalState, LessonReport } from '../../shared/classroom-lesson-contracts';

import type { ClassroomLessonClient } from './classroom-lesson-client';
import { ClassroomLessonController, type LessonRunner } from './classroom-lesson-controller';
import type { ClassroomLessonStateStore } from './classroom-lesson-state-store';
import { lessonFixture, lessonStateFixture } from './classroom-lesson.fixture';
import { LessonBlockedError } from './classroom-lesson-errors';

function fixture(mode: 'open' | 'explain' | 'practice' = 'explain') {
  const f = lessonFixture(mode);
  const anchor = randomUUID();
  const states = new Map<string, LessonLocalState>();
  const executionId = randomUUID();
  const client = {
    receipt: vi.fn(async (...args: [string, string, LessonReport]) => { void args; return { ok: true }; }),
    report: vi.fn(async () => ({ ok: true })),
    start: vi.fn(async (_a: string, _l: string, clientStartId: string, clientInstanceId: string) => ({
      executionId,
      lessonId: f.envelope.lessonId,
      planDigest: f.envelope.planDigest,
      userId: 'student',
      anchorAttemptId: anchor,
      targetAttemptId: anchor,
      clientStartId,
      clientInstanceId,
      ownedByThisRequest: true,
    })),
    lookupStart: vi.fn(async () => ({ claim: null })),
    status: vi.fn(async () => ({
      active: true,
      planDigest: f.envelope.planDigest,
      serverTime: new Date().toISOString(),
    })),
    material: vi.fn(async () => ({ resource: f.resource, text: '', chunks: [], nextOrdinal: null })),
    startStep: vi.fn(
      async (
        _e: string,
        stepId: string,
        input: { taskId: string; attemptNumber: number; purpose: 'work' | 'help' | 'check' },
      ) => ({
        executionId,
        stepId,
        taskId: input.taskId,
        attemptNumber: input.attemptNumber,
        purpose: input.purpose,
        workSessionId: randomUUID(),
        ownedByThisRequest: true,
      }),
    ),
    lookupStep: vi.fn(async () => ({ claim: null })),
  };
  const store = {
    readConsent: vi.fn<() => Promise<boolean | null>>(async () => null),
    saveConsent: vi.fn(async (_owner: string, _anchor: string, _enabled: boolean) => { void _owner; void _anchor; void _enabled; }),
    latest: vi.fn<() => Promise<LessonLocalState | null>>(async () => null),
    readLesson: vi.fn(async (_owner: string, id: string) => states.get(id) ?? null),
    saveLesson: vi.fn(async (state: LessonLocalState) => {
      states.set(state.envelope.lessonId, structuredClone(state));
    }),
    close: vi.fn(),
  };
  const runner = {
    busy: vi.fn(() => false),
    reserve: vi.fn(),
    release: vi.fn(),
    prepare: vi.fn(async () => undefined),
    run: vi.fn<LessonRunner['run']>(async () => ({ text: 'Explanation ready', feedback: [], disposition: 'step_finished', modelRequestCount: 1 })),
    cancel: vi.fn(async () => 'confirmed' as const),
  } satisfies LessonRunner;
  const controller = new ClassroomLessonController({
    client: client as unknown as ClassroomLessonClient,
    store: store as unknown as ClassroomLessonStateStore,
    runner,
    owner: async () => 'student',
  });
  return { ...f, anchor, client, store, states, runner, controller };
}
describe('student lesson lifecycle', () => {
  it('retains a legacy unknown status and revokes control consent during restoration', async () => {
    const f = fixture();
    const saved = lessonStateFixture();
    saved.status = 'unknown';
    saved.effect = 'confirmed';
    saved.child = null;
    saved.desktopControlConsent = true;
    f.store.latest.mockResolvedValueOnce(saved);
    await f.controller.activate(f.anchor, true);
    expect(f.controller.view().active).toMatchObject({ status: 'unknown', reasonCode: 'outcome_unknown', desktopControlConsent: false });
    expect(f.runner.prepare).not.toHaveBeenCalled();
    expect(f.runner.run).not.toHaveBeenCalled();
    expect(f.client.startStep).not.toHaveBeenCalled();
  });
  it.each(['dispatching', 'unknown'] as const)('preserves %s when a subsequent typed refusal is reported', async (effect) => {
    const f = fixture();
    f.runner.run.mockImplementationOnce(async (state) => {
      state.effect = effect;
      throw new LessonBlockedError('permission_required', 'Consent changed after dispatch.');
    });
    await f.controller.activate(f.anchor, true);
    await f.controller.receive(f.envelope, true);
    await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('unknown'));
    expect(f.controller.view().active?.effect).toBe(effect);
    expect(f.states.get(f.envelope.lessonId)?.reasonCode).toBe('outcome_unknown');
    await expect(f.controller.continue({ lessonId: f.envelope.lessonId, expectedRevision: f.controller.view().active!.revision, action: 'resume' })).rejects.toThrow();
    expect(f.runner.run).toHaveBeenCalledOnce();
  });
  it('does not return a resource page after access is revoked during retrieval', async () => {
    const f = fixture();
    await f.controller.activate(f.anchor, true);
    await f.controller.receive(f.envelope, true);
    await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('waiting_for_student'));
    f.client.material.mockImplementationOnce(async () => {
      f.client.status.mockResolvedValue({ active: false, planDigest: f.envelope.planDigest, serverTime: new Date().toISOString() });
      return { resource: f.resource, text: 'revoked material', chunks: [], nextOrdinal: null };
    });
    await expect(f.controller.materialPage(f.envelope.lessonId, f.resource.id, 0)).rejects.toThrow('lesson_expired');
  });
  it('does not finish a desktop open step until the agent reports the verified outcome', async () => {
    const { lessonDigest } = await import('./classroom-lesson-policy');
    const f = fixture('open');
    f.plan.schemaVersion = 3;
    f.plan.steps[0]!.surface = { kind: 'resource_app', navigation: 'student' };
    f.envelope.planDigest = lessonDigest(f.plan);
    let complete!: (value: Awaited<ReturnType<LessonRunner['run']>>) => void;
    f.runner.run.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await f.controller.activate(f.anchor, true);
    await f.controller.receive(f.envelope, true);
    await vi.waitFor(() => expect(f.runner.run).toHaveBeenCalledOnce());
    expect(f.runner.prepare).toHaveBeenCalledOnce();
    expect(f.controller.view().active?.status).toBe('running');
    expect(f.client.startStep).toHaveBeenCalledOnce();
    complete({ text: 'Verified the requested document.', feedback: [], disposition: 'step_finished' });
    await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('finished'));
  });
  it('saves an initial join opt-out so restoration cannot replace it with the default', async () => {
    const f = fixture();
    await f.controller.activate(f.anchor, false);
    expect(f.store.saveConsent).toHaveBeenCalledWith('student', f.anchor, false);
    await f.controller.activate(null, false);
    f.store.readConsent.mockResolvedValueOnce(false);
    await f.controller.activate(f.anchor, true);
    expect(f.controller.view().autoRunConsent).toBe(false);
  });
  it('restores an explicit opt-out and saves changes for this account and session', async () => {
    const f = fixture();
    f.store.readConsent.mockResolvedValueOnce(false);
    await f.controller.activate(f.anchor, true);
    expect(f.controller.view().autoRunConsent).toBe(false);
    await f.controller.receive(f.envelope, true);
    expect(f.runner.prepare).not.toHaveBeenCalled();
    await f.controller.setConsent(true);
    expect(f.store.saveConsent).toHaveBeenCalledWith('student', f.anchor, true);
    expect(f.controller.view().autoRunConsent).toBe(true);
  });

  it('gives a help child the previous completed explanation and saves its question and answer', async () => {
    const f = fixture();
    await f.controller.activate(f.anchor, true);
    await f.controller.receive(f.envelope, true);
    await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('waiting_for_student'));
    expect(f.controller.view().active?.history).toMatchObject([{ mode: 'explain', text: 'Explanation ready' }]);
    let priorHistory: unknown;
    f.runner.run.mockImplementationOnce(async (state) => {
      priorHistory = structuredClone(state.history);
      return { text: 'Input returns the typed name.', feedback: [] };
    });
    await f.controller.continue({ lessonId: f.envelope.lessonId, expectedRevision: f.controller.view().active!.revision,
      action: 'question', text: 'What does input return?' });
    await vi.waitFor(() => expect(f.controller.view().active?.history).toHaveLength(2));
    expect(priorHistory).toMatchObject([{ mode: 'explain', text: 'Explanation ready' }]);
    expect(f.states.get(f.envelope.lessonId)?.history[1]).toMatchObject({ mode: 'help', question: 'What does input return?', text: 'Input returns the typed name.' });
  });
  it('blocks a preparation failure without classifying it as an unknown UI action', async () => {
    const f = fixture('open');
    f.runner.prepare.mockRejectedValueOnce(new Error('lesson_surface_unverified'));
    await f.controller.activate(f.anchor, true);
    await f.controller.receive(f.envelope, true);
    await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('blocked'));
    expect(f.runner.run).not.toHaveBeenCalled();
    expect(f.controller.view().active?.effect).toBe('none');
    expect(f.runner.prepare).toHaveBeenCalledOnce();
  });
  it('routes legacy web opening through a claimed shared task and ignores duplicate delivery', async () => {
    const f = fixture('open');
    await f.controller.activate(f.anchor, true);
    await f.controller.receive(f.envelope, true);
    await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('finished'));
    expect(f.runner.prepare).toHaveBeenCalledOnce();
    expect(f.runner.run).toHaveBeenCalledOnce();
    expect(f.client.startStep).toHaveBeenCalledOnce();
    expect(f.controller.view().active?.modelRequestCount).toBe(1);
    expect(f.runner.release).toHaveBeenCalledWith(f.envelope.lessonId);
    await f.controller.receive(f.envelope, true);
    expect(f.runner.prepare).toHaveBeenCalledOnce();
  });
  it('receives an initial snapshot without effects, then starts explicitly', async () => {
    const f = fixture();
    await f.controller.activate(f.anchor, true);
    await f.controller.receive(f.envelope, false);
    expect(f.client.receipt).toHaveBeenCalledOnce();
    expect(f.runner.prepare).not.toHaveBeenCalled();
    await f.controller.continue({ lessonId: f.envelope.lessonId, expectedRevision: 0, action: 'start' });
    await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('waiting_for_student'));
    expect(f.runner.run).toHaveBeenCalledOnce();
    const journal = f.states.get(f.envelope.lessonId)!;
    expect(journal.claim?.executionId).toBeTruthy();
    expect(journal.effect).toBe('confirmed');
    await f.controller.receive(f.envelope, true);
    expect(f.runner.run).toHaveBeenCalledOnce();
  });
  it('auto starts a fresh eligible delta, but a busy student only receives it', async () => {
    const f = fixture();
    await f.controller.activate(f.anchor, true);
    f.runner.busy.mockReturnValue(true);
    await f.controller.receive(f.envelope, true);
    expect(f.runner.run).not.toHaveBeenCalled();
    expect(f.client.receipt.mock.calls[0]![2]).toMatchObject({ status: 'blocked', reasonCode: 'device_busy' });
    const idle = fixture();
    await idle.controller.activate(idle.anchor, true);
    await idle.controller.receive(idle.envelope, true);
    await vi.waitFor(() => expect(idle.runner.run).toHaveBeenCalledOnce());
  });
  it('presents web practice and answers follow-up help in the same task', async () => {
    const f = fixture('practice');
    await f.controller.activate(f.anchor, true);
    await f.controller.receive(f.envelope, true);
    await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('waiting_for_student'));
    expect(f.runner.run).toHaveBeenCalledOnce();
    expect(f.runner.run.mock.calls[0]![1]).toBe('practice');
    await f.controller.continue({
      lessonId: f.envelope.lessonId,
      expectedRevision: f.controller.view().active!.revision,
      action: 'question',
      text: 'Where does the name go?',
    });
    await vi.waitFor(() => expect(f.runner.run).toHaveBeenCalledTimes(2));
    expect(f.runner.run.mock.calls[1]![1]).toBe('help');
    expect(f.client.startStep).toHaveBeenCalledOnce();
    expect(f.client.startStep.mock.calls[0]![2].purpose).toBe('work');
    await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('waiting_for_student'));
    expect(f.controller.view().active?.stepIndex).toBe(0);
  });
  it('persists unknown dispatch and refuses to replay it', async () => {
    const f = fixture();
    f.runner.run.mockImplementationOnce(async (state) => {
      state.effect = 'unknown';
      throw new Error('Lost action receipt');
    });
    await f.controller.activate(f.anchor, true);
    await f.controller.receive(f.envelope, true);
    await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('unknown'));
    const state = f.controller.view().active!;
    await expect(
      f.controller.continue({ lessonId: f.envelope.lessonId, expectedRevision: state.revision, action: 'resume' }),
    ).rejects.toThrow('cannot be resumed');
    expect(f.runner.run).toHaveBeenCalledOnce();
    expect(f.states.get(f.envelope.lessonId)?.status).toBe('unknown');
    expect(f.states.get(f.envelope.lessonId)?.history).toEqual([]);
  });
  it('rejects stale next and revocation before any material effect', async () => {
    const f = fixture();
    f.client.status.mockRejectedValueOnce(new Error('Class closed'));
    await f.controller.activate(f.anchor, true);
    await f.controller.receive(f.envelope, true);
    await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('blocked'));
    expect(f.runner.prepare).not.toHaveBeenCalled();
    await expect(
      f.controller.continue({ lessonId: f.envelope.lessonId, expectedRevision: 0, action: 'next' }),
    ).rejects.toThrow('changed');
  });
});

it('charges measured model requests and returns unused reservations for the next teaching round', async () => {
  const { lessonDigest } = await import('./classroom-lesson-policy');
  const f = fixture();
  f.plan.schemaVersion = 3;
  f.plan.steps[0]!.surface = { kind: 'current_window', navigation: 'student' };
  f.envelope.planDigest = lessonDigest(f.plan);
  f.runner.run.mockResolvedValueOnce({ text: 'First point', feedback: [], disposition: 'continue', modelRequestCount: 4 });
  await f.controller.activate(f.anchor, true);
  await f.controller.receive(f.envelope, true);
  await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('waiting_for_student'));
  expect(f.controller.view().active?.modelRequestCount).toBe(4);
  await expect(f.controller.continue({ lessonId: f.envelope.lessonId, expectedRevision: f.controller.view().active!.revision, action: 'next' })).rejects.toThrow('Continue the explanation');
  f.runner.run.mockResolvedValueOnce({ text: 'Second point', feedback: [], disposition: 'step_finished', modelRequestCount: 4 });
  await f.controller.continue({ lessonId: f.envelope.lessonId, expectedRevision: f.controller.view().active!.revision, action: 'continue_explanation' });
  await vi.waitFor(() => expect(f.controller.view().active?.teachingProgress?.disposition).toBe('step_finished'));
  expect(f.controller.view().active?.stepIndex).toBe(0);
  expect(f.controller.view().active?.modelRequestCount).toBe(8);
  expect(f.client.startStep.mock.calls.map((call) => call[2].attemptNumber)).toEqual([1]);
  expect(f.runner.run.mock.calls[1]![0].child?.taskId ?? f.controller.view().active?.stepTasks[f.plan.steps[0]!.id]?.taskId)
    .toBe(f.client.startStep.mock.calls[0]![2].taskId);
});

it('honors Pause from an older revision of the same active lesson', async () => {
  const f = fixture();
  await f.controller.activate(f.anchor, true);
  await f.controller.receive(f.envelope, true);
  await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('waiting_for_student'));
  await f.controller.continue({ lessonId: f.envelope.lessonId, expectedRevision: 0, action: 'pause' });
  expect(f.controller.view().active?.status).toBe('paused');
  expect(f.controller.view().active?.desktopControlConsent).toBe(false);
});
