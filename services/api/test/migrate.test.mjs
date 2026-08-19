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

  assert.equal(statements.length, 9);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS users/u);
  assert.match(statements[1], /CREATE TABLE IF NOT EXISTS access_codes/u);
  assert.match(statements[2], /CREATE TABLE IF NOT EXISTS model_budget_reservations/u);
  assert.match(statements[3], /audio_duration_ms/u);
  assert.match(statements[4], /plan[\s\S]+api_rate_limit_buckets/u);
  assert.match(statements[5], /agent_turns[\s\S]+agent_turn_id/u);
  assert.match(statements[6], /knowledge_spaces[\s\S]+knowledge_space_invites/u);
  assert.match(statements[7], /knowledge_sources[\s\S]+knowledge_ingestion_jobs/u);
  assert.match(statements[8], /knowledge_activities[\s\S]+knowledge_activity_run_events/u);
});
