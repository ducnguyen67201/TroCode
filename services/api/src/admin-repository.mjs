import { randomBytes } from 'node:crypto';

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
        const label = normalized.label
          ? normalized.count === 1
            ? normalized.label
            : `${normalized.label} ${index + 1}/${normalized.count}`
          : null;
        const result = await client.query(
          `INSERT INTO access_codes (code_digest, label, max_users, plan)
           VALUES ($1, $2, $3, $4)
           RETURNING id, created_at`,
          [codeDigest, label, normalized.maxUsers, normalized.plan],
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
