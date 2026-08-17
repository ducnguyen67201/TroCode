import { describe, expect, it, vi } from 'vitest';

import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';
import type { TaskRuntime } from '../agent/task-runtime';

import { TaskApplicationService } from './task-application-service';

describe('TaskApplicationService', () => {
  it('owns submit-before-start ordering and resumes interactions', () => {
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
    const service = new TaskApplicationService(runtime, execution);

    expect(service.submitAndStart({ text: 'Do useful work.' })).toMatchObject({
      phase: 'planning',
    });
    expect(order).toEqual(['submit', 'start']);
    service.respond({ taskId: 'task-1' });
    expect(execution.resume).toHaveBeenCalledWith('task-1');
  });
});
