CREATE TABLE IF NOT EXISTS access_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_digest BYTEA NOT NULL UNIQUE CHECK (OCTET_LENGTH(code_digest) = 32),
  label TEXT CHECK (label IS NULL OR CHAR_LENGTH(label) <= 100),
  max_users INTEGER NOT NULL CHECK (max_users > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS access_code_redemptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_code_id UUID NOT NULL REFERENCES access_codes(id) ON DELETE RESTRICT,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS access_code_redemptions_code_idx
  ON access_code_redemptions(access_code_id, redeemed_at);
