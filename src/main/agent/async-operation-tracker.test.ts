import { describe, expect, it, vi } from 'vitest';

import { AsyncOperationTracker, type AsyncOperation } from './async-operation-tracker';

function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  let saved: AsyncOperation | null = null;
  const storage = { read: vi.fn(async () => saved), save: vi.fn(async (record: AsyncOperation) => { saved = { ...record }; }) };
  return { storage, tracker: new AsyncOperationTracker(), authorize: vi.fn(async () => undefined) };
}

describe('durable asynchronous operations', () => {
  it('returns pending beyond the old deadline and dispatches concurrent/repeated requests only once', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const f = fixture();
      const completion = deferred();
      const dispatch = vi.fn(() => completion.promise);
      const [first, second] = await Promise.all([
        f.tracker.start('resource', f.storage, f.authorize, dispatch),
        f.tracker.start('resource', f.storage, f.authorize, dispatch),
      ]);
      expect(first).toMatchObject({ status: 'pending', id: second.id });
      expect(f.storage.save.mock.invocationCallOrder[0]).toBeLessThan(dispatch.mock.invocationCallOrder[0]!);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await f.tracker.read('resource', f.storage)).toMatchObject({ status: 'pending', id: first.id });
      expect(await f.tracker.start('resource', f.storage, f.authorize, dispatch)).toMatchObject({ id: first.id });
      expect(dispatch).toHaveBeenCalledOnce();
      completion.resolve('');
      await vi.advanceTimersByTimeAsync(0);
      expect(await f.tracker.read('resource', f.storage)).toMatchObject({ status: 'completed', id: first.id });
      await f.tracker.start('resource', f.storage, f.authorize, dispatch);
      expect(dispatch).toHaveBeenCalledOnce();
      expect(f.authorize).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); vi.useRealTimers(); }
  });

  it('restores a pending receipt as unknown and never redispatches it', async () => {
    const f = fixture();
    const completion = deferred();
    const dispatch = vi.fn(() => completion.promise);
    const first = await f.tracker.start('resource', f.storage, f.authorize, dispatch);
    const restarted = new AsyncOperationTracker();
    expect(await restarted.start('resource', f.storage, f.authorize, dispatch)).toMatchObject({ id: first.id, status: 'unknown' });
    expect(dispatch).toHaveBeenCalledOnce();
    completion.resolve('');
  });

  it('keeps original rejection diagnostics and never retries a rejected dispatch', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const f = fixture();
      const error = new Error('Native opening rejected');
      const dispatch = vi.fn(async () => { throw error; });
      await f.tracker.start('resource', f.storage, f.authorize, dispatch);
      await vi.waitFor(async () => expect((await f.tracker.read('resource', f.storage))?.status).toBe('unknown'));
      expect(log).toHaveBeenCalledWith('[async-operation]', expect.objectContaining({ event: 'unknown', error: { name: error.name, message: error.message, stack: error.stack } }));
      await f.tracker.start('resource', f.storage, f.authorize, dispatch);
      expect(dispatch).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });

  it('does not dispatch if durable admission fails', async () => {
    const f = fixture();
    f.storage.save.mockRejectedValueOnce(new Error('Disk unavailable'));
    const dispatch = vi.fn(async () => '');
    await expect(f.tracker.start('resource', f.storage, f.authorize, dispatch)).rejects.toThrow('Disk unavailable');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('records an explicit OS rejection as failed instead of unknown', async () => {
    const f = fixture();
    const dispatch = vi.fn(async () => 'No application is available');
    await f.tracker.start('resource', f.storage, f.authorize, dispatch);
    await vi.waitFor(async () => expect((await f.tracker.read('resource', f.storage))?.status).toBe('failed'));
    await f.tracker.start('resource', f.storage, f.authorize, dispatch);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('keeps a failed completion write unknown without an unhandled rejection', async () => {
    const f = fixture();
    const completion = deferred();
    const dispatch = vi.fn(() => completion.promise);
    await f.tracker.start('resource', f.storage, f.authorize, dispatch);
    f.storage.save.mockRejectedValueOnce(new Error('Disk unavailable'));
    completion.resolve('');
    await vi.waitFor(async () => expect((await f.tracker.read('resource', f.storage))?.status).toBe('unknown'));
    expect((await new AsyncOperationTracker().read('resource', f.storage))?.status).toBe('unknown');
    expect(dispatch).toHaveBeenCalledOnce();
  });
});
