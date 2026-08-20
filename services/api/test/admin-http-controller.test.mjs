import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { AdminHttpController } from '../src/admin-http-controller.mjs';

const ADMIN_TOKEN = 'test-admin-token-that-is-longer-than-thirty-two-characters';

async function withAdmin(run) {
  const calls = [];
  const repository = {
    createAccessCodes: async (input) => {
      calls.push({ input, method: 'createAccessCodes' });
      return {
        items: [
          {
            code: 'TRO-ONE-TIME-CODE',
            createdAt: '2026-08-20T05:00:00.000Z',
            id: 'code-1',
            label: input.label,
            maxUsers: input.maxUsers,
            plan: input.plan,
          },
        ],
      };
    },
    listAccessCodes: async (input) => {
      calls.push({ input, method: 'listAccessCodes' });
      return {
        items: [
          {
            code: 'TRO-RETRIEVABLE-CODE',
            createdAt: '2026-08-20T05:00:00.000Z',
            id: 'code-1',
            label: 'Launch',
            maxUsers: 3,
            plan: 'pro',
            redeemedUsers: 1,
            remainingUsers: 2,
            retrievable: true,
            status: 'available',
          },
        ],
        page: { limit: input.limit, offset: input.offset, total: 1 },
        summary: {
          availableCodes: 1,
          fullCodes: 0,
          retrievableCodes: 1,
          totalCodes: 1,
          totalRedemptions: 1,
        },
      };
    },
    listUsers: async (input) => {
      calls.push({ input, method: 'listUsers' });
      return {
        items: [],
        page: { limit: input.limit, offset: input.offset, total: 0 },
        summary: { activeUsers: 0, blockedUsers: 0, totalUsers: 0 },
      };
    },
    setUserBlocked: async (id, blocked) => {
      calls.push({ blocked, id, method: 'setUserBlocked' });
      return {
        blockedAt: blocked ? '2026-08-20T05:00:00.000Z' : null,
        id,
        status: blocked ? 'blocked' : 'active',
      };
    },
  };
  const controller = new AdminHttpController({
    accessToken: ADMIN_TOKEN,
    rateLimiter: {
      consume: async ({ limit }) => ({
        allowed: true,
        limit,
        remaining: limit - 1,
        retryAfterSeconds: 1,
      }),
    },
    repository,
  });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      if (await controller.handle({ request, response, url })) return;
      response.statusCode = 404;
      response.end('Not found');
    } catch (error) {
      response.statusCode = Number.isInteger(error?.status) ? error.status : 500;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: error?.message ?? 'Internal error' }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run({ baseUrl, calls });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function adminHeaders(baseUrl) {
  return {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    Origin: baseUrl,
  };
}

test('serves the separate admin dashboard with a strict self-only CSP', async () => {
  await withAdmin(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/source/admin`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/u);
    assert.match(html, /<h1[^>]*>Users<\/h1>/u);
    assert.match(html, /<h1[^>]*>Access codes<\/h1>/u);
    assert.doesNotMatch(html, new RegExp(ADMIN_TOKEN, 'u'));

    const script = await fetch(`${baseUrl}/source/admin/assets/admin.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/u);
  });
});

test('lists access codes with bounded filters and prevents response caching', async () => {
  await withAdmin(async ({ baseUrl, calls }) => {
    const response = await fetch(
      `${baseUrl}/v1/admin/access-codes?limit=25&offset=50&search=launch&status=available`,
      { headers: adminHeaders(baseUrl) },
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(calls, [
      {
        input: {
          limit: 25,
          offset: 50,
          search: 'launch',
          status: 'available',
        },
        method: 'listAccessCodes',
      },
    ]);
    assert.equal((await response.json()).items[0].code, 'TRO-RETRIEVABLE-CODE');
  });
});

test('requires the admin bearer token and a same-origin browser request', async () => {
  await withAdmin(async ({ baseUrl }) => {
    const missing = await fetch(`${baseUrl}/v1/admin/users`);
    assert.equal(missing.status, 401);

    const wrong = await fetch(`${baseUrl}/v1/admin/users`, {
      headers: { Authorization: 'Bearer definitely-wrong' },
    });
    assert.equal(wrong.status, 401);

    const crossOrigin = await fetch(`${baseUrl}/v1/admin/users`, {
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        Origin: 'https://evil.example',
      },
    });
    assert.equal(crossOrigin.status, 403);
  });
});

test('lists users with bounded pagination and search', async () => {
  await withAdmin(async ({ baseUrl, calls }) => {
    const response = await fetch(
      `${baseUrl}/v1/admin/users?limit=25&offset=50&search=ada%40example.com`,
      { headers: adminHeaders(baseUrl) },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      {
        input: { limit: 25, offset: 50, search: 'ada@example.com' },
        method: 'listUsers',
      },
    ]);
  });
});

test('blocks a user and rejects malformed access changes', async () => {
  await withAdmin(async ({ baseUrl, calls }) => {
    const response = await fetch(
      `${baseUrl}/v1/admin/users/google-user-1/access`,
      {
        body: JSON.stringify({ blocked: true }),
        headers: {
          ...adminHeaders(baseUrl),
          'Content-Type': 'application/json',
        },
        method: 'PATCH',
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      {
        blocked: true,
        id: 'google-user-1',
        method: 'setUserBlocked',
      },
    ]);

    const malformed = await fetch(
      `${baseUrl}/v1/admin/users/google-user-1/access`,
      {
        body: JSON.stringify({ blocked: 'yes' }),
        headers: {
          ...adminHeaders(baseUrl),
          'Content-Type': 'application/json',
        },
        method: 'PATCH',
      },
    );
    assert.equal(malformed.status, 400);
  });
});

test('creates a validated batch of one-time access codes for a selected plan', async () => {
  await withAdmin(async ({ baseUrl, calls }) => {
    const response = await fetch(`${baseUrl}/v1/admin/access-codes/bulk`, {
      body: JSON.stringify({
        count: 6,
        label: 'September launch',
        maxUsers: 2,
        plan: 'pro',
      }),
      headers: {
        ...adminHeaders(baseUrl),
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    assert.equal(response.status, 201);
    assert.deepEqual(calls, [
      {
        input: {
          count: 6,
          label: 'September launch',
          maxUsers: 2,
          plan: 'pro',
        },
        method: 'createAccessCodes',
      },
    ]);
    assert.equal((await response.json()).items[0].code, 'TRO-ONE-TIME-CODE');

    const invalid = await fetch(`${baseUrl}/v1/admin/access-codes/bulk`, {
      body: JSON.stringify({ count: 0, maxUsers: 1, plan: 'enterprise' }),
      headers: {
        ...adminHeaders(baseUrl),
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    assert.equal(invalid.status, 400);
  });
});
