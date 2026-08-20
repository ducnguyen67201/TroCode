import { inTransaction, iso } from './knowledge-repository-utils.mjs';

export class KnowledgeIngestionJobRepository {
  constructor(pool) { this.pool = pool; }

  async claim({ leaseMs, workerId }) {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        `WITH candidate AS (
           SELECT jobs.id FROM knowledge_ingestion_jobs jobs
           WHERE ((jobs.state IN ('queued','retry') AND jobs.available_at <= NOW())
              OR (jobs.state='leased' AND jobs.lease_expires_at < NOW()))
             AND jobs.attempt_count < 12
           ORDER BY jobs.available_at, jobs.created_at
           FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE knowledge_ingestion_jobs jobs SET state='leased', lease_owner=$1,
           lease_expires_at=NOW()+($2 * INTERVAL '1 millisecond'), attempt_count=attempt_count+1, updated_at=NOW()
         FROM candidate WHERE jobs.id=candidate.id
         RETURNING jobs.id,jobs.source_version_id,jobs.attempt_count,jobs.lease_expires_at`,
        [workerId, leaseMs],
      );
      const row = result.rows[0];
      return row ? { id: row.id, sourceVersionId: row.source_version_id, attemptCount: row.attempt_count, leaseExpiresAt: iso(row.lease_expires_at) } : null;
    });
  }

  async source(jobId, workerId) {
    const result = await this.pool.query(
      `SELECT versions.id,versions.object_key,versions.byte_size,versions.sha256,versions.media_type
       FROM knowledge_ingestion_jobs jobs JOIN knowledge_source_versions versions ON versions.id=jobs.source_version_id
       WHERE jobs.id=$1 AND jobs.lease_owner=$2 AND jobs.state='leased' AND jobs.lease_expires_at>NOW()`,
      [jobId, workerId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, objectKey: row.object_key, byteSize: Number(row.byte_size), sha256: row.sha256, mediaType: row.media_type } : null;
  }

  async retry(jobId, workerId, errorCode, attemptCount) {
    const failed = attemptCount >= 6;
    const delaySeconds = Math.min(900, 2 ** Math.min(attemptCount, 9));
    await this.pool.query(
      `UPDATE knowledge_ingestion_jobs SET state=$3, error_code=$4, lease_owner=NULL, lease_expires_at=NULL,
       available_at=NOW()+($5 * INTERVAL '1 second'), updated_at=NOW()
       WHERE id=$1 AND lease_owner=$2`, [jobId, workerId, failed ? 'failed' : 'retry', errorCode, delaySeconds],
    );
    return { failed, delaySeconds };
  }
}
