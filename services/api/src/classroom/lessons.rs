use super::broadcasts::{broadcast_digest, timestamp};
use super::lesson_contracts::{LessonCommit, LessonPlan, LessonResource};
use super::{ClassroomService, invalid_request};
use crate::{Row, error::ApiError, query};
use serde_json::{Value, json};
use time::OffsetDateTime;
use uuid::Uuid;

pub(super) fn unavailable() -> ApiError {
    ApiError::conflict(
        "lesson_resource_unavailable",
        "This lesson or assignment is no longer available.",
    )
}
pub(super) fn envelope(row: &crate::postgres::PgRow) -> Value {
    json!({"lessonId":row.get::<Uuid,_>("id"),"sessionId":row.get::<Uuid,_>("session_id"),"sequence":row.get::<i64,_>("sequence"),"contractVersion":1,
      "plan":row.get::<Value,_>("plan"),"planDigest":row.get::<String,_>("plan_digest"),"state":row.get::<String,_>("state"),
      "createdAt":timestamp(row.get("created_at")),"expiresAt":timestamp(row.get("expires_at")),"serverTime":timestamp(OffsetDateTime::now_utc())})
}
fn receipt(row: &crate::postgres::PgRow, new: bool) -> Value {
    json!({"clientId":row.get::<Uuid,_>("client_id"),"lesson":envelope(row),"newlyCreated":new})
}
impl ClassroomService {
    pub async fn lesson_context(
        &self,
        user: &str,
        space: Uuid,
        session: Uuid,
        run: Uuid,
    ) -> Result<Value, ApiError> {
        self.teacher_context(user, space, session).await?;
        let row=query("SELECT versions.definition,versions.id FROM knowledge_class_session_activities items JOIN knowledge_activity_versions versions ON versions.id=items.activity_version_id JOIN knowledge_activity_runs runs ON runs.id=items.run_id WHERE items.session_id=$1 AND items.run_id=$2 AND runs.space_id=$3")
          .bind(session).bind(run).bind(space).fetch_optional(&self.pool).await?.ok_or_else(unavailable)?;
        let definition = row.get::<Value, _>("definition");
        let version = row.get::<Uuid, _>("id");
        let sources = self.lesson_sources(space, version).await?;
        Ok(
            json!({"sessionId":session,"targetRunId":run,"activityVersionId":version,"title":definition["title"],"instructions":definition["instructions"],
          "allowedOrigins":definition["sessionPolicy"]["allowedOrigins"].as_array().cloned().unwrap_or_default(),"criteria":definition["criteria"],
          "sources":sources,"launchTarget":definition["launchTarget"],"answerReveal":definition["guidancePolicy"]["answerReveal"]}),
        )
    }
    pub(super) async fn lesson_sources(
        &self,
        space: Uuid,
        version: Uuid,
    ) -> Result<Vec<Value>, ApiError> {
        let rows=query("SELECT versions.id,sources.display_name FROM knowledge_activity_version_sources pinned JOIN knowledge_source_versions versions ON versions.id=pinned.source_version_id JOIN knowledge_sources sources ON sources.id=versions.source_id WHERE pinned.activity_version_id=$1 AND sources.space_id=$2 AND sources.archived_at IS NULL AND sources.role IN ('reference','instructions') AND versions.state='ready' ORDER BY versions.id LIMIT 200")
          .bind(version).bind(space).fetch_all(&self.pool).await?;
        Ok(rows.iter().map(|r|json!({"sourceVersionId":r.get::<Uuid,_>("id"),"title":r.get::<String,_>("display_name")})).collect())
    }
    pub async fn commit_lesson(
        &self,
        user: &str,
        space: Uuid,
        session: Uuid,
        input: LessonCommit,
    ) -> Result<Value, ApiError> {
        input.plan.validate()?;
        let context = self
            .lesson_context(user, space, session, input.plan.target_run_id)
            .await?;
        validate_context(&input.plan, &context)?;
        let plan = input.plan.value()?;
        let canonical = serde_json::to_string(&plan).map_err(ApiError::internal)?;
        if canonical.len() > 65536 {
            return Err(invalid_request());
        }
        let digest = broadcast_digest(&plan)?;
        let mut tx = self.begin().await?;
        self.broadcast_teacher_authority(&mut tx, user, space)
            .await?;
        let locked=query("SELECT state,lesson_sequence FROM knowledge_class_sessions WHERE id=$1 AND space_id=$2 FOR UPDATE")
          .bind(session).bind(space).fetch_optional(&mut *tx).await?.ok_or_else(unavailable)?;
        if let Some(row) =
            query("SELECT * FROM knowledge_classroom_lessons WHERE session_id=$1 AND client_id=$2")
                .bind(session)
                .bind(input.client_id)
                .fetch_optional(&mut *tx)
                .await?
        {
            if row.get::<String, _>("created_by") != user
                || row.get::<String, _>("plan_digest") != digest
            {
                return Err(ApiError::conflict(
                    "lesson_idempotency_conflict",
                    "This request ID already belongs to another lesson.",
                ));
            }
            tx.commit().await?;
            return Ok(receipt(&row, false));
        }
        if locked.get::<String, _>("state") != "open" {
            return Err(unavailable());
        }
        let run=query("SELECT runs.id FROM knowledge_activity_runs runs JOIN knowledge_class_session_activities items ON items.run_id=runs.id WHERE items.session_id=$1 AND runs.id=$2 AND runs.activity_version_id=$3 AND runs.state='open' AND (runs.opens_at IS NULL OR runs.opens_at<=NOW()) AND (runs.closes_at IS NULL OR runs.closes_at>NOW()) FOR SHARE OF runs")
          .bind(session).bind(input.plan.target_run_id).bind(input.plan.activity_version_id).fetch_optional(&mut *tx).await?;
        if run.is_none() {
            return Err(unavailable());
        }
        super::lesson_resources::lock_lesson_sources(&mut tx, &input.plan).await?;
        let seq = locked.get::<i64, _>("lesson_sequence") + 1;
        if seq > 9_007_199_254_740_991 {
            return Err(unavailable());
        }
        let row=query("INSERT INTO knowledge_classroom_lessons(session_id,client_id,sequence,target_run_id,activity_version_id,plan,canonical_plan,plan_digest,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *")
          .bind(session).bind(input.client_id).bind(seq).bind(input.plan.target_run_id).bind(input.plan.activity_version_id).bind(plan).bind(canonical).bind(digest).bind(user).fetch_one(&mut *tx).await?;
        query("UPDATE knowledge_class_sessions SET lesson_sequence=$2 WHERE id=$1")
            .bind(session)
            .bind(seq)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(receipt(&row, true))
    }
    pub async fn lookup_lesson(
        &self,
        user: &str,
        space: Uuid,
        session: Uuid,
        client: Uuid,
    ) -> Result<Value, ApiError> {
        self.teacher_context(user, space, session).await?;
        let row=query("SELECT * FROM knowledge_classroom_lessons WHERE session_id=$1 AND client_id=$2 AND created_by=$3").bind(session).bind(client).bind(user).fetch_optional(&self.pool).await?;
        Ok(json!({"receipt":row.as_ref().map(|r|receipt(r,false))}))
    }
    pub async fn stop_lesson(
        &self,
        user: &str,
        space: Uuid,
        session: Uuid,
        lesson: Uuid,
    ) -> Result<Value, ApiError> {
        let mut tx = self.begin().await?;
        self.broadcast_teacher_authority(&mut tx, user, space)
            .await?;
        let locked =
            query("SELECT id FROM knowledge_class_sessions WHERE id=$1 AND space_id=$2 FOR UPDATE")
                .bind(session)
                .bind(space)
                .fetch_optional(&mut *tx)
                .await?;
        if locked.is_none() {
            return Err(unavailable());
        }
        let row=query("UPDATE knowledge_classroom_lessons SET state='stopped',stopped_at=COALESCE(stopped_at,NOW()) WHERE id=$1 AND session_id=$2 RETURNING *").bind(lesson).bind(session).fetch_optional(&mut *tx).await?.ok_or_else(unavailable)?;
        tx.commit().await?;
        Ok(envelope(&row))
    }
    pub async fn lesson_feed(
        &self,
        user: &str,
        anchor: Uuid,
        after: Option<i64>,
    ) -> Result<Value, ApiError> {
        let session = self.broadcast_student_session(user, anchor).await?;
        let id = session.get::<Uuid, _>("id");
        let rows = if let Some(after) = after {
            query("SELECT * FROM knowledge_classroom_lessons WHERE session_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 100").bind(id).bind(after).fetch_all(&self.pool).await?
        } else {
            query("SELECT * FROM knowledge_classroom_lessons WHERE session_id=$1 ORDER BY sequence DESC LIMIT 5").bind(id).fetch_all(&self.pool).await?
        };
        let stopped=query("SELECT id FROM knowledge_classroom_lessons WHERE session_id=$1 AND (state='stopped' OR expires_at<=NOW()) ORDER BY sequence DESC LIMIT 100").bind(id).fetch_all(&self.pool).await?;
        let max = rows
            .iter()
            .map(|r| r.get::<i64, _>("sequence"))
            .max()
            .unwrap_or(after.unwrap_or(0));
        Ok(
            json!({"sessionId":id,"sessionState":session.get::<String,_>("state"),"serverTime":timestamp(OffsetDateTime::now_utc()),"maxSequence":max,
          "items":rows.iter().map(envelope).collect::<Vec<_>>(),"stoppedIds":stopped.iter().map(|r|r.get::<Uuid,_>("id")).collect::<Vec<_>>()}),
        )
    }
}
pub(super) fn validate_context(plan: &LessonPlan, context: &Value) -> Result<(), ApiError> {
    if context["activityVersionId"] != plan.activity_version_id.to_string()
        || context["launchTarget"] == "workspace"
    {
        return Err(unavailable());
    }
    for resource in &plan.resources {
        match resource {
            LessonResource::Web { origin, .. } => {
                if !context["allowedOrigins"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|v| v == origin))
                {
                    return Err(unavailable());
                }
            }
            LessonResource::SourceText {
                source_version_id, ..
            } => {
                if !context["sources"].as_array().is_some_and(|a| {
                    a.iter()
                        .any(|v| v["sourceVersionId"] == source_version_id.to_string())
                }) {
                    return Err(unavailable());
                }
            }
            LessonResource::Assignment { .. } => {}
        }
    }
    for step in &plan.steps {
        // V1 cannot establish prior student effort at teacher commit time. Restricted-answer activities stay read-only.
        if step.mode == "demonstrate" && context["answerReveal"] != "allowed" {
            return Err(ApiError::conflict(
                "lesson_answer_restricted",
                "This Activity does not allow a demonstration answer. Use an explanation step.",
            ));
        }
        for id in &step.criterion_ids {
            if !context["criteria"]
                .as_array()
                .is_some_and(|a| a.iter().any(|v| v["id"] == *id))
            {
                return Err(invalid_request());
            }
        }
    }
    Ok(())
}
