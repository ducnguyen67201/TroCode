import { randomBytes } from 'node:crypto';

import {
  openAccessCode,
  sealAccessCode,
} from './access-code-cipher.mjs';
import { digestAccessCode } from './access-code-repository.mjs';
import { PLAN_IDS, planFor } from './plan-catalog.mjs';

const MAX_CODES_PER_BATCH = 100;
const MAX_USERS_PER_CODE = 10_000;

function accessCode() {
  return `TRO-${randomBytes(12).toString('hex').toUpperCase()}`;
}

function iso(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function publicUser(row) {
  const blockedAt = iso(row.blocked_at);
  return {
    blockedAt,
    codeLabel: row.code_label ?? null,
    createdAt: iso(row.created_at),
    email: row.email,
    id: row.id,
    lastSeenAt: iso(row.last_seen_at),
    name: row.name,
    plan: row.plan,
    status: blockedAt ? 'blocked' : 'active',
  };
}

function publicAccessCode(row, hmacKey) {
  const redeemedUsers = Number(row.redeemed_users ?? 0);
  const maxUsers = Number(row.max_users);
  const pausedAt = iso(row.paused_at);
  let code = null;
  if (row.code_ciphertext) {
    try {
      code = openAccessCode(row.code_ciphertext, hmacKey, row.code_digest);
    } catch {
      code = null;
    }
  }
  return {
    code,
    createdAt: iso(row.created_at),
    id: row.id,
    label: row.label ?? null,
    maxUsers,
    pausedAt,
    plan: row.plan,
    redeemedUsers,
    remainingUsers: Math.max(0, maxUsers - redeemedUsers),
    retrievable: code !== null,
    status: pausedAt
      ? 'paused'
      : redeemedUsers >= maxUsers
        ? 'full'
        : 'available',
  };
}

function publicAccessCodeUser(row) {
  return {
    email: row.email,
    id: row.id,
    name: row.name,
    redeemedAt: iso(row.redeemed_at),
    status: row.blocked_at ? 'blocked' : 'active',
  };
}

function assertCreateInput({ count, label, maxUsers, plan }) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_CODES_PER_BATCH) {
    throw new Error(`count must be an integer from 1 to ${MAX_CODES_PER_BATCH}.`);
  }
  if (
    !Number.isInteger(maxUsers) ||
    maxUsers < 1 ||
    maxUsers > MAX_USERS_PER_CODE
  ) {
    throw new Error(
      `maxUsers must be an integer from 1 to ${MAX_USERS_PER_CODE}.`,
    );
  }
  if (label !== null && (typeof label !== 'string' || label.length > 80)) {
    throw new Error('label must be null or at most 80 characters.');
  }
  if (!PLAN_IDS.includes(plan)) throw new Error('plan is invalid.');
  planFor(plan);
}

export class PostgresAdminRepository {
  constructor(pool, { generateCode = accessCode, hmacKey }) {
    this.generateCode = generateCode;
    this.hmacKey = hmacKey;
    this.pool = pool;
  }

  async listUsers({ limit, offset, search, status = 'all' }) {
    const pattern = search ? `%${search}%` : '';
    const statusClause =
      status === 'blocked'
        ? 'AND users.blocked_at IS NOT NULL'
        : status === 'active'
          ? 'AND users.blocked_at IS NULL'
          : '';
    const summaryResult = await this.pool.query(
      `SELECT COUNT(*)::INTEGER AS total_users,
              COUNT(*) FILTER (WHERE blocked_at IS NULL)::INTEGER AS active_users,
              COUNT(*) FILTER (WHERE blocked_at IS NOT NULL)::INTEGER AS blocked_users,
              COUNT(*) FILTER (
                WHERE ($1 = '' OR email ILIKE $1 OR name ILIKE $1)
                ${statusClause.replaceAll('users.', '')}
              )::INTEGER AS filtered_users
       FROM users`,
      [pattern],
    );
    const usersResult = await this.pool.query(
      `SELECT users.id,
              users.email,
              users.name,
              users.plan,
              users.blocked_at,
              users.created_at,
              codes.label AS code_label,
              latest_session.last_seen_at,
              COUNT(*) OVER()::INTEGER AS filtered_total
       FROM users
       LEFT JOIN access_code_redemptions AS redemptions
         ON redemptions.user_id = users.id
       LEFT JOIN access_codes AS codes
         ON codes.id = redemptions.access_code_id
       LEFT JOIN LATERAL (
         SELECT MAX(device_sessions.last_used_at) AS last_seen_at
         FROM device_sessions
         WHERE device_sessions.user_id = users.id
       ) AS latest_session ON TRUE
       WHERE ($1 = '' OR users.email ILIKE $1 OR users.name ILIKE $1)
         ${statusClause}
       ORDER BY users.created_at DESC, users.id
       LIMIT $2 OFFSET $3`,
      [pattern, limit, offset],
    );
    const summary = summaryResult.rows[0] ?? {};
    const firstUser = usersResult.rows[0];
    const total = Number(
      summary.filtered_users ?? firstUser?.filtered_total ?? summary.total_users ?? 0,
    );
    return {
      items: usersResult.rows.map(publicUser),
      page: { limit, offset, total },
      summary: {
        activeUsers: Number(summary.active_users ?? 0),
        blockedUsers: Number(summary.blocked_users ?? 0),
        totalUsers: Number(summary.total_users ?? 0),
      },
    };
  }

