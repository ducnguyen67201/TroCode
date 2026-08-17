import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PostgresAccessCodeRepository,
  digestAccessCode,
  normalizeAccessCode,
} from '../src/access-code-repository.mjs';

const TEST_HMAC_KEY = 'test-access-code-key-that-is-at-least-32-characters';

function sequencedPool(responses) {
  const queries = [];
  const client = {
    query: async (sql, parameters = []) => {
      queries.push({ parameters, sql });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response ?? { rows: [] };
    },
    release: () => {
      client.released = true;
    },
    released: false,
  };
  return {
    client,
    pool: {
      connect: async () => client,
      query: async (sql, parameters = []) => {
        queries.push({ parameters, sql });
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response ?? { rows: [] };
      },
    },
    queries,
  };
}

test('normalizes access codes and hashes equivalent input identically', () => {
  assert.equal(normalizeAccessCode(' code-a_1 '), 'CODE-A_1');
  assert.equal(normalizeAccessCode('bad code'), null);
  assert.equal(normalizeAccessCode('abc'), null);
  assert.deepEqual(
    digestAccessCode('codea', TEST_HMAC_KEY),
    digestAccessCode(' CODEA ', TEST_HMAC_KEY),
  );
  assert.notDeepEqual(
    digestAccessCode('CODEA', TEST_HMAC_KEY),
    digestAccessCode('CODEA', 'another-test-access-code-key-with-32-characters'),
  );
});

test('redeems a code while holding user and code row locks', async () => {
  const { client, pool, queries } = sequencedPool([
    { rows: [] },
    { rows: [{ id: 'user-1' }] },
    { rows: [] },
    { rows: [{ id: 'code-1', max_users: 10 }] },
    { rows: [{ used_users: 9 }] },
    { rows: [] },
    { rows: [] },
  ]);
  const repository = new PostgresAccessCodeRepository(pool, {
    hmacKey: TEST_HMAC_KEY,
  });

  assert.deepEqual(await repository.redeem('user-1', 'CODEA'), {
    kind: 'active',
    status: {
      maxUsers: 10,
      newlyRedeemed: true,
      state: 'active',
      summary: 'Access code accepted.',
      usedUsers: 10,
    },
  });
  assert.match(queries[1].sql, /users WHERE id = \$1 FOR UPDATE/u);
  assert.match(queries[3].sql, /access_codes[\s\S]+FOR UPDATE/u);
  assert.equal(queries.at(-1).sql, 'COMMIT');
  assert.equal(client.released, true);
});

test('rejects a full code without inserting a redemption', async () => {
  const { client, pool, queries } = sequencedPool([
    { rows: [] },
    { rows: [{ id: 'user-2' }] },
    { rows: [] },
    { rows: [{ id: 'code-1', max_users: 10 }] },
    { rows: [{ used_users: 10 }] },
    { rows: [] },
  ]);
  const repository = new PostgresAccessCodeRepository(pool, {
    hmacKey: TEST_HMAC_KEY,
  });

  assert.deepEqual(await repository.redeem('user-2', 'CODEA'), {
    kind: 'code_full',
  });
  assert.equal(
    queries.some((query) => query.sql.includes('INSERT INTO access_code_redemptions')),
    false,
  );
  assert.equal(queries.at(-1).sql, 'ROLLBACK');
  assert.equal(client.released, true);
});

test('keeps an account linked to its first access code', async () => {
  const firstCodeDigest = digestAccessCode('CODEA', TEST_HMAC_KEY);
  const { pool, queries } = sequencedPool([
    { rows: [] },
    { rows: [{ id: 'user-1' }] },
    {
      rows: [
        { code_digest: firstCodeDigest, max_users: 10, used_users: 4 },
      ],
    },
    { rows: [] },
  ]);
  const repository = new PostgresAccessCodeRepository(pool, {
    hmacKey: TEST_HMAC_KEY,
  });

  assert.deepEqual(await repository.redeem('user-1', 'CODEB'), {
    kind: 'account_already_linked',
  });
  assert.equal(queries.at(-1).sql, 'COMMIT');
});
