CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL,
  client_task_id UUID NOT NULL,
  execution_profile TEXT NOT NULL CHECK (execution_profile IN ('everyday','workspace')),
  workspace_selection_id UUID,
  agent_turn_id UUID REFERENCES agent_turns(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN (
    'queued','compiling_outcomes','planning','awaiting_worker','executing_tool',
    'awaiting_input','awaiting_approval','verifying','recovering','completed',
    'blocked','failed','cancelled','expired'
  )),
  schema_digest TEXT NOT NULL CHECK (schema_digest ~ '^[a-f0-9]{64}$'),
  protocol_version INTEGER NOT NULL DEFAULT 1 CHECK (protocol_version > 0),
  run_version INTEGER NOT NULL DEFAULT 1 CHECK (run_version > 0),
  outcome_revision INTEGER NOT NULL DEFAULT 1 CHECK (outcome_revision > 0),
  next_sequence BIGINT NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
  last_control_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_control_sequence >= 0),
  session_generation INTEGER NOT NULL DEFAULT 1 CHECK (session_generation > 0),
  pending_session_generation INTEGER CHECK (pending_session_generation IS NULL OR pending_session_generation > 0),
  request_ciphertext BYTEA,
  request_iv BYTEA CHECK (request_iv IS NULL OR octet_length(request_iv) = 12),
  request_tag BYTEA CHECK (request_tag IS NULL OR octet_length(request_tag) = 16),
  request_key_version INTEGER CHECK (request_key_version IS NULL OR request_key_version > 0),
  contract_ciphertext BYTEA,
  contract_iv BYTEA CHECK (contract_iv IS NULL OR octet_length(contract_iv) = 12),
  contract_tag BYTEA CHECK (contract_tag IS NULL OR octet_length(contract_tag) = 16),
  contract_key_version INTEGER CHECK (contract_key_version IS NULL OR contract_key_version > 0),
  public_summary TEXT NOT NULL DEFAULT '' CHECK (length(public_summary) <= 1000),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  recovery_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (recovery_attempt_count >= 0),
  deadline_at TIMESTAMPTZ NOT NULL,
  payload_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, client_task_id),
  UNIQUE (user_id, task_id),
  CHECK ((execution_profile = 'workspace') = (workspace_selection_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS agent_runs_claim_idx
  ON agent_runs(state, lease_expires_at, created_at)
  WHERE state IN ('queued','planning','recovering','verifying');
CREATE INDEX IF NOT EXISTS agent_runs_user_time_idx
  ON agent_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_payload_expiry_idx
  ON agent_runs(payload_expires_at) WHERE request_ciphertext IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_run_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  type TEXT NOT NULL CHECK (length(type) BETWEEN 1 AND 80),
  public_summary TEXT NOT NULL CHECK (length(public_summary) BETWEEN 1 AND 1000),
  payload_ciphertext BYTEA,
  payload_iv BYTEA CHECK (payload_iv IS NULL OR octet_length(payload_iv) = 12),
  payload_tag BYTEA CHECK (payload_tag IS NULL OR octet_length(payload_tag) = 16),
  payload_key_version INTEGER CHECK (payload_key_version IS NULL OR payload_key_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, sequence)
);
CREATE INDEX IF NOT EXISTS agent_run_events_replay_idx
  ON agent_run_events(run_id, sequence);

CREATE TABLE IF NOT EXISTS agent_session_items (
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
  item_sequence BIGINT NOT NULL CHECK (item_sequence > 0),
  source_event_id UUID REFERENCES agent_run_events(id) ON DELETE RESTRICT,
  item_ciphertext BYTEA NOT NULL,
  item_iv BYTEA NOT NULL CHECK (octet_length(item_iv) = 12),
  item_tag BYTEA NOT NULL CHECK (octet_length(item_tag) = 16),
  item_key_version INTEGER NOT NULL CHECK (item_key_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, generation, item_sequence)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_session_items_source_event_idx
  ON agent_session_items(run_id, source_event_id) WHERE source_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_run_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  run_version INTEGER NOT NULL CHECK (run_version > 0),
  model_step_id UUID NOT NULL,
  graph_digest TEXT NOT NULL CHECK (graph_digest ~ '^[a-f0-9]{64}$'),
  state_ciphertext BYTEA NOT NULL,
  state_iv BYTEA NOT NULL CHECK (octet_length(state_iv) = 12),
  state_tag BYTEA NOT NULL CHECK (octet_length(state_tag) = 16),
  state_key_version INTEGER NOT NULL CHECK (state_key_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, run_version)
);

CREATE TABLE IF NOT EXISTS agent_tool_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  call_id TEXT NOT NULL CHECK (length(call_id) BETWEEN 1 AND 255),
  tool_id TEXT NOT NULL CHECK (tool_id ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$'),
  operation TEXT NOT NULL CHECK (length(operation) BETWEEN 1 AND 100),
  state TEXT NOT NULL DEFAULT 'requested' CHECK (state IN (
    'requested','delivered','executing','confirmed','failed','denied',
    'not_executed','unknown','cancelled','expired'
  )),
  consequential BOOLEAN NOT NULL DEFAULT FALSE,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 255),
  request_ciphertext BYTEA,
  request_iv BYTEA CHECK (request_iv IS NULL OR octet_length(request_iv) = 12),
  request_tag BYTEA CHECK (request_tag IS NULL OR octet_length(request_tag) = 16),
  request_key_version INTEGER CHECK (request_key_version IS NULL OR request_key_version > 0),
  result_ciphertext BYTEA,
  result_iv BYTEA CHECK (result_iv IS NULL OR octet_length(result_iv) = 12),
  result_tag BYTEA CHECK (result_tag IS NULL OR octet_length(result_tag) = 16),
  result_key_version INTEGER CHECK (result_key_version IS NULL OR result_key_version > 0),
  public_summary TEXT NOT NULL DEFAULT '' CHECK (length(public_summary) <= 1000),
  worker_session_id UUID,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  executing_at TIMESTAMPTZ,
  terminal_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (run_id, call_id),
  UNIQUE (run_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS agent_tool_invocations_pending_idx
  ON agent_tool_invocations(run_id, state, requested_at);

CREATE TABLE IF NOT EXISTS agent_outcome_criteria (
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  criterion_id TEXT NOT NULL CHECK (length(criterion_id) BETWEEN 1 AND 80),
  verifier_kind TEXT NOT NULL CHECK (verifier_kind IN (
    'assistant_output','application_surface','browser_semantic',
    'filesystem_effect','tool_effect','semantic_judge'
  )),
  verifier_digest TEXT NOT NULL CHECK (verifier_digest ~ '^[a-f0-9]{64}$'),
  required BOOLEAN NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','passed','failed','unknown')),
  description_ciphertext BYTEA NOT NULL,
  description_iv BYTEA NOT NULL CHECK (octet_length(description_iv) = 12),
  description_tag BYTEA NOT NULL CHECK (octet_length(description_tag) = 16),
  description_key_version INTEGER NOT NULL CHECK (description_key_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, revision, criterion_id)
);

CREATE TABLE IF NOT EXISTS agent_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  criterion_id TEXT NOT NULL CHECK (length(criterion_id) BETWEEN 1 AND 80),
  source TEXT NOT NULL CHECK (source IN (
    'assistant_output','tool_result','fresh_observation','browser_dom',
    'filesystem','semantic_judge'
  )),
  status TEXT NOT NULL CHECK (status IN ('supports','contradicts','unknown')),
  invocation_id UUID REFERENCES agent_tool_invocations(id) ON DELETE RESTRICT,
  observation_id UUID,
  observation_fingerprint TEXT CHECK (
    observation_fingerprint IS NULL OR observation_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  public_summary TEXT NOT NULL CHECK (length(public_summary) BETWEEN 1 AND 1000),
  detail_ciphertext BYTEA,
  detail_iv BYTEA CHECK (detail_iv IS NULL OR octet_length(detail_iv) = 12),
  detail_tag BYTEA CHECK (detail_tag IS NULL OR octet_length(detail_tag) = 16),
  detail_key_version INTEGER CHECK (detail_key_version IS NULL OR detail_key_version > 0),
  detail_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (run_id, revision, criterion_id)
    REFERENCES agent_outcome_criteria(run_id, revision, criterion_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_evidence_criterion_idx
  ON agent_evidence(run_id, revision, criterion_id, created_at);

CREATE TABLE IF NOT EXISTS agent_worker_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_session_id UUID NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE,
  protocol_version INTEGER NOT NULL CHECK (protocol_version > 0),
  schema_digest TEXT NOT NULL CHECK (schema_digest ~ '^[a-f0-9]{64}$'),
  capabilities JSONB NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  disconnected_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_worker_sessions_available_idx
  ON agent_worker_sessions(user_id, expires_at DESC)
  WHERE disconnected_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_tool_invocations_worker_session_fk'
      AND conrelid = 'agent_tool_invocations'::regclass
  ) THEN
    ALTER TABLE agent_tool_invocations
      ADD CONSTRAINT agent_tool_invocations_worker_session_fk
      FOREIGN KEY (worker_session_id) REFERENCES agent_worker_sessions(id) ON DELETE RESTRICT;
  END IF;
END
$$;

COMMENT ON TABLE agent_runs IS
  'Encrypted, API-owned durable agent runs. Screenshot bytes are never persisted.';
