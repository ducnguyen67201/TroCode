import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresSessionRepository } from '../src/session-repository.mjs';

const TEST_HMAC_KEY = 'test-session-repository-key-that-is-at-least-32-characters';

function poolWithResponses(responses) {
  const queries = [];
  const client = {
    query: async (sql, parameters = []) => {
      queries.push({ parameters, sql });
      return responses.shift() ?? { rows: [] };
    },
    release: () => undefined,
  };
  return {
    pool: {
      connect: async () => client,
      query: client.query,
    },
    queries,
  };
}

test('does not issue a new session to a blocked account', async () => {
  const { pool, queries } = poolWithResponses([
    { rows: [] },
    { rows: [{ blocked_at: new Date('2026-08-20T05:00:00.000Z') }] },
    { rows: [] },
  ]);
  const repository = new PostgresSessionRepository(pool, {
    hmacKey: TEST_HMAC_KEY,
    sessionDurationDays: 30,
  });

  assert.equal(
    await repository.issue({
      email: 'blocked@example.com',
      id: 'blocked-user',
      name: 'Blocked User',
    }),
    null,
  );
  assert.equal(
    queries.some((query) => query.sql.includes('INSERT INTO device_sessions')),
    false,
  );
  assert.equal(queries.at(-1).sql, 'ROLLBACK');
});

test('existing sessions stop authenticating after an account is blocked', async () => {
  const { pool, queries } = poolWithResponses([{ rows: [] }]);
  const repository = new PostgresSessionRepository(pool, {
    hmacKey: TEST_HMAC_KEY,
    sessionDurationDays: 30,
  });

  assert.equal(
    await repository.authenticate(`tro_live_${'a'.repeat(43)}`),
    null,
  );
  assert.match(queries[0].sql, /users\.blocked_at IS NULL/u);
});
