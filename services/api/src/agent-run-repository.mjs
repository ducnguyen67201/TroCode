import { createHash, randomUUID } from 'node:crypto';

import { inTransaction, iso } from './knowledge-repository-utils.mjs';

const TERMINAL_RUN_STATES = new Set(['completed', 'blocked', 'failed', 'cancelled', 'expired']);
const TERMINAL_TOOL_STATES = new Set(['confirmed', 'failed', 'denied', 'not_executed', 'unknown', 'cancelled', 'expired']);

function envelopeValues(envelope) {
  return [envelope.ciphertext, envelope.iv, envelope.tag, envelope.keyVersion];
}

function normalizeRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    clientTaskId: row.client_task_id,
    executionProfile: row.execution_profile,
    workspaceSelectionId: row.workspace_selection_id,
    state: row.state,
    schemaDigest: row.schema_digest,
    protocolVersion: row.protocol_version,
    runVersion: row.run_version,
    outcomeRevision: row.outcome_revision,
    nextSequence: Number(row.next_sequence),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: iso(row.lease_expires_at),
    deadlineAt: iso(row.deadline_at),
    payloadExpiresAt: iso(row.payload_expires_at),
    publicSummary: row.public_summary,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function staleLease() {
  const error = new Error('The agent run lease is stale or belongs to another worker.');
  error.code = 'stale_run_lease';
  error.status = 409;
  return error;
}

function effectCriterionId(toolId, operation) {
  const verifier = { kind: 'tool_effect', operation, toolId };
  return `effect-${createHash('sha256')
    .update(JSON.stringify(verifier))
    .digest('hex')
    .slice(0, 16)}`;
}

