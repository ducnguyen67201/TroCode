import { inTransaction } from './knowledge-repository-utils.mjs';

function stripImageBytes(value) {
  if (Array.isArray(value)) return value.map(stripImageBytes);
  if (!value || typeof value !== 'object') return value;
  if (value.type === 'input_image' || value.type === 'computer_screenshot') {
    return {
      type: 'input_text',
      text: '[visual evidence expired; capture a fresh observation]',
    };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (
        key === 'dataBase64' ||
        key === 'dataUrl' ||
        key === 'image_url' ||
        key === 'imageUrl'
      ) {
        return [key, '[visual evidence removed]'];
      }
      if (typeof item === 'string' && item.startsWith('data:image/')) {
        return [key, '[visual evidence removed]'];
      }
      return [key, stripImageBytes(item)];
    }),
  );
}

function envelopeFromRow(row) {
  return {
    ciphertext: row.item_ciphertext,
    iv: row.item_iv,
    tag: row.item_tag,
    keyVersion: row.item_key_version,
  };
}

export class DurableAgentSession {
  constructor({ crypto, pool, runId }) {
    this.crypto = crypto;
    this.pool = pool;
    this.runId = runId;
  }

  async getSessionId() {
    return this.runId;
  }

  async getItems(limit) {
    const boundedLimit = limit === undefined ? 1_000 : Math.min(Math.max(limit, 1), 1_000);
    const result = await this.pool.query(
      `SELECT items.generation,items.item_sequence,items.item_ciphertext,items.item_iv,
              items.item_tag,items.item_key_version
       FROM agent_session_items items JOIN agent_runs runs ON runs.id=items.run_id
       WHERE items.run_id=$1 AND items.generation=runs.session_generation
       ORDER BY item_sequence DESC LIMIT $2`,
      [this.runId, boundedLimit],
    );
    return result.rows.reverse().map((row) =>
      this.crypto.decryptJson(envelopeFromRow(row), {
        kind: 'agent_session_item',
        runId: this.runId,
        schemaVersion: 1,
        generation: Number(row.generation),
        sequence: Number(row.item_sequence),
      }),
    );
  }

  async addItems(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    if (items.length > 200) throw new Error('A session append cannot exceed 200 items.');
    await inTransaction(this.pool, async (client) => {
      const run = await client.query(
        `SELECT session_generation,pending_session_generation
         FROM agent_runs WHERE id=$1 FOR UPDATE`,
        [this.runId],
      );
      const generation =
        run.rows[0].pending_session_generation ?? run.rows[0].session_generation;
      const latest = await client.query(
        `SELECT COALESCE(MAX(item_sequence),0) AS sequence
         FROM agent_session_items WHERE run_id=$1 AND generation=$2`,
        [this.runId, generation],
      );
      let sequence = Number(latest.rows[0].sequence);
      for (const item of items) {
        sequence += 1;
        const envelope = this.crypto.encryptJson(stripImageBytes(item), {
          kind: 'agent_session_item',
          runId: this.runId,
          schemaVersion: 1,
          generation: Number(generation),
          sequence,
        });
        await client.query(
          `INSERT INTO agent_session_items
            (run_id,generation,item_sequence,item_ciphertext,item_iv,item_tag,item_key_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [this.runId, generation, sequence, envelope.ciphertext, envelope.iv, envelope.tag, envelope.keyVersion],
        );
      }
      if (run.rows[0].pending_session_generation !== null) {
        await client.query(
          `UPDATE agent_runs SET session_generation=$2,pending_session_generation=NULL,
             updated_at=NOW() WHERE id=$1`,
          [this.runId, generation],
        );
        await client.query(
          `DELETE FROM agent_session_items WHERE run_id=$1 AND generation<>$2`,
          [this.runId, generation],
        );
      }
    });
  }

  async addControlItem(sourceEventId, item) {
    await inTransaction(this.pool, async (client) => {
      const run = await client.query(
        'SELECT session_generation FROM agent_runs WHERE id=$1 FOR UPDATE',
        [this.runId],
      );
      const generation = run.rows[0].session_generation;
      const latest = await client.query(
        `SELECT COALESCE(MAX(item_sequence),0) AS sequence
         FROM agent_session_items WHERE run_id=$1 AND generation=$2`,
        [this.runId, generation],
      );
      const sequence = Number(latest.rows[0].sequence) + 1;
      const envelope = this.crypto.encryptJson(stripImageBytes(item), {
        kind: 'agent_session_item',
        runId: this.runId,
        schemaVersion: 1,
        generation: Number(generation),
        sequence,
      });
      await client.query(
        `INSERT INTO agent_session_items
          (run_id,generation,item_sequence,source_event_id,item_ciphertext,item_iv,item_tag,item_key_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (run_id,source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING`,
        [this.runId, generation, sequence, sourceEventId, envelope.ciphertext, envelope.iv, envelope.tag, envelope.keyVersion],
      );
    });
  }

  async popItem() {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        `DELETE FROM agent_session_items WHERE (run_id,generation,item_sequence) IN (
           SELECT items.run_id,items.generation,items.item_sequence
           FROM agent_session_items items JOIN agent_runs runs ON runs.id=items.run_id
           WHERE items.run_id=$1 AND items.generation=runs.session_generation
           ORDER BY item_sequence DESC LIMIT 1 FOR UPDATE
         ) RETURNING generation,item_sequence,item_ciphertext,item_iv,item_tag,item_key_version`,
        [this.runId],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      return this.crypto.decryptJson(envelopeFromRow(row), {
        kind: 'agent_session_item',
        runId: this.runId,
        schemaVersion: 1,
        generation: Number(row.generation),
        sequence: Number(row.item_sequence),
      });
    });
  }

  async clearSession() {
    await this.pool.query(
      `UPDATE agent_runs SET pending_session_generation=session_generation+1,
         updated_at=NOW() WHERE id=$1`,
      [this.runId],
    );
  }
}

export function createCompactingAgentSession({
  client,
  compactionModel,
  maxItems = 80,
  openAIResponsesCompactionSession,
  session,
}) {
  if (!openAIResponsesCompactionSession) return session;
  const compactingSession = new openAIResponsesCompactionSession({
    client,
    compactionMode: 'input',
    model: compactionModel,
    underlyingSession: session,
    shouldTriggerCompaction: ({ compactionCandidateItems, sessionItems }) =>
      compactionCandidateItems.length >= maxItems || sessionItems.length >= maxItems * 2,
  });
  compactingSession.addControlItem = (sourceEventId, item) =>
    session.addControlItem(sourceEventId, item);
  return compactingSession;
}
