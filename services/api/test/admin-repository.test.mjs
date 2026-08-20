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

test('lists access codes with capacity, retrieval, and legacy metadata', async () => {
  const { pool, queries } = sequencedPool([
    {
      rows: [
        {
          available_codes: 1,
          full_codes: 1,
          retrievable_codes: 1,
          paused_codes: 1,
          total_codes: 3,
          total_redemptions: 3,
        },
      ],
    },
    {
      rows: [
        {
          code_ciphertext: null,
          code_digest: Buffer.alloc(32, 1),
          created_at: new Date('2026-08-19T05:10:00.000Z'),
          filtered_total: 1,
          id: 'legacy-code-id',
          label: 'Founding cohort',
          max_users: 5,
          paused_at: null,
          plan: 'pro',
          redeemed_users: 2,
        },
      ],
    },
  ]);
  const repository = new PostgresAdminRepository(pool, {
    hmacKey: TEST_HMAC_KEY,
  });

  assert.deepEqual(
    await repository.listAccessCodes({
      limit: 50,
      offset: 0,
      search: 'Founding',
      status: 'available',
    }),
    {
      items: [
        {
          code: null,
          createdAt: '2026-08-19T05:10:00.000Z',
          id: 'legacy-code-id',
          label: 'Founding cohort',
          maxUsers: 5,
          pausedAt: null,
          plan: 'pro',
          redeemedUsers: 2,
          remainingUsers: 3,
          retrievable: false,
          status: 'available',
        },
      ],
      page: { limit: 50, offset: 0, total: 1 },
      summary: {
        availableCodes: 1,
        fullCodes: 1,
        pausedCodes: 1,
        retrievableCodes: 1,
        totalCodes: 3,
        totalRedemptions: 3,
      },
    },
  );
  assert.match(queries[1].sql, /code_ciphertext/u);
  assert.match(queries[1].sql, /LIMIT \$4 OFFSET \$5/u);
  assert.equal(queries[1].parameters[1], '%Founding%');
});

test('pauses an access code and records the admin action atomically', async () => {
  const codeId = '11111111-1111-4111-8111-111111111111';
  const pausedAt = new Date('2026-08-20T08:00:00.000Z');
  const { client, pool, queries } = sequencedPool([
    { rows: [] },
    {
      rows: [
        {
          id: codeId,
          max_users: 5,
          paused_at: pausedAt,
          redeemed_users: 2,
        },
      ],
    },
    { rows: [] },
    { rows: [] },
  ]);
  const repository = new PostgresAdminRepository(pool, {
    hmacKey: TEST_HMAC_KEY,
  });

  assert.deepEqual(await repository.setAccessCodePaused(codeId, true), {
    id: codeId,
    pausedAt: '2026-08-20T08:00:00.000Z',
    status: 'paused',
  });
  assert.match(queries[1].sql, /UPDATE access_codes/u);
  assert.deepEqual(queries[1].parameters, [codeId, true]);
  assert.match(queries[2].sql, /admin_audit_events/u);
  assert.deepEqual(queries[2].parameters, [
    'access_codes.paused',
    JSON.stringify({ accessCodeId: codeId }),
  ]);
  assert.equal(queries.at(-1).sql, 'COMMIT');
  assert.equal(client.released, true);
});

test('resumes a full access code without misreporting it as available', async () => {
  const codeId = '11111111-1111-4111-8111-111111111111';
  const { pool, queries } = sequencedPool([
    { rows: [] },
    {
      rows: [
        {
          id: codeId,
          max_users: 1,
          paused_at: null,
          redeemed_users: 1,
        },
      ],
    },
    { rows: [] },
    { rows: [] },
  ]);
  const repository = new PostgresAdminRepository(pool, {
    hmacKey: TEST_HMAC_KEY,
  });

  assert.deepEqual(await repository.setAccessCodePaused(codeId, false), {
    id: codeId,
    pausedAt: null,
    status: 'full',
  });
  assert.deepEqual(queries[2].parameters, [
    'access_codes.resumed',
    JSON.stringify({ accessCodeId: codeId }),
  ]);
  assert.equal(queries.at(-1).sql, 'COMMIT');
});

