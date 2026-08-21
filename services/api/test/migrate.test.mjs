import assert from 'node:assert/strict';
import test from 'node:test';

import { runMigrations } from '../src/migrate.mjs';

test('runs every checked-in SQL migration in filename order', async () => {
  const statements = [];
  await runMigrations({
    query: async (sql) => {
      statements.push(sql);
    },
  });

  assert.equal(statements.length, 17);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS users/u);
  assert.match(statements[1], /CREATE TABLE IF NOT EXISTS access_codes/u);
  assert.match(statements[2], /CREATE TABLE IF NOT EXISTS model_budget_reservations/u);
  assert.match(statements[3], /audio_duration_ms/u);
  assert.match(statements[4], /plan[\s\S]+api_rate_limit_buckets/u);
  assert.match(statements[5], /agent_turns[\s\S]+agent_turn_id/u);
  assert.match(
    statements[6],
    /access_codes_plan_check[\s\S]+ALTER TABLE users[\s\S]+DEFAULT 'free'[\s\S]+agent_turns_plan_check/u,
  );
  assert.match(statements[7], /knowledge_spaces[\s\S]+knowledge_space_invites/u);
  assert.match(statements[8], /knowledge_sources[\s\S]+knowledge_ingestion_jobs/u);
  assert.match(statements[9], /knowledge_activities[\s\S]+knowledge_activity_run_events/u);
  assert.match(statements[10], /blocked_at[\s\S]+admin_audit_events/u);
  assert.match(statements[11], /code_ciphertext/u);
  assert.match(
    statements[12],
    /paused_at[\s\S]+access_codes\.paused[\s\S]+access_codes\.deleted/u,
  );
  assert.match(
    statements[13],
    /agent_runs[\s\S]+agent_run_events[\s\S]+agent_session_items[\s\S]+agent_run_checkpoints[\s\S]+agent_tool_invocations[\s\S]+agent_outcome_criteria[\s\S]+agent_evidence[\s\S]+agent_worker_sessions/u,
  );
  assert.match(
    statements[13],
    /IF NOT EXISTS[\s\S]+agent_tool_invocations_worker_session_fk/u,
  );
  assert.match(
    statements[14],
    /effect_kind[\s\S]+authorization_source[\s\S]+intent_revision[\s\S]+approval_required[\s\S]+effect_resource_consistency[\s\S]+policy_consistency/u,
  );
  assert.match(statements[15], /user\.access_code_granted/u);
  assert.match(statements[16], /free_access_started_at/u);
});

test('latest migrations are forward-only and re-runnable', async () => {
  const statements = [];
  const database = { query: async (sql) => statements.push(sql) };
  await runMigrations(database);
  await runMigrations(database);
  assert.equal(statements.length, 34);
  assert.match(statements[14], /ADD COLUMN IF NOT EXISTS effect_kind/u);
  assert.match(statements[31], /ADD COLUMN IF NOT EXISTS effect_kind/u);
  assert.match(statements[32], /user\.access_code_granted/u);
  assert.match(statements[33], /free_access_started_at/u);
});
