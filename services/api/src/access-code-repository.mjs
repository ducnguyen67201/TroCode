import { createHmac } from 'node:crypto';

import { planFor } from './plan-catalog.mjs';

const ACCESS_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{3,63}$/u;

export function normalizeAccessCode(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return ACCESS_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function digestAccessCode(value, hmacKey) {
  const normalized = normalizeAccessCode(value);
  if (!normalized) return null;
  if (typeof hmacKey !== 'string' || hmacKey.length < 32) {
    throw new Error('Access-code HMAC key must be at least 32 characters.');
  }
  return createHmac('sha256', hmacKey)
    .update('trocode-access-code-v1\0', 'utf8')
    .update(normalized, 'utf8')
    .digest();
}

function activeStatus(row, newlyRedeemed = false) {
  const maxUsers = Number(row.max_users);
  const usedUsers = Number(row.used_users);
  planFor(row.plan);
  return {
    maxUsers,
    newlyRedeemed,
    plan: row.plan,
    state: 'active',
    summary: 'Access code accepted.',
    usedUsers,
  };
}

export class PostgresAccessCodeRepository {
  constructor(pool, { hmacKey }) {
    this.pool = pool;
    this.hmacKey = hmacKey;
  }

  async getStatus(userId) {
    const result = await this.pool.query(
      `SELECT codes.max_users,
              codes.plan,
              COUNT(usage.user_id)::INTEGER AS used_users
       FROM access_code_redemptions AS own_redemption
       JOIN access_codes AS codes
         ON codes.id = own_redemption.access_code_id
       JOIN access_code_redemptions AS usage
         ON usage.access_code_id = codes.id
       WHERE own_redemption.user_id = $1
       GROUP BY codes.id, codes.max_users, codes.plan`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      return {
        maxUsers: null,
        state: 'inactive',
        summary: 'Enter an access code to continue.',
        usedUsers: null,
      };
    }
    return activeStatus(row);
  }

  async redeem(userId, value) {
    const codeDigest = digestAccessCode(value, this.hmacKey);
    if (!codeDigest) return { kind: 'invalid_code' };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const lockedUser = await client.query(
        'SELECT id FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      if (!lockedUser.rows[0]) {
        throw new Error('Authenticated user is missing from the database.');
      }

      const existing = await client.query(
        `SELECT codes.code_digest,
                codes.max_users,
                codes.plan,
                COUNT(usage.user_id)::INTEGER AS used_users
         FROM access_code_redemptions AS own_redemption
         JOIN access_codes AS codes
           ON codes.id = own_redemption.access_code_id
         JOIN access_code_redemptions AS usage
           ON usage.access_code_id = codes.id
         WHERE own_redemption.user_id = $1
         GROUP BY codes.id, codes.code_digest, codes.max_users, codes.plan`,
        [userId],
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        await client.query('COMMIT');
        return Buffer.from(existingRow.code_digest).equals(codeDigest)
          ? { kind: 'active', status: activeStatus(existingRow) }
          : { kind: 'account_already_linked' };
      }

      const codeResult = await client.query(
        `SELECT id, max_users, plan
         FROM access_codes
         WHERE code_digest = $1
         FOR UPDATE`,
        [codeDigest],
      );
      const code = codeResult.rows[0];
      if (!code) {
        await client.query('ROLLBACK');
        return { kind: 'invalid_code' };
      }

      const usageResult = await client.query(
        `SELECT COUNT(*)::INTEGER AS used_users
         FROM access_code_redemptions
         WHERE access_code_id = $1`,
        [code.id],
      );
      const usedUsers = Number(usageResult.rows[0]?.used_users ?? 0);
      const maxUsers = Number(code.max_users);
      if (usedUsers >= maxUsers) {
        await client.query('ROLLBACK');
        return { kind: 'code_full' };
      }

      await client.query(
        `INSERT INTO access_code_redemptions (user_id, access_code_id)
         VALUES ($1, $2)`,
        [userId, code.id],
      );
      await client.query('COMMIT');
      return {
        kind: 'active',
        status: activeStatus(
          {
            max_users: maxUsers,
            plan: code.plan,
            used_users: usedUsers + 1,
          },
          true,
        ),
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
