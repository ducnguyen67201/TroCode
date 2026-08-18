import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresUsageRepository } from '../src/usage-repository.mjs';

test('settlement stores sanitized audio duration separately from latency', async () => {
  const statements = [];
  const client = {
    query: async (sql, parameters = []) => {
      statements.push({ parameters, sql });
      if (sql.includes('SELECT request_id')) {
        return {
          rows: [
            {
              actual_micro_usd: null,
              request_id: 'request-1',
              reserved_micro_usd: 30,
              status: 'reserved',
            },
          ],
        };
      }
      if (sql.includes('UPDATE model_budget_reservations')) {
        return {
          rows: [
            {
              actual_micro_usd: 31,
              request_id: 'request-1',
              reserved_micro_usd: 30,
              status: 'settled',
            },
          ],
        };
      }
      return { rows: [] };
    },
    release() {},
  };
  const repository = new PostgresUsageRepository({
    connect: async () => client,
  });
  await repository.settle({
    actualMicroUsd: 31,
    durationMs: 842,
    requestId: 'request-1',
    usage: {
      audioDurationMs: 300,
      cacheWriteTokens: 0,
      cachedInputTokens: 0,
      inputTokens: 0,
      model: 'whisper-1',
      outputTokens: 0,
      reasoningTokens: 0,
      source: 'actual',
    },
    userId: 'user-1',
  });
  const insert = statements.find((entry) =>
    entry.sql.includes('INSERT INTO model_usage_events'),
  );
  assert.match(insert.sql, /audio_duration_ms/u);
  assert.equal(insert.parameters[10], 842);
  assert.equal(insert.parameters[11], 300);
  assert.equal(
    insert.parameters.some(
      (value) => typeof value === 'string' && /base64|transcript|hello/u.test(value),
    ),
    false,
  );
});
