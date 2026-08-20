import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresAdminRepository } from '../src/admin-repository.mjs';

const TEST_HMAC_KEY = 'test-admin-repository-key-that-is-at-least-32-characters';

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
      query: client.query,
    },
    queries,
  };
}

test('lists bounded user records with access and plan metadata', async () => {
  const { pool, queries } = sequencedPool([
    {
      rows: [{ active_users: 7, blocked_users: 2, total_users: 9 }],
    },
    {
      rows: [
        {
          blocked_at: null,
          code_label: 'August cohort',
          created_at: new Date('2026-08-01T00:00:00.000Z'),
          email: 'ada@example.com',
          id: 'google-ada',
          last_seen_at: new Date('2026-08-20T04:00:00.000Z'),
          name: 'Ada',
          plan: 'pro',
        },
      ],
    },
  ]);
  const repository = new PostgresAdminRepository(pool, {
    hmacKey: TEST_HMAC_KEY,
  });

  assert.deepEqual(
    await repository.listUsers({ limit: 50, offset: 0, search: 'ada' }),
    {
      items: [
        {
          blockedAt: null,
          codeLabel: 'August cohort',
          createdAt: '2026-08-01T00:00:00.000Z',
          email: 'ada@example.com',
          id: 'google-ada',
          lastSeenAt: '2026-08-20T04:00:00.000Z',
          name: 'Ada',
          plan: 'pro',
          status: 'active',
        },
      ],
      page: { limit: 50, offset: 0, total: 9 },
      summary: { activeUsers: 7, blockedUsers: 2, totalUsers: 9 },
    },
  );
  assert.match(queries[1].sql, /LIMIT \$2 OFFSET \$3/u);
  assert.deepEqual(queries[1].parameters, ['%ada%', 50, 0]);
});

test('blocking a user also revokes every active device session', async () => {
  const { client, pool, queries } = sequencedPool([
    { rows: [] },
    {
      rows: [
        {
          blocked_at: new Date('2026-08-20T05:00:00.000Z'),
          id: 'google-user-1',
        },
      ],
    },
    { rows: [] },
    { rows: [] },
  ]);
  const repository = new PostgresAdminRepository(pool, {
    hmacKey: TEST_HMAC_KEY,
  });

  assert.deepEqual(await repository.setUserBlocked('google-user-1', true), {
    blockedAt: '2026-08-20T05:00:00.000Z',
    id: 'google-user-1',
    status: 'blocked',
  });
  assert.match(queries[1].sql, /UPDATE users/u);
  assert.match(queries[2].sql, /UPDATE device_sessions[\s\S]+revoked_at/u);
  assert.equal(queries.at(-1).sql, 'COMMIT');
  assert.equal(client.released, true);
});

test('bulk code creation returns plaintext once and stores only digests', async () => {
  const generated = ['TRO-CODE-ONE', 'TRO-CODE-TWO'];
  const { client, pool, queries } = sequencedPool([
    { rows: [] },
    {
      rows: [
        {
          created_at: new Date('2026-08-20T05:10:00.000Z'),
          id: 'code-id-1',
        },
      ],
    },
    {
      rows: [
        {
          created_at: new Date('2026-08-20T05:10:01.000Z'),
          id: 'code-id-2',
        },
      ],
    },
    { rows: [] },
  ]);
  const repository = new PostgresAdminRepository(pool, {
    generateCode: () => generated.shift(),
    hmacKey: TEST_HMAC_KEY,
  });

  const result = await repository.createAccessCodes({
    count: 2,
    label: 'Launch',
    maxUsers: 3,
    plan: 'max',
  });

  assert.deepEqual(result, {
    items: [
      {
        code: 'TRO-CODE-ONE',
        createdAt: '2026-08-20T05:10:00.000Z',
        id: 'code-id-1',
        label: 'Launch 1/2',
        maxUsers: 3,
        plan: 'max',
      },
      {
        code: 'TRO-CODE-TWO',
        createdAt: '2026-08-20T05:10:01.000Z',
        id: 'code-id-2',
        label: 'Launch 2/2',
        maxUsers: 3,
        plan: 'max',
      },
    ],
  });
  const inserts = queries.filter((query) =>
    query.sql.includes('INSERT INTO access_codes'),
  );
  assert.equal(inserts.length, 2);
  assert.ok(Buffer.isBuffer(inserts[0].parameters[0]));
  assert.equal(inserts[0].parameters.includes('TRO-CODE-ONE'), false);
  assert.equal(queries.at(-1).sql, 'COMMIT');
  assert.equal(client.released, true);
});

test('bulk code creation rolls back the whole batch after a collision', async () => {
  const duplicate = Object.assign(new Error('duplicate'), { code: '23505' });
  const { client, pool, queries } = sequencedPool([
    { rows: [] },
    duplicate,
    { rows: [] },
  ]);
  const repository = new PostgresAdminRepository(pool, {
    generateCode: () => 'TRO-DUPLICATE',
    hmacKey: TEST_HMAC_KEY,
  });

  await assert.rejects(
    repository.createAccessCodes({
      count: 1,
      label: null,
      maxUsers: 1,
      plan: 'basic',
    }),
    /generate unique access codes/u,
  );
  assert.equal(queries.at(-1).sql, 'ROLLBACK');
  assert.equal(client.released, true);
});
