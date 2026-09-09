import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { LessonLocalState, LessonReport } from '../../shared/classroom-lesson-contracts';

import type { ClassroomLessonClient } from './classroom-lesson-client';
import { ClassroomLessonController, type LessonRunner } from './classroom-lesson-controller';
import type { ClassroomLessonStateStore } from './classroom-lesson-state-store';
import { lessonFixture } from './classroom-lesson.fixture';

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
    latest: vi.fn(async () => null),
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
    run: vi.fn<LessonRunner['run']>(async () => ({ text: 'Explanation ready', feedback: [] })),
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
  it('does not mark an open-only lesson finished when the surface could not be verified', async () => {
    const f = fixture('open');
    f.runner.prepare.mockRejectedValueOnce(new Error('lesson_surface_unverified'));
    await f.controller.activate(f.anchor, true);
    await f.controller.receive(f.envelope, true);
    await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('unknown'));
    expect(f.runner.run).not.toHaveBeenCalled();
    await expect(f.controller.continue({ lessonId: f.envelope.lessonId, expectedRevision: f.controller.view().active!.revision, action: 'resume' })).rejects.toThrow();
    expect(f.runner.prepare).toHaveBeenCalledOnce();
  });
  it('opens the material, verifies it and finishes without a model or exercise task', async () => {
    const f = fixture('open');
    await f.controller.activate(f.anchor, true);
    await f.controller.receive(f.envelope, true);
    await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('finished'));
    expect(f.runner.prepare).toHaveBeenCalledOnce();
    expect(f.runner.run).not.toHaveBeenCalled();
    expect(f.client.startStep).not.toHaveBeenCalled();
    expect(f.controller.view().active?.modelRequestCount).toBe(0);
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
  it('leaves practice to the student and routes help to a read-only child', async () => {
    const f = fixture('practice');
    await f.controller.activate(f.anchor, true);
    await f.controller.receive(f.envelope, true);
    await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('waiting_for_student'));
    expect(f.runner.run).not.toHaveBeenCalled();
    await f.controller.continue({
      lessonId: f.envelope.lessonId,
      expectedRevision: f.controller.view().active!.revision,
      action: 'question',
      text: 'Where does the name go?',
    });
    await vi.waitFor(() => expect(f.runner.run).toHaveBeenCalledOnce());
    expect(f.runner.run.mock.calls[0]![1]).toBe('help');
    expect(f.client.startStep.mock.calls[0]![2].purpose).toBe('help');
    await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('waiting_for_student'));
    expect(f.controller.view().active?.stepIndex).toBe(0);
  });
  it('persists unknown dispatch and refuses to replay it', async () => {
    const f = fixture();
    f.runner.run.mockRejectedValueOnce(new Error('Lost action receipt'));
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

it('continues a v3 explanation on the same step with cumulative model reservations', async () => {
  const { lessonDigest } = await import('./classroom-lesson-policy');
  const f = fixture();
  f.plan.schemaVersion = 3;
  f.plan.steps[0]!.surface = { kind: 'current_window', navigation: 'student' };
  f.envelope.planDigest = lessonDigest(f.plan);
  f.runner.run.mockResolvedValueOnce({ text: 'First point', feedback: [], disposition: 'continue' });
  await f.controller.activate(f.anchor, true);
  await f.controller.receive(f.envelope, true);
  await vi.waitFor(() => expect(f.controller.view().active?.status).toBe('waiting_for_student'));
  expect(f.controller.view().active?.modelRequestCount).toBe(4);
  await expect(f.controller.continue({ lessonId: f.envelope.lessonId, expectedRevision: f.controller.view().active!.revision, action: 'next' })).rejects.toThrow('Continue the explanation');
  f.runner.run.mockResolvedValueOnce({ text: 'Second point', feedback: [], disposition: 'step_finished' });
  await f.controller.continue({ lessonId: f.envelope.lessonId, expectedRevision: f.controller.view().active!.revision, action: 'continue_explanation' });
  await vi.waitFor(() => expect(f.controller.view().active?.teachingProgress?.disposition).toBe('step_finished'));
  expect(f.controller.view().active?.stepIndex).toBe(0);
  expect(f.controller.view().active?.modelRequestCount).toBe(8);
  expect(f.client.startStep.mock.calls.map((call) => call[2].attemptNumber)).toEqual([1, 2]);
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
