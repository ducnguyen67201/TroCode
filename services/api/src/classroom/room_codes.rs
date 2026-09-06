use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::error::ApiError;
use crate::{Row, postgres::PgRow, query};

use super::service::definition_bool;
use super::{
    ClassroomService, CreateRoomCodeRequest, RoomCodeResponse, deterministic_room_code,
    room_code_digest,
};

impl ClassroomService {
    pub async fn create_room_code(
        &self,
        user_id: &str,
        group_participant_limit: u32,
        space_id: Uuid,
        run_id: Uuid,
        input: CreateRoomCodeRequest,
    ) -> Result<RoomCodeResponse, ApiError> {
        input.validate()?;
        self.require_facilitator(user_id, space_id).await?;
        let context = self
            .run_context(run_id, space_id)
            .await?
            .ok_or(ApiError::not_found("run_not_found", "Run not found."))?;
        if context.target_kind != "room" || !matches!(context.mode.as_str(), "live" | "hybrid") {
            return Err(ApiError::conflict(
                "room_run_required",
                "Room admission requires a live or hybrid Room Run.",
            ));
        }
        if !definition_bool(&context.definition, &["sessionPolicy", "allowRoomJoin"]) {
            return Err(ApiError::conflict(
                "room_join_disabled",
                "Publish this Activity with room joining enabled first.",
            ));
        }
        let now = OffsetDateTime::now_utc();
        let expires_at = input.expires_at.unwrap_or(now + Duration::hours(8));
        if expires_at <= now || expires_at > now + Duration::hours(24) {
            return Err(ApiError::bad_request(
                "room_expiry_invalid",
                "Room codes must expire within the next 24 hours.",
            ));
        }
        let max_uses = input.max_uses.min(group_participant_limit) as i32;
        let code = deterministic_room_code(&self.hmac_key, run_id, input.client_id);
        let digest = room_code_digest(&code, &self.hmac_key);
        let mut transaction = self.begin().await?;
        query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!("room-code:{run_id}"))
            .execute(&mut *transaction)
            .await?;
        let run = query(
            r#"SELECT state,mode,target_kind FROM knowledge_activity_runs
               WHERE id=$1 AND space_id=$2 FOR UPDATE"#,
        )
        .bind(run_id)
        .bind(space_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(ApiError::not_found("run_not_found", "Run not found."))?;
        let target_kind: String = run.get("target_kind");
        let mode: String = run.get("mode");
        let state: String = run.get("state");
        if target_kind != "room" || !matches!(mode.as_str(), "live" | "hybrid") {
            return Err(ApiError::conflict(
                "room_run_required",
                "Room admission requires a live or hybrid Room Run.",
            ));
        }
        if !matches!(state.as_str(), "draft" | "open") {
            return Err(ApiError::conflict(
                "room_closed",
                "This classroom is closed.",
            ));
        }
        if let Some(existing) = query(
            r#"SELECT id,max_uses,used_count,expires_at,revoked_at,created_at
               FROM knowledge_live_room_codes WHERE run_id=$1 AND client_id=$2"#,
        )
        .bind(run_id)
        .bind(input.client_id)
        .fetch_optional(&mut *transaction)
        .await?
        {
            let response = room_code_from_row(&existing, code, false);
            transaction.commit().await?;
            return Ok(response);
        }
        // Navigation must preserve the code already shared with learners.
        // Explicit rotation keeps the existing default behavior.
        if input.reuse_active
            && let Some(existing) = query(
                r#"SELECT id,client_id,max_uses,used_count,expires_at,revoked_at,created_at
                   FROM knowledge_live_room_codes
                   WHERE run_id=$1 AND revoked_at IS NULL AND expires_at>NOW()
                   ORDER BY created_at DESC,id DESC LIMIT 1"#,
            )
            .bind(run_id)
            .fetch_optional(&mut *transaction)
            .await?
        {
            let existing_code =
                deterministic_room_code(&self.hmac_key, run_id, existing.get("client_id"));
            let response = room_code_from_row(&existing, existing_code, false);
            transaction.commit().await?;
            return Ok(response);
        }
        query(
            r#"UPDATE knowledge_live_room_codes SET revoked_at=COALESCE(revoked_at,NOW())
               WHERE run_id=$1 AND revoked_at IS NULL"#,
        )
        .bind(run_id)
        .execute(&mut *transaction)
        .await?;
        let inserted = query(
            r#"INSERT INTO knowledge_live_room_codes
                 (client_id,run_id,code_digest,max_uses,expires_at,created_by)
               VALUES ($1,$2,$3,$4,$5,$6)
               RETURNING id,max_uses,used_count,expires_at,revoked_at,created_at"#,
        )
        .bind(input.client_id)
        .bind(run_id)
        .bind(digest.as_slice())
        .bind(max_uses)
        .bind(expires_at)
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
        let response = room_code_from_row(&inserted, code, true);
        transaction.commit().await?;
        Ok(response)
    }
}

fn room_code_from_row(row: &PgRow, code: String, newly_created: bool) -> RoomCodeResponse {
    RoomCodeResponse {
        id: row.get("id"),
        code,
        max_uses: row.get("max_uses"),
        used_count: row.get("used_count"),
        expires_at: row.get("expires_at"),
        revoked_at: row.get("revoked_at"),
        created_at: row.get("created_at"),
        newly_created,
    }
}
