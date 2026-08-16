import type { Pool, PoolClient } from 'pg';
import { Pool as PostgresPool } from 'pg';

import {
  TaskHistorySchema,
  TaskUpdateSchema,
  type TaskHistory,
  type TaskUpdate,
} from '../../shared/contracts';

const TASK_HISTORY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS trocode_task_snapshots (
  owner_id TEXT NOT NULL,
  task_id UUID NOT NULL,
  phase TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  snapshot JSONB NOT NULL,
  PRIMARY KEY (owner_id, task_id)
);

CREATE INDEX IF NOT EXISTS trocode_task_snapshots_owner_updated_idx
  ON trocode_task_snapshots (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS trocode_task_events (
  owner_id TEXT NOT NULL,
  task_id UUID NOT NULL,
  event_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  event JSONB NOT NULL,
  PRIMARY KEY (owner_id, event_id),
  CONSTRAINT trocode_task_events_task_fk
    FOREIGN KEY (owner_id, task_id)
    REFERENCES trocode_task_snapshots (owner_id, task_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS trocode_task_events_owner_occurred_idx
  ON trocode_task_events (owner_id, occurred_at ASC);
`;

export interface TaskHistoryStore {
  close(): Promise<void>;
  initialize(): Promise<void>;
  load(ownerId: string): Promise<TaskHistory>;
  save(ownerId: string, update: TaskUpdate): Promise<void>;
}

interface SnapshotRow {
  snapshot: unknown;
}

interface EventRow {
  event: unknown;
}

export class PostgresTaskHistoryStore implements TaskHistoryStore {
  private readonly pool: Pool;

  constructor(
    connectionString: string,
    pool = new PostgresPool({
      application_name: 'trocode-desktop',
      connectionString,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 4,
    }),
  ) {
    this.pool = pool;
  }

  async initialize(): Promise<void> {
    await this.pool.query(TASK_HISTORY_SCHEMA_SQL);
  }

  async save(ownerId: string, input: TaskUpdate): Promise<void> {
    const update = TaskUpdateSchema.parse(input);
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO trocode_task_snapshots (
          owner_id,
          task_id,
          phase,
          created_at,
          updated_at,
          snapshot
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (owner_id, task_id) DO UPDATE SET
          phase = EXCLUDED.phase,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          snapshot = EXCLUDED.snapshot
        WHERE trocode_task_snapshots.updated_at <= EXCLUDED.updated_at`,
        [
          ownerId,
          update.snapshot.taskId,
          update.snapshot.phase,
          update.snapshot.createdAt,
          update.snapshot.updatedAt,
          JSON.stringify(update.snapshot),
        ],
      );
      await client.query(
        `INSERT INTO trocode_task_events (
          owner_id,
          task_id,
          event_id,
          occurred_at,
          event
        ) VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (owner_id, event_id) DO NOTHING`,
        [
          ownerId,
          update.event.taskId,
          update.event.eventId,
          update.event.timestamp,
          JSON.stringify(update.event),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async load(ownerId: string): Promise<TaskHistory> {
    const [snapshotResult, eventResult] = await Promise.all([
      this.pool.query<SnapshotRow>(
        `SELECT snapshot
         FROM trocode_task_snapshots
         WHERE owner_id = $1
         ORDER BY updated_at DESC`,
        [ownerId],
      ),
      this.pool.query<EventRow>(
        `SELECT event
         FROM trocode_task_events
         WHERE owner_id = $1
         ORDER BY occurred_at ASC`,
        [ownerId],
      ),
    ]);

    return TaskHistorySchema.parse({
      events: eventResult.rows.map((row) => row.event),
      persistence: {
        mode: 'postgres',
        summary: 'Task history is saved to PostgreSQL.',
      },
      snapshots: snapshotResult.rows.map((row) => row.snapshot),
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async rollback(client: PoolClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original transaction error.
    }
  }
}

