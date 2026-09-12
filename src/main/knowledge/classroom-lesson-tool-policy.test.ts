import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { ResolvedToolInvocation } from '../agent/agent-contracts';

import { lessonToolDefinitions } from './classroom-lesson-agent-tools';
import { ClassroomLessonToolPolicy } from './classroom-lesson-tool-policy';

function fixture() {
  const policy = new ClassroomLessonToolPolicy();
  const taskId = randomUUID();
  const call: ResolvedToolInvocation = { callId: randomUUID(), modelName: 'observe_context', toolId: 'computer.observe', operation: 'observe', kind: 'surface', input: {} };
  const guard = { before: vi.fn<() => Promise<void>>(async () => undefined), observeResult: vi.fn(async () => undefined), uncertain: vi.fn(() => false), complete: vi.fn(() => false), failure: vi.fn(() => null) };
  policy.registerDesktop(taskId, guard);
  const execute = vi.fn(async () => ({ status: 'confirmed' as const, summary: 'Observed' }));
  return { policy, taskId, call, guard, execute };
}

describe('shared lesson dispatch policy', () => {
  it('identifies a guard failure before dispatch without executing or swallowing it', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const f = fixture();
      const error = new Error('Observe the current screen before acting.');
      f.guard.before.mockRejectedValueOnce(error);
      await expect(f.policy.dispatch(f.taskId, f.call, f.execute)).rejects.toBe(error);
      expect(f.execute).not.toHaveBeenCalled();
      const entry = log.mock.calls.find(([prefix, line]) => prefix === '[execution]' && JSON.parse(String(line)).event === 'lesson.guard_denied');
      expect(JSON.parse(String(entry?.[1]))).toMatchObject({ taskId: f.taskId, callId: f.call.callId, phase: 'dispatch', error: 'Error: Observe the current screen before acting.' });
    } finally { log.mockRestore(); }
  });
  it('advertises one student tool path and removes the old browser completion tool', () => {
    expect(lessonToolDefinitions().some((tool) => tool.modelName === 'complete_lesson_step')).toBe(false);
  });
  it('dispatches through the guard, awaits its receipt and rejects late calls after revocation', async () => {
    const f = fixture();
    await f.policy.dispatch(f.taskId, f.call, f.execute);
    expect(f.guard.before).toHaveBeenCalledWith(f.call, true);
    expect(f.guard.observeResult).toHaveBeenCalledWith({ status: 'confirmed', summary: 'Observed' });
    f.policy.remove(f.taskId);
    await expect(f.policy.dispatch(f.taskId, f.call, f.execute)).rejects.toThrow('access_changed');
    expect(f.execute).toHaveBeenCalledOnce();
  });
  it('rechecks revocation after asynchronous authorization before dispatching', async () => {
    const f = fixture();
    let release!: () => void;
    f.guard.before.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const pending = f.policy.before(f.taskId, f.call, true);
    f.policy.remove(f.taskId);
    release();
    await expect(pending).rejects.toThrow('access_changed');
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('serializes actions and denies a queued action when the task is removed', async () => {
    const f = fixture();
    let release!: () => void;
    f.execute.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ status: 'confirmed', summary: 'Observed' }); }));
    const first = f.policy.dispatch(f.taskId, f.call, f.execute);
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledOnce());
    const second = f.policy.dispatch(f.taskId, f.call, f.execute);
    const rejected = expect(second).rejects.toThrow('access_changed');
    f.policy.remove(f.taskId);
    expect(() => f.policy.registerDesktop(f.taskId, f.guard)).toThrow('already registered');
    release();
    await first;
    await rejected;
    expect(f.execute).toHaveBeenCalledOnce();
    f.policy.registerDesktop(f.taskId, f.guard);
    await f.policy.dispatch(f.taskId, f.call, f.execute);
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
});
