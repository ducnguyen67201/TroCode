ALTER TABLE users
  ADD COLUMN IF NOT EXISTS free_access_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_free_access_started_at_idx
  ON users(free_access_started_at)
  WHERE free_access_started_at IS NOT NULL;
