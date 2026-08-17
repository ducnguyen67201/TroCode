import { describe, expect, it, vi } from 'vitest';

import type { ResolvedToolInvocation } from './agent-contracts';
import { RuntimeToolDispatcher } from './runtime-tool-dispatcher';

const invocation: ResolvedToolInvocation = {
  action: {
    action: 'write_file',
    description: 'Generate a track.',
    toolId: 'music.generate',
    operation: 'create_track',
  },
  callId: 'call-music',
  input: { prompt: 'lo-fi' },
  kind: 'direct',
  modelName: 'generate_music',
  operation: 'create_track',
  toolId: 'music.generate',
};

describe('RuntimeToolDispatcher', () => {
  it('dispatches the resolved invocation once to the exact adapter', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'confirmed',
      summary: 'Track generated.',
    });
    const dispatcher = new RuntimeToolDispatcher([
      { id: 'music.generate', execute },
    ]);
    const controller = new AbortController();

    await expect(
      dispatcher.dispatch(invocation, {
        signal: controller.signal,
        taskId: 'task-id',
      }),
    ).resolves.toMatchObject({ status: 'confirmed' });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(invocation, {
      signal: controller.signal,
      taskId: 'task-id',
    });
  });

  it('rejects unavailable adapters and cancelled dispatch', async () => {
    const dispatcher = new RuntimeToolDispatcher([]);
    await expect(
      dispatcher.dispatch(invocation, {
        signal: new AbortController().signal,
        taskId: 'task-id',
      }),
    ).rejects.toThrow('unavailable');

    const controller = new AbortController();
    controller.abort();
    await expect(
      dispatcher.dispatch(invocation, {
        signal: controller.signal,
        taskId: 'task-id',
      }),
    ).rejects.toThrow('cancelled');
  });
});
