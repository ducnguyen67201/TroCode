import { inTransaction, iso } from './knowledge-repository-utils.mjs';

function normalizeSource(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    relativePath: row.virtual_path,
    role: row.role,
    createdAt: iso(row.created_at),
    latestVersion: row.version_id ? {
      id: row.version_id,
      state: row.version_state,
      mediaType: row.media_type,
      byteSize: Number(row.byte_size),
      createdAt: iso(row.version_created_at),
      errorCode: row.error_code,
    } : null,
  };
}

export class PostgresKnowledgeSourceRepository {
  constructor(pool) { this.pool = pool; }

  async createPendingBatch({ files, spaceId, userId, objectKeyFor }) {
    return inTransaction(this.pool, async (client) => {
      const created = [];
      for (const file of files) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`source:${spaceId}:${file.clientId}`]);
        const existing = await client.query(
          `SELECT sources.id, versions.id AS version_id, versions.object_key, versions.byte_size,
                  versions.sha256, versions.media_type, versions.state
           FROM knowledge_sources sources JOIN knowledge_source_versions versions ON versions.source_id = sources.id
           WHERE sources.space_id = $1 AND sources.client_id = $2
           ORDER BY versions.version_number DESC LIMIT 1`, [spaceId, file.clientId],
        );
        if (existing.rows[0]) {
          const version = existing.rows[0];
          if (Number(version.byte_size) !== file.byteSize || version.sha256 !== file.sha256 || version.media_type !== file.mediaType) {
            const error = new Error('Upload idempotency key conflicts with different file metadata.');
            error.status = 409; error.code = 'upload_conflict'; throw error;
          }
          created.push({ sourceId: version.id, sourceVersionId: version.version_id, objectKey: version.object_key, state: version.state, newlyCreated: false, file });
          continue;
        }
        const source = await client.query(
          `INSERT INTO knowledge_sources (client_id, space_id, display_name, virtual_path, role, created_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [file.clientId, spaceId, file.displayName, file.relativePath, file.role, userId],
        );
        const objectKey = objectKeyFor();
        const version = await client.query(
          `INSERT INTO knowledge_source_versions
             (source_id, version_number, state, media_type, byte_size, sha256, object_key, created_by)
           VALUES ($1,1,'pending_upload',$2,$3,$4,$5,$6) RETURNING id, state`,
          [source.rows[0].id, file.mediaType, file.byteSize, file.sha256, objectKey, userId],
        );
        created.push({ sourceId: source.rows[0].id, sourceVersionId: version.rows[0].id, objectKey, state: version.rows[0].state, newlyCreated: true, file });
      }
      return created;
    });
  }

  async uploadAuthority(sourceVersionId, userId) {
    const result = await this.pool.query(
      `SELECT versions.id, versions.object_key, versions.byte_size, versions.sha256, versions.media_type,
              versions.state, sources.space_id
       FROM knowledge_source_versions versions
       JOIN knowledge_sources sources ON sources.id = versions.source_id
       LEFT JOIN knowledge_space_members members ON members.space_id = sources.space_id
         AND members.user_id = $2 AND members.removed_at IS NULL
       WHERE versions.id = $1 AND (
         members.role IN ('owner','facilitator') OR EXISTS (
           SELECT 1 FROM knowledge_submission_artifacts artifacts
           JOIN knowledge_activity_attempts attempts ON attempts.id=artifacts.attempt_id
           WHERE artifacts.source_version_id=versions.id AND attempts.user_id=$2
         )
       )`, [sourceVersionId, userId],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id, objectKey: row.object_key, byteSize: Number(row.byte_size), sha256: row.sha256,
      mediaType: row.media_type, state: row.state, spaceId: row.space_id,
    } : null;
  }

  async linkSubmissionArtifacts({ attemptId, items, userId }) {
    return inTransaction(this.pool, async (client) => {
      const attempt = await client.query(
        `SELECT attempts.id FROM knowledge_activity_attempts attempts
         WHERE attempts.id=$1 AND attempts.user_id=$2 FOR UPDATE`,
        [attemptId, userId],
      );
      if (!attempt.rows[0]) return false;
      for (const item of items) {
        await client.query(
          `INSERT INTO knowledge_submission_artifacts
             (client_id,attempt_id,source_version_id,submitted_by)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (attempt_id,client_id) DO NOTHING`,
          [item.file.clientId, attemptId, item.sourceVersionId, userId],
        );
      }
      return true;
    });
  }

  async markUploadedAndQueue(sourceVersionId) {
    return inTransaction(this.pool, async (client) => {
      const updated = await client.query(
        `UPDATE knowledge_source_versions SET state = 'processing'
         WHERE id = $1 AND state IN ('pending_upload','processing') RETURNING id, state`, [sourceVersionId],
      );
      if (!updated.rows[0]) return null;
      await client.query(
        `INSERT INTO knowledge_ingestion_jobs (source_version_id) VALUES ($1)
         ON CONFLICT (source_version_id) DO UPDATE SET
           state = CASE WHEN knowledge_ingestion_jobs.state = 'completed' THEN knowledge_ingestion_jobs.state ELSE 'queued' END,
           available_at = CASE WHEN knowledge_ingestion_jobs.state = 'completed' THEN knowledge_ingestion_jobs.available_at ELSE NOW() END,
           updated_at = NOW()`, [sourceVersionId],
      );
      return { id: sourceVersionId, state: 'processing' };
    });
  }

  async list(spaceId, userId, limit = 100) {
    const result = await this.pool.query(
      `SELECT sources.*, latest.id AS version_id, latest.state AS version_state, latest.media_type,
              latest.byte_size, latest.created_at AS version_created_at, latest.error_code
       FROM knowledge_sources sources
       JOIN knowledge_space_members members ON members.space_id = sources.space_id
       LEFT JOIN LATERAL (
         SELECT * FROM knowledge_source_versions versions WHERE versions.source_id = sources.id
         ORDER BY versions.version_number DESC LIMIT 1
       ) latest ON TRUE
       WHERE sources.space_id = $1 AND members.user_id = $2 AND members.removed_at IS NULL
         AND sources.archived_at IS NULL AND sources.role <> 'submission'
         AND (
           members.role IN ('owner','facilitator') OR EXISTS (
             SELECT 1
             FROM knowledge_activity_version_sources pinned
             JOIN knowledge_activity_runs runs
               ON runs.activity_version_id=pinned.activity_version_id
             JOIN knowledge_activity_attempts attempts ON attempts.run_id=runs.id
             WHERE pinned.source_version_id=latest.id AND attempts.user_id=$2
               AND attempts.state <> 'withdrawn'
           )
         )
       ORDER BY sources.created_at DESC, sources.id DESC LIMIT $3`, [spaceId, userId, limit],
    );
    return result.rows.map(normalizeSource);
  }

  async storageUsedByOwner(userId) {
    const result = await this.pool.query(
      `SELECT COALESCE(SUM(versions.byte_size),0)::bigint AS value
       FROM knowledge_source_versions versions
       JOIN knowledge_sources sources ON sources.id=versions.source_id
       JOIN knowledge_spaces spaces ON spaces.id=sources.space_id
       WHERE spaces.owner_user_id=$1 AND sources.archived_at IS NULL`,
      [userId],
    );
    return Number(result.rows[0]?.value ?? 0);
  }

  async replaceChunks({ chunks, pageCount, parserVersion, sourceVersionId }) {
    return inTransaction(this.pool, async (client) => {
      const locked = await client.query(`SELECT state FROM knowledge_source_versions WHERE id = $1 FOR UPDATE`, [sourceVersionId]);
      if (!locked.rows[0]) return false;
      await client.query(`DELETE FROM knowledge_source_chunks WHERE source_version_id = $1`, [sourceVersionId]);
      for (const chunk of chunks) await client.query(
        `INSERT INTO knowledge_source_chunks (source_version_id, ordinal, locator, body) VALUES ($1,$2,$3,$4)`,
        [sourceVersionId, chunk.ordinal, chunk.locator, chunk.body],
      );
      await client.query(
        `UPDATE knowledge_source_versions SET state='ready', parser_version=$2, page_count=$3, ready_at=NOW(), error_code=NULL WHERE id=$1`,
        [sourceVersionId, parserVersion, pageCount],
      );
      await client.query(`UPDATE knowledge_ingestion_jobs SET state='completed', lease_owner=NULL, lease_expires_at=NULL, updated_at=NOW() WHERE source_version_id=$1`, [sourceVersionId]);
      return true;
    });
  }

  async markFailed(sourceVersionId, errorCode) {
    await this.pool.query(
      `UPDATE knowledge_source_versions SET state='failed', error_code=$2 WHERE id=$1`, [sourceVersionId, errorCode],
    );
  }
}
