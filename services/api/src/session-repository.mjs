import { createHmac, randomBytes } from 'node:crypto';

function digestToken(token, hmacKey) {
  return createHmac('sha256', hmacKey).update(token, 'utf8').digest();
}

function newToken() {
  return `tro_live_${randomBytes(32).toString('base64url')}`;
}

export class PostgresSessionRepository {
  constructor(pool, { hmacKey, sessionDurationDays }) {
    this.pool = pool;
    this.hmacKey = hmacKey;
    this.sessionDurationDays = sessionDurationDays;
  }

  async issue(user) {
    const token = newToken();
    const tokenDigest = digestToken(token, this.hmacKey);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const userResult = await client.query(
        `INSERT INTO users (id, email, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           name = EXCLUDED.name,
           updated_at = NOW()
         RETURNING blocked_at`,
        [user.id, user.email, user.name],
      );
      if (userResult.rows[0]?.blocked_at) {
        await client.query('ROLLBACK');
        return null;
      }
      const result = await client.query(
        `INSERT INTO device_sessions (user_id, token_digest, expires_at)
         VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 day'))
         RETURNING expires_at`,
        [user.id, tokenDigest, this.sessionDurationDays],
      );
      await client.query('COMMIT');
      return {
        accessToken: token,
        expiresAt: result.rows[0].expires_at.toISOString(),
        user,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async authenticate(token) {
    if (typeof token !== 'string' || !/^tro_live_[A-Za-z0-9_-]{43}$/.test(token)) {
      return null;
    }
    const result = await this.pool.query(
      `UPDATE device_sessions AS sessions
       SET last_used_at = NOW()
       FROM users
       WHERE sessions.token_digest = $1
         AND sessions.user_id = users.id
         AND users.blocked_at IS NULL
         AND sessions.revoked_at IS NULL
         AND sessions.expires_at > NOW()
       RETURNING sessions.id AS session_id,
                 sessions.expires_at,
                 users.id,
                 users.email,
                 users.name`,
      [digestToken(token, this.hmacKey)],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      expiresAt: row.expires_at.toISOString(),
      sessionId: row.session_id,
      user: { email: row.email, id: row.id, name: row.name },
    };
  }

  async revoke(sessionId) {
    await this.pool.query(
      `UPDATE device_sessions SET revoked_at = NOW()
       WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId],
    );
  }

  async rotate(session) {
    const token = newToken();
    const tokenDigest = digestToken(token, this.hmacKey);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const revoked = await client.query(
        `UPDATE device_sessions AS sessions
         SET revoked_at = NOW()
         FROM users
         WHERE sessions.id = $1
           AND sessions.user_id = users.id
           AND users.blocked_at IS NULL
           AND sessions.revoked_at IS NULL
           AND sessions.expires_at > NOW()
         RETURNING sessions.user_id`,
        [session.sessionId],
      );
      if (!revoked.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const created = await client.query(
        `INSERT INTO device_sessions (user_id, token_digest, expires_at)
         VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 day'))
         RETURNING expires_at`,
        [session.user.id, tokenDigest, this.sessionDurationDays],
      );
      await client.query('COMMIT');
      return {
        accessToken: token,
        expiresAt: created.rows[0].expires_at.toISOString(),
        user: session.user,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
