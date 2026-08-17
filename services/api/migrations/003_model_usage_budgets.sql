CREATE TABLE IF NOT EXISTS model_budget_reservations (
  request_id UUID NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL,
  lane TEXT NOT NULL CHECK (lane IN ('responses', 'realtime_transcription', 'speech')),
  model TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  reserved_micro_usd BIGINT NOT NULL CHECK (reserved_micro_usd >= 0),
  actual_micro_usd BIGINT CHECK (actual_micro_usd >= 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released', 'uncertain')),
  disposition TEXT,
  would_deny BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, request_id)
);

CREATE INDEX IF NOT EXISTS model_budget_reservations_user_time_idx
  ON model_budget_reservations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_budget_reservations_task_idx
  ON model_budget_reservations(user_id, task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_budget_reservations_committed_idx
  ON model_budget_reservations(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS model_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL,
  lane TEXT NOT NULL CHECK (lane IN ('responses', 'realtime_transcription', 'speech')),
  model TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  cache_write_tokens BIGINT NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  reasoning_tokens BIGINT NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
  duration_ms BIGINT NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  character_count BIGINT NOT NULL DEFAULT 0 CHECK (character_count >= 0),
  amount_micro_usd BIGINT NOT NULL CHECK (amount_micro_usd >= 0),
  usage_source TEXT NOT NULL CHECK (usage_source IN ('actual', 'estimated')),
  disposition TEXT NOT NULL,
  provider_response_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, request_id)
);

CREATE INDEX IF NOT EXISTS model_usage_events_user_time_idx
  ON model_usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_usage_events_task_idx
  ON model_usage_events(user_id, task_id, created_at DESC);

COMMENT ON TABLE model_usage_events IS
  'Sanitized provider usage only: never store prompts, outputs, screenshots, or tool arguments.';
