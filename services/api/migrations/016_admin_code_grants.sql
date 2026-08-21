ALTER TABLE admin_audit_events
  DROP CONSTRAINT IF EXISTS admin_audit_events_action_check;

ALTER TABLE admin_audit_events
  ADD CONSTRAINT admin_audit_events_action_check CHECK (
    action IN (
      'user.blocked',
      'user.unblocked',
      'user.access_code_granted',
      'access_codes.created',
      'access_codes.paused',
      'access_codes.resumed',
      'access_codes.deleted'
    )
  );
