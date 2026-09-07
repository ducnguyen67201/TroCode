import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { ResolvedToolInvocation } from '../agent/agent-contracts';
import type { DesktopObservation } from '../agent/execution-contracts';

import { ClassroomLessonToolPolicy, lessonToolAllowed, verifyLessonSurface } from './classroom-lesson-tool-policy';

function fixture(value = '') {
  const task = randomUUID();
  const policy = new ClassroomLessonToolPolicy();
  const consume = vi.fn();
  const scope = {
    lessonId: randomUUID(),
    stepId: randomUUID(),
    resourceUrl: 'https://example.com/editor',
    origin: 'https://example.com',
  };
  const observation: DesktopObservation = {
    observationId: randomUUID(),
    taskId: task,
    capturedAt: new Date().toISOString(),
    text: '',
    route: 'browser_semantic',
    degraded: false,
    fingerprint: 'a'.repeat(64),
    surface: { kind: 'browser', application: 'Google Chrome', url: scope.resourceUrl },
    elements: [
      { ref: 'e1', role: 'textbox', name: 'Code', value },
      { ref: 'e2', role: 'button', name: 'Submit assignment' },
    ],
  };
  policy.register(task, scope, vi.fn(), consume);
  policy.observeResult(task, { status: 'confirmed', summary: 'Observed', observation });
  const call: ResolvedToolInvocation = {
    callId: randomUUID(),
    modelName: 'control_surface',
    toolId: 'computer.control',
    operation: 'type_text',
    kind: 'surface',
    input: {
      observationId: observation.observationId,
      command: { kind: 'type_text', ref: 'e1', text: 'print("hello")', replace: true },
    },
  };
  return { task, scope, policy, observation, call, consume };
}
describe('trusted lesson effect boundary', () => {
  it('filters general capabilities out of the demo catalog', () => {
    const f = fixture();
    for (const tool of ['terminal.exec', 'cua.click', 'desktop.control', 'classroom.broadcast', 'browser.navigate'])
      expect(lessonToolAllowed(tool, f.scope)).toBe(false);
    expect(lessonToolAllowed('computer.control', f.scope)).toBe(true);
    expect(lessonToolAllowed('terminal.exec')).toBe(true);
  });
  it('blocks unrelated app, path and existing work before effects', async () => {
    const f = fixture('student_work = 42');
    await expect(f.policy.before(f.task, f.call, true)).rejects.toThrow('existing_work');
    expect(f.consume).not.toHaveBeenCalled();
    expect(() =>
      verifyLessonSurface(
        { ...f.observation, surface: { ...f.observation.surface!, url: 'https://example.com/account' } },
        f.scope,
      ),
    ).toThrow();
    expect(() =>
      verifyLessonSurface(
        { ...f.observation, surface: { ...f.observation.surface!, application: 'Another app' } },
        f.scope,
      ),
    ).toThrow();
  });
  it('requires fresh result observation and never retries an unknown effect', async () => {
    const f = fixture();
    await f.policy.before(f.task, f.call, true);
    expect(f.consume).toHaveBeenCalledOnce();
    await expect(f.policy.before(f.task, f.call, true)).rejects.toThrow('Observe');
    f.policy.observeResult(f.task, { status: 'unknown', summary: 'Lost receipt', observation: f.observation });
    await expect(f.policy.before(f.task, f.call, true)).rejects.toThrow('outcome_unknown');
  });
  it('rejects submission controls and ungrounded completion', async () => {
    const f = fixture();
    f.call.input = {
      observationId: f.observation.observationId,
      command: { kind: 'click_element', ref: 'e2', count: 1, button: 'left' },
    };
    await expect(f.policy.before(f.task, f.call, true)).rejects.toThrow('denied');
    expect(() => f.policy.complete(f.task, randomUUID(), f.observation.fingerprint)).toThrow();
  });
});

describe('lesson cancellation races', () => {
  it('rejects late tools after removing a child policy', async () => {
    const f = fixture();
    f.policy.remove(f.task);
    await expect(f.policy.before(f.task, f.call, true)).rejects.toThrow('access_changed');
    expect(f.consume).not.toHaveBeenCalled();
  });
  it('rechecks revocation after an asynchronous authority lookup', async () => {
    const f = fixture();
    const policy = new ClassroomLessonToolPolicy();
    let release!: () => void;
    policy.register(
      f.task,
      f.scope,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      f.consume,
    );
    policy.observeResult(f.task, { status: 'confirmed', summary: 'Observed', observation: f.observation });
    const pending = policy.before(f.task, f.call, true);
    policy.remove(f.task);
    release();
    await expect(pending).rejects.toThrow('access_changed');
    expect(f.consume).not.toHaveBeenCalled();
  });
});

it('distinguishes a known refusal from an input with an uncertain result', async () => {
  const blocked = fixture('existing student code');
  await expect(blocked.policy.before(blocked.task, blocked.call, true)).rejects.toThrow('existing_work');
  expect(blocked.policy.knownBlock(blocked.task)).toBe('existing_work');
  const dispatched = fixture();
  await dispatched.policy.before(dispatched.task, dispatched.call, true);
  expect(dispatched.policy.knownBlock(dispatched.task)).toBeNull();
});
