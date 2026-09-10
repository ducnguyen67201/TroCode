import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { ResolvedToolInvocation, ToolExecutionResult } from '../agent/agent-contracts';
import { AsyncOperationTracker, type AsyncOperation } from '../agent/async-operation-tracker';

import { ClassroomDesktopTeachingTools } from './classroom-desktop-teaching-tools';
import { desktopLessonFixture } from './classroom-desktop-teaching.fixture';
import { LessonBlockedError } from './classroom-lesson-errors';
import type { ClassroomLessonSurfaceService } from './classroom-lesson-surface-service';
import { ClassroomLessonToolPolicy } from './classroom-lesson-tool-policy';

describe('pending opening through the shared lesson loop', () => {
  it('observes and selects a viewer while opening awaits input, then verifies and explains', async () => {
    const f = desktopLessonFixture();
    const taskId = randomUUID();
    const tracker = new AsyncOperationTracker();
    let record: AsyncOperation | null = null;
    const storage = { read: async () => record, save: async (value: AsyncOperation) => { record = { ...value }; } };
    let completeOpening!: (result: string) => void;
    let visible = false;
    const nativeOpen = vi.fn(() => new Promise<string>((resolve) => { completeOpening = resolve; }));
    const chooser = { ...f.observation, fingerprint: 'b'.repeat(64), text: 'Choose a viewer',
      surface: { ...f.observation.surface!, title: 'Application chooser' },
      elements: [{ ref: 'e1', role: 'button', name: 'Installed viewer' }] };
    const surfaces = {
      observe: async () => { if (!visible) throw new LessonBlockedError('surface_unverified', 'Document is not visible'); return f.observation; },
      inspectMaterial: async () => visible ? { ready: true, observation: f.observation }
        : { ready: false, observation: chooser, error: new LessonBlockedError('surface_unverified', 'Document is not visible') },
    } as unknown as ClassroomLessonSurfaceService;
    const presentSequence = vi.fn(async () => ({ outcome: 'presented' as const }));
    const tools = new ClassroomDesktopTeachingTools({
      surfaces, presenter: { presentSequence, cancelGuidance: vi.fn() },
      authorize: async () => undefined, consume: async () => undefined,
      markEffect: async (effect) => { f.state.effect = effect; },
      resourceOperation: () => tracker.read('resource', storage),
      openResource: async () => ({ status: 'confirmed', summary: 'Opening requested',
        data: { operation: await tracker.start('resource', storage, async () => undefined, nativeOpen) } }),
    });
    tools.register(taskId, f.state);
    const policy = new ClassroomLessonToolPolicy();
    policy.registerDesktop(taskId, tools.guard(taskId));
    const call = (name: string, input: unknown) => {
      const invocation: ResolvedToolInvocation = { toolId: `classroom.teaching-${name}`, operation: name, modelName: `lesson_${name}`, callId: randomUUID(), kind: 'direct', input };
      return policy.dispatch(taskId, invocation, () => tools.adapters().find((adapter) => adapter.id === invocation.toolId)!.execute(invocation, { taskId, signal: new AbortController().signal }));
    };
    await call('context', {});
    expect(await call('open', { handle: f.resource.id })).toMatchObject({ data: { operation: { status: 'pending' } } });
    expect((await call('observe', {})).status).toBe('not_executed');
    const copy = { hook: 'Look.', instruction: 'Read print.', reason: 'It displays output.', expectedOutcome: 'Understand output.' };
    expect((await call('present', { observationId: chooser.observationId, fingerprint: chooser.fingerprint, ref: 'e1', x: null, y: null, copy })).status).toBe('denied');
    expect(presentSequence).not.toHaveBeenCalled();
    const control: ResolvedToolInvocation = {
      toolId: 'computer.control', modelName: 'control_surface', operation: 'click_element', kind: 'surface', callId: randomUUID(),
      input: { observationId: chooser.observationId, observationFingerprint: chooser.fingerprint, command: { kind: 'click_element', ref: 'e1', button: 'left', count: 1 } },
    };
    const click = vi.fn(async (): Promise<ToolExecutionResult> => {
      visible = true;
      completeOpening('');
      return { status: 'confirmed', summary: 'Viewer selected', observation: f.observation };
    });
    expect((await policy.dispatch(taskId, control, click)).status).toBe('confirmed');
    expect(click).toHaveBeenCalledOnce();
    await vi.waitFor(async () => expect((await tracker.read('resource', storage))?.status).toBe('completed'));
    expect((await call('observe', {})).status).toBe('confirmed');
    const evidence = { observationId: f.observation.observationId, fingerprint: f.observation.fingerprint };
    expect((await call('present', { ...evidence, ref: 'e1', x: null, y: null, copy })).status).toBe('confirmed');
    expect((await call('finish', { ...evidence, disposition: 'step_finished', recap: 'Explained print.' })).status).toBe('confirmed');
    expect(nativeOpen).toHaveBeenCalledOnce();
    expect(presentSequence).toHaveBeenCalledOnce();
    expect(policy.uncertain(taskId)).toBe(false);
    expect(policy.isComplete(taskId)).toBe(true);
  });
});
