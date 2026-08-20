const RESERVATION_STATES = new Set([
  'reserved',
  'settled',
  'released',
  'uncertain',
]);

function rowNumber(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Usage repository returned invalid money data.');
  }
  return parsed;
}

function normalizeReservation(row) {
  if (!row) return null;
  if (!RESERVATION_STATES.has(row.status)) {
    throw new Error('Usage repository returned an invalid reservation state.');
  }
  return {
    actualMicroUsd:
      row.actual_micro_usd === null ? null : rowNumber(row.actual_micro_usd),
    requestId: row.request_id,
    reservedMicroUsd: rowNumber(row.reserved_micro_usd),
    status: row.status,
  };
}

export class PostgresUsageRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async reserve(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        input.userId,
      ]);
      await client.query(
        `UPDATE model_budget_reservations
         SET status = CASE WHEN dispatched_at IS NULL THEN 'released' ELSE 'uncertain' END,
             disposition = CASE WHEN dispatched_at IS NULL
               THEN 'expired_before_dispatch' ELSE 'ambiguous' END,
             updated_at = NOW()
         WHERE user_id = $1
           AND status = 'reserved'
           AND created_at < NOW() - ($2 * INTERVAL '1 millisecond')`,
        [input.userId, input.reservationTtlMs],
      );
      const duplicate = await client.query(
        `SELECT request_id, reserved_micro_usd, actual_micro_usd, status
         FROM model_budget_reservations
         WHERE user_id = $1 AND request_id = $2`,
        [input.userId, input.requestId],
      );
      if (duplicate.rows[0]) {
        await client.query('COMMIT');
        return { kind: 'duplicate', reservation: normalizeReservation(duplicate.rows[0]) };
      }
      let agentTurn = null;
      if (input.lane === 'responses') {
        if (typeof input.agentTurnId !== 'string') {
          await client.query('COMMIT');
          return { kind: 'invalid_turn' };
        }
        const turnResult = await client.query(
          `SELECT id, task_id, plan, status, provider_call_count
           FROM agent_turns
           WHERE id = $1 AND user_id = $2
           FOR UPDATE`,
          [input.agentTurnId, input.userId],
        );
        agentTurn = turnResult.rows[0] ?? null;
        if (
          !agentTurn ||
          agentTurn.task_id !== input.taskId ||
          agentTurn.plan !== input.planId ||
          agentTurn.status === 'released'
        ) {
          await client.query('COMMIT');
          return { kind: 'invalid_turn' };
        }
        if (
          rowNumber(agentTurn.provider_call_count) >=
          input.maxProviderCallsPerTurn
        ) {
          await client.query('COMMIT');
          return { kind: 'turn_exhausted' };
        }
      }
      const committed = await this.committedSpend(client, input);
      const denial = input.authorize(committed);
      if (denial && input.enforce) {
        await client.query('COMMIT');
        return { denial, kind: 'denied' };
      }
      if (agentTurn) {
        await client.query(
          `UPDATE agent_turns
           SET provider_call_count = provider_call_count + 1,
               updated_at = NOW()
           WHERE id = $1`,
          [agentTurn.id],
        );
      }
      const inserted = await client.query(
        `INSERT INTO model_budget_reservations
           (request_id, user_id, task_id, lane, model, catalog_version,
            reserved_micro_usd, status, would_deny, agent_turn_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'reserved', $8, $9)
         RETURNING request_id, reserved_micro_usd, actual_micro_usd, status`,
        [
          input.requestId,
          input.userId,
          input.taskId,
          input.lane,
          input.model,
          input.catalogVersion,
          input.reservedMicroUsd,
          Boolean(denial),
          agentTurn?.id ?? null,
        ],
      );
      await client.query('COMMIT');
      return {
        committed,
        denial,
        kind: 'reserved',
        reservation: normalizeReservation(inserted.rows[0]),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async committedFor(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        input.userId,
      ]);
      const result = await this.committedSpend(client, input);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markDispatched(userId, requestId) {
    return this.transitionWithTurn(userId, requestId, {
      predicate: "status = 'reserved'",
      set: 'dispatched_at = COALESCE(dispatched_at, NOW()), updated_at = NOW()',
      turnStatus: 'active',
    });
  }

  async settle(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        input.userId,
      ]);
      const current = await client.query(
        `SELECT request_id, reserved_micro_usd, actual_micro_usd, status,
                agent_turn_id
         FROM model_budget_reservations
         WHERE user_id = $1 AND request_id = $2 FOR UPDATE`,
        [input.userId, input.requestId],
      );
      const reservation = normalizeReservation(current.rows[0]);
      if (!reservation) throw new Error('Usage reservation was not found.');
      if (reservation.status === 'settled') {
        if (reservation.actualMicroUsd !== input.actualMicroUsd) {
          throw new Error('Usage reservation was already settled differently.');
        }
        await client.query('COMMIT');
        return reservation;
      }
      if (reservation.status !== 'reserved') {
        throw new Error(`Cannot settle a ${reservation.status} reservation.`);
      }
      await client.query(
        `INSERT INTO model_usage_events
           (request_id, user_id, task_id, lane, model, catalog_version,
            input_tokens, cached_input_tokens, cache_write_tokens,
            output_tokens, reasoning_tokens, character_count,
            amount_micro_usd, usage_source,
            disposition, duration_ms, audio_duration_ms, provider_response_id)
         SELECT request_id, user_id, task_id, lane, model, catalog_version,
                $3, $4, $5, $6, $7, $8, $9, $10, 'completed', $11, $12, $13
         FROM model_budget_reservations
         WHERE user_id = $1 AND request_id = $2
         ON CONFLICT (user_id, request_id) DO NOTHING`,
        [
          input.userId,
          input.requestId,
          input.usage.inputTokens,
          input.usage.cachedInputTokens,
          input.usage.cacheWriteTokens,
          input.usage.outputTokens,
          input.usage.reasoningTokens ?? 0,
          input.usage.characterCount ?? 0,
          input.actualMicroUsd,
          input.usage.source,
          input.durationMs,
          input.usage.audioDurationMs ?? 0,
          input.usage.responseId ?? null,
        ],
      );
      const updated = await client.query(
        `UPDATE model_budget_reservations
         SET status = 'settled', actual_micro_usd = $3,
             disposition = 'completed', settled_at = NOW(), updated_at = NOW()
         WHERE user_id = $1 AND request_id = $2
         RETURNING request_id, reserved_micro_usd, actual_micro_usd, status`,
        [input.userId, input.requestId, input.actualMicroUsd],
      );
      if (current.rows[0].agent_turn_id) {
        await client.query(
          `UPDATE agent_turns
           SET status = 'active', updated_at = NOW()
           WHERE id = $1 AND status <> 'released'`,
          [current.rows[0].agent_turn_id],
        );
      }
      await client.query('COMMIT');
      return normalizeReservation(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async release(userId, requestId, disposition) {
    if (disposition !== 'rejected_before_inference') {
      throw new Error('A reservation may only be released before inference.');
    }
    return this.transitionWithTurn(userId, requestId, {
      predicate: "status = 'reserved'",
      set: "status = 'released', disposition = 'rejected_before_inference', updated_at = NOW()",
      releaseTurnIfUnused: true,
    });
  }

  async markUncertain(userId, requestId) {
    return this.transitionWithTurn(userId, requestId, {
      predicate: "status = 'reserved'",
      set: "status = 'uncertain', disposition = 'ambiguous', updated_at = NOW()",
      turnStatus: 'uncertain',
    });
  }

  async snapshot(userId, taskId = null) {
    const result = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'settled' THEN actual_micro_usd ELSE 0 END), 0) AS month_settled,
         COALESCE(SUM(CASE WHEN status IN ('reserved', 'uncertain') THEN reserved_micro_usd ELSE 0 END), 0) AS month_reserved,
         (SELECT COUNT(*)
          FROM agent_turns
          WHERE user_id = $1
            AND created_at >= date_trunc('week', NOW())
            AND status <> 'released') AS week_messages,
         COALESCE(SUM(CASE WHEN status = 'settled' AND updated_at >= date_trunc('day', NOW()) THEN actual_micro_usd ELSE 0 END), 0) AS day_settled,
         COALESCE(SUM(CASE WHEN status IN ('reserved', 'uncertain') AND updated_at >= date_trunc('day', NOW()) THEN reserved_micro_usd ELSE 0 END), 0) AS day_reserved,
         COALESCE(SUM(CASE WHEN task_id = $2 AND status = 'settled' THEN actual_micro_usd ELSE 0 END), 0) AS task_settled,
         COALESCE(SUM(CASE WHEN task_id = $2 AND status IN ('reserved', 'uncertain') THEN reserved_micro_usd ELSE 0 END), 0) AS task_reserved,
         date_trunc('month', NOW()) + INTERVAL '1 month' AS month_ends_at,
         date_trunc('week', NOW()) + INTERVAL '1 week' AS week_ends_at,
         date_trunc('day', NOW()) + INTERVAL '1 day' AS day_ends_at
       FROM model_budget_reservations
       WHERE user_id = $1
         AND created_at >= date_trunc('month', NOW())`,
      [userId, taskId],
    );
    const row = result.rows[0];
    return {
      dayEndsAt: row.day_ends_at.toISOString(),
      dayReservedMicroUsd: rowNumber(row.day_reserved),
      daySettledMicroUsd: rowNumber(row.day_settled),
      monthEndsAt: row.month_ends_at.toISOString(),
      monthReservedMicroUsd: rowNumber(row.month_reserved),
      monthSettledMicroUsd: rowNumber(row.month_settled),
      taskReservedMicroUsd: rowNumber(row.task_reserved),
      taskSettledMicroUsd: rowNumber(row.task_settled),
      weekEndsAt: row.week_ends_at.toISOString(),
      weekMessages: rowNumber(row.week_messages),
    };
  }

  async committedSpend(client, input) {
    const result = await client.query(
      `SELECT
         COALESCE(SUM(CASE WHEN task_id = $2 AND status = 'settled' THEN actual_micro_usd WHEN task_id = $2 AND status IN ('reserved', 'uncertain') THEN reserved_micro_usd ELSE 0 END), 0) AS task,
         COALESCE(SUM(CASE WHEN created_at >= date_trunc('day', NOW()) AND status = 'settled' THEN actual_micro_usd WHEN created_at >= date_trunc('day', NOW()) AND status IN ('reserved', 'uncertain') THEN reserved_micro_usd ELSE 0 END), 0) AS day,
         COALESCE(SUM(CASE WHEN created_at >= date_trunc('month', NOW()) AND status = 'settled' THEN actual_micro_usd WHEN created_at >= date_trunc('month', NOW()) AND status IN ('reserved', 'uncertain') THEN reserved_micro_usd ELSE 0 END), 0) AS month
       FROM model_budget_reservations
       WHERE user_id = $1`,
      [input.userId, input.taskId],
    );
    return {
      dayMicroUsd: rowNumber(result.rows[0].day),
      monthMicroUsd: rowNumber(result.rows[0].month),
      taskMicroUsd: rowNumber(result.rows[0].task),
    };
  }

  async transitionWithTurn(userId, requestId, transition) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [userId],
      );
      const current = await client.query(
        `SELECT request_id, reserved_micro_usd, actual_micro_usd, status,
                agent_turn_id
         FROM model_budget_reservations
         WHERE user_id = $1 AND request_id = $2
         FOR UPDATE`,
        [userId, requestId],
      );
      const reservation = normalizeReservation(current.rows[0]);
      if (!reservation) throw new Error('Usage reservation was not found.');
      const updated = await client.query(
        `UPDATE model_budget_reservations SET ${transition.set}
         WHERE user_id = $1 AND request_id = $2 AND ${transition.predicate}
         RETURNING request_id, reserved_micro_usd, actual_micro_usd, status`,
        [userId, requestId],
      );
      const agentTurnId = current.rows[0].agent_turn_id;
      if (agentTurnId && transition.turnStatus && updated.rows[0]) {
        await client.query(
          `UPDATE agent_turns
           SET status = $2,
               first_dispatched_at = CASE WHEN $2 = 'active'
                 THEN COALESCE(first_dispatched_at, NOW())
                 ELSE first_dispatched_at END,
               updated_at = NOW()
           WHERE id = $1 AND status <> 'released'`,
          [agentTurnId, transition.turnStatus],
        );
      }
      if (agentTurnId && transition.releaseTurnIfUnused && updated.rows[0]) {
        await client.query(
          `UPDATE agent_turns
           SET status = 'released', updated_at = NOW()
           WHERE id = $1
             AND NOT EXISTS (
               SELECT 1 FROM model_budget_reservations
               WHERE agent_turn_id = $1
                 AND status IN ('reserved', 'settled', 'uncertain')
             )`,
          [agentTurnId],
        );
      }
      await client.query('COMMIT');
      return normalizeReservation(updated.rows[0]) ?? reservation;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
