CREATE TABLE IF NOT EXISTS knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  space_id UUID NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (CHAR_LENGTH(display_name) BETWEEN 1 AND 255),
  virtual_path TEXT NOT NULL CHECK (CHAR_LENGTH(virtual_path) BETWEEN 1 AND 2000),
  role TEXT NOT NULL CHECK (role IN ('reference', 'instructions', 'rubric', 'starter', 'submission')),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  UNIQUE (space_id, client_id)
);
CREATE INDEX IF NOT EXISTS knowledge_sources_space_page_idx
  ON knowledge_sources(space_id, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS knowledge_source_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  state TEXT NOT NULL CHECK (state IN ('pending_upload', 'processing', 'ready', 'failed')),
  media_type TEXT NOT NULL CHECK (media_type IN ('text/plain', 'text/markdown', 'application/pdf')),
  byte_size BIGINT NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  object_key TEXT NOT NULL UNIQUE CHECK (CHAR_LENGTH(object_key) BETWEEN 1 AND 512),
  parser_version TEXT,
  page_count INTEGER CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 5000),
  error_code TEXT CHECK (error_code IS NULL OR CHAR_LENGTH(error_code) <= 80),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at TIMESTAMPTZ,
  UNIQUE (source_id, version_number)
);

CREATE TABLE IF NOT EXISTS knowledge_source_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_version_id UUID NOT NULL REFERENCES knowledge_source_versions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  locator JSONB NOT NULL CHECK (OCTET_LENGTH(locator::TEXT) <= 4096),
  body TEXT NOT NULL CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 12000),
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_version_id, ordinal)
);
CREATE INDEX IF NOT EXISTS knowledge_source_chunks_search_idx
  ON knowledge_source_chunks USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS knowledge_source_chunks_version_idx
  ON knowledge_source_chunks(source_version_id, ordinal);

CREATE TABLE IF NOT EXISTS knowledge_ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_version_id UUID NOT NULL UNIQUE REFERENCES knowledge_source_versions(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'leased', 'retry', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 12),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner UUID,
  lease_expires_at TIMESTAMPTZ,
  error_code TEXT CHECK (error_code IS NULL OR CHAR_LENGTH(error_code) <= 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_ingestion_jobs_claim_idx
  ON knowledge_ingestion_jobs(state, available_at, created_at)
  WHERE state IN ('queued', 'retry', 'leased');

COMMENT ON COLUMN knowledge_source_versions.object_key IS
  'Private object-store authority. Never return this column to a renderer or model.';
