import { describe, expect, it } from 'vitest';

import { TaskInteractionBroker } from './task-interaction-broker';

describe('TaskInteractionBroker', () => {
  it('releases only the exact task and interaction kind', async () => {
    const broker = new TaskInteractionBroker();
    const controller = new AbortController();
    const waiting = broker.wait('task-1', 'approval', controller.signal);

    expect(() => broker.release('task-1', 'input')).toThrow('not waiting');
    expect(broker.has('task-1', 'approval')).toBe(true);
    broker.release('task-1', 'approval');
    await expect(waiting).resolves.toBeUndefined();
  });

  it('rejects a pending wait immediately on cancellation', async () => {
    const broker = new TaskInteractionBroker();
    const controller = new AbortController();
    const waiting = broker.wait('task-1', 'input', controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });
});