export class PostgresAgentRunRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async submit(input) {
    return inTransaction(this.pool, async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('agent-runtime-submit',0))`,
      );
      const existing = await client.query(
        `SELECT * FROM agent_runs WHERE user_id=$1 AND client_task_id=$2 FOR UPDATE`,
        [input.userId, input.clientTaskId],
      );
      if (existing.rows[0]) {
        const run = normalizeRun(existing.rows[0]);
        return run.taskId === input.taskId ? { kind: 'duplicate', run } : { kind: 'conflict', run };
      }
      const capacity = await client.query(
        `SELECT
           COUNT(*) FILTER (WHERE user_id=$1)::int AS user_active,
           COUNT(*)::int AS global_active
         FROM agent_runs
         WHERE state NOT IN ('completed','blocked','failed','cancelled','expired')
           AND deadline_at>NOW()`,
        [input.userId],
      );
      if (
        capacity.rows[0].user_active >= input.maxActiveRunsPerUser ||
        capacity.rows[0].global_active >= input.maxQueueDepth
      ) {
        return {
          kind: 'capacity',
          reason: capacity.rows[0].user_active >= input.maxActiveRunsPerUser
            ? 'user_concurrency_limit'
            : 'global_queue_full',
        };
      }
      const request = envelopeValues(input.requestEnvelope);
      const contract = envelopeValues(input.contractEnvelope);
      const inserted = await client.query(
        `INSERT INTO agent_runs
          (id,user_id,task_id,client_task_id,execution_profile,workspace_selection_id,
           agent_turn_id,state,schema_digest,
           protocol_version,request_ciphertext,request_iv,request_tag,request_key_version,
           contract_ciphertext,contract_iv,contract_tag,contract_key_version,
           deadline_at,payload_expires_at,public_summary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING *`,
        [
          input.runId, input.userId, input.taskId, input.clientTaskId,
          input.executionProfile, input.workspaceSelectionId, input.agentTurnId ?? null,
          input.schemaDigest, input.protocolVersion,
          ...request, ...contract, input.deadlineAt, input.payloadExpiresAt,
          input.publicSummary.slice(0, 1_000),
        ],
      );
      const run = normalizeRun(inserted.rows[0]);
      for (const criterion of input.criteria) {
        const description = envelopeValues(criterion.descriptionEnvelope);
        await client.query(
          `INSERT INTO agent_outcome_criteria
            (run_id,revision,criterion_id,verifier_kind,verifier_digest,required,
             description_ciphertext,description_iv,description_tag,description_key_version)
           VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [run.id, criterion.id, criterion.verifierKind, criterion.verifierDigest, criterion.required, ...description],
        );
      }
      await this.#appendEvent(client, run.id, 'run.queued', input.publicSummary);
      return { kind: 'created', run: normalizeRun((await client.query('SELECT * FROM agent_runs WHERE id=$1', [run.id])).rows[0]) };
    });
  }

  async getOwned(userId, runId) {
    const result = await this.pool.query('SELECT * FROM agent_runs WHERE id=$1 AND user_id=$2', [runId, userId]);
    return normalizeRun(result.rows[0]);
  }

  async getOwnedRequestEnvelope(userId, runId) {
    const result = await this.pool.query(
      `SELECT request_ciphertext,request_iv,request_tag,request_key_version
       FROM agent_runs WHERE id=$1 AND user_id=$2`,
      [runId, userId],
    );
    const row = result.rows[0];
    return row?.request_ciphertext ? {
      ciphertext: row.request_ciphertext,
      iv: row.request_iv,
      tag: row.request_tag,
      keyVersion: row.request_key_version,
    } : null;
  }

  async getOwnedContractEnvelope(userId, runId) {
    const result = await this.pool.query(
      `SELECT contract_ciphertext,contract_iv,contract_tag,contract_key_version
       FROM agent_runs WHERE id=$1 AND user_id=$2`,
      [runId, userId],
    );
    const row = result.rows[0];
    return row?.contract_ciphertext ? {
      ciphertext: row.contract_ciphertext,
      iv: row.contract_iv,
      tag: row.contract_tag,
      keyVersion: row.contract_key_version,
    } : null;
  }

  async listOwned(userId, { limit = 50, before = null } = {}) {
    const result = await this.pool.query(
      `SELECT * FROM agent_runs WHERE user_id=$1 AND ($2::timestamptz IS NULL OR created_at<$2)
       ORDER BY created_at DESC LIMIT $3`,
      [userId, before, Math.min(Math.max(limit, 1), 100)],
    );
    return result.rows.map(normalizeRun);
  }

  async hasActiveOwned(userId) {
    const result = await this.pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM agent_runs
         WHERE user_id=$1
           AND state NOT IN ('completed','blocked','failed','cancelled','expired')
           AND deadline_at>NOW()
       ) AS active`,
      [userId],
    );
    return result.rows[0]?.active === true;
  }

  async claim({ workerId, leaseMs, recoveryLimit = 6 }) {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        `WITH candidate AS (
           SELECT id FROM agent_runs
           WHERE state IN ('queued','planning','recovering','verifying')
             AND deadline_at>NOW()
             AND recovery_attempt_count<$3
             AND (lease_expires_at IS NULL OR lease_expires_at<NOW())
           ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE agent_runs runs SET
           state=CASE WHEN runs.lease_owner IS NULL THEN runs.state ELSE 'recovering' END,
           lease_owner=$1,
           lease_expires_at=NOW()+($2 * INTERVAL '1 millisecond'),
           recovery_attempt_count=CASE WHEN runs.lease_owner IS NULL THEN runs.recovery_attempt_count ELSE runs.recovery_attempt_count+1 END,
           run_version=run_version+1,updated_at=NOW()
         FROM candidate WHERE runs.id=candidate.id RETURNING runs.*`,
        [workerId, leaseMs, recoveryLimit],
      );
      return normalizeRun(result.rows[0]);
    });
  }

  async renew({ runId, workerId, runVersion, leaseMs }) {
    const result = await this.pool.query(
      `UPDATE agent_runs SET lease_expires_at=NOW()+($4 * INTERVAL '1 millisecond'),updated_at=NOW()
       WHERE id=$1 AND lease_owner=$2 AND run_version=$3 AND lease_expires_at>NOW()
       RETURNING *`,
      [runId, workerId, runVersion, leaseMs],
    );
    if (!result.rows[0]) throw staleLease();
    return normalizeRun(result.rows[0]);
  }

  async transition({ runId, workerId, runVersion, from, to, eventType, summary }) {
    return inTransaction(this.pool, async (client) => {
      const changed = await client.query(
        `UPDATE agent_runs SET state=$5,updated_at=NOW()
         WHERE id=$1 AND lease_owner=$2 AND run_version=$3 AND lease_expires_at>NOW()
           AND state=ANY($4::text[]) AND deadline_at>NOW()
         RETURNING *`,
        [runId, workerId, runVersion, from, to],
      );
      if (!changed.rows[0]) throw staleLease();
      const event = await this.#appendEvent(client, runId, eventType, summary);
      return { event, run: normalizeRun(changed.rows[0]) };
    });
  }

  async appendEvent({ runId, workerId, runVersion, type, summary }) {
    return inTransaction(this.pool, async (client) => {
      const locked = await client.query(
        `SELECT id FROM agent_runs WHERE id=$1 AND lease_owner=$2 AND run_version=$3
           AND lease_expires_at>NOW() FOR UPDATE`,
        [runId, workerId, runVersion],
      );
      if (!locked.rows[0]) throw staleLease();
      return this.#appendEvent(client, runId, type, summary);
    });
  }

  async eventsAfter(userId, runId, afterSequence = 0, limit = 500) {
    const result = await this.pool.query(
      `SELECT events.id,events.run_id,events.sequence,events.type,events.public_summary,events.created_at,
              events.payload_ciphertext,events.payload_iv,events.payload_tag,events.payload_key_version
       FROM agent_run_events events JOIN agent_runs runs ON runs.id=events.run_id
       WHERE runs.user_id=$1 AND runs.id=$2 AND events.sequence>$3
       ORDER BY events.sequence LIMIT $4`,
      [userId, runId, afterSequence, Math.min(Math.max(limit, 1), 1_000)],
    );
    return result.rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      sequence: Number(row.sequence),
      type: row.type,
      summary: row.public_summary,
      createdAt: iso(row.created_at),
      privateEnvelope: row.payload_ciphertext ? {
        ciphertext: row.payload_ciphertext,
        iv: row.payload_iv,
        tag: row.payload_tag,
        keyVersion: row.payload_key_version,
      } : null,
    }));
  }

  async outcomeStatus(runId) {
    const result = await this.pool.query(
      `SELECT criteria.criterion_id,criteria.required,criteria.state,criteria.verifier_kind,
              runs.outcome_revision
       FROM agent_outcome_criteria criteria JOIN agent_runs runs ON runs.id=criteria.run_id
       WHERE criteria.run_id=$1 AND criteria.revision=runs.outcome_revision
       ORDER BY criteria.criterion_id LIMIT 20`,
      [runId],
    );
    return {
      outcomeRevision: result.rows[0]?.outcome_revision ?? 1,
      outcomes: result.rows.map((row) => ({
        criterionId: row.criterion_id,
        required: row.required,
        status: row.state,
        verifierKind: row.verifier_kind,
      })),
    };
  }

  async appendOwnedEvent({ userId, runId, type, summary, payloadEnvelope = null }) {
    return inTransaction(this.pool, async (client) => {
      const locked = await client.query(
        `SELECT id,state FROM agent_runs WHERE id=$1 AND user_id=$2 FOR UPDATE`,
        [runId, userId],
      );
      const run = locked.rows[0];
      if (!run) return null;
      if (TERMINAL_RUN_STATES.has(run.state)) {
        const error = new Error('Terminal agent runs cannot accept new input.');
        error.code = 'terminal_agent_run';
        error.status = 409;
        throw error;
      }
      return this.#appendEvent(client, runId, type, summary, payloadEnvelope);
    });
  }

  async reviseOwnedOutcomes({
    userId,
    runId,
    contractEnvelope,
    criteria,
    expectedOutcomeRevision,
    payloadEnvelope,
  }) {
    return inTransaction(this.pool, async (client) => {
      const locked = await client.query(
        `SELECT * FROM agent_runs WHERE id=$1 AND user_id=$2 FOR UPDATE`,
        [runId, userId],
      );
      const run = locked.rows[0];
      if (!run) return null;
      if (TERMINAL_RUN_STATES.has(run.state)) {
        const error = new Error('Terminal agent runs cannot revise outcomes.');
        error.code = 'terminal_agent_run';
        error.status = 409;
        throw error;
      }
      if (run.outcome_revision !== expectedOutcomeRevision) {
        const error = new Error('The agent contract changed before steering committed.');
        error.code = 'stale_agent_contract';
        error.status = 409;
        throw error;
      }
      const nextRevision = run.outcome_revision + 1;
      for (const criterion of criteria) {
        const description = envelopeValues(criterion.descriptionEnvelope);
        await client.query(
          `INSERT INTO agent_outcome_criteria
            (run_id,revision,criterion_id,verifier_kind,verifier_digest,required,state,
             description_ciphertext,description_iv,description_tag,description_key_version)
           SELECT $1,$2,$3,$4,$5,$6,COALESCE(previous.state,'pending'),$7,$8,$9,$10
           FROM (SELECT 1) seed LEFT JOIN agent_outcome_criteria previous
             ON previous.run_id=$1 AND previous.revision=$11
            AND previous.criterion_id=$3 AND previous.verifier_digest=$5`,
          [runId, nextRevision, criterion.id, criterion.verifierKind,
            criterion.verifierDigest, criterion.required, ...description, run.outcome_revision],
        );
      }
      await client.query(
        `INSERT INTO agent_outcome_criteria
          (run_id,revision,criterion_id,verifier_kind,verifier_digest,required,state,
           description_ciphertext,description_iv,description_tag,description_key_version)
         SELECT run_id,$2,criterion_id,verifier_kind,verifier_digest,required,state,
                description_ciphertext,description_iv,description_tag,description_key_version
         FROM agent_outcome_criteria
         WHERE run_id=$1 AND revision=$3 AND verifier_kind='tool_effect'
         ON CONFLICT (run_id,revision,criterion_id) DO NOTHING`,
        [runId, nextRevision, run.outcome_revision],
      );
      await client.query(
        `INSERT INTO agent_evidence
          (id,run_id,revision,criterion_id,source,status,invocation_id,observation_id,
           observation_fingerprint,public_summary,detail_ciphertext,detail_iv,detail_tag,
           detail_key_version,detail_expires_at)
         SELECT gen_random_uuid(),evidence.run_id,$2,evidence.criterion_id,evidence.source,
                evidence.status,evidence.invocation_id,evidence.observation_id,
                evidence.observation_fingerprint,evidence.public_summary,evidence.detail_ciphertext,
                evidence.detail_iv,evidence.detail_tag,evidence.detail_key_version,evidence.detail_expires_at
         FROM agent_evidence evidence JOIN agent_outcome_criteria current
           ON current.run_id=evidence.run_id AND current.revision=$2
          AND current.criterion_id=evidence.criterion_id
         JOIN agent_outcome_criteria previous
           ON previous.run_id=evidence.run_id AND previous.revision=$3
          AND previous.criterion_id=evidence.criterion_id
          AND previous.verifier_digest=current.verifier_digest
         WHERE evidence.run_id=$1 AND evidence.revision=$3`,
        [runId, nextRevision, run.outcome_revision],
      );
      const contract = envelopeValues(contractEnvelope);
      await client.query(
        `UPDATE agent_runs SET outcome_revision=$2,contract_ciphertext=$3,contract_iv=$4,
           contract_tag=$5,contract_key_version=$6,updated_at=NOW() WHERE id=$1`,
        [runId, nextRevision, ...contract],
      );
      return this.#appendEvent(
        client,
        runId,
        'run.steering_queued',
        'Steering queued with a revised outcome contract.',
        payloadEnvelope,
      );
    });
  }

  async listOwnedSteeringEnvelopes(userId, runId) {
    const result = await this.pool.query(
      `SELECT events.sequence,events.payload_ciphertext,events.payload_iv,
              events.payload_tag,events.payload_key_version
       FROM agent_run_events events JOIN agent_runs runs ON runs.id=events.run_id
       WHERE events.run_id=$1 AND runs.user_id=$2
         AND events.type='run.steering_queued'
       ORDER BY events.sequence`,
      [runId, userId],
    );
    return result.rows.map((row) => ({
      sequence: Number(row.sequence),
      payloadEnvelope: {
        ciphertext: row.payload_ciphertext,
        iv: row.payload_iv,
        tag: row.payload_tag,
        keyVersion: row.payload_key_version,
      },
    }));
  }

  async pendingControl({ runId, workerId, runVersion }) {
    const result = await this.pool.query(
      `SELECT events.id,events.sequence,events.type,events.payload_ciphertext,
              events.payload_iv,events.payload_tag,events.payload_key_version
       FROM agent_runs runs JOIN agent_run_events events ON events.run_id=runs.id
       WHERE runs.id=$1 AND runs.lease_owner=$2 AND runs.run_version=$3
         AND runs.lease_expires_at>NOW() AND events.sequence>runs.last_control_sequence
         AND events.type='run.steering_queued'
       ORDER BY events.sequence LIMIT 1`,
      [runId, workerId, runVersion],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      sequence: Number(row.sequence),
      type: row.type,
      payloadEnvelope: {
        ciphertext: row.payload_ciphertext,
        iv: row.payload_iv,
        tag: row.payload_tag,
        keyVersion: row.payload_key_version,
      },
    } : null;
  }

  async acknowledgeControl({ runId, workerId, runVersion, sequence, type }) {
    return inTransaction(this.pool, async (client) => {
      const changed = await client.query(
        `UPDATE agent_runs SET last_control_sequence=$4,updated_at=NOW()
         WHERE id=$1 AND lease_owner=$2 AND run_version=$3 AND lease_expires_at>NOW()
           AND last_control_sequence<$4 RETURNING id`,
        [runId, workerId, runVersion, sequence],
      );
      if (!changed.rows[0]) throw staleLease();
      return this.#appendEvent(
        client,
        runId,
        type === 'run.steering_queued' ? 'run.steering_applied' : 'run.approval_applied',
        type === 'run.steering_queued'
          ? 'Steering applied at a safe model boundary.'
          : 'Approval decision applied at a safe model boundary.',
      );
    });
  }

  async saveCheckpoint(input) {
    const state = envelopeValues(input.stateEnvelope);
    const result = await this.pool.query(
      `INSERT INTO agent_run_checkpoints
        (run_id,run_version,model_step_id,graph_digest,state_ciphertext,state_iv,state_tag,state_key_version)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8 FROM agent_runs
       WHERE id=$1 AND lease_owner=$9 AND run_version=$2 AND lease_expires_at>NOW()
       ON CONFLICT (run_id,run_version) DO UPDATE SET
         model_step_id=EXCLUDED.model_step_id,graph_digest=EXCLUDED.graph_digest,
         state_ciphertext=EXCLUDED.state_ciphertext,state_iv=EXCLUDED.state_iv,
         state_tag=EXCLUDED.state_tag,state_key_version=EXCLUDED.state_key_version
       RETURNING id`,
      [input.runId, input.runVersion, input.modelStepId, input.graphDigest, ...state, input.workerId],
    );
    if (!result.rows[0]) throw staleLease();
    return result.rows[0].id;
  }

  async loadOperational({ runId, workerId, runVersion }) {
    const result = await this.pool.query(
      `SELECT request_ciphertext,request_iv,request_tag,request_key_version,
              contract_ciphertext,contract_iv,contract_tag,contract_key_version,
              outcome_revision,state,task_id,user_id,agent_turn_id,protocol_version
       FROM agent_runs WHERE id=$1 AND lease_owner=$2 AND run_version=$3
         AND lease_expires_at>NOW()`,
      [runId, workerId, runVersion],
    );
    const row = result.rows[0];
    if (!row) throw staleLease();
    return {
      agentTurnId: row.agent_turn_id,
      contractEnvelope: {
        ciphertext: row.contract_ciphertext,
        iv: row.contract_iv,
        tag: row.contract_tag,
        keyVersion: row.contract_key_version,
      },
      outcomeRevision: row.outcome_revision,
      protocolVersion: row.protocol_version,
      requestEnvelope: {
        ciphertext: row.request_ciphertext,
        iv: row.request_iv,
        tag: row.request_tag,
        keyVersion: row.request_key_version,
      },
      state: row.state,
      taskId: row.task_id,
      userId: row.user_id,
    };
  }

  async latestCheckpoint({ runId, workerId, runVersion }) {
    const result = await this.pool.query(
      `SELECT checkpoints.* FROM agent_run_checkpoints checkpoints
       JOIN agent_runs runs ON runs.id=checkpoints.run_id
       WHERE runs.id=$1 AND runs.lease_owner=$2 AND runs.run_version=$3
         AND runs.lease_expires_at>NOW()
       ORDER BY checkpoints.created_at DESC LIMIT 1`,
      [runId, workerId, runVersion],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      graphDigest: row.graph_digest,
      modelStepId: row.model_step_id,
      runVersion: row.run_version,
      stateEnvelope: {
        ciphertext: row.state_ciphertext,
        iv: row.state_iv,
        tag: row.state_tag,
        keyVersion: row.state_key_version,
      },
    };
  }

  async pendingOrTerminalInvocation(runId) {
    const result = await this.pool.query(
      `SELECT * FROM agent_tool_invocations WHERE run_id=$1
       ORDER BY requested_at DESC LIMIT 1`,
      [runId],
    );
    return result.rows[0] ?? null;
  }

  async registerInvocation(input) {
    const request = envelopeValues(input.requestEnvelope);
    return inTransaction(this.pool, async (client) => {
      const locked = await client.query(
        `SELECT id FROM agent_runs WHERE id=$1 AND lease_owner=$2 AND run_version=$3
         AND lease_expires_at>NOW() AND state NOT IN ('completed','blocked','failed','cancelled','expired') FOR UPDATE`,
        [input.runId, input.workerId, input.runVersion],
      );
      if (!locked.rows[0]) throw staleLease();
      if (input.effectCriterion) {
        const description = envelopeValues(input.effectCriterion.descriptionEnvelope);
        const revision = await client.query('SELECT outcome_revision FROM agent_runs WHERE id=$1', [input.runId]);
        await client.query(
          `INSERT INTO agent_outcome_criteria
            (run_id,revision,criterion_id,verifier_kind,verifier_digest,required,
             description_ciphertext,description_iv,description_tag,description_key_version)
           VALUES ($1,$2,$3,'tool_effect',$4,FALSE,$5,$6,$7,$8)
           ON CONFLICT (run_id,revision,criterion_id) DO NOTHING`,
          [input.runId, revision.rows[0].outcome_revision, input.effectCriterion.id,
            input.effectCriterion.verifierDigest, ...description],
        );
      }
      const result = await client.query(
        `INSERT INTO agent_tool_invocations
          (id,run_id,call_id,tool_id,operation,effect_kind,resource_kind,
           authorization_source,intent_revision,approval_required,consequential,idempotency_key,
           request_ciphertext,request_iv,request_tag,request_key_version,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (run_id,idempotency_key) DO UPDATE SET run_id=EXCLUDED.run_id
         RETURNING *`,
        [input.invocationId ?? randomUUID(), input.runId, input.callId, input.toolId, input.operation,
          input.effect.kind, input.effect.resourceKind, input.authorizationSource,
          input.intentRevision, input.approvalRequired, input.consequential,
          input.idempotencyKey, ...request, input.expiresAt],
      );
      await client.query(
        `UPDATE agent_runs SET state='awaiting_worker',lease_owner=NULL,lease_expires_at=NULL,
           updated_at=NOW() WHERE id=$1`,
        [input.runId],
      );
      await this.#appendEvent(client, input.runId, 'tool.requested', `Waiting for ${input.toolId}.${input.operation}.`);
      return result.rows[0];
    });
  }

  async markDelivered({ invocationId, workerSessionId }) {
    const result = await this.pool.query(
      `UPDATE agent_tool_invocations SET state='delivered',worker_session_id=$2,delivered_at=NOW()
       WHERE id=$1 AND state IN ('requested','delivered') AND expires_at>NOW()
         AND (
           worker_session_id IS NULL OR worker_session_id=$2 OR
           NOT EXISTS (
             SELECT 1 FROM agent_worker_sessions previous
             WHERE previous.id=agent_tool_invocations.worker_session_id
               AND previous.disconnected_at IS NULL AND previous.expires_at>NOW()
           )
         )
       RETURNING *`,
      [invocationId, workerSessionId],
    );
    return result.rows[0] ?? null;
  }

  async grantExecution({
    approvalRequired,
    authorizationSource,
    consequential,
    effect,
    intentRevision,
    invocationId,
    workerSessionId,
  }) {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE agent_tool_invocations SET state='executing',executing_at=NOW(),
           effect_kind=$3,resource_kind=$4,authorization_source=$5,
           approval_required=$6,consequential=$7
         WHERE id=$1 AND worker_session_id=$2 AND state IN ('requested','delivered')
           AND expires_at>NOW() AND intent_revision=$8
         RETURNING *`,
        [invocationId, workerSessionId, effect.kind, effect.resourceKind,
          authorizationSource, approvalRequired, consequential, intentRevision],
      );
      const invocation = result.rows[0];
      if (!invocation) return { granted: false };
      await client.query(
        `UPDATE agent_outcome_criteria criteria SET required=TRUE,updated_at=NOW()
         FROM agent_runs runs
         WHERE criteria.run_id=$1
           AND runs.id=criteria.run_id
           AND criteria.revision=runs.outcome_revision
           AND criteria.criterion_id=$2`,
        [invocation.run_id, effectCriterionId(invocation.tool_id, invocation.operation)],
      );
      return { granted: true, invocation };
    });
  }

  async recordResult(input) {
    if (!TERMINAL_TOOL_STATES.has(input.status)) throw new Error('Invalid terminal tool state.');
    const resultEnvelope = input.resultEnvelope ? envelopeValues(input.resultEnvelope) : [null, null, null, null];
    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE agent_tool_invocations SET state=$3,result_ciphertext=$4,result_iv=$5,
           result_tag=$6,result_key_version=$7,public_summary=$8,terminal_at=NOW()
         WHERE id=$1 AND worker_session_id=$2
           AND (
             state='executing' OR
             (state IN ('requested','delivered') AND $3 IN ('denied','not_executed','cancelled'))
           )
           AND EXISTS (SELECT 1 FROM agent_worker_sessions workers WHERE workers.id=$2
             AND workers.disconnected_at IS NULL AND workers.expires_at>NOW())
         RETURNING *`,
        [input.invocationId, input.workerSessionId, input.status, ...resultEnvelope, input.summary.slice(0, 1_000)],
      );
      const invocation = result.rows[0];
      if (!invocation) return { kind: 'stale' };
      await client.query(`UPDATE agent_runs SET state='verifying',updated_at=NOW() WHERE id=$1`, [invocation.run_id]);
      await this.#appendEvent(client, invocation.run_id, 'tool.completed', input.summary);
      return { invocation, kind: 'committed' };
    });
  }

  async recordEvidence({ runId, revision, evidence }) {
    return inTransaction(this.pool, async (client) => {
      for (const item of evidence) {
        await client.query(
          `INSERT INTO agent_evidence
            (id,run_id,revision,criterion_id,source,status,invocation_id,
             observation_id,observation_fingerprint,public_summary)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (id) DO NOTHING`,
          [item.id, runId, revision, item.criterionId, item.source, item.status,
            item.invocationId ?? null, item.observationId ?? null,
            item.observationFingerprint ?? null, item.summary.slice(0, 1_000)],
        );
        await client.query(
          `UPDATE agent_outcome_criteria SET state=CASE
             WHEN $4='contradicts' THEN 'failed'
             WHEN $4='supports' THEN 'passed'
             WHEN $4='unknown' THEN 'unknown'
             ELSE state END,updated_at=NOW()
           WHERE run_id=$1 AND revision=$2 AND criterion_id=$3`,
          [runId, revision, item.criterionId, item.status],
        );
      }
    });
  }

  async setCriterionResults({ runId, revision, results, workerId, runVersion }) {
    return inTransaction(this.pool, async (client) => {
      const locked = await client.query(
        `SELECT id FROM agent_runs WHERE id=$1 AND lease_owner=$2 AND run_version=$3
         AND lease_expires_at>NOW() FOR UPDATE`,
        [runId, workerId, runVersion],
      );
      if (!locked.rows[0]) throw staleLease();
      for (const result of results) {
        await client.query(
          `UPDATE agent_outcome_criteria SET state=$4,updated_at=NOW()
           WHERE run_id=$1 AND revision=$2 AND criterion_id=$3`,
          [runId, revision, result.criterionId, result.state],
        );
      }
    });
  }

  async evidenceForRun(runId, revision) {
    const result = await this.pool.query(
      `SELECT id,criterion_id,source,status,invocation_id,observation_id,
              observation_fingerprint,public_summary,created_at
       FROM agent_evidence WHERE run_id=$1 AND revision=$2 ORDER BY created_at`,
      [runId, revision],
    );
    return result.rows.map((row) => ({
      id: row.id,
      criterionId: row.criterion_id,
      source: row.source,
      status: row.status,
      invocationId: row.invocation_id ?? undefined,
      observationId: row.observation_id ?? undefined,
      observationFingerprint: row.observation_fingerprint ?? undefined,
      summary: row.public_summary,
      createdAt: iso(row.created_at),
    }));
  }

  async completeVerified({ finalEnvelope, runId, workerId, runVersion }) {
    return inTransaction(this.pool, async (client) => {
      const locked = await client.query(
        `SELECT * FROM agent_runs WHERE id=$1 AND lease_owner=$2 AND run_version=$3
         AND lease_expires_at>NOW() FOR UPDATE`,
        [runId, workerId, runVersion],
      );
      const run = locked.rows[0];
      if (!run) throw staleLease();
      if (TERMINAL_RUN_STATES.has(run.state)) return { kind: 'terminal', run: normalizeRun(run) };
      const incomplete = await client.query(
        `SELECT criterion_id,state FROM agent_outcome_criteria
         WHERE run_id=$1 AND revision=$2 AND required=TRUE AND state<>'passed'
         ORDER BY criterion_id LIMIT 1`,
        [runId, run.outcome_revision],
      );
      if (incomplete.rows[0]) {
        return { criterionId: incomplete.rows[0].criterion_id, kind: 'incomplete', state: incomplete.rows[0].state };
      }
      const completed = await client.query(
        `UPDATE agent_runs SET state='completed',public_summary=$2,completed_at=NOW(),updated_at=NOW(),
           lease_owner=NULL,lease_expires_at=NULL WHERE id=$1 RETURNING *`,
        [runId, 'Task completed with all required outcomes verified.'],
      );
      const event = await this.#appendEvent(
        client,
        runId,
        'run.completed',
        'Task completed with all required outcomes verified.',
        finalEnvelope,
      );
      return { event, kind: 'completed', run: normalizeRun(completed.rows[0]) };
    });
  }

  async cancel(userId, runId) {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE agent_runs SET state='cancelled',updated_at=NOW(),lease_owner=NULL,lease_expires_at=NULL
         WHERE id=$1 AND user_id=$2 AND state NOT IN ('completed','failed','cancelled','expired') RETURNING *`,
        [runId, userId],
      );
      if (!result.rows[0]) return null;
      await client.query(
        `UPDATE agent_tool_invocations SET state=CASE WHEN state='executing' THEN 'unknown' ELSE 'cancelled' END,
         terminal_at=NOW() WHERE run_id=$1 AND state IN ('requested','delivered','executing')`,
        [runId],
      );
      await this.#appendEvent(client, runId, 'run.cancelled', 'Task cancelled.');
      return normalizeRun(result.rows[0]);
    });
  }

  async disconnectWorker({ userId, workerSessionId }) {
    return inTransaction(this.pool, async (client) => {
      await client.query(
        `UPDATE agent_worker_sessions SET disconnected_at=COALESCE(disconnected_at,NOW()),expires_at=NOW()
         WHERE id=$1 AND user_id=$2`,
        [workerSessionId, userId],
      );
      await client.query(
        `UPDATE agent_tool_invocations invocations SET state='requested',worker_session_id=NULL,
           delivered_at=NULL,executing_at=NULL
         FROM agent_runs runs WHERE invocations.run_id=runs.id AND runs.user_id=$1
           AND invocations.worker_session_id=$2 AND invocations.state='executing'
           AND invocations.tool_id='task.interaction'`,
        [userId, workerSessionId],
      );
      const ambiguous = await client.query(
        `UPDATE agent_tool_invocations invocations SET state='unknown',terminal_at=NOW(),
           public_summary='Desktop worker disconnected after execution began.'
         FROM agent_runs runs WHERE invocations.run_id=runs.id AND runs.user_id=$1
           AND invocations.worker_session_id=$2 AND invocations.state='executing'
         RETURNING invocations.run_id`,
        [userId, workerSessionId],
      );
      const runIds = [...new Set(ambiguous.rows.map((row) => row.run_id))];
      for (const runId of runIds) {
        const blocked = await client.query(
          `UPDATE agent_runs SET state='blocked',lease_owner=NULL,lease_expires_at=NULL,
             public_summary='A desktop action has an unknown outcome.',updated_at=NOW()
           WHERE id=$1 AND state NOT IN ('completed','blocked','failed','cancelled','expired')
           RETURNING id`,
          [runId],
        );
        if (blocked.rows[0]) {
          await this.#appendEvent(
            client,
            runId,
            'run.blocked',
            'Desktop execution became unknown after the worker disconnected.',
          );
        }
      }
      return { ambiguousInvocationCount: ambiguous.rowCount };
    });
  }

  async expire() {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE agent_runs SET state='expired',updated_at=NOW(),lease_owner=NULL,lease_expires_at=NULL
         WHERE deadline_at<=NOW() AND state NOT IN ('completed','blocked','failed','cancelled','expired') RETURNING id`,
      );
      for (const row of result.rows) {
        await this.#appendEvent(client, row.id, 'run.expired', 'Task deadline expired.');
      }
      return result.rowCount;
    });
  }

  async expireToolInvocations() {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE agent_tool_invocations SET state='expired',terminal_at=NOW(),
           public_summary='Desktop invocation expired before execution.'
         WHERE expires_at<=NOW() AND state IN ('requested','delivered') RETURNING run_id`,
      );
      const runIds = [...new Set(result.rows.map((row) => row.run_id))];
      for (const runId of runIds) {
        const blocked = await client.query(
          `UPDATE agent_runs SET state='blocked',lease_owner=NULL,lease_expires_at=NULL,
             public_summary='A required desktop invocation expired.',updated_at=NOW()
           WHERE id=$1 AND state NOT IN ('completed','blocked','failed','cancelled','expired')
           RETURNING id`,
          [runId],
        );
        if (blocked.rows[0]) {
          await this.#appendEvent(
            client,
            runId,
            'run.blocked',
            'A required desktop invocation expired before execution.',
          );
        }
      }
      return result.rowCount;
    });
  }

  async cleanupExpiredPayloads() {
    const runs = await this.pool.query(
      `UPDATE agent_runs SET request_ciphertext=NULL,request_iv=NULL,request_tag=NULL,
         request_key_version=NULL,contract_ciphertext=NULL,contract_iv=NULL,contract_tag=NULL,
         contract_key_version=NULL WHERE payload_expires_at<=NOW()
         AND request_ciphertext IS NOT NULL`,
    );
    const tools = await this.pool.query(
      `UPDATE agent_tool_invocations invocations SET
         request_ciphertext=NULL,request_iv=NULL,request_tag=NULL,request_key_version=NULL,
         result_ciphertext=NULL,result_iv=NULL,result_tag=NULL,result_key_version=NULL
       FROM agent_runs runs WHERE invocations.run_id=runs.id AND runs.payload_expires_at<=NOW()
         AND (invocations.request_ciphertext IS NOT NULL OR invocations.result_ciphertext IS NOT NULL)`,
    );
    const events = await this.pool.query(
      `UPDATE agent_run_events events SET payload_ciphertext=NULL,payload_iv=NULL,payload_tag=NULL,
         payload_key_version=NULL FROM agent_runs runs
       WHERE events.run_id=runs.id AND runs.payload_expires_at<=NOW()
         AND events.payload_ciphertext IS NOT NULL`,
    );
    const checkpoints = await this.pool.query(
      `DELETE FROM agent_run_checkpoints checkpoints USING agent_runs runs
       WHERE checkpoints.run_id=runs.id AND runs.payload_expires_at<=NOW()`,
    );
    const sessions = await this.pool.query(
      `DELETE FROM agent_session_items items USING agent_runs runs
       WHERE items.run_id=runs.id AND runs.payload_expires_at<=NOW()`,
    );
    const evidence = await this.pool.query(
      `UPDATE agent_evidence SET detail_ciphertext=NULL,detail_iv=NULL,detail_tag=NULL,detail_key_version=NULL
       WHERE detail_expires_at<=NOW() AND detail_ciphertext IS NOT NULL`,
    );
    return {
      checkpoints: checkpoints.rowCount,
      evidence: evidence.rowCount,
      eventPayloads: events.rowCount,
      runPayloads: runs.rowCount,
      sessionItems: sessions.rowCount,
      toolPayloads: tools.rowCount,
    };
  }

  async #appendEvent(client, runId, type, summary, payloadEnvelope = null) {
    const sequence = await client.query(
      `UPDATE agent_runs SET next_sequence=next_sequence+1,updated_at=NOW()
       WHERE id=$1 RETURNING next_sequence-1 AS sequence`,
      [runId],
    );
    const inserted = await client.query(
      `INSERT INTO agent_run_events
        (run_id,sequence,type,public_summary,payload_ciphertext,payload_iv,payload_tag,payload_key_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id,run_id,sequence,type,public_summary,created_at`,
      [runId, sequence.rows[0].sequence, type, summary.slice(0, 1_000),
        payloadEnvelope?.ciphertext ?? null, payloadEnvelope?.iv ?? null,
        payloadEnvelope?.tag ?? null, payloadEnvelope?.keyVersion ?? null],
    );
    const row = inserted.rows[0];
    await client.query(`SELECT pg_notify('agent_run_events',$1)`, [`${runId}:${row.sequence}`]);
    return {
      id: row.id,
      runId: row.run_id,
      sequence: Number(row.sequence),
      type: row.type,
      summary: row.public_summary,
      createdAt: iso(row.created_at),
    };
  }
}
