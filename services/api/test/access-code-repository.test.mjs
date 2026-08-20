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

test('returns the Free plan for an account without an access code', async () => {
  const { pool } = sequencedPool([
    {
      rows: [
        {
          max_users: null,
          plan: 'free',
          used_users: 0,
        },
      ],
    },
  ]);
  const repository = new PostgresAccessCodeRepository(pool, {
    hmacKey: TEST_HMAC_KEY,
  });

  assert.deepEqual(await repository.getStatus('user-1'), {
    maxUsers: null,
    newlyRedeemed: false,
    plan: 'free',
    state: 'active',
    summary: 'Free plan active.',
    usedUsers: null,
  });
});

test('returns an inactive status for a blocked account', async () => {
  const { pool } = sequencedPool([
    {
      rows: [
        {
          blocked_at: new Date('2026-08-20T05:00:00.000Z'),
          max_users: 10,
          plan: 'pro',
          used_users: 3,
        },
      ],
    },
  ]);
  const repository = new PostgresAccessCodeRepository(pool, {
    hmacKey: TEST_HMAC_KEY,
  });

  assert.deepEqual(await repository.getStatus('blocked-user'), {
    maxUsers: 10,
    newlyRedeemed: false,
    plan: 'pro',
    state: 'inactive',
    summary: 'This account has been blocked by an administrator.',
    usedUsers: 3,
  });
});

test('redeems a code while holding user and code row locks', async () => {
  const { client, pool, queries } = sequencedPool([
    { rows: [] },
    { rows: [{ id: 'user-1' }] },
    { rows: [] },
    { rows: [{ id: 'code-1', max_users: 10, plan: 'pro' }] },
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
      plan: 'pro',
      state: 'active',
      summary: 'Access code accepted.',
      usedUsers: 10,
    },
  });
  assert.match(queries[1].sql, /users WHERE id = \$1 FOR UPDATE/u);
  assert.match(queries[3].sql, /access_codes[\s\S]+FOR UPDATE/u);
  assert.match(queries.at(-2).sql, /UPDATE users[\s\S]+SET plan = \$2/u);
  assert.equal(queries.at(-1).sql, 'COMMIT');
  assert.equal(client.released, true);
});

test('rejects a full code without inserting a redemption', async () => {
  const { client, pool, queries } = sequencedPool([
    { rows: [] },
    { rows: [{ id: 'user-2' }] },
    { rows: [] },
    { rows: [{ id: 'code-1', max_users: 10, plan: 'basic' }] },
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
        {
          code_digest: firstCodeDigest,
          max_users: 10,
          plan: 'max',
          used_users: 4,
        },
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
