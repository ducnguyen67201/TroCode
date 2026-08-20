const TURN_STATES = new Set(['reserved', 'active', 'uncertain', 'released']);

function rowNumber(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Agent turn repository returned invalid count data.');
  }
  return parsed;
}

function normalizeTurn(row) {
  if (!row) return null;
  if (!TURN_STATES.has(row.status)) {
    throw new Error('Agent turn repository returned an invalid state.');
  }
  return {
    clientTurnId: row.client_turn_id,
    createdAt: row.created_at.toISOString(),
    id: row.id,
    plan: row.plan,
    status: row.status,
    taskId: row.task_id,
    wouldDeny: Boolean(row.would_deny),
  };
}

export class PostgresAgentTurnRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [input.userId],
      );
      const existing = await client.query(
        `SELECT id, client_turn_id, task_id, plan, status, would_deny, created_at
         FROM agent_turns
         WHERE user_id = $1 AND client_turn_id = $2`,
        [input.userId, input.clientTurnId],
      );
      if (existing.rows[0]) {
        const turn = normalizeTurn(existing.rows[0]);
        await client.query('COMMIT');
        return turn.taskId === input.taskId
          ? { kind: 'duplicate', turn }
          : { kind: 'conflict', turn };
      }

      const usage = await client.query(
        `SELECT COUNT(*) AS week_messages
         FROM agent_turns
         WHERE user_id = $1
           AND created_at >= date_trunc('week', NOW())
           AND status <> 'released'`,
        [input.userId],
      );
      const committed = {
        weekMessages: rowNumber(usage.rows[0]?.week_messages),
      };
      const denial = input.authorize(committed);
      if (denial && input.enforce) {
        await client.query('COMMIT');
        return { denial, kind: 'denied' };
      }

      const inserted = await client.query(
        `INSERT INTO agent_turns
           (client_turn_id, user_id, task_id, plan, status, would_deny)
         VALUES ($1, $2, $3, $4, 'reserved', $5)
         RETURNING id, client_turn_id, task_id, plan, status, would_deny,
                   created_at`,
        [
          input.clientTurnId,
          input.userId,
          input.taskId,
          input.planId,
          Boolean(denial),
        ],
      );
      await client.query('COMMIT');
      return {
        committed,
        denial,
        kind: 'created',
        turn: normalizeTurn(inserted.rows[0]),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
