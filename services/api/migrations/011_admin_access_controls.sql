ALTER TABLE users
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_blocked_at_idx
  ON users(blocked_at)
  WHERE blocked_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL CHECK (
    action IN ('user.blocked', 'user.unblocked', 'access_codes.created')
  ),
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  detail JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (OCTET_LENGTH(detail::TEXT) <= 4096),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_events_created_idx
  ON admin_audit_events(created_at DESC);

COMMENT ON TABLE admin_audit_events IS
  'Administrative action metadata only. Access tokens and plaintext access codes must never be stored here.';
