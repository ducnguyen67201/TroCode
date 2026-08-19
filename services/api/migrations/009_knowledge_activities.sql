CREATE TABLE IF NOT EXISTS knowledge_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  space_id UUID NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'archived')),
  draft_definition JSONB NOT NULL CHECK (OCTET_LENGTH(draft_definition::TEXT) <= 65536),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  UNIQUE (space_id, client_id)
);

CREATE TABLE IF NOT EXISTS knowledge_activity_draft_sources (
  activity_id UUID NOT NULL REFERENCES knowledge_activities(id) ON DELETE CASCADE,
  source_version_id UUID NOT NULL REFERENCES knowledge_source_versions(id) ON DELETE RESTRICT,
  PRIMARY KEY (activity_id, source_version_id)
);

CREATE TABLE IF NOT EXISTS knowledge_activity_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES knowledge_activities(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  definition JSONB NOT NULL CHECK (OCTET_LENGTH(definition::TEXT) <= 65536),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  published_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (activity_id, version_number),
  UNIQUE (activity_id, content_hash)
);

CREATE TABLE IF NOT EXISTS knowledge_activity_version_sources (
  activity_version_id UUID NOT NULL REFERENCES knowledge_activity_versions(id) ON DELETE RESTRICT,
  source_version_id UUID NOT NULL REFERENCES knowledge_source_versions(id) ON DELETE RESTRICT,
  PRIMARY KEY (activity_version_id, source_version_id)
);

CREATE TABLE IF NOT EXISTS knowledge_activity_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  space_id UUID NOT NULL REFERENCES knowledge_spaces(id) ON DELETE RESTRICT,
  activity_version_id UUID NOT NULL REFERENCES knowledge_activity_versions(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('live', 'async', 'hybrid')),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'open', 'closed', 'archived')),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('group', 'participants')),
  target_group_id UUID REFERENCES knowledge_space_groups(id) ON DELETE RESTRICT,
  opens_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  insight_policy TEXT NOT NULL CHECK (insight_policy IN ('explicit_and_operational', 'evidence_candidates')),
  insight_policy_version TEXT NOT NULL DEFAULT '1',
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (space_id, client_id),
  CHECK ((target_kind = 'group') = (target_group_id IS NOT NULL)),
  CHECK (opens_at IS NULL OR closes_at IS NULL OR opens_at < closes_at)
);
CREATE INDEX IF NOT EXISTS knowledge_activity_runs_space_page_idx
  ON knowledge_activity_runs(space_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS knowledge_activity_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES knowledge_activity_runs(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, user_id)
);

CREATE TABLE IF NOT EXISTS knowledge_activity_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES knowledge_activity_runs(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL UNIQUE REFERENCES knowledge_activity_assignments(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'assigned' CHECK (state IN ('assigned', 'in_progress', 'blocked', 'submitted', 'completed', 'withdrawn')),
  acknowledged_policy_version TEXT,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, user_id)
);
CREATE INDEX IF NOT EXISTS knowledge_activity_attempts_user_idx
  ON knowledge_activity_attempts(user_id, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS knowledge_activity_work_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  attempt_id UUID NOT NULL REFERENCES knowledge_activity_attempts(id) ON DELETE RESTRICT,
  task_id UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'created' CHECK (state IN ('created', 'active', 'paused', 'completed', 'cancelled', 'failed')),
  launch_kind TEXT NOT NULL CHECK (launch_kind IN ('none', 'workspace', 'current_surface')),
  help_requested_at TIMESTAMPTZ,
  hint_level INTEGER NOT NULL DEFAULT 0 CHECK (hint_level BETWEEN 0 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attempt_id, client_id),
  UNIQUE (task_id)
);
ALTER TABLE knowledge_activity_work_sessions
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS knowledge_submission_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  attempt_id UUID NOT NULL REFERENCES knowledge_activity_attempts(id) ON DELETE RESTRICT,
  source_version_id UUID NOT NULL REFERENCES knowledge_source_versions(id) ON DELETE RESTRICT,
  submitted_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attempt_id, client_id)
);

CREATE TABLE IF NOT EXISTS knowledge_activity_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  attempt_id UUID NOT NULL REFERENCES knowledge_activity_attempts(id) ON DELETE RESTRICT,
  work_session_id UUID REFERENCES knowledge_activity_work_sessions(id) ON DELETE RESTRICT,
  criterion_id TEXT NOT NULL CHECK (CHAR_LENGTH(criterion_id) BETWEEN 1 AND 80),
  tag TEXT NOT NULL CHECK (CHAR_LENGTH(tag) BETWEEN 1 AND 80),
  provenance TEXT NOT NULL CHECK (provenance IN ('participant', 'host', 'agent_candidate', 'facilitator')),
  result_code TEXT NOT NULL CHECK (result_code IN ('observed', 'passed', 'failed', 'blocked', 'needs_review')),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attempt_id, client_id)
);
CREATE TABLE IF NOT EXISTS knowledge_attempt_help_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  attempt_id UUID NOT NULL REFERENCES knowledge_activity_attempts(id) ON DELETE RESTRICT,
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (attempt_id, client_id)
);
CREATE INDEX IF NOT EXISTS knowledge_attempt_help_open_idx
  ON knowledge_attempt_help_requests(attempt_id, requested_at)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS knowledge_activity_evidence_attempt_idx
  ON knowledge_activity_evidence(attempt_id, created_at DESC);

CREATE SEQUENCE IF NOT EXISTS knowledge_activity_run_event_sequence;
CREATE TABLE IF NOT EXISTS knowledge_activity_run_events (
  sequence BIGINT PRIMARY KEY DEFAULT nextval('knowledge_activity_run_event_sequence'),
  run_id UUID NOT NULL REFERENCES knowledge_activity_runs(id) ON DELETE CASCADE,
  attempt_id UUID REFERENCES knowledge_activity_attempts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (CHAR_LENGTH(event_type) BETWEEN 1 AND 80),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (OCTET_LENGTH(payload::TEXT) <= 4096),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_activity_run_events_delta_idx
  ON knowledge_activity_run_events(run_id, sequence);

COMMENT ON TABLE knowledge_activity_evidence IS
  'Bounded provenance-labeled observations only; never an automatic grade or mental-state claim.';
