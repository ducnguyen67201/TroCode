CREATE TABLE IF NOT EXISTS knowledge_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 240),
  description TEXT NOT NULL DEFAULT '' CHECK (CHAR_LENGTH(description) <= 4000),
  purpose_label TEXT CHECK (purpose_label IS NULL OR CHAR_LENGTH(purpose_label) <= 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  UNIQUE (owner_user_id, client_id)
);

CREATE TABLE IF NOT EXISTS knowledge_space_members (
  space_id UUID NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'facilitator', 'participant')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  PRIMARY KEY (space_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_space_one_owner_idx
  ON knowledge_space_members(space_id) WHERE role = 'owner' AND removed_at IS NULL;
CREATE INDEX IF NOT EXISTS knowledge_space_members_user_idx
  ON knowledge_space_members(user_id, joined_at DESC) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS knowledge_space_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  space_id UUID NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 240),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  UNIQUE (space_id, client_id)
);

CREATE TABLE IF NOT EXISTS knowledge_space_group_members (
  group_id UUID NOT NULL REFERENCES knowledge_space_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS knowledge_space_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  space_id UUID NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  group_id UUID REFERENCES knowledge_space_groups(id) ON DELETE SET NULL,
  code_digest BYTEA NOT NULL UNIQUE CHECK (OCTET_LENGTH(code_digest) = 32),
  role TEXT NOT NULL CHECK (role IN ('facilitator', 'participant')),
  max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 10000),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count BETWEEN 0 AND max_uses),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (space_id, client_id)
);

CREATE TABLE IF NOT EXISTS knowledge_space_invite_redemptions (
  invite_id UUID NOT NULL REFERENCES knowledge_space_invites(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (invite_id, user_id)
);

COMMENT ON COLUMN knowledge_spaces.purpose_label IS
  'Display-only label. It must never be used for authorization or policy.';