test('deletes an unused access code while preserving codes with redemptions', async () => {
  const unusedId = '11111111-1111-4111-8111-111111111111';
  const unused = sequencedPool([
    { rows: [] },
    { rows: [{ id: unusedId }] },
    { rows: [{ redeemed_users: 0 }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
  ]);
  const repository = new PostgresAdminRepository(unused.pool, {
    hmacKey: TEST_HMAC_KEY,
  });

  assert.deepEqual(await repository.deleteAccessCode(unusedId), {
    id: unusedId,
    kind: 'deleted',
  });
  assert.match(unused.queries[1].sql, /FOR UPDATE/u);
  assert.match(unused.queries[3].sql, /DELETE FROM access_codes/u);
  assert.equal(unused.queries.at(-1).sql, 'COMMIT');

  const usedId = '22222222-2222-4222-8222-222222222222';
  const used = sequencedPool([
    { rows: [] },
    { rows: [{ id: usedId }] },
    { rows: [{ redeemed_users: 2 }] },
    { rows: [] },
  ]);
  const usedRepository = new PostgresAdminRepository(used.pool, {
    hmacKey: TEST_HMAC_KEY,
  });

  assert.deepEqual(await usedRepository.deleteAccessCode(usedId), {
    id: usedId,
    kind: 'in_use',
    redeemedUsers: 2,
  });
  assert.equal(
    used.queries.some((query) => query.sql.includes('DELETE FROM access_codes')),
    false,
  );
  assert.equal(used.queries.at(-1).sql, 'ROLLBACK');
});

test('lists the users who redeemed an access code with bounded pagination', async () => {
  const codeId = '11111111-1111-4111-8111-111111111111';
  const { pool, queries } = sequencedPool([
    {
      rows: [
        {
          id: codeId,
          label: 'Launch cohort',
          max_users: 5,
          plan: 'pro',
          redeemed_users: 2,
        },
      ],
    },
    {
      rows: [
        {
          blocked_at: null,
          email: 'ada@example.com',
          id: 'google-ada',
          name: 'Ada Lovelace',
          redeemed_at: new Date('2026-08-20T05:10:00.000Z'),
        },
        {
          blocked_at: new Date('2026-08-20T06:00:00.000Z'),
          email: 'grace@example.com',
          id: 'google-grace',
          name: 'Grace Hopper',
          redeemed_at: new Date('2026-08-19T05:10:00.000Z'),
        },
      ],
    },
  ]);
  const repository = new PostgresAdminRepository(pool, {
    hmacKey: TEST_HMAC_KEY,
  });

  assert.deepEqual(
    await repository.listAccessCodeUsers(codeId, { limit: 25, offset: 0 }),
    {
      code: {
        id: codeId,
        label: 'Launch cohort',
        maxUsers: 5,
        plan: 'pro',
        redeemedUsers: 2,
      },
      items: [
        {
          email: 'ada@example.com',
          id: 'google-ada',
          name: 'Ada Lovelace',
          redeemedAt: '2026-08-20T05:10:00.000Z',
          status: 'active',
        },
        {
          email: 'grace@example.com',
          id: 'google-grace',
          name: 'Grace Hopper',
          redeemedAt: '2026-08-19T05:10:00.000Z',
          status: 'blocked',
        },
      ],
      page: { limit: 25, offset: 0, total: 2 },
    },
  );
  assert.match(queries[1].sql, /redemptions\.access_code_id = \$1/u);
  assert.match(queries[1].sql, /LIMIT \$2 OFFSET \$3/u);
  assert.deepEqual(queries[1].parameters, [codeId, 25, 0]);
});

test('returns null when listing users for a missing access code', async () => {
  const { pool, queries } = sequencedPool([{ rows: [] }]);
  const repository = new PostgresAdminRepository(pool, {
    hmacKey: TEST_HMAC_KEY,
  });

  assert.equal(
    await repository.listAccessCodeUsers(
      '22222222-2222-4222-8222-222222222222',
      { limit: 50, offset: 0 },
    ),
    null,
  );
  assert.equal(queries.length, 1);
});

test('bulk code creation returns plaintext and stores a digest plus encrypted copy', async () => {
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
  assert.ok(Buffer.isBuffer(inserts[0].parameters[1]));
  assert.equal(
    inserts[0].parameters[1].includes(Buffer.from('TRO-CODE-ONE')),
    false,
  );
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
