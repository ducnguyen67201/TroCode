CREATE TABLE IF NOT EXISTS agent_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_turn_id UUID NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('basic', 'pro', 'max')),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'active', 'uncertain', 'released')),
  provider_call_count INTEGER NOT NULL DEFAULT 0
    CHECK (provider_call_count >= 0),
  would_deny BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_dispatched_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, client_turn_id)
);

CREATE INDEX IF NOT EXISTS agent_turns_user_time_idx
  ON agent_turns(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_turns_user_status_time_idx
  ON agent_turns(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_turns_task_idx
  ON agent_turns(user_id, task_id, created_at DESC);

ALTER TABLE model_budget_reservations
  ADD COLUMN IF NOT EXISTS agent_turn_id UUID
  REFERENCES agent_turns(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS model_budget_reservations_agent_turn_idx
  ON model_budget_reservations(agent_turn_id, created_at DESC);

COMMENT ON TABLE agent_turns IS
  'API-owned billable user turns. Client turn IDs are idempotency keys, not quota authority.';
