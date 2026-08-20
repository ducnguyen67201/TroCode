import { KNOWLEDGE_LIMITS } from './knowledge-space-contracts.mjs';

export class KnowledgeSearchService {
  constructor(pool) { this.pool = pool; }
  async search({ attemptId, limit = KNOWLEDGE_LIMITS.searchResults, query, userId }) {
    const authorized = await this.pool.query(
      `SELECT 1 FROM knowledge_activity_attempts WHERE id=$1 AND user_id=$2`,
      [attemptId, userId],
    );
    if (!authorized.rows[0]) {
      const error = new Error('Attempt not found.');
      error.status = 404;
      error.code = 'attempt_not_found';
      throw error;
    }
    const result = await this.pool.query(
      `WITH authorized_versions AS (
         SELECT pinned.source_version_id
         FROM knowledge_activity_attempts attempts
         JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
         JOIN knowledge_activity_version_sources pinned ON pinned.activity_version_id=runs.activity_version_id
         JOIN knowledge_source_versions versions ON versions.id=pinned.source_version_id AND versions.state='ready'
         WHERE attempts.id=$1 AND attempts.user_id=$2
       ), ranked AS (
         SELECT chunks.body,chunks.locator,chunks.source_version_id,
                ts_rank_cd(chunks.search_vector, websearch_to_tsquery('simple',$3)) AS rank,
                sources.display_name,sources.role
         FROM knowledge_source_chunks chunks
         JOIN authorized_versions permitted ON permitted.source_version_id=chunks.source_version_id
         JOIN knowledge_source_versions versions ON versions.id=chunks.source_version_id
         JOIN knowledge_sources sources ON sources.id=versions.source_id
         WHERE chunks.search_vector @@ websearch_to_tsquery('simple',$3)
         ORDER BY rank DESC,chunks.ordinal LIMIT $4
       ) SELECT * FROM ranked`, [attemptId, userId, query, limit],
    );
    let characters = 0;
    const results = [];
    for (const row of result.rows) {
      const remaining = KNOWLEDGE_LIMITS.searchCharacters - characters;
      if (remaining <= 0) break;
      const snippet = row.body.slice(0, Math.min(4_000, remaining)); characters += snippet.length;
      results.push({ sourceTitle: row.display_name, role: row.role, locator: row.locator, snippet, score: Number(row.rank) });
    }
    return { results, truncated: result.rows.length > results.length || characters >= KNOWLEDGE_LIMITS.searchCharacters };
  }
}
