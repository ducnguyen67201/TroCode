ALTER TABLE access_codes
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'basic'
  CHECK (plan IN ('basic', 'pro', 'max'));

CREATE TABLE IF NOT EXISTS api_rate_limit_buckets (
  scope TEXT NOT NULL CHECK (CHAR_LENGTH(scope) BETWEEN 1 AND 64),
  identity_digest BYTEA NOT NULL CHECK (OCTET_LENGTH(identity_digest) = 32),
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, identity_digest, window_started_at)
);

CREATE INDEX IF NOT EXISTS api_rate_limit_buckets_updated_idx
  ON api_rate_limit_buckets(updated_at);
