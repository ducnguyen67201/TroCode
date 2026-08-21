import { createHash, randomUUID } from 'node:crypto';

import {
  ActionEffectSchema,
  DesktopInvocationResultSchema,
  DesktopExecutionGrantSchema,
  DesktopWorkerCapabilitiesSchema,
} from './agent-runtime-contracts.mjs';
import { AGENT_TOOL_SCHEMA_DIGEST } from './agent-tool-catalog.mjs';

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

export class DesktopWorkerController {
  constructor({ crypto, pool, repository, visualSidecar, heartbeatTtlMs = 35_000 }) {
    this.crypto = crypto;
    this.pool = pool;
    this.repository = repository;
    this.visualSidecar = visualSidecar;
    this.heartbeatTtlMs = heartbeatTtlMs;
  }

  async connect({ deviceSessionId, userId, capabilities }) {
    const parsed = DesktopWorkerCapabilitiesSchema.parse(capabilities);
    if (parsed.schemaDigest !== AGENT_TOOL_SCHEMA_DIGEST) {
      const error = new Error('Desktop worker must upgrade before accepting tasks.');
      error.code = 'worker_upgrade_required';
      error.status = 409;
      throw error;
    }
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO agent_worker_sessions
        (id,user_id,device_session_id,protocol_version,schema_digest,capabilities,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()+($7 * INTERVAL '1 millisecond'))
       RETURNING id,connected_at,expires_at`,
      [id, userId, deviceSessionId, parsed.protocolVersion, parsed.schemaDigest, parsed, this.heartbeatTtlMs],
    );
    await this.pool.query(
      `UPDATE agent_runs SET state='recovering',lease_owner=NULL,lease_expires_at=NULL,
         updated_at=NOW(),public_summary='Desktop worker reconnected; resuming task.'
       WHERE user_id=$1 AND state='awaiting_worker' AND deadline_at>NOW()`,
      [userId],
    );
    return {
      id: result.rows[0].id,
      connectedAt: iso(result.rows[0].connected_at),
      expiresAt: iso(result.rows[0].expires_at),
    };
  }

  async capabilitiesForUser(userId) {
    const result = await this.pool.query(
      `SELECT workers.capabilities,users.plan FROM agent_worker_sessions workers
       JOIN users ON users.id=workers.user_id
       WHERE workers.user_id=$1 AND workers.disconnected_at IS NULL AND workers.expires_at>NOW()
       ORDER BY workers.heartbeat_at DESC LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    return row ? { ...DesktopWorkerCapabilitiesSchema.parse(row.capabilities), planId: row.plan } : null;
  }

  async heartbeat({ userId, workerSessionId }) {
    const result = await this.pool.query(
      `UPDATE agent_worker_sessions SET heartbeat_at=NOW(),
         expires_at=NOW()+($3 * INTERVAL '1 millisecond')
       WHERE id=$1 AND user_id=$2 AND disconnected_at IS NULL RETURNING expires_at`,
      [workerSessionId, userId, this.heartbeatTtlMs],
    );
    return result.rows[0] ? { expiresAt: iso(result.rows[0].expires_at) } : null;
  }

  async pending({ userId, workerSessionId, after = null }) {
    const worker = await this.#requireWorker(userId, workerSessionId);
    const result = await this.pool.query(
      `SELECT invocations.* FROM agent_tool_invocations invocations
       JOIN agent_runs runs ON runs.id=invocations.run_id
       WHERE runs.user_id=$1 AND invocations.state IN ('requested','delivered')
         AND invocations.expires_at>NOW()
         AND ($2::timestamptz IS NULL OR invocations.requested_at>$2)
         AND (
           invocations.state='requested' OR
           invocations.worker_session_id=$3 OR
           NOT EXISTS (
             SELECT 1 FROM agent_worker_sessions previous
             WHERE previous.id=invocations.worker_session_id
               AND previous.disconnected_at IS NULL AND previous.expires_at>NOW()
           )
         )
       ORDER BY invocations.requested_at LIMIT 100`,
      [userId, after, worker.id],
    );
    const items = [];
    for (const row of result.rows) {
      const input = this.crypto.decryptJson({
        ciphertext: row.request_ciphertext,
        iv: row.request_iv,
        tag: row.request_tag,
        keyVersion: row.request_key_version,
      }, { invocationId: row.id, kind: 'agent_tool_request', runId: row.run_id, schemaVersion: 1 });
      const effect = ActionEffectSchema.parse(input.effect);
      if (
        effect.kind !== row.effect_kind ||
        effect.resourceKind !== row.resource_kind ||
        input.intentRevision !== row.intent_revision ||
        input.approvalRequired !== row.approval_required ||
        input.authorizationSource !== row.authorization_source ||
        input.consequential !== row.consequential
      ) {
        throw new Error('Persisted desktop invocation policy metadata is inconsistent.');
      }
      await this.repository.markDelivered({ invocationId: row.id, workerSessionId: worker.id });
      const verifierKinds = [];
      if (row.tool_id === 'application.launch') verifierKinds.push('application_surface');
      if (row.tool_id === 'browser.dom') verifierKinds.push('browser_semantic');
      if (row.tool_id === 'workspace.filesystem' || row.tool_id === 'workspace.terminal') {
        verifierKinds.push('filesystem_effect');
      }
      const filesystemCriterionIds = row.tool_id.startsWith('workspace.')
        ? [
            'workspace-inspected',
            ...(row.operation === 'write_file' || row.operation === 'run_command'
              ? ['workspace-mutated']
              : []),
          ]
        : [];
      const effectVerifier = {
        kind: 'tool_effect',
        operation: row.operation,
        toolId: row.tool_id,
      };
      const effectCriterionId = `effect-${createHash('sha256')
        .update(JSON.stringify(effectVerifier)).digest('hex').slice(0, 16)}`;
      const obligations = await this.pool.query(
        `SELECT criteria.criterion_id,criteria.verifier_kind
         FROM agent_outcome_criteria criteria JOIN agent_runs runs ON runs.id=criteria.run_id
         WHERE criteria.run_id=$1 AND criteria.revision=runs.outcome_revision
           AND (
             criteria.criterion_id=$2 OR
             (
               criteria.verifier_kind=ANY($3::text[]) AND
               (
                 criteria.verifier_kind<>'filesystem_effect' OR
                 criteria.criterion_id=ANY($4::text[])
               )
             )
           )
         ORDER BY (criteria.criterion_id=$2) DESC,criteria.criterion_id
         LIMIT 4`,
        [row.run_id, effectCriterionId, verifierKinds, filesystemCriterionIds],
      );
      items.push({
        protocolVersion: worker.protocol_version,
        schemaDigest: worker.schema_digest,
        invocationId: row.id,
        runId: row.run_id,
        callId: row.call_id,
        toolId: row.tool_id,
        operation: row.operation,
        effect,
        intentRevision: row.intent_revision,
        approvalRequired: row.approval_required,
        authorizationSource: row.authorization_source,
        consequential: row.consequential,
        input: input.input,
        obligations: obligations.rows.map((criterion) => ({
          criterionId: criterion.criterion_id,
          verifierKind: criterion.verifier_kind,
        })),
        expiresAt: iso(row.expires_at),
      });
    }
    return items;
  }

