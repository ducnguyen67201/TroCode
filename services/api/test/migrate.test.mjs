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

  assert.equal(statements.length, 5);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS users/u);
  assert.match(statements[1], /CREATE TABLE IF NOT EXISTS access_codes/u);
  assert.match(statements[2], /CREATE TABLE IF NOT EXISTS model_budget_reservations/u);
  assert.match(statements[3], /audio_duration_ms/u);
  assert.match(statements[4], /plan[\s\S]+api_rate_limit_buckets/u);
});
