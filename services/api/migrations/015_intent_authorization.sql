ALTER TABLE agent_tool_invocations
  ADD COLUMN IF NOT EXISTS effect_kind TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS resource_kind TEXT DEFAULT 'generic_private_resource',
  ADD COLUMN IF NOT EXISTS authorization_source TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS intent_revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT TRUE;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_tool_invocations_effect_kind_check'
  ) THEN
    ALTER TABLE agent_tool_invocations ADD CONSTRAINT agent_tool_invocations_effect_kind_check
      CHECK (effect_kind IN (
        'none','create_resource','update_resource','rename_resource','move_resource',
        'add_comment','workspace_write','workspace_command','send_communication',
        'delete_or_archive','unexpected_overwrite','publish','deploy','merge',
        'financial_or_trade','authentication_or_credential','system_permission',
        'install','sensitive_transfer','unknown'
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_tool_invocations_resource_kind_check'
  ) THEN
    ALTER TABLE agent_tool_invocations ADD CONSTRAINT agent_tool_invocations_resource_kind_check
      CHECK (resource_kind IS NULL OR resource_kind IN (
        'calendar_event','document','spreadsheet','spreadsheet_row','workspace_file',
        'workspace_repository','comment','issue','pull_request','email','message',
        'form_submission','download','application','generic_private_resource',
        'generic_public_resource'
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_tool_invocations_authorization_source_check'
  ) THEN
    ALTER TABLE agent_tool_invocations ADD CONSTRAINT agent_tool_invocations_authorization_source_check
      CHECK (authorization_source IN ('routine','user_instruction','exact_approval','none'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_tool_invocations_intent_revision_check'
  ) THEN
    ALTER TABLE agent_tool_invocations ADD CONSTRAINT agent_tool_invocations_intent_revision_check
      CHECK (intent_revision >= 0 AND intent_revision <= 10000);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_tool_invocations_execution_authorization_check'
  ) THEN
    ALTER TABLE agent_tool_invocations ADD CONSTRAINT agent_tool_invocations_execution_authorization_check
      CHECK (
        authorization_source = 'none' OR
        approval_required = (authorization_source = 'exact_approval')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_tool_invocations_effect_resource_consistency_check'
  ) THEN
    ALTER TABLE agent_tool_invocations ADD CONSTRAINT agent_tool_invocations_effect_resource_consistency_check
      CHECK (
        (effect_kind = 'none' AND resource_kind IS NULL) OR
        (effect_kind <> 'none' AND resource_kind IS NOT NULL)
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_tool_invocations_policy_consistency_check'
  ) THEN
    ALTER TABLE agent_tool_invocations ADD CONSTRAINT agent_tool_invocations_policy_consistency_check
      CHECK (
        authorization_source = 'none' OR
        (
          authorization_source = 'routine' AND
          effect_kind = 'none' AND
          approval_required = FALSE
        ) OR
        (
          authorization_source = 'user_instruction' AND
          effect_kind <> 'none' AND
          approval_required = FALSE
        ) OR
        (
          authorization_source = 'exact_approval' AND
          approval_required = TRUE
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS agent_tool_invocations_policy_idx
  ON agent_tool_invocations(run_id, intent_revision, authorization_source, approval_required);

COMMENT ON COLUMN agent_tool_invocations.authorization_source IS
  'Closed, privacy-safe host policy source. It never stores user text, target, path, recipient, or tool arguments.';