  async grantExecution({ userId, workerSessionId, input }) {
    await this.#requireWorker(userId, workerSessionId);
    const grant = DesktopExecutionGrantSchema.parse(input);
    return this.repository.grantExecution({ ...grant, workerSessionId });
  }

  async recordResult({ userId, workerSessionId, input }) {
    await this.#requireWorker(userId, workerSessionId);
    const result = DesktopInvocationResultSchema.parse(input);
    const invocation = await this.pool.query(
      `SELECT id,run_id,tool_id,operation FROM agent_tool_invocations
       WHERE id=$1 AND worker_session_id=$2`,
      [result.invocationId, workerSessionId],
    );
    const row = invocation.rows[0];
    if (!row) return { kind: 'stale' };
    if (result.visual) this.visualSidecar?.put(result.invocationId, result.visual);
    const { visual: _visual, ...durableResult } = result;
    const resultEnvelope = this.crypto.encryptJson(durableResult, {
      invocationId: result.invocationId,
      kind: 'agent_tool_result',
      runId: row.run_id,
      schemaVersion: 1,
    });
    const publicSummary =
      `${row.tool_id}.${row.operation} returned ${result.status}.`;
    const committed = await this.repository.recordResult({
      invocationId: result.invocationId,
      resultEnvelope,
      status: result.status,
      summary: publicSummary,
      workerSessionId,
    });
    if (committed.kind !== 'committed' && result.visual) {
      this.visualSidecar?.take(result.invocationId);
    }
    if (committed.kind === 'committed' && result.evidence.length > 0) {
      const revision = await this.pool.query('SELECT outcome_revision FROM agent_runs WHERE id=$1', [row.run_id]);
      await this.repository.recordEvidence({
        runId: row.run_id,
        revision: revision.rows[0].outcome_revision,
        evidence: result.evidence.map((item) => ({
          ...item,
          id: randomUUID(),
          invocationId: result.invocationId,
          summary: `${item.source} evidence returned ${item.status}.`,
        })),
      });
    }
    return committed;
  }

  async disconnect({ userId, workerSessionId }) {
    return this.repository.disconnectWorker({ userId, workerSessionId });
  }

  async expireStale() {
    const stale = await this.pool.query(
      `SELECT id,user_id FROM agent_worker_sessions
       WHERE disconnected_at IS NULL AND expires_at<=NOW() LIMIT 500`,
    );
    let ambiguousInvocationCount = 0;
    for (const row of stale.rows) {
      const result = await this.repository.disconnectWorker({
        userId: row.user_id,
        workerSessionId: row.id,
      });
      ambiguousInvocationCount += result.ambiguousInvocationCount;
    }
    return { ambiguousInvocationCount, expiredWorkerCount: stale.rowCount };
  }

  async #requireWorker(userId, workerSessionId) {
    const result = await this.pool.query(
      `SELECT * FROM agent_worker_sessions WHERE id=$1 AND user_id=$2
       AND disconnected_at IS NULL AND expires_at>NOW()`,
      [workerSessionId, userId],
    );
    const row = result.rows[0];
    if (!row) {
      const error = new Error('Desktop worker session is stale or disconnected.');
      error.code = 'stale_worker_session';
      error.status = 409;
      throw error;
    }
    return row;
  }
}
