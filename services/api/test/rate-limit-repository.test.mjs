import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresRateLimiter } from '../src/rate-limit-repository.mjs';

test('consumes a shared database bucket without storing the raw identity', async () => {
  const statements = [];
  const limiter = new PostgresRateLimiter(
    {
      query: async (sql, parameters) => {
        statements.push({ parameters, sql });
        return {
          rows: [
            {
              request_count: 3,
              reset_at: new Date('2026-08-18T10:01:00.000Z'),
            },
          ],
        };
      },
    },
    { hmacKey: 'rate-limit-test-key-that-is-at-least-32-characters' },
  );

  const result = await limiter.consume({
    key: 'google-subject-123',
    limit: 10,
    now: new Date('2026-08-18T10:00:30.000Z'),
    scope: 'responses.minute',
    windowMs: 60_000,
  });

  assert.deepEqual(result, {
    allowed: true,
    limit: 10,
    remaining: 7,
    retryAfterSeconds: 30,
  });
  assert.match(statements[0].sql, /ON CONFLICT[\s\S]+DO UPDATE/u);
  assert(Buffer.isBuffer(statements[0].parameters[1]));
  assert.equal(statements[0].parameters[1].length, 32);
  assert.equal(
    statements[0].parameters.some((value) => value === 'google-subject-123'),
    false,
  );
});

test('denies requests after the shared bucket exceeds the plan limit', async () => {
  const limiter = new PostgresRateLimiter(
    {
      query: async () => ({
        rows: [
          {
            request_count: 11,
            reset_at: new Date('2026-08-18T10:01:00.000Z'),
          },
        ],
      }),
    },
    { hmacKey: 'rate-limit-test-key-that-is-at-least-32-characters' },
  );

  assert.deepEqual(
    await limiter.consume({
      key: 'user-1',
      limit: 10,
      now: new Date('2026-08-18T10:00:59.500Z'),
      scope: 'responses.minute',
      windowMs: 60_000,
    }),
    {
      allowed: false,
      limit: 10,
      remaining: 0,
      retryAfterSeconds: 1,
    },
  );
});
