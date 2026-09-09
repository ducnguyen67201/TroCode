use super::broadcasts::timestamp;
use super::lesson_contracts::{LessonPlan, LessonResource};
use super::lessons::unavailable;
use super::{ClassroomService, invalid_request};
use crate::{Row, error::ApiError, query};
use serde_json::{Value, json};
use uuid::Uuid;
impl ClassroomService {
    pub async fn lesson_material(
        &self,
        user: &str,
        anchor: Uuid,
        lesson: Uuid,
        resource: Uuid,
        ordinal: i32,
    ) -> Result<Value, ApiError> {
        if ordinal < 0 {
            return Err(invalid_request());
        }
        let mut tx = self.begin().await?;
        let row = self
            .lesson_authority(&mut tx, user, anchor, lesson, true)
            .await?;
        let plan: LessonPlan =
            serde_json::from_value(row.get("plan")).map_err(ApiError::internal)?;
        let selected = plan
            .resources
            .iter()
            .find(|r| r.id() == resource)
            .ok_or_else(unavailable)?;
        let mut chunks = Vec::new();
        let mut next = None;
        let mut text = String::new();
        match selected {
            LessonResource::CurrentScreen { .. } => {}
            LessonResource::Assignment { .. } => {
                text = row.get::<Value, _>("definition")["instructions"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned();
            }
            LessonResource::Web { origin, .. } => {
                if !row.get::<Value, _>("definition")["sessionPolicy"]["allowedOrigins"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|v| v == origin))
                {
                    return Err(unavailable());
                }
            }
            LessonResource::SourceText {
                source_version_id, ..
            } => {
                let pinned=query("SELECT sources.id FROM knowledge_activity_version_sources pins JOIN knowledge_source_versions versions ON versions.id=pins.source_version_id JOIN knowledge_sources sources ON sources.id=versions.source_id JOIN knowledge_activity_runs runs ON runs.id=$3 AND runs.space_id=sources.space_id WHERE pins.activity_version_id=$1 AND pins.source_version_id=$2 AND versions.state='ready' AND sources.archived_at IS NULL AND sources.role IN ('reference','instructions') FOR SHARE OF sources,versions")
                  .bind(plan.activity_version_id).bind(source_version_id).bind(plan.target_run_id).fetch_optional(&mut *tx).await?;
                if pinned.is_none() {
                    return Err(unavailable());
                }
                let rows=query("SELECT ordinal,body,locator FROM knowledge_source_chunks WHERE source_version_id=$1 AND ordinal>=$2 ORDER BY ordinal LIMIT 21").bind(source_version_id).bind(ordinal).fetch_all(&mut *tx).await?;
                let mut bytes = 0;
                for chunk in rows {
                    let item = json!({"ordinal":chunk.get::<i32,_>("ordinal"),"body":chunk.get::<String,_>("body"),"locator":chunk.get::<Value,_>("locator")});
                    let size = serde_json::to_vec(&item).map_err(ApiError::internal)?.len();
                    if chunks.len() == 20 || bytes + size > 60000 {
                        next = Some(chunk.get::<i32, _>("ordinal"));
                        break;
                    }
                    bytes += size;
                    chunks.push(item);
                }
            }
        }
        tx.commit().await?;
        Ok(json!({"resource":selected,"text":text,"chunks":chunks,"nextOrdinal":next}))
    }
    pub async fn lesson_progress(
        &self,
        user: &str,
        space: Uuid,
        session: Uuid,
        lesson: Uuid,
        cursor: Option<String>,
    ) -> Result<Value, ApiError> {
        self.teacher_context(user, space, session).await?;
        let row = query(
            "SELECT target_run_id FROM knowledge_classroom_lessons WHERE id=$1 AND session_id=$2",
        )
        .bind(lesson)
        .bind(session)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(unavailable)?;
        let run = row.get::<Uuid, _>("target_run_id");
        let rows=query(r#"SELECT attempts.user_id,delivery.status,delivery.report,delivery.step_id,delivery.reason_code,delivery.received_at,delivery.updated_at,device.capabilities,device.last_seen_at,device.last_seen_at > NOW()-INTERVAL '30 seconds' AS connected
          FROM knowledge_activity_attempts attempts LEFT JOIN knowledge_classroom_lesson_deliveries delivery ON delivery.lesson_id=$2 AND delivery.user_id=attempts.user_id
          LEFT JOIN LATERAL (SELECT capabilities,last_seen_at FROM knowledge_classroom_lesson_devices WHERE session_id=$4 AND user_id=attempts.user_id ORDER BY last_seen_at DESC LIMIT 1) device ON TRUE
          WHERE attempts.run_id=$1 AND attempts.state<>'withdrawn' AND ($3::text IS NULL OR attempts.user_id>$3) ORDER BY attempts.user_id LIMIT 101"#)
          .bind(run).bind(lesson).bind(cursor).bind(session).fetch_all(&self.pool).await?;
        let next = if rows.len() > 100 {
            Some(rows[99].get::<String, _>("user_id"))
        } else {
            None
        };
        let counts=query("SELECT COALESCE(delivery.status,'not_received') AS status,COUNT(*)::bigint AS count FROM knowledge_activity_attempts attempts LEFT JOIN knowledge_classroom_lesson_deliveries delivery ON delivery.lesson_id=$2 AND delivery.user_id=attempts.user_id WHERE attempts.run_id=$1 AND attempts.state<>'withdrawn' GROUP BY COALESCE(delivery.status,'not_received')")
          .bind(run).bind(lesson).fetch_all(&self.pool).await?;
        let counts: serde_json::Map<String, Value> = counts
            .iter()
            .map(|r| (r.get("status"), json!(r.get::<i64, _>("count"))))
            .collect();
        let rows:Vec<Value>=rows.iter().take(100).map(|r|json!({"criterionOutcomes":r.get::<Option<Value>,_>("report").and_then(|v|v.get("criterionOutcomes").cloned()).unwrap_or_else(||json!([])),"userId":r.get::<String,_>("user_id"),"status":r.get::<Option<String>,_>("status").unwrap_or_else(||"not_received".into()),"stepId":r.get::<Option<Uuid>,_>("step_id"),"reasonCode":r.get::<Option<String>,_>("reason_code"),"device":r.get::<Option<Value>,_>("capabilities").map(|cap| json!({"build":cap["build"],"ready":cap["ready"],"lessonsVersion":cap["lessonsVersion"],"connected":r.get::<Option<bool>,_>("connected").unwrap_or(false),"lastSeenAt":r.get::<Option<time::OffsetDateTime>,_>("last_seen_at").map(timestamp)})),"receivedAt":r.get::<Option<time::OffsetDateTime>,_>("received_at").map(timestamp),"updatedAt":r.get::<Option<time::OffsetDateTime>,_>("updated_at").map(timestamp)})).collect();
        Ok(json!({"rows":rows,"counts":counts,"nextCursor":next}))
    }
}

pub(super) async fn lock_lesson_sources(
    tx: &mut crate::Transaction<'_, crate::Postgres>,
    plan: &LessonPlan,
) -> Result<(), ApiError> {
    for resource in &plan.resources {
        if let LessonResource::SourceText {
            source_version_id, ..
        } = resource
        {
            let row=query("SELECT sources.id FROM knowledge_activity_version_sources pins JOIN knowledge_source_versions versions ON versions.id=pins.source_version_id JOIN knowledge_sources sources ON sources.id=versions.source_id JOIN knowledge_activity_runs runs ON runs.id=$3 AND runs.space_id=sources.space_id WHERE pins.activity_version_id=$1 AND pins.source_version_id=$2 AND versions.state='ready' AND sources.archived_at IS NULL AND sources.role IN ('reference','instructions') FOR SHARE OF sources,versions")
                .bind(plan.activity_version_id).bind(source_version_id).bind(plan.target_run_id).fetch_optional(&mut **tx).await?;
            if row.is_none() {
                return Err(unavailable());
            }
        }
    }
    Ok(())
}
