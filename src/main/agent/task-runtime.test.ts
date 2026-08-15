import { describe, expect, it, vi } from 'vitest';

import { TaskRuntime } from './task-runtime';

describe('task runtime', () => {
  it('emits typed lifecycle events while compiling a goal', () => {
    const runtime = new TaskRuntime();
    const listener = vi.fn();
    runtime.on('task-event', listener);

    const snapshot = runtime.submit({ text: 'Open YouTube for me' });

    expect(snapshot.phase).toBe('ready');
    expect(snapshot.goal?.interactionMode).toBe('act');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops at clarification for an ambiguous request', () => {
    const runtime = new TaskRuntime();
    const snapshot = runtime.submit({ text: 'help' });

    expect(snapshot.phase).toBe('clarifying');
    expect(snapshot.goal).toBeNull();
  });

  it('cancels a non-terminal task', () => {
    const runtime = new TaskRuntime();
    const submitted = runtime.submit({ text: 'Open YouTube for me' });
    const cancelled = runtime.cancel({ taskId: submitted.taskId });

    expect(cancelled.phase).toBe('cancelled');
  });
});
