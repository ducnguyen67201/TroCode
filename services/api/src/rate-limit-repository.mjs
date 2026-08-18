import { createHmac } from 'node:crypto';

const SCOPE_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/u;

function positiveInteger(name, value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

export class PostgresRateLimiter {
  constructor(pool, { hmacKey }) {
    if (typeof hmacKey !== 'string' || hmacKey.length < 32) {
      throw new Error('Rate-limit HMAC key must be at least 32 characters.');
    }
    this.pool = pool;
    this.hmacKey = hmacKey;
  }

  async consume({ key, limit, now = new Date(), scope, windowMs }) {
    positiveInteger('limit', limit);
    positiveInteger('windowMs', windowMs);
    if (typeof key !== 'string' || key.length < 1 || key.length > 512) {
      throw new Error('Rate-limit key must be a bounded nonempty string.');
    }
    if (typeof scope !== 'string' || !SCOPE_PATTERN.test(scope)) {
      throw new Error('Rate-limit scope is invalid.');
    }
    const nowDate = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(nowDate.getTime())) {
      throw new Error('Rate-limit time is invalid.');
    }
    const windowStartedAt = new Date(
      Math.floor(nowDate.getTime() / windowMs) * windowMs,
    );
    const identityDigest = createHmac('sha256', this.hmacKey)
      .update('trocode-rate-limit-v1\0', 'utf8')
      .update(scope, 'utf8')
      .update('\0', 'utf8')
      .update(key, 'utf8')
      .digest();
    const result = await this.pool.query(
      `INSERT INTO api_rate_limit_buckets
         (scope, identity_digest, window_started_at, request_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (scope, identity_digest, window_started_at)
       DO UPDATE SET request_count = api_rate_limit_buckets.request_count + 1,
                     updated_at = NOW()
       RETURNING request_count,
                 window_started_at + ($4 * INTERVAL '1 millisecond') AS reset_at`,
      [scope, identityDigest, windowStartedAt, windowMs],
    );
    const count = Number(result.rows[0]?.request_count);
    const resetAt = new Date(result.rows[0]?.reset_at);
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(resetAt.getTime())) {
      throw new Error('Rate-limit repository returned invalid bucket data.');
    }
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((resetAt.getTime() - nowDate.getTime()) / 1_000),
      ),
    };
  }
}
