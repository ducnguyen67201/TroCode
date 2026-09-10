import { randomUUID } from 'node:crypto';

import { z } from 'zod';

export const AsyncOperationSchema = z.object({
  version: z.literal(1), id: z.uuid(),
  status: z.enum(['pending', 'completed', 'failed', 'unknown']),
  startedAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type AsyncOperation = z.infer<typeof AsyncOperationSchema>;
export interface AsyncOperationStorage {
  read(): Promise<AsyncOperation | null>;
  save(record: AsyncOperation): Promise<void>;
}

/** A durable dispatch receipt, distinct from completion of a UI-dependent request. */
export class AsyncOperationTracker {
  private readonly live = new Map<string, AsyncOperation>();
  private readonly admissions = new Map<string, Promise<AsyncOperation>>();

  async read(key: string, storage: AsyncOperationStorage): Promise<AsyncOperation | null> {
    const live = this.live.get(key);
    if (live) return { ...live };
    const admitting = this.admissions.get(key);
    if (admitting) return admitting;
    const saved = await storage.read();
    // Admission may have started while storage was being read.
    const current = this.live.get(key);
    if (current) return { ...current };
    const started = this.admissions.get(key);
    if (started) return started;
    return this.restore(saved, storage);
  }

  private async restore(saved: AsyncOperation | null, storage: AsyncOperationStorage) {
    if (!saved || saved.status !== 'pending') return saved;
    // A different process cannot prove that a previously dispatched request finished.
    const unknown: AsyncOperation = { ...saved, status: 'unknown', updatedAt: new Date().toISOString() };
    await storage.save(unknown);
    this.log('restored_unknown', unknown);
    return unknown;
  }

  start(key: string, storage: AsyncOperationStorage, beforeDispatch: () => Promise<void>, dispatch: () => Promise<string | void>): Promise<AsyncOperation> {
    const admitted = this.admissions.get(key);
    if (admitted) return admitted;
    const work = this.admit(key, storage, beforeDispatch, dispatch);
    this.admissions.set(key, work);
    void work.finally(() => this.admissions.delete(key)).catch(() => undefined);
    return work;
  }

  private async admit(key: string, storage: AsyncOperationStorage, beforeDispatch: () => Promise<void>, dispatch: () => Promise<string | void>): Promise<AsyncOperation> {
    const active = this.live.get(key);
    if (active) return { ...active };
    const existing = await this.restore(await storage.read(), storage);
    if (existing) return existing;
    await beforeDispatch();
    const timestamp = new Date().toISOString();
    const record: AsyncOperation = { version: 1, id: randomUUID(), status: 'pending', startedAt: timestamp, updatedAt: timestamp };
    await storage.save(record);
    this.live.set(key, record);
    this.log('dispatch', record);
    // A slow OS request may be waiting for the very interaction the agent must perform.
    const timer = setTimeout(() => this.log('still_pending', record), 10_000);
    timer.unref?.();
    const settle = async (status: AsyncOperation['status'], error?: unknown) => {
      clearTimeout(timer);
      const result = { ...record, status, updatedAt: new Date().toISOString() };
      this.log(status, result, error);
      try {
        await storage.save(result);
        this.live.delete(key);
      } catch (failure) {
        this.live.set(key, { ...result, status: 'unknown' });
        this.log('persistence_failed', result, failure);
      }
    };
    // Catch synchronous dispatch throws too. Neither callback mutates task/lesson state.
    void Promise.resolve().then(dispatch).then(
      (error) => settle(error ? 'failed' : 'completed', error || undefined),
      (error: unknown) => settle('unknown', error),
    );
    return { ...record };
  }

  private log(event: string, record: AsyncOperation, error?: unknown) {
    console.info('[async-operation]', {
      event, operationId: record.id, timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - Date.parse(record.startedAt), status: record.status,
      ...(error === undefined ? {} : { error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack } : String(error) }),
    });
  }
}
