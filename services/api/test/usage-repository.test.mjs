import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresUsageRepository } from '../src/usage-repository.mjs';

test('response reservations lock and validate the API-owned agent turn', async () => {
  const statements = [];
  const client = {
    query: async (sql, parameters = []) => {
      statements.push({ parameters, sql });
      if (
        sql.includes('SELECT request_id') &&
        sql.includes('FROM model_budget_reservations')
      ) {
        return { rows: [] };
      }
      if (sql.includes('FROM agent_turns') && sql.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              plan: 'basic',
              provider_call_count: 3,
              status: 'active',
              task_id: '11111111-1111-4111-8111-111111111111',
            },
          ],
        };
      }
      if (sql.includes('AS task')) {
        return { rows: [{ day: 0, month: 0, task: 0 }] };
      }
      if (sql.includes('INSERT INTO model_budget_reservations')) {
        return {
          rows: [
            {
              actual_micro_usd: null,
              request_id: '33333333-3333-4333-8333-333333333333',
              reserved_micro_usd: 20,
              status: 'reserved',
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

  const result = await repository.reserve({
    agentTurnId: '22222222-2222-4222-8222-222222222222',
    authorize: () => null,
    catalogVersion: 'v1',
    enforce: true,
    lane: 'responses',
    maxProviderCallsPerTurn: 40,
    model: 'gpt-5.6-luna',
    planId: 'basic',
    requestId: '33333333-3333-4333-8333-333333333333',
    reservationTtlMs: 60_000,
    reservedMicroUsd: 20,
    taskId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
  });

  assert.equal(result.kind, 'reserved');
  const turnLock = statements.find(({ sql }) =>
    sql.includes('FROM agent_turns'),
  );
  assert.match(turnLock.sql, /FOR UPDATE/u);
  const increment = statements.find(({ sql }) =>
    sql.includes('provider_call_count = provider_call_count + 1'),
  );
  assert.deepEqual(increment.parameters, [
    '22222222-2222-4222-8222-222222222222',
  ]);
  const insert = statements.find(({ sql }) =>
    sql.includes('INSERT INTO model_budget_reservations'),
  );
  assert.match(insert.sql, /agent_turn_id/u);
  assert.equal(insert.parameters.at(-1), '22222222-2222-4222-8222-222222222222');
});

test('a user turn cannot be reused for unbounded provider calls', async () => {
  let inserted = false;
  const client = {
    query: async (sql) => {
      if (
        sql.includes('SELECT request_id') &&
        sql.includes('FROM model_budget_reservations')
      ) {
        return { rows: [] };
      }
      if (sql.includes('FROM agent_turns') && sql.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              plan: 'basic',
              provider_call_count: 40,
              status: 'active',
              task_id: '11111111-1111-4111-8111-111111111111',
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO model_budget_reservations')) inserted = true;
      return { rows: [] };
    },
    release() {},
  };
  const repository = new PostgresUsageRepository({
    connect: async () => client,
  });

  const result = await repository.reserve({
    agentTurnId: '22222222-2222-4222-8222-222222222222',
    authorize: () => null,
    catalogVersion: 'v1',
    enforce: true,
    lane: 'responses',
    maxProviderCallsPerTurn: 40,
    model: 'gpt-5.6-luna',
    planId: 'basic',
    requestId: '33333333-3333-4333-8333-333333333333',
    reservationTtlMs: 60_000,
    reservedMicroUsd: 20,
    taskId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
  });

  assert.deepEqual(result, { kind: 'turn_exhausted' });
  assert.equal(inserted, false);
});

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

test('committed spend tracks money without treating provider calls as messages', async () => {
  const statements = [];
  const client = {
    query: async (sql) => {
      statements.push(sql);
      if (sql.includes('AS month')) {
        return {
          rows: [{ day: 0, month: 0, task: 0 }],
        };
      }
      return { rows: [] };
    },
    release() {},
  };
  const repository = new PostgresUsageRepository({
    connect: async () => client,
  });

  assert.deepEqual(
    await repository.committedFor({
      taskId: 'task-1',
      userId: 'user-1',
    }),
    { dayMicroUsd: 0, monthMicroUsd: 0, taskMicroUsd: 0 },
  );
  const aggregate = statements.find((sql) => sql.includes('AS month'));
  assert.doesNotMatch(aggregate, /month_messages|lane = 'responses'/u);
});
