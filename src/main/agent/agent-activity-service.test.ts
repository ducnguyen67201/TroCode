import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentActivityUpdateSchema } from '../../shared/contracts';

import { AgentActivityService } from './agent-activity-service';

describe('AgentActivityService', () => {
  afterEach(() => vi.useRealTimers());

  it('publishes bounded, monotonic, ephemeral task activity', () => {
    vi.useFakeTimers();
    const service = new AgentActivityService();
    const listener = vi.fn();
    const taskId = randomUUID();
    service.on('activity', listener);

    const first = service.publish(taskId, {
      kind: 'run_started',
      summary: 'Agent started.',
    });
    const second = service.publish(taskId, {
      kind: 'text_delta',
      textDelta: 'Hello',
    });

    expect(first?.sequence).toBe(0);
    expect(second).toBeNull();
    vi.advanceTimersByTime(75);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1]?.[0]).toMatchObject({
      kind: 'text_delta',
      sequence: 1,
      textDelta: 'Hello',
    });
  });

  it('coalesces provider text into bounded IPC chunks and caps the task draft', () => {
    vi.useFakeTimers();
    const service = new AgentActivityService();
    const listener = vi.fn();
    const taskId = randomUUID();
    service.on('activity', listener);

    service.publish(taskId, {
      kind: 'text_delta',
      textDelta: 'x'.repeat(10_000),
    });
    service.publish(taskId, { kind: 'text_delta', textDelta: 'ignored' });
    vi.advanceTimersByTime(75);

    expect(listener).toHaveBeenCalledTimes(4);
    const activities = listener.mock.calls.map(([activity]) =>
      AgentActivityUpdateSchema.parse(activity),
    );
    expect(
      activities.reduce(
        (total, activity) => total + (activity.textDelta?.length ?? 0),
        0,
      ),
    ).toBe(8_000);
    expect(
      activities.every((activity) => (activity.textDelta?.length ?? 0) <= 2_000),
    ).toBe(true);
  });
});
