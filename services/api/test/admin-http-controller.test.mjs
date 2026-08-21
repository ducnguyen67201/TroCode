import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { AdminHttpController } from '../src/admin-http-controller.mjs';

const ADMIN_TOKEN = 'test-admin-token-that-is-longer-than-thirty-two-characters';

async function withAdmin(run, { now } = {}) {
  const calls = [];
  const repository = {
    grantAccessCode: async (userId, accessCodeId) => {
      calls.push({ accessCodeId, method: 'grantAccessCode', userId });
      if (userId === 'missing-user') return { kind: 'user_not_found' };
      if (accessCodeId === '22222222-2222-4222-8222-222222222222') {
        return { kind: 'code_full' };
      }
      return {
        accessCodeId,
        codeLabel: 'Launch',
        kind: 'granted',
        plan: 'pro',
        remainingUsers: 1,
        userId,
      };
    },
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
    deleteAccessCode: async (id) => {
      calls.push({ id, method: 'deleteAccessCode' });
      if (id === '22222222-2222-4222-8222-222222222222') {
        return { id, kind: 'in_use', redeemedUsers: 1 };
      }
      return { id, kind: 'deleted' };
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
            pausedAt: null,
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
          pausedCodes: 0,
          retrievableCodes: 1,
          totalCodes: 1,
          totalRedemptions: 1,
        },
      };
    },
    listAccessCodeUsers: async (id, input) => {
      calls.push({ id, input, method: 'listAccessCodeUsers' });
      if (id === '22222222-2222-4222-8222-222222222222') return null;
      return {
        code: {
          id,
          label: 'Launch',
          maxUsers: 3,
          plan: 'pro',
          redeemedUsers: 1,
        },
        items: [
          {
            email: 'ada@example.com',
            id: 'google-ada',
            name: 'Ada',
            redeemedAt: '2026-08-20T05:00:00.000Z',
            status: 'active',
          },
        ],
        page: { limit: input.limit, offset: input.offset, total: 1 },
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
    listUsage: async (input) => {
      calls.push({ input, method: 'listUsage' });
      return {
        items: [
          {
            activityTitle: null,
            amountMicroUsd: 4200,
            createdAt: '2026-08-20T05:00:00.000Z',
            id: 'usage-1',
            lane: 'responses',
            model: 'gpt-5.6-luna',
            taskId: '11111111-1111-4111-8111-111111111111',
            user: {
              email: 'ada@example.com',
              id: 'google-ada',
              name: 'Ada',
              plan: 'pro',
            },
          },
        ],
        page: { limit: input.limit, offset: input.offset, total: 1 },
        series: {
          granularity: 'day',
          items: [
            {
              requests: 1,
              spendMicroUsd: 4200,
              startedAt: '2026-08-20T00:00:00.000Z',
              tokens: 1200,
            },
          ],
        },
        summary: {
          activeUsers: 1,
          totalRequests: 1,
          totalSpendMicroUsd: 4200,
          totalTokens: 1200,
        },
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
    setAccessCodePaused: async (id, paused) => {
      calls.push({ id, method: 'setAccessCodePaused', paused });
      return {
        id,
        pausedAt: paused ? '2026-08-20T08:00:00.000Z' : null,
        status: paused ? 'paused' : 'available',
      };
    },
  };
  const controller = new AdminHttpController({
    accessToken: ADMIN_TOKEN,
    now,
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
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
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
    assert.match(html, /<h1[^>]*>Usage<\/h1>/u);
    assert.match(html, /id="usage-nav"/u);
    assert.match(html, /id="usage-chart"/u);
    assert.match(html, /Prompts, outputs, screenshots, and tool inputs are never stored/u);
    assert.match(html, /Who(?:&rsquo;|')s using it/u);
    assert.match(html, /id="code-users-dialog"/u);
    assert.match(html, /id="grant-code-dialog"/u);
    assert.match(html, /id="grant-code-search"/u);
    assert.match(html, /id="grant-code-load-more"/u);
    assert.doesNotMatch(html, new RegExp(ADMIN_TOKEN, 'u'));

    const script = await fetch(`${baseUrl}/source/admin/assets/admin.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/u);
    const javascript = await script.text();
    assert.match(javascript, /restoreSession/u);
    assert.match(javascript, /\/v1\/admin\/session/u);
    assert.match(javascript, /pauseAccessCode/u);
    assert.match(javascript, /deleteAccessCode/u);
    assert.match(javascript, /\/v1\/admin\/usage/u);
    assert.match(javascript, /renderUsageChart/u);
    assert.match(javascript, /grantAccessCode/u);
    assert.match(html, /signed in for 30 days/u);
    assert.match(html, /<th scope="col">Actions<\/th>/u);
  });
});

test('lists usage with bounded privacy-safe filters and no caching', async () => {
  await withAdmin(async ({ baseUrl, calls }) => {
    const response = await fetch(`${baseUrl}/v1/admin/usage?limit=25&offset=50&search=ada&lane=responses&range=7d`, {
      headers: adminHeaders(baseUrl),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(calls, [
      {
        input: {
          lane: 'responses',
          limit: 25,
          offset: 50,
          range: '7d',
          search: 'ada',
        },
        method: 'listUsage',
      },
    ]);
    const body = await response.json();
    assert.equal(body.items[0].user.email, 'ada@example.com');
    assert.equal(body.series.items[0].spendMicroUsd, 4200);

    const invalidLane = await fetch(`${baseUrl}/v1/admin/usage?lane=prompts`, {
      headers: adminHeaders(baseUrl),
    });
    assert.equal(invalidLane.status, 400);

    const invalidRange = await fetch(`${baseUrl}/v1/admin/usage?range=forever`, { headers: adminHeaders(baseUrl) });
    assert.equal(invalidRange.status, 400);
  });
});

test('keeps the administrator signed in with a hardened browser session', async () => {
  let now = Date.parse('2026-08-20T08:45:00.000Z');
  await withAdmin(
    async ({ baseUrl, calls }) => {
      const login = await fetch(`${baseUrl}/v1/admin/session`, {
        headers: adminHeaders(baseUrl),
        method: 'POST',
      });
      const setCookie = login.headers.get('set-cookie');

      assert.equal(login.status, 204);
      assert.match(setCookie, /trocode_admin_session=/u);
      assert.match(setCookie, /HttpOnly/u);
      assert.match(setCookie, /Secure/u);
      assert.match(setCookie, /SameSite=Strict/u);
      assert.match(setCookie, /Max-Age=2592000/u);
      assert.doesNotMatch(setCookie, new RegExp(ADMIN_TOKEN, 'u'));

      const cookie = setCookie.split(';', 1)[0];
      const restored = await fetch(`${baseUrl}/v1/admin/users`, {
        headers: { Cookie: cookie, Origin: baseUrl },
      });
      assert.equal(restored.status, 200);
      assert.equal(calls.at(-1).method, 'listUsers');

      now += 2_592_000_001;
      const expired = await fetch(`${baseUrl}/v1/admin/users`, {
        headers: { Cookie: cookie, Origin: baseUrl },
      });
      assert.equal(expired.status, 401);
    },
    { now: () => now },
  );
});

test('locking the dashboard clears the persistent browser session', async () => {
  await withAdmin(async ({ baseUrl }) => {
    const login = await fetch(`${baseUrl}/v1/admin/session`, {
      headers: adminHeaders(baseUrl),
      method: 'POST',
    });
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const logout = await fetch(`${baseUrl}/v1/admin/session`, {
      headers: { Cookie: cookie, Origin: baseUrl },
      method: 'DELETE',
    });

    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/u);
    assert.equal(logout.headers.get('cache-control'), 'no-store');
  });
});

test('lists access codes with bounded filters and prevents response caching', async () => {
  await withAdmin(async ({ baseUrl, calls }) => {
    const response = await fetch(`${baseUrl}/v1/admin/access-codes?limit=25&offset=50&search=launch&status=available`, {
      headers: adminHeaders(baseUrl),
    });

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

test('lists users of one access code with validated, bounded pagination', async () => {
  const codeId = '11111111-1111-4111-8111-111111111111';
  await withAdmin(async ({ baseUrl, calls }) => {
    const response = await fetch(`${baseUrl}/v1/admin/access-codes/${codeId}/users?limit=25&offset=50`, {
      headers: adminHeaders(baseUrl),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(calls, [
      {
        id: codeId,
        input: { limit: 25, offset: 50 },
        method: 'listAccessCodeUsers',
      },
    ]);
    assert.equal((await response.json()).items[0].email, 'ada@example.com');

    const invalidId = await fetch(`${baseUrl}/v1/admin/access-codes/not-a-uuid/users`, {
      headers: adminHeaders(baseUrl),
    });
    assert.equal(invalidId.status, 400);
  });
});

test('returns not found when an access code user list does not exist', async () => {
  await withAdmin(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/v1/admin/access-codes/22222222-2222-4222-8222-222222222222/users`, {
      headers: adminHeaders(baseUrl),
    });

    assert.equal(response.status, 404);
  });
});

test('pauses an access code with a strict validated request', async () => {
  const codeId = '11111111-1111-4111-8111-111111111111';
  await withAdmin(async ({ baseUrl, calls }) => {
    const response = await fetch(`${baseUrl}/v1/admin/access-codes/${codeId}`, {
      body: JSON.stringify({ paused: true }),
      headers: {
        ...adminHeaders(baseUrl),
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    });

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [{ id: codeId, method: 'setAccessCodePaused', paused: true }]);
    assert.equal((await response.json()).status, 'paused');

    const resumed = await fetch(`${baseUrl}/v1/admin/access-codes/${codeId}`, {
      body: JSON.stringify({ paused: false }),
      headers: {
        ...adminHeaders(baseUrl),
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    });
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).status, 'available');
    assert.deepEqual(calls.at(-1), {
      id: codeId,
      method: 'setAccessCodePaused',
      paused: false,
    });

    const invalid = await fetch(`${baseUrl}/v1/admin/access-codes/${codeId}`, {
      body: JSON.stringify({ paused: 'yes' }),
      headers: {
        ...adminHeaders(baseUrl),
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    });
    assert.equal(invalid.status, 400);
  });
});

test('deletes only unused access codes', async () => {
  const unusedId = '11111111-1111-4111-8111-111111111111';
  const usedId = '22222222-2222-4222-8222-222222222222';
  await withAdmin(async ({ baseUrl, calls }) => {
    const deleted = await fetch(`${baseUrl}/v1/admin/access-codes/${unusedId}`, {
      headers: adminHeaders(baseUrl),
      method: 'DELETE',
    });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).kind, 'deleted');

    const protectedHistory = await fetch(`${baseUrl}/v1/admin/access-codes/${usedId}`, {
      headers: adminHeaders(baseUrl),
      method: 'DELETE',
    });
    assert.equal(protectedHistory.status, 409);
    assert.deepEqual(calls, [
      { id: unusedId, method: 'deleteAccessCode' },
      { id: usedId, method: 'deleteAccessCode' },
    ]);
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
    const response = await fetch(`${baseUrl}/v1/admin/users?limit=25&offset=50&search=ada%40example.com`, {
      headers: adminHeaders(baseUrl),
    });

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
    const response = await fetch(`${baseUrl}/v1/admin/users/google-user-1/access`, {
      body: JSON.stringify({ blocked: true }),
      headers: {
        ...adminHeaders(baseUrl),
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      {
        blocked: true,
        id: 'google-user-1',
        method: 'setUserBlocked',
      },
    ]);

    const malformed = await fetch(`${baseUrl}/v1/admin/users/google-user-1/access`, {
      body: JSON.stringify({ blocked: 'yes' }),
      headers: {
        ...adminHeaders(baseUrl),
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    });
    assert.equal(malformed.status, 400);
  });
});

test('grants a selected available code to a user with validated conflicts', async () => {
  const codeId = '11111111-1111-4111-8111-111111111111';
  await withAdmin(async ({ baseUrl, calls }) => {
    const response = await fetch(`${baseUrl}/v1/admin/users/google-user-1/access-code`, {
      body: JSON.stringify({ accessCodeId: codeId }),
      headers: {
        ...adminHeaders(baseUrl),
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    assert.equal(response.status, 201);
    assert.deepEqual(calls, [
      {
        accessCodeId: codeId,
        method: 'grantAccessCode',
        userId: 'google-user-1',
      },
    ]);
    assert.equal((await response.json()).kind, 'granted');

    const full = await fetch(`${baseUrl}/v1/admin/users/google-user-1/access-code`, {
      body: JSON.stringify({
        accessCodeId: '22222222-2222-4222-8222-222222222222',
      }),
      headers: {
        ...adminHeaders(baseUrl),
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    assert.equal(full.status, 409);

    const malformed = await fetch(`${baseUrl}/v1/admin/users/google-user-1/access-code`, {
      body: JSON.stringify({ accessCodeId: 'not-a-uuid' }),
      headers: {
        ...adminHeaders(baseUrl),
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
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