  async setUserBlocked(userId, blocked) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE users
         SET blocked_at = CASE
               WHEN $2 THEN COALESCE(blocked_at, NOW())
               ELSE NULL
             END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, blocked_at`,
        [userId, blocked],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return null;
      }
      if (blocked) {
        await client.query(
          `UPDATE device_sessions
           SET revoked_at = NOW()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );
      }
      await client.query(
        `INSERT INTO admin_audit_events (action, target_user_id)
         VALUES ($1, $2)`,
        [blocked ? 'user.blocked' : 'user.unblocked', userId],
      );
      await client.query('COMMIT');
      const blockedAt = iso(row.blocked_at);
      return {
        blockedAt,
        id: row.id,
        status: blockedAt ? 'blocked' : 'active',
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listAccessCodes({ limit, offset, search, status = 'all' }) {
    const pattern = search ? `%${search}%` : '';
    const searchDigest = search ? digestAccessCode(search, this.hmacKey) : null;
    const summaryResult = await this.pool.query(
      `WITH usage AS (
         SELECT codes.id,
                codes.max_users,
                codes.code_ciphertext,
                codes.paused_at,
                COUNT(redemptions.user_id)::INTEGER AS redeemed_users
         FROM access_codes AS codes
         LEFT JOIN access_code_redemptions AS redemptions
           ON redemptions.access_code_id = codes.id
         GROUP BY codes.id,
                  codes.max_users,
                  codes.code_ciphertext,
                  codes.paused_at
       )
       SELECT COUNT(*)::INTEGER AS total_codes,
              COUNT(*) FILTER (
                WHERE paused_at IS NULL AND redeemed_users < max_users
              )::INTEGER AS available_codes,
              COUNT(*) FILTER (
                WHERE paused_at IS NULL AND redeemed_users >= max_users
              )::INTEGER AS full_codes,
              COUNT(*) FILTER (
                WHERE paused_at IS NOT NULL
              )::INTEGER AS paused_codes,
              COUNT(*) FILTER (
                WHERE code_ciphertext IS NOT NULL
              )::INTEGER AS retrievable_codes,
              COALESCE(SUM(redeemed_users), 0)::INTEGER AS total_redemptions
       FROM usage`,
    );
    const codesResult = await this.pool.query(
      `WITH usage AS (
         SELECT codes.id,
                codes.code_digest,
                codes.code_ciphertext,
                codes.label,
                codes.max_users,
                codes.paused_at,
                codes.plan,
                codes.created_at,
                COUNT(redemptions.user_id)::INTEGER AS redeemed_users
         FROM access_codes AS codes
         LEFT JOIN access_code_redemptions AS redemptions
           ON redemptions.access_code_id = codes.id
         GROUP BY codes.id,
                  codes.code_digest,
                  codes.code_ciphertext,
                  codes.label,
                  codes.max_users,
                  codes.paused_at,
                  codes.plan,
                  codes.created_at
       )
       SELECT *, COUNT(*) OVER()::INTEGER AS filtered_total
       FROM usage
       WHERE (
         $1 = ''
         OR ($1 = 'available' AND paused_at IS NULL AND redeemed_users < max_users)
         OR ($1 = 'full' AND paused_at IS NULL AND redeemed_users >= max_users)
         OR ($1 = 'paused' AND paused_at IS NOT NULL)
       )
         AND (
           $2 = ''
           OR COALESCE(label, '') ILIKE $2
           OR code_digest = $3
         )
       ORDER BY created_at DESC, id
       LIMIT $4 OFFSET $5`,
      [status === 'all' ? '' : status, pattern, searchDigest, limit, offset],
    );
    const summary = summaryResult.rows[0] ?? {};
    return {
      items: codesResult.rows.map((row) => publicAccessCode(row, this.hmacKey)),
      page: {
        limit,
        offset,
        total: Number(codesResult.rows[0]?.filtered_total ?? 0),
      },
      summary: {
        availableCodes: Number(summary.available_codes ?? 0),
        fullCodes: Number(summary.full_codes ?? 0),
        pausedCodes: Number(summary.paused_codes ?? 0),
        retrievableCodes: Number(summary.retrievable_codes ?? 0),
        totalCodes: Number(summary.total_codes ?? 0),
        totalRedemptions: Number(summary.total_redemptions ?? 0),
      },
    };
  }

  async setAccessCodePaused(codeId, paused) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `WITH updated AS (
           UPDATE access_codes
           SET paused_at = CASE
                 WHEN $2 THEN COALESCE(paused_at, NOW())
                 ELSE NULL
               END
           WHERE id = $1
           RETURNING id, max_users, paused_at
         )
         SELECT updated.id,
                updated.max_users,
                updated.paused_at,
                COUNT(redemptions.user_id)::INTEGER AS redeemed_users
         FROM updated
         LEFT JOIN access_code_redemptions AS redemptions
           ON redemptions.access_code_id = updated.id
         GROUP BY updated.id, updated.max_users, updated.paused_at`,
        [codeId, paused],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(
        `INSERT INTO admin_audit_events (action, detail)
         VALUES ($1, $2::JSONB)`,
        [
          paused ? 'access_codes.paused' : 'access_codes.resumed',
          JSON.stringify({ accessCodeId: codeId }),
        ],
      );
      await client.query('COMMIT');
      const pausedAt = iso(row.paused_at);
      const redeemedUsers = Number(row.redeemed_users ?? 0);
      const maxUsers = Number(row.max_users);
      return {
        id: row.id,
        pausedAt,
        status: pausedAt
          ? 'paused'
          : redeemedUsers >= maxUsers
            ? 'full'
            : 'available',
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteAccessCode(codeId) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const codeResult = await client.query(
        `SELECT id
         FROM access_codes
         WHERE id = $1
         FOR UPDATE`,
        [codeId],
      );
      if (!codeResult.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const usageResult = await client.query(
        `SELECT COUNT(*)::INTEGER AS redeemed_users
         FROM access_code_redemptions
         WHERE access_code_id = $1`,
        [codeId],
      );
      const redeemedUsers = Number(
        usageResult.rows[0]?.redeemed_users ?? 0,
      );
      if (redeemedUsers > 0) {
        await client.query('ROLLBACK');
        return { id: codeId, kind: 'in_use', redeemedUsers };
      }
      await client.query('DELETE FROM access_codes WHERE id = $1', [codeId]);
      await client.query(
        `INSERT INTO admin_audit_events (action, detail)
         VALUES ('access_codes.deleted', $1::JSONB)`,
        [JSON.stringify({ accessCodeId: codeId })],
      );
      await client.query('COMMIT');
      return { id: codeId, kind: 'deleted' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listAccessCodeUsers(codeId, { limit, offset }) {
    const codeResult = await this.pool.query(
      `SELECT codes.id,
              codes.label,
              codes.max_users,
              codes.plan,
              COUNT(redemptions.user_id)::INTEGER AS redeemed_users
       FROM access_codes AS codes
       LEFT JOIN access_code_redemptions AS redemptions
         ON redemptions.access_code_id = codes.id
       WHERE codes.id = $1
       GROUP BY codes.id, codes.label, codes.max_users, codes.plan`,
      [codeId],
    );
    const code = codeResult.rows[0];
    if (!code) return null;

    const usersResult = await this.pool.query(
      `SELECT users.id,
              users.email,
              users.name,
              users.blocked_at,
              redemptions.redeemed_at
       FROM access_code_redemptions AS redemptions
       INNER JOIN users ON users.id = redemptions.user_id
       WHERE redemptions.access_code_id = $1
       ORDER BY redemptions.redeemed_at DESC, users.id
       LIMIT $2 OFFSET $3`,
      [codeId, limit, offset],
    );
    const redeemedUsers = Number(code.redeemed_users ?? 0);
    return {
      code: {
        id: code.id,
        label: code.label ?? null,
        maxUsers: Number(code.max_users),
        plan: code.plan,
        redeemedUsers,
      },
      items: usersResult.rows.map(publicAccessCodeUser),
      page: { limit, offset, total: redeemedUsers },
    };
  }

  async createAccessCodes(input) {
    const normalized = {
      ...input,
      label: input.label?.trim() || null,
    };
    assertCreateInput(normalized);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const items = [];
      for (let index = 0; index < normalized.count; index += 1) {
        const code = this.generateCode();
        const codeDigest = digestAccessCode(code, this.hmacKey);
        if (!codeDigest) throw new Error('Generated access code is invalid.');
        const codeCiphertext = sealAccessCode(code, this.hmacKey, codeDigest);
        const label = normalized.label
          ? normalized.count === 1
            ? normalized.label
            : `${normalized.label} ${index + 1}/${normalized.count}`
          : null;
        const result = await client.query(
          `INSERT INTO access_codes (
             code_digest,
             code_ciphertext,
             label,
             max_users,
             plan
           )
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, created_at`,
          [
            codeDigest,
            codeCiphertext,
            label,
            normalized.maxUsers,
            normalized.plan,
          ],
        );
        const row = result.rows[0];
        items.push({
          code,
          createdAt: iso(row.created_at),
          id: row.id,
          label,
          maxUsers: normalized.maxUsers,
          plan: normalized.plan,
        });
      }
      await client.query(
        `INSERT INTO admin_audit_events (action, detail)
         VALUES ('access_codes.created', $1::JSONB)`,
        [
          JSON.stringify({
            count: normalized.count,
            maxUsers: normalized.maxUsers,
            plan: normalized.plan,
          }),
        ],
      );
      await client.query('COMMIT');
      return { items };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error && typeof error === 'object' && error.code === '23505') {
        throw new Error('Could not generate unique access codes. Try again.');
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
