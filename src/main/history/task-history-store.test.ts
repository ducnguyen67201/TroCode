import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { TaskEvent, TaskSnapshot, TaskUpdate } from '../../shared/contracts';

import { PostgresTaskHistoryStore } from './task-history-store';

const taskId = '11111111-1111-4111-8111-111111111111';
const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const timestamp = '2026-08-16T06:00:00.000Z';

function createUpdate(): TaskUpdate {
  const event: TaskEvent = {
    artifacts: [],
    eventId,
    nextActions: [],
    phase: 'completed',
    status: 'success',
    summary: 'Task completed.',
    taskId,
    timestamp,
  };
  const snapshot: TaskSnapshot = {
    approvalGrant: null,
    createdAt: '2026-08-16T05:00:00.000Z',
    goal: null,
    lastEvent: event,
    messages: [],
    outcomes: null,
    pendingInteraction: null,
    phase: 'completed',
    progress: null,
    queuedSteering: [],
    runtimeResume: null,
    request: 'Complete the task',
    taskId,
    updatedAt: timestamp,
  };
  return { event, snapshot };
}

function createPool(snapshot: unknown = createUpdate().snapshot) {
  const update = createUpdate();
  const snapshots = Array.isArray(snapshot) ? snapshot : [snapshot];
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      void sql;
      void values;
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      void values;
      if (sql.includes('SELECT snapshot')) {
        return { rows: snapshots.map((item) => ({ snapshot: item })) };
      }
      if (sql.includes('SELECT event')) {
        return { rows: [{ event: update.event }] };
      }
      return { rows: [] };
    }),
  };

  return { client, pool: pool as unknown as Pool, poolMocks: pool };
}

describe('PostgresTaskHistoryStore', () => {
  it('initializes the account-scoped task and event tables', async () => {
    const { pool, poolMocks } = createPool();
    const store = new PostgresTaskHistoryStore('postgresql://example', pool);

    await store.initialize();

    expect(poolMocks.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS trocode_task_snapshots'),
    );
    expect(poolMocks.query).toHaveBeenCalledWith(
      expect.stringContaining('FOREIGN KEY (owner_id, task_id)'),
    );
  });

  it('upserts the latest snapshot and inserts each event in one transaction', async () => {
    const { client, pool } = createPool();
    const store = new PostgresTaskHistoryStore('postgresql://example', pool);
    const update = createUpdate();

    await store.save('google-user-1', update);

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO trocode_task_snapshots'),
      expect.stringContaining('INSERT INTO trocode_task_events'),
      'COMMIT',
    ]);
    const snapshotValues = client.query.mock.calls[1]?.[1];
    expect(snapshotValues?.slice(0, 5)).toEqual([
      'google-user-1',
      taskId,
      'completed',
      update.snapshot.createdAt,
      update.snapshot.updatedAt,
    ]);
    expect(JSON.parse(String(snapshotValues?.[5]))).toEqual(update.snapshot);
    const eventValues = client.query.mock.calls[2]?.[1];
    expect(eventValues?.slice(0, 4)).toEqual([
      'google-user-1',
      taskId,
      eventId,
      timestamp,
    ]);
    expect(JSON.parse(String(eventValues?.[4]))).toEqual(update.event);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('loads and validates only the requested owner history', async () => {
    const { pool, poolMocks } = createPool();
    const store = new PostgresTaskHistoryStore('postgresql://example', pool);

    await expect(store.load('google-user-1')).resolves.toMatchObject({
      events: [{ eventId }],
      persistence: { mode: 'postgres' },
      snapshots: [{ taskId }],
    });
    expect(poolMocks.query).toHaveBeenCalledTimes(2);
    expect(poolMocks.query.mock.calls[0]?.[1]).toEqual(['google-user-1']);
    expect(poolMocks.query.mock.calls[1]?.[1]).toEqual(['google-user-1']);
  });

  it('backfills transitional contracts with an owner-scoped compare-and-swap', async () => {
    const transitionalSnapshot = {
      ...createUpdate().snapshot,
      goal: {
        approvalPolicy: { alwaysConfirm: ['login'] },
        id: '22222222-2222-4222-8222-222222222222',
        limits: {
          maxImages: 20,
          maxMicroUsd: 500_000,
          maxMinutes: 10,
          maxModelSamples: 40,
          maxToolCalls: 30,
        },
        originalRequest: 'Complete the task',
        schemaVersion: 5,
      },
    };
    const { pool, poolMocks } = createPool(transitionalSnapshot);
    const store = new PostgresTaskHistoryStore('postgresql://example', pool);

    const history = await store.load('google-user-1');

    expect(history.snapshots[0]?.goal).toMatchObject({
      autonomyMode: 'balanced',
      executionProfile: 'everyday',
      runtimeKind: 'openai_agents',
      schemaVersion: 6,
      activity: null,
      workspace: null,
    });
    const backfill = poolMocks.query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE trocode_task_snapshots'),
    );
    expect(backfill?.[1]?.[0]).toBe('google-user-1');
    const rows = JSON.parse(String(backfill?.[1]?.[1]));
    expect(rows).toEqual([
      {
        previous_snapshot: transitionalSnapshot,
        snapshot: history.snapshots[0],
        task_id: taskId,
      },
    ]);
    expect(backfill?.[0]).toContain(
      'stored.snapshot = candidate.previous_snapshot',
    );
  });

  it('bounds snapshot backfills to short batches', async () => {
    const snapshots = Array.from({ length: 51 }, (_, index) => ({
      ...createUpdate().snapshot,
      goal: {
        approvalPolicy: { alwaysConfirm: ['login'] },
        id: '22222222-2222-4222-8222-222222222222',
        limits: {
          maxImages: 20,
          maxMicroUsd: 500_000,
          maxMinutes: 10,
          maxModelSamples: 40,
          maxToolCalls: 30,
        },
        originalRequest: 'Complete the task',
        schemaVersion: 5,
      },
      lastEvent: null,
      taskId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));
    const { pool, poolMocks } = createPool(snapshots);
    const store = new PostgresTaskHistoryStore('postgresql://example', pool);

    await store.load('google-user-1');

    const backfills = poolMocks.query.mock.calls.filter(([sql]) =>
      sql.includes('UPDATE trocode_task_snapshots'),
    );
    expect(backfills).toHaveLength(2);
    expect(JSON.parse(String(backfills[0]?.[1]?.[1]))).toHaveLength(50);
    expect(JSON.parse(String(backfills[1]?.[1]?.[1]))).toHaveLength(1);
  });

  it('rolls back and releases the client when a write fails', async () => {
    const { client, pool } = createPool();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO trocode_task_snapshots')) {
        throw new Error('write failed');
      }
      return { rows: [] };
    });
    const store = new PostgresTaskHistoryStore('postgresql://example', pool);

    await expect(store.save('google-user-1', createUpdate())).rejects.toThrow(
      'write failed',
    );
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
