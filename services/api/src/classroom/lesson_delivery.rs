use super::broadcasts::timestamp;
use super::lesson_contracts::{
    LessonDevice, LessonPlan, LessonReport, LessonStart, LessonStepStart,
};
use super::lessons::unavailable;
use super::{ClassroomService, invalid_request};
use crate::{Postgres, Row, Transaction, error::ApiError, query};
use serde_json::{Value, json};
use time::OffsetDateTime;
use uuid::Uuid;

fn claim(row: &crate::postgres::PgRow, digest: &str, owned: bool) -> Value {
    json!({"executionId":row.get::<Uuid,_>("execution_id"),"lessonId":row.get::<Uuid,_>("lesson_id"),"planDigest":digest,"userId":row.get::<String,_>("user_id"),
      "anchorAttemptId":row.get::<Uuid,_>("anchor_attempt_id"),"targetAttemptId":row.get::<Uuid,_>("target_attempt_id"),"clientStartId":row.get::<Uuid,_>("client_start_id"),
      "clientInstanceId":row.get::<Uuid,_>("client_instance_id"),"ownedByThisRequest":owned})
}
fn step_claim(row: &crate::postgres::PgRow, owned: bool) -> Value {
    json!({"executionId":row.get::<Uuid,_>("execution_id"),"stepId":row.get::<Uuid,_>("step_id"),"attemptNumber":row.get::<i64,_>("attempt_number"),
      "taskId":row.get::<Uuid,_>("task_id"),"workSessionId":row.get::<Uuid,_>("work_session_id"),"purpose":row.get::<String,_>("purpose"),"ownedByThisRequest":owned})
}
impl ClassroomService {
    pub(super) async fn lesson_authority(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        user: &str,
        anchor: Uuid,
        lesson: Uuid,
        active: bool,
    ) -> Result<crate::postgres::PgRow, ApiError> {
        let account=query("SELECT id FROM users WHERE id=$1 AND classroom_role='student' AND blocked_at IS NULL AND knowledge_spaces_enabled=true FOR SHARE").bind(user).fetch_optional(&mut **tx).await?;
        if account.is_none() {
            return Err(unavailable());
        }
        let session = self.broadcast_student_session(user, anchor).await?;
        let session_id = session.get::<Uuid, _>("id");
        let locked = query("SELECT state FROM knowledge_class_sessions WHERE id=$1 FOR UPDATE")
            .bind(session_id)
            .fetch_one(&mut **tx)
            .await?;
        query("SELECT runs.id FROM knowledge_activity_runs runs JOIN knowledge_class_session_activities items ON items.run_id=runs.id WHERE items.session_id=$1 ORDER BY runs.id FOR SHARE OF runs").bind(session_id).fetch_all(&mut **tx).await?;
        let row=query(r#"SELECT lessons.*,attempts.id AS target_attempt_id,attempts.state AS attempt_state,
          attempts.acknowledged_policy_version,runs.insight_policy,runs.insight_policy_version,runs.state AS run_state,runs.opens_at,runs.closes_at,versions.definition
          FROM knowledge_classroom_lessons lessons JOIN knowledge_activity_runs runs ON runs.id=lessons.target_run_id AND runs.activity_version_id=lessons.activity_version_id
          JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id
          JOIN knowledge_activity_attempts attempts ON attempts.run_id=runs.id AND attempts.user_id=$3
          JOIN knowledge_space_members members ON members.space_id=runs.space_id AND members.user_id=$3 AND members.role='participant' AND members.removed_at IS NULL
          JOIN knowledge_run_participations participation ON participation.attempt_id=$4 AND participation.left_at IS NULL
          WHERE lessons.id=$1 AND lessons.session_id=$2 AND attempts.state<>'withdrawn'
          FOR UPDATE OF lessons,attempts FOR SHARE OF members,participation"#).bind(lesson).bind(session_id).bind(user).bind(anchor).fetch_optional(&mut **tx).await?.ok_or_else(unavailable)?;
        let now = OffsetDateTime::now_utc();
        if active
            && (locked.get::<String, _>("state") != "open"
                || row.get::<String, _>("state") != "active"
                || row.get::<String, _>("run_state") != "open"
                || now >= row.get::<OffsetDateTime, _>("expires_at")
                || row
                    .get::<Option<OffsetDateTime>, _>("opens_at")
                    .is_some_and(|t| now < t)
                || row
                    .get::<Option<OffsetDateTime>, _>("closes_at")
                    .is_some_and(|t| now >= t)
                || !matches!(
                    row.get::<String, _>("attempt_state").as_str(),
                    "assigned" | "in_progress" | "blocked" | "ready_for_review"
                ))
        {
            return Err(unavailable());
        }
        if active
            && row.get::<String, _>("insight_policy") == "evidence_candidates"
            && row.get::<Option<String>, _>("acknowledged_policy_version")
                != Some(row.get::<String, _>("insight_policy_version"))
        {
            return Err(ApiError::conflict(
                "insight_acknowledgement_required",
                "Open the assignment and acknowledge its insight policy first.",
            ));
        }
        let plan: LessonPlan =
            serde_json::from_value(row.get("plan")).map_err(ApiError::internal)?;
        if active {
            super::lesson_resources::lock_lesson_sources(tx, &plan).await?;
        }
        Ok(row)
    }
    pub async fn lesson_receipt(
        &self,
        user: &str,
        anchor: Uuid,
        lesson: Uuid,
        report: LessonReport,
    ) -> Result<Value, ApiError> {
        report.validate()?;
        if !matches!(report.status.as_str(), "received" | "blocked") {
            return Err(invalid_request());
        }
        let mut tx = self.begin().await?;
        let row = self
            .lesson_authority(&mut tx, user, anchor, lesson, false)
            .await?;
        query("INSERT INTO knowledge_classroom_lesson_deliveries(lesson_id,user_id,anchor_attempt_id,target_attempt_id,status,reason_code) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(lesson_id,user_id) DO NOTHING")
          .bind(lesson).bind(user).bind(anchor).bind(row.get::<Uuid,_>("target_attempt_id")).bind(report.status).bind(report.reason_code).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(json!({"ok":true}))
    }
    pub async fn start_lesson(
        &self,
        user: &str,
        anchor: Uuid,
        lesson: Uuid,
        input: LessonStart,
    ) -> Result<Value, ApiError> {
        let mut tx = self.begin().await?;
        let row = self
            .lesson_authority(&mut tx, user, anchor, lesson, true)
            .await?;
        let delivery=query("SELECT * FROM knowledge_classroom_lesson_deliveries WHERE lesson_id=$1 AND user_id=$2 FOR UPDATE").bind(lesson).bind(user).fetch_optional(&mut *tx).await?.ok_or_else(unavailable)?;
        let digest = row.get::<String, _>("plan_digest");
        if delivery.get::<Option<Uuid>, _>("execution_id").is_some() {
            let owned = delivery.get::<Uuid, _>("client_start_id") == input.client_start_id
                && delivery.get::<Uuid, _>("client_instance_id") == input.client_instance_id
                && delivery.get::<Uuid, _>("anchor_attempt_id") == anchor;
            let result = claim(&delivery, &digest, owned);
            tx.commit().await?;
            return Ok(result);
        }
        let saved=query("UPDATE knowledge_classroom_lesson_deliveries SET execution_id=$3,client_start_id=$4,client_instance_id=$5,status='preparing',updated_at=NOW() WHERE lesson_id=$1 AND user_id=$2 RETURNING *")
          .bind(lesson).bind(user).bind(Uuid::new_v4()).bind(input.client_start_id).bind(input.client_instance_id).fetch_one(&mut *tx).await?;
        tx.commit().await?;
        Ok(claim(&saved, &digest, true))
    }
    pub async fn lookup_lesson_start(
        &self,
        user: &str,
        anchor: Uuid,
        lesson: Uuid,
    ) -> Result<Value, ApiError> {
        let mut tx = self.begin().await?;
        let row = self
            .lesson_authority(&mut tx, user, anchor, lesson, false)
            .await?;
        let saved=query("SELECT * FROM knowledge_classroom_lesson_deliveries WHERE lesson_id=$1 AND user_id=$2 AND execution_id IS NOT NULL").bind(lesson).bind(user).fetch_optional(&mut *tx).await?;
        tx.commit().await?;
        Ok(
            json!({"claim":saved.as_ref().map(|r|claim(r,&row.get::<String,_>("plan_digest"),false))}),
        )
    }
    pub(super) async fn execution_delivery(
        &self,
        user: &str,
        execution: Uuid,
    ) -> Result<crate::postgres::PgRow, ApiError> {
        query("SELECT * FROM knowledge_classroom_lesson_deliveries WHERE execution_id=$1 AND user_id=$2").bind(execution).bind(user).fetch_optional(&self.pool).await?.ok_or_else(unavailable)
    }
    pub async fn start_lesson_step(
        &self,
        user: &str,
        execution: Uuid,
        step: Uuid,
        input: LessonStepStart,
    ) -> Result<Value, ApiError> {
        if !(1..=20).contains(&input.attempt_number)
            || !matches!(input.purpose.as_str(), "work" | "help" | "check")
        {
            return Err(invalid_request());
        }
        let d = self.execution_delivery(user, execution).await?;
        if d.get::<Uuid, _>("client_instance_id") != input.client_instance_id {
            return Err(unavailable());
        }
        let mut tx = self.begin().await?;
        let row = self
            .lesson_authority(
                &mut tx,
                user,
                d.get("anchor_attempt_id"),
                d.get("lesson_id"),
                true,
            )
            .await?;
        let locked_delivery=query("SELECT status FROM knowledge_classroom_lesson_deliveries WHERE execution_id=$1 FOR UPDATE").bind(execution).fetch_one(&mut *tx).await?;
        if matches!(
            locked_delivery.get::<String, _>("status").as_str(),
            "finished" | "stopped" | "expired" | "failed" | "unknown"
        ) {
            return Err(unavailable());
        }
        let plan: LessonPlan =
            serde_json::from_value(row.get("plan")).map_err(ApiError::internal)?;
        let selected = plan
            .steps
            .iter()
            .find(|s| s.id == step)
            .ok_or_else(invalid_request)?;
        if (selected.mode == "check" && input.purpose == "work")
            || (selected.mode != "check" && input.purpose == "check" && selected.mode != "practice")
        {
            return Err(invalid_request());
        }
        if let Some(saved)=query("SELECT * FROM knowledge_classroom_lesson_steps WHERE execution_id=$1 AND step_id=$2 AND attempt_number=$3").bind(execution).bind(step).bind(input.attempt_number).fetch_optional(&mut *tx).await?{
            let owned=saved.get::<Uuid,_>("task_id")==input.task_id && saved.get::<String,_>("purpose")==input.purpose;
            if !owned{return Err(ApiError::conflict("lesson_idempotency_conflict","This step attempt belongs to another request."));}
            tx.commit().await?;return Ok(step_claim(&saved,true));
        }
        let work=query("INSERT INTO knowledge_activity_work_sessions(client_id,attempt_id,task_id,launch_kind,purpose) VALUES($1,$2,$1,$4,$3) RETURNING id")
          .bind(input.task_id).bind(d.get::<Uuid,_>("target_attempt_id")).bind(&input.purpose).bind(row.get::<Value,_>("definition")["launchTarget"].as_str().unwrap_or("none")).fetch_one(&mut *tx).await?;
        let saved=query("INSERT INTO knowledge_classroom_lesson_steps(execution_id,step_id,attempt_number,task_id,work_session_id,purpose) VALUES($1,$2,$3,$4,$5,$6) RETURNING *")
          .bind(execution).bind(step).bind(input.attempt_number).bind(input.task_id).bind(work.get::<Uuid,_>("id")).bind(input.purpose).fetch_one(&mut *tx).await?;
        tx.commit().await?;
        Ok(step_claim(&saved, true))
    }
    pub async fn lookup_lesson_step(
        &self,
        user: &str,
        execution: Uuid,
        step: Uuid,
        attempt: i64,
    ) -> Result<Value, ApiError> {
        let d = self.execution_delivery(user, execution).await?;
        self.broadcast_student_session(user, d.get("anchor_attempt_id"))
            .await?;
        let saved=query("SELECT * FROM knowledge_classroom_lesson_steps WHERE execution_id=$1 AND step_id=$2 AND attempt_number=$3").bind(execution).bind(step).bind(attempt).fetch_optional(&self.pool).await?;
        Ok(json!({"claim":saved.as_ref().map(|r|step_claim(r,false))}))
    }
    pub async fn lesson_status(&self, user: &str, execution: Uuid) -> Result<Value, ApiError> {
        let d = self.execution_delivery(user, execution).await?;
        let mut tx = self.begin().await?;
        let row = self
            .lesson_authority(
                &mut tx,
                user,
                d.get("anchor_attempt_id"),
                d.get("lesson_id"),
                true,
            )
            .await?;
        tx.commit().await?;
        Ok(
            json!({"active":!matches!(d.get::<String,_>("status").as_str(),"stopped"|"expired"|"finished"|"failed"|"unknown"),"serverTime":timestamp(OffsetDateTime::now_utc()),"planDigest":row.get::<String,_>("plan_digest")}),
        )
    }
    pub async fn report_lesson(
        &self,
        user: &str,
        execution: Uuid,
        input: LessonReport,
    ) -> Result<Value, ApiError> {
        input.validate()?;
        let d = self.execution_delivery(user, execution).await?;
        let mut tx = self.begin().await?;
        let row = self
            .lesson_authority(
                &mut tx,
                user,
                d.get("anchor_attempt_id"),
                d.get("lesson_id"),
                false,
            )
            .await?;
        let plan: LessonPlan =
            serde_json::from_value(row.get("plan")).map_err(ApiError::internal)?;
        if input.criterion_outcomes.iter().any(|item| {
            !plan
                .steps
                .iter()
                .filter(|s| Some(s.id) == input.step_id)
                .any(|s| s.criterion_ids.contains(&item.criterion_id))
        }) {
            return Err(invalid_request());
        }
        if input
            .step_id
            .is_some_and(|id| !plan.steps.iter().any(|s| s.id == id))
        {
            return Err(invalid_request());
        }
        let locked=query("SELECT revision,report,status FROM knowledge_classroom_lesson_deliveries WHERE execution_id=$1 FOR UPDATE").bind(execution).fetch_one(&mut *tx).await?;
        let revision = locked.get::<i64, _>("revision");
        let report = serde_json::to_value(&input).map_err(ApiError::internal)?;
        if revision == input.revision
            && locked
                .get::<Option<Value>, _>("report")
                .is_some_and(|r| r != report)
        {
            return Err(ApiError::conflict(
                "lesson_report_conflict",
                "A report revision already has different content.",
            ));
        }
        if input.revision > revision {
            let old = locked.get::<String, _>("status");
            if matches!(
                old.as_str(),
                "finished" | "stopped" | "expired" | "failed" | "unknown"
            ) && old != input.status
                && !(matches!(old.as_str(), "failed" | "unknown") && input.status == "stopped")
            {
                return Err(unavailable());
            }
            query("UPDATE knowledge_classroom_lesson_deliveries SET revision=$2,report=$3,status=$4,reason_code=$5,step_id=$6,updated_at=NOW() WHERE execution_id=$1")
              .bind(execution).bind(input.revision).bind(report).bind(input.status).bind(input.reason_code).bind(input.step_id).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(json!({"ok":true}))
    }
    pub async fn lesson_device(
        &self,
        user: &str,
        anchor: Uuid,
        input: LessonDevice,
    ) -> Result<Value, ApiError> {
        if input.build.len() > 100 || !matches!(input.lessons_version, 1 | 2) {
            return Err(invalid_request());
        }
        let session = self.broadcast_student_session(user, anchor).await?;
        query("INSERT INTO knowledge_classroom_lesson_devices(session_id,user_id,client_instance_id,capabilities) VALUES($1,$2,$3,$4) ON CONFLICT(session_id,user_id,client_instance_id) DO UPDATE SET capabilities=EXCLUDED.capabilities,last_seen_at=NOW()")
          .bind(session.get::<Uuid,_>("id")).bind(user).bind(input.client_instance_id).bind(json!({"build":input.build,"lessonsVersion":input.lessons_version,"ready":input.ready})).execute(&self.pool).await?;
        Ok(json!({"ok":true}))
    }
}
