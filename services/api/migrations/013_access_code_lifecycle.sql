ALTER TABLE access_codes
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;

ALTER TABLE admin_audit_events
  DROP CONSTRAINT IF EXISTS admin_audit_events_action_check;

ALTER TABLE admin_audit_events
  ADD CONSTRAINT admin_audit_events_action_check CHECK (
    action IN (
      'user.blocked',
      'user.unblocked',
      'access_codes.created',
      'access_codes.paused',
      'access_codes.resumed',
      'access_codes.deleted'
    )
  );

COMMENT ON COLUMN access_codes.paused_at IS
  'When set, the code rejects new redemptions while existing redemptions remain active.';
