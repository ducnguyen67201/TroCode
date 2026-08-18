import { describe, expect, it, vi } from 'vitest';

import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';
import type { TaskRuntime } from '../agent/task-runtime';

import { TaskApplicationService } from './task-application-service';

describe('TaskApplicationService', () => {
  it('reads trusted preferences before submit and resumes interactions', async () => {
    const order: string[] = [];
    const runtime = {
      submit: vi.fn(() => {
        order.push('submit');
        return { taskId: 'task-1' };
      }),
      respondToInteraction: vi.fn(() => ({ taskId: 'task-1' })),
    } as unknown as TaskRuntime;
    const execution = {
      resume: vi.fn(),
      start: vi.fn(() => {
        order.push('start');
        return { taskId: 'task-1', phase: 'planning' };
      }),
    } as unknown as TaskExecutionCoordinator;
    const preferences = {
      get: vi.fn(async () => ({
        approvalMode: 'fully_approved' as const,
        appLanguage: 'en' as const,
        muteSystemAudioWhileSpeaking: false,
        primaryLanguage: 'en' as const,
      })),
    };
    const service = new TaskApplicationService(runtime, execution, preferences);

    await expect(
      service.submitAndStart({ text: 'Do useful work.' }),
    ).resolves.toMatchObject({ phase: 'planning' });
    expect(order).toEqual(['submit', 'start']);
    expect(runtime.submit).toHaveBeenCalledWith(
      { text: 'Do useful work.' },
      'fully_approved',
    );
    service.respond({ taskId: 'task-1' });
    expect(execution.resume).toHaveBeenCalledWith('task-1');
  });

  it('does not start a task when trusted preference loading fails', async () => {
    const runtime = { submit: vi.fn() } as unknown as TaskRuntime;
    const execution = { start: vi.fn() } as unknown as TaskExecutionCoordinator;
    const service = new TaskApplicationService(runtime, execution, {
      get: vi.fn(async () => {
        throw new Error('Preferences unavailable.');
      }),
    });

    await expect(
      service.submitAndStart({ text: 'Do useful work.' }),
    ).rejects.toThrow('Preferences unavailable.');
    expect(runtime.submit).not.toHaveBeenCalled();
    expect(execution.start).not.toHaveBeenCalled();
  });
});
