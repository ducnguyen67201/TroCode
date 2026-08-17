import { describe, expect, it, vi } from 'vitest';

import { RuntimeToolDispatcher } from './runtime-tool-dispatcher';

describe('RuntimeToolDispatcher', () => {
  it('dispatches once to the exact registered adapter', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'confirmed',
      summary: 'Track generated.',
    });
    const dispatcher = new RuntimeToolDispatcher([
      { id: 'music.generate', execute },
    ]);
    const controller = new AbortController();
    const action = {
      action: 'write_file' as const,
      toolId: 'music.generate',
      operation: 'create_track',
      description: 'Generate a track.',
    };

    await expect(
      dispatcher.dispatch(action, { prompt: 'lo-fi' }, {
        signal: controller.signal,
        taskId: 'task-id',
      }),
    ).resolves.toMatchObject({ status: 'confirmed' });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('refuses an action whose executor was not registered', async () => {
    const dispatcher = new RuntimeToolDispatcher([]);

    await expect(
      dispatcher.dispatch(
        {
          action: 'write_file',
          toolId: 'music.generate',
          operation: 'create_track',
          description: 'Generate a track.',
        },
        {},
        { signal: new AbortController().signal, taskId: 'task-id' },
      ),
    ).rejects.toThrow('unavailable');
  });
});
