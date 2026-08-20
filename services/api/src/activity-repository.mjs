import { createHash } from 'node:crypto';
import { inTransaction, iso } from './knowledge-repository-utils.mjs';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export class PostgresActivityRepository {
  constructor(pool) { this.pool = pool; }

  async saveDraft({ clientId, definition, sourceVersionIds, spaceId, userId }) {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        `INSERT INTO knowledge_activities (client_id, space_id, draft_definition, created_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (space_id, client_id) DO UPDATE SET draft_definition=EXCLUDED.draft_definition, updated_at=NOW()
         RETURNING id, state, draft_definition, updated_at`, [clientId, spaceId, definition, userId],
      );
      const activityId = result.rows[0].id;
      await client.query(`DELETE FROM knowledge_activity_draft_sources WHERE activity_id=$1`, [activityId]);
      if (sourceVersionIds.length) await client.query(
        `INSERT INTO knowledge_activity_draft_sources (activity_id, source_version_id)
         SELECT $1, versions.id
         FROM knowledge_source_versions versions
         JOIN knowledge_sources sources ON sources.id=versions.source_id
         WHERE versions.id = ANY($2::uuid[]) AND sources.space_id=$3
           AND sources.role <> 'submission'`, [activityId, sourceVersionIds, spaceId],
      );
      return { id: activityId, state: result.rows[0].state, definition: result.rows[0].draft_definition, updatedAt: iso(result.rows[0].updated_at) };
    });
  }

  async publish({ activityId, clientId, spaceId, userId }) {
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`publish:${activityId}`]);
      const draft = await client.query(
        `SELECT draft_definition FROM knowledge_activities WHERE id=$1 AND space_id=$2 FOR UPDATE`, [activityId, spaceId],
      );
      if (!draft.rows[0]) return null;
      const sources = await client.query(
        `SELECT draft.source_version_id FROM knowledge_activity_draft_sources draft
         JOIN knowledge_source_versions versions ON versions.id=draft.source_version_id
         JOIN knowledge_sources sources ON sources.id=versions.source_id
         WHERE draft.activity_id=$1 AND sources.space_id=$2 AND versions.state='ready'
           AND sources.role <> 'submission'
         ORDER BY draft.source_version_id`, [activityId, spaceId],
      );
      const sourceVersionIds = sources.rows.map((row) => row.source_version_id);
      const contentHash = createHash('sha256').update(canonicalJson({ definition: draft.rows[0].draft_definition, sourceVersionIds })).digest('hex');
      const existing = await client.query(
        `SELECT id, version_number, published_at FROM knowledge_activity_versions WHERE activity_id=$1 AND content_hash=$2`, [activityId, contentHash],
      );
      if (existing.rows[0]) return { id: existing.rows[0].id, versionNumber: existing.rows[0].version_number, publishedAt: iso(existing.rows[0].published_at), newlyCreated: false };
      const version = await client.query(
        `INSERT INTO knowledge_activity_versions (activity_id, version_number, definition, content_hash, published_by)
         SELECT $1, COALESCE(MAX(version_number),0)+1, $2, $3, $4 FROM knowledge_activity_versions WHERE activity_id=$1
         RETURNING id, version_number, published_at`, [activityId, draft.rows[0].draft_definition, contentHash, userId],
      );
      if (sourceVersionIds.length) await client.query(
        `INSERT INTO knowledge_activity_version_sources (activity_version_id, source_version_id)
         SELECT $1, UNNEST($2::uuid[])`, [version.rows[0].id, sourceVersionIds],
      );
      await client.query(`UPDATE knowledge_activities SET state='published', updated_at=NOW() WHERE id=$1`, [activityId]);
      return { id: version.rows[0].id, versionNumber: version.rows[0].version_number, publishedAt: iso(version.rows[0].published_at), newlyCreated: true };
    });
  }

  async createRun({ activityVersionId, clientId, closesAt, insightPolicy, mode, opensAt, spaceId, target, userId }) {
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`run:${spaceId}:${clientId}`]);
      const existing = await client.query(`SELECT id, state FROM knowledge_activity_runs WHERE space_id=$1 AND client_id=$2`, [spaceId, clientId]);
      if (existing.rows[0]) return { id: existing.rows[0].id, state: existing.rows[0].state, newlyCreated: false };
      const version = await client.query(
        `SELECT versions.id
         FROM knowledge_activity_versions versions
         JOIN knowledge_activities activities ON activities.id=versions.activity_id
         WHERE versions.id=$1 AND activities.space_id=$2`,
        [activityVersionId, spaceId],
      );
      if (!version.rows[0]) {
        const error = new Error('Published Activity not found in this Space.');
        error.status = 404; error.code = 'activity_version_not_found'; throw error;
      }
      if (target.kind === 'group') {
        const group = await client.query(
          `SELECT id FROM knowledge_space_groups
           WHERE id=$1 AND space_id=$2 AND archived_at IS NULL`,
          [target.groupId, spaceId],
        );
        if (!group.rows[0]) {
          const error = new Error('Group not found in this Space.');
          error.status = 404; error.code = 'group_not_found'; throw error;
        }
      }
      const run = await client.query(
        `INSERT INTO knowledge_activity_runs
           (client_id,space_id,activity_version_id,mode,target_kind,target_group_id,opens_at,closes_at,insight_policy,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,state`,
        [clientId, spaceId, activityVersionId, mode, target.kind, target.kind === 'group' ? target.groupId : null, opensAt, closesAt, insightPolicy, userId],
      );
      let userIds;
      if (target.kind === 'group') {
        const members = await client.query(
          `SELECT members.user_id FROM knowledge_space_group_members members
           JOIN knowledge_space_members space_members
             ON space_members.space_id=$2 AND space_members.user_id=members.user_id
           WHERE members.group_id=$1 AND space_members.removed_at IS NULL`,
          [target.groupId, spaceId],
        );
        userIds = members.rows.map((row) => row.user_id);
      } else {
        const requestedUserIds = [...new Set(target.userIds)];
        const members = await client.query(
          `SELECT user_id FROM knowledge_space_members
           WHERE space_id=$1 AND user_id=ANY($2::text[]) AND removed_at IS NULL`,
          [spaceId, requestedUserIds],
        );
        if (members.rows.length !== requestedUserIds.length) {
          const error = new Error('Every Run participant must belong to this Space.');
          error.status = 400; error.code = 'participant_not_in_space'; throw error;
        }
        userIds = members.rows.map((row) => row.user_id);
      }
      if (userIds.length) {
        await client.query(
          `INSERT INTO knowledge_activity_assignments (run_id,user_id)
           SELECT $1, user_id FROM UNNEST($2::text[]) AS user_id
           ON CONFLICT DO NOTHING`, [run.rows[0].id, userIds],
        );
        await client.query(
          `INSERT INTO knowledge_activity_attempts (run_id,assignment_id,user_id)
           SELECT assignment.run_id, assignment.id, assignment.user_id
           FROM knowledge_activity_assignments assignment WHERE assignment.run_id=$1
           ON CONFLICT (run_id,user_id) DO NOTHING`, [run.rows[0].id],
        );
      }
      return { id: run.rows[0].id, state: run.rows[0].state, assignmentCount: userIds.length, newlyCreated: true };
    });
  }

  async setRunState(runId, spaceId, state) {
    const result = await this.pool.query(
      `UPDATE knowledge_activity_runs SET state=$3, updated_at=NOW() WHERE id=$1 AND space_id=$2 RETURNING id,state`, [runId, spaceId, state],
    );
    return result.rows[0] ?? null;
  }

  async runState(runId, spaceId) {
    const result = await this.pool.query(
      `SELECT state FROM knowledge_activity_runs WHERE id=$1 AND space_id=$2`,
      [runId, spaceId],
    );
    return result.rows[0]?.state ?? null;
  }

  async activeRunCount(spaceId) {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS value FROM knowledge_activity_runs
       WHERE space_id=$1 AND state IN ('draft','open')`,
      [spaceId],
    );
    return result.rows[0]?.value ?? 0;
  }

  async groupSize(groupId, spaceId) {
    const result = await this.pool.query(
      `SELECT COUNT(members.user_id)::int AS value
       FROM knowledge_space_groups groups
       LEFT JOIN knowledge_space_group_members members ON members.group_id=groups.id
       WHERE groups.id=$1 AND groups.space_id=$2 AND groups.archived_at IS NULL`,
      [groupId, spaceId],
    );
    return result.rows[0]?.value ?? 0;
  }

  async attemptContext(attemptId, userId) {
    const result = await this.pool.query(
      `SELECT attempts.id, attempts.user_id, attempts.state, attempts.acknowledged_policy_version,
              runs.id AS run_id, runs.state AS run_state, runs.mode, runs.opens_at, runs.closes_at,
              runs.insight_policy, runs.insight_policy_version, runs.space_id,
              versions.id AS activity_version_id, versions.definition,
              spaces.name AS space_name
       FROM knowledge_activity_attempts attempts
       JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
       JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id
       JOIN knowledge_spaces spaces ON spaces.id=runs.space_id
       WHERE attempts.id=$1 AND attempts.user_id=$2`, [attemptId, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const [sources, progress] = await Promise.all([
      this.pool.query(
        `SELECT versions.id AS source_version_id,sources.display_name,sources.virtual_path,sources.role,
                versions.byte_size,versions.sha256
         FROM knowledge_activity_version_sources pinned
         JOIN knowledge_source_versions versions ON versions.id=pinned.source_version_id
         JOIN knowledge_sources sources ON sources.id=versions.source_id
         WHERE pinned.activity_version_id=$1 AND versions.state='ready'
         ORDER BY sources.virtual_path,versions.id`,
        [row.activity_version_id],
      ),
      this.pool.query(
        `SELECT COUNT(DISTINCT sessions.id)::int AS session_count,
                COALESCE(ARRAY_AGG(DISTINCT evidence.criterion_id)
                  FILTER (WHERE evidence.result_code='passed'), '{}') AS completed_criterion_ids
         FROM knowledge_activity_attempts attempts
         LEFT JOIN knowledge_activity_work_sessions sessions ON sessions.attempt_id=attempts.id
         LEFT JOIN knowledge_activity_evidence evidence ON evidence.attempt_id=attempts.id
         WHERE attempts.id=$1`,
        [attemptId],
      ),
    ]);
    const progressRow = progress.rows[0];
    return {
      attemptId: row.id, userId: row.user_id, state: row.state, acknowledgedPolicyVersion: row.acknowledged_policy_version,
      run: { id: row.run_id, state: row.run_state, mode: row.mode, opensAt: iso(row.opens_at), closesAt: iso(row.closes_at), insightPolicy: row.insight_policy, insightPolicyVersion: row.insight_policy_version },
      space: { id: row.space_id, name: row.space_name }, activityVersionId: row.activity_version_id, definition: row.definition,
      sourceCatalog: sources.rows.map((source) => ({ title: source.display_name, role: source.role })),
      starterAvailable: sources.rows.some((source) => source.role === 'starter'),
      priorProgress: {
        completedCriterionIds: progressRow?.completed_criterion_ids ?? [],
        sessionCount: progressRow?.session_count ?? 0,
        summary: progressRow?.session_count
          ? `This Attempt has ${progressRow.session_count} prior Work Session(s).`
          : 'No prior Work Sessions.',
      },
    };
  }

  async starterFiles(attemptId, userId) {
    const result = await this.pool.query(
      `SELECT versions.id,versions.object_key,versions.byte_size,versions.sha256,
              versions.media_type,sources.virtual_path
       FROM knowledge_activity_attempts attempts
       JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
       JOIN knowledge_activity_version_sources pinned
         ON pinned.activity_version_id=runs.activity_version_id
       JOIN knowledge_source_versions versions ON versions.id=pinned.source_version_id
       JOIN knowledge_sources sources ON sources.id=versions.source_id
       WHERE attempts.id=$1 AND attempts.user_id=$2 AND sources.role='starter'
         AND versions.state='ready'
       ORDER BY sources.virtual_path,versions.id`,
      [attemptId, userId],
    );
    return result.rows.map((row) => ({
      byteSize: Number(row.byte_size),
      mediaType: row.media_type,
      objectKey: row.object_key,
      relativePath: row.virtual_path,
      sha256: row.sha256,
      sourceVersionId: row.id,
    }));
  }

  async listAssigned(userId, limit = 100) {
    const result = await this.pool.query(
      `SELECT attempts.id AS attempt_id,attempts.state,attempts.updated_at,runs.id AS run_id,
              runs.mode,runs.opens_at,runs.closes_at,versions.definition,spaces.id AS space_id,spaces.name AS space_name
       FROM knowledge_activity_attempts attempts
       JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
       JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id
       JOIN knowledge_spaces spaces ON spaces.id=runs.space_id
       WHERE attempts.user_id=$1 AND attempts.state <> 'withdrawn'
       ORDER BY attempts.updated_at DESC,attempts.id DESC LIMIT $2`, [userId, limit],
    );
    return result.rows.map((row) => ({
      attemptId: row.attempt_id, state: row.state, updatedAt: iso(row.updated_at),
      run: { id: row.run_id, mode: row.mode, opensAt: iso(row.opens_at), closesAt: iso(row.closes_at) },
      activity: { title: row.definition.title, objective: row.definition.objective },
      space: { id: row.space_id, name: row.space_name },
    }));
  }

  async workSessionAuthority(workSessionId, userId) {
    const result = await this.pool.query(
      `SELECT sessions.id,attempts.id AS attempt_id,attempts.user_id,attempts.acknowledged_policy_version,
              runs.insight_policy,runs.insight_policy_version,versions.definition
       FROM knowledge_activity_work_sessions sessions
       JOIN knowledge_activity_attempts attempts ON attempts.id=sessions.attempt_id
       JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
       JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id
       WHERE sessions.id=$1 AND attempts.user_id=$2`, [workSessionId, userId],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id, attemptId: row.attempt_id, userId: row.user_id,
      acknowledgedPolicyVersion: row.acknowledged_policy_version,
      insightPolicy: row.insight_policy, insightPolicyVersion: row.insight_policy_version,
      criteria: row.definition.criteria ?? [],
    } : null;
  }

  async acknowledgePolicy(attemptId, userId, policyVersion) {
    const result = await this.pool.query(
      `UPDATE knowledge_activity_attempts attempts SET acknowledged_policy_version=$3, updated_at=NOW()
       FROM knowledge_activity_runs runs WHERE attempts.id=$1 AND attempts.user_id=$2 AND attempts.run_id=runs.id
       AND runs.insight_policy_version=$3 RETURNING attempts.id`, [attemptId, userId, policyVersion],
    );
    return Boolean(result.rows[0]);
  }

  async commitSubmission(attemptId, userId) {
    return inTransaction(this.pool, async (client) => {
      const updated = await client.query(
        `UPDATE knowledge_activity_attempts attempts
         SET state='submitted',submitted_at=COALESCE(submitted_at,NOW()),updated_at=NOW()
         WHERE attempts.id=$1 AND attempts.user_id=$2
           AND attempts.state IN ('assigned','in_progress','blocked')
           AND EXISTS (
             SELECT 1 FROM knowledge_submission_artifacts artifacts
             JOIN knowledge_source_versions versions ON versions.id=artifacts.source_version_id
             WHERE artifacts.attempt_id=attempts.id
               AND versions.state IN ('processing','ready')
           )
         RETURNING attempts.id,attempts.run_id,attempts.state,attempts.submitted_at`,
        [attemptId, userId],
      );
      const row = updated.rows[0];
      if (!row) {
        const existing = await client.query(
          `SELECT id,run_id,state,submitted_at FROM knowledge_activity_attempts
           WHERE id=$1 AND user_id=$2 AND state='submitted'`,
          [attemptId, userId],
        );
        const submitted = existing.rows[0];
        return submitted
          ? { attemptId: submitted.id, state: submitted.state, submittedAt: iso(submitted.submitted_at) }
          : null;
      }
      await client.query(
        `INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
         VALUES ($1,$2,'attempt_submitted',jsonb_build_object('state','submitted'))`,
        [row.run_id, row.id],
      );
      return { attemptId: row.id, state: row.state, submittedAt: iso(row.submitted_at) };
    });
  }

  async requestHelp(attemptId, userId, clientId) {
    return inTransaction(this.pool, async (client) => {
      const updated = await client.query(
        `UPDATE knowledge_activity_attempts
         SET state=CASE WHEN state IN ('assigned','in_progress') THEN 'blocked' ELSE state END,
             updated_at=NOW()
         WHERE id=$1 AND user_id=$2 AND state NOT IN ('completed','withdrawn')
         RETURNING id,run_id,state`,
        [attemptId, userId],
      );
      const row = updated.rows[0];
      if (!row) return null;
      const request = await client.query(
        `INSERT INTO knowledge_attempt_help_requests
           (client_id,attempt_id,requested_by)
         VALUES ($1,$2,$3)
         ON CONFLICT (attempt_id,client_id) DO NOTHING
         RETURNING requested_at`,
        [clientId, attemptId, userId],
      );
      if (!request.rows[0]) return { requested: true, state: row.state };
      await client.query(
        `UPDATE knowledge_activity_work_sessions
         SET help_requested_at=COALESCE(help_requested_at,NOW()),updated_at=NOW()
         WHERE id=(SELECT id FROM knowledge_activity_work_sessions
                   WHERE attempt_id=$1 ORDER BY created_at DESC LIMIT 1)`,
        [attemptId],
      );
      await client.query(
        `INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
         VALUES ($1,$2,'help_requested',jsonb_build_object('state',$3::text))`,
        [row.run_id, row.id, row.state],
      );
      return { requested: true, state: row.state };
    });
  }

  async createWorkSession({ attemptId, clientId, launchKind, taskId, userId }) {
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`work:${attemptId}:${clientId}`]);
      const existing = await client.query(
        `SELECT sessions.id,sessions.state,sessions.task_id,sessions.launch_kind,sessions.updated_at AS created_at
         FROM knowledge_activity_work_sessions sessions
         JOIN knowledge_activity_attempts attempts ON attempts.id=sessions.attempt_id
         WHERE sessions.attempt_id=$1 AND sessions.client_id=$2 AND attempts.user_id=$3`,
        [attemptId, clientId, userId],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        return { id: row.id, state: row.state, taskId: row.task_id, launchKind: row.launch_kind, createdAt: iso(row.created_at) };
      }
      const result = await client.query(
        `INSERT INTO knowledge_activity_work_sessions (client_id,attempt_id,task_id,launch_kind)
         SELECT $2,attempts.id,$3,$4 FROM knowledge_activity_attempts attempts
         WHERE attempts.id=$1 AND attempts.user_id=$5
         RETURNING id,state,task_id,launch_kind,created_at`, [attemptId, clientId, taskId, launchKind, userId],
      );
      if (!result.rows[0]) return null;
      await client.query(
        `UPDATE knowledge_activity_attempts SET state=CASE WHEN state='assigned' THEN 'in_progress' ELSE state END,
         started_at=COALESCE(started_at,NOW()),updated_at=NOW() WHERE id=$1`, [attemptId],
      );
      await client.query(
        `INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
         SELECT run_id,id,'work_session_created',jsonb_build_object('state','created') FROM knowledge_activity_attempts WHERE id=$1`, [attemptId],
      );
      const row = result.rows[0];
      return { id: row.id, state: row.state, taskId: row.task_id, launchKind: row.launch_kind, createdAt: iso(row.created_at) };
    });
  }

  async updateWorkSession({ helpRequested, hintLevel, state, userId, workSessionId }) {
    const result = await this.pool.query(
      `UPDATE knowledge_activity_work_sessions sessions SET
         state=$2, help_requested_at=CASE WHEN $3::boolean THEN COALESCE(help_requested_at,NOW()) ELSE help_requested_at END,
         hint_level=COALESCE($4,hint_level), started_at=CASE WHEN $2='active' THEN COALESCE(started_at,NOW()) ELSE started_at END,
         ended_at=CASE WHEN $2 IN ('completed','cancelled','failed') THEN NOW() ELSE ended_at END, updated_at=NOW()
       FROM knowledge_activity_attempts attempts
       WHERE sessions.id=$1 AND sessions.attempt_id=attempts.id AND attempts.user_id=$5
       RETURNING sessions.id,sessions.attempt_id,sessions.state,sessions.help_requested_at,sessions.hint_level`,
      [workSessionId, state, Boolean(helpRequested), hintLevel ?? null, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    await this.pool.query(
      `INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
       SELECT run_id,id,'work_session_updated',jsonb_build_object('state',$2::text,'helpRequested',$3::boolean,'hintLevel',$4::int)
       FROM knowledge_activity_attempts WHERE id=$1`, [row.attempt_id, state, Boolean(helpRequested), row.hint_level],
    );
    return { id: row.id, state: row.state, helpRequestedAt: iso(row.help_requested_at), hintLevel: row.hint_level };
  }

  async insertEvidence(input) {
    return inTransaction(this.pool, async (client) => {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`evidence:${input.workSessionId}`],
      );
      if (input.provenance === 'agent_candidate') {
        const count = await client.query(
          `SELECT COUNT(*)::int AS value FROM knowledge_activity_evidence
           WHERE work_session_id=$1 AND provenance='agent_candidate'`,
          [input.workSessionId],
        );
        if (count.rows[0].value >= 20) {
          const error = new Error('This Work Session reached its evidence limit.');
          error.status = 429; error.code = 'evidence_limit'; throw error;
        }
      }
      const result = await client.query(
        `INSERT INTO knowledge_activity_evidence
         (client_id,attempt_id,work_session_id,criterion_id,tag,provenance,result_code,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (attempt_id,client_id) DO UPDATE SET client_id=EXCLUDED.client_id
       RETURNING id,criterion_id,tag,provenance,result_code,created_at`,
      [input.clientId,input.attemptId,input.workSessionId,input.criterionId,input.tag,input.provenance,input.resultCode,input.userId],
    );
      const row = result.rows[0];
      return { id: row.id, criterionId: row.criterion_id, tag: row.tag, provenance: row.provenance, resultCode: row.result_code, createdAt: iso(row.created_at) };
    });
  }

  async dashboard(runId, spaceId, sinceSequence = null) {
    if (sinceSequence !== null) {
      const events = await this.pool.query(
        `SELECT sequence,event_type,payload,created_at FROM knowledge_activity_run_events
         WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 1000`, [runId, sinceSequence],
      );
      return { kind: 'delta', events: events.rows.map((row) => ({ sequence: Number(row.sequence), type: row.event_type, payload: row.payload, createdAt: iso(row.created_at) })), maxSequence: Number(events.rows.at(-1)?.sequence ?? sinceSequence) };
    }
    const result = await this.pool.query(
      `SELECT attempts.id,attempts.user_id,attempts.state,attempts.updated_at,
              COUNT(DISTINCT sessions.id)::int AS session_count,
              COUNT(DISTINCT evidence.id)::int AS evidence_count,
              GREATEST(MAX(sessions.help_requested_at),MAX(help.requested_at)) AS help_requested_at
       FROM knowledge_activity_runs runs
       JOIN knowledge_activity_attempts attempts ON attempts.run_id=runs.id
       LEFT JOIN knowledge_activity_work_sessions sessions ON sessions.attempt_id=attempts.id
       LEFT JOIN knowledge_activity_evidence evidence ON evidence.attempt_id=attempts.id
       LEFT JOIN knowledge_attempt_help_requests help ON help.attempt_id=attempts.id AND help.resolved_at IS NULL
       WHERE runs.id=$1 AND runs.space_id=$2 GROUP BY attempts.id ORDER BY attempts.updated_at DESC LIMIT 500`, [runId, spaceId],
    );
    const [sequence, evidence] = await Promise.all([this.pool.query(
      `SELECT COALESCE(MAX(events.sequence),0) AS value
       FROM knowledge_activity_run_events events
       JOIN knowledge_activity_runs runs ON runs.id=events.run_id
       WHERE events.run_id=$1 AND runs.space_id=$2`,
      [runId, spaceId],
    ), this.pool.query(
      `SELECT evidence.criterion_id,
              COUNT(DISTINCT evidence.attempt_id)::int AS participant_count,
              COUNT(*) FILTER (WHERE evidence.provenance='agent_candidate')::int AS agent_candidate_count,
              COUNT(DISTINCT evidence.provenance)::int AS corroborated_count
       FROM knowledge_activity_evidence evidence
       JOIN knowledge_activity_attempts attempts ON attempts.id=evidence.attempt_id
       JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
       WHERE runs.id=$1 AND runs.space_id=$2
       GROUP BY evidence.criterion_id
       ORDER BY participant_count DESC,evidence.criterion_id
       LIMIT 100`,
      [runId, spaceId],
    )]);
    return {
      kind: 'snapshot',
      participants: result.rows.map((row) => ({ id: row.user_id, attemptId: row.id, state: row.state, updatedAt: iso(row.updated_at), sessionCount: row.session_count, evidenceCount: row.evidence_count, helpRequestedAt: iso(row.help_requested_at) })),
      criterionEvidence: evidence.rows.map((row) => ({
        agentCandidateCount: row.agent_candidate_count,
        corroboratedCount: row.corroborated_count,
        criterionId: row.criterion_id,
        participantCount: row.participant_count,
      })),
      maxSequence: Number(sequence.rows[0].value),
    };
  }
}
