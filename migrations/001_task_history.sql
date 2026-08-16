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
