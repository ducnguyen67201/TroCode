use sqlx::{PgPool, Row};
use time::OffsetDateTime;

use crate::{
    error::{ApiError, ApiResult},
    usage::plan_for,
};

/// Redeem the class owner's shared code on first access, including old rosters.
/// This is a normal, persistent redemption; leaving a class does not revoke it.
pub(super) async fn claim_classroom_access(pool: &PgPool, user_id: &str) -> ApiResult<()> {
    let mut tx = pool.begin().await?;
    // Match manual redemption's user -> code lock order. Concurrent checks for
    // one student must not claim twice or replace independently granted access.
    let student = sqlx::query("SELECT email,classroom_role,blocked_at,free_access_started_at FROM users WHERE id=$1 FOR UPDATE")
        .bind(user_id).fetch_optional(&mut *tx).await?;
    let Some(student) = student else {
        return Ok(());
    };
    if student.get::<String, _>("classroom_role") != "student"
        || student
            .get::<Option<OffsetDateTime>, _>("blocked_at")
            .is_some()
    {
        return Ok(());
    }
    let assigned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM access_code_redemptions WHERE user_id=$1)
         OR EXISTS(SELECT 1 FROM organization_memberships WHERE removed_at IS NULL
                   AND (user_id=$1 OR email_normalized=LOWER(BTRIM($2))))",
    )
    .bind(user_id)
    .bind(student.get::<String, _>("email"))
    .fetch_one(&mut *tx)
    .await?;
    if assigned {
        return Ok(());
    }

    // Organization codes require explicitly assigned seats and must never be
    // inherited through a class. Only an active owner can sponsor a student.
    let codes = sqlx::query(
        "SELECT codes.id,codes.plan,codes.max_users,codes.paused_at
         FROM access_codes codes WHERE codes.distribution_mode='shared' AND EXISTS(
           SELECT 1 FROM knowledge_space_members members
           JOIN knowledge_spaces spaces ON spaces.id=members.space_id
           JOIN users teacher ON teacher.id=spaces.owner_user_id
           JOIN knowledge_space_members owner ON owner.space_id=spaces.id
             AND owner.user_id=teacher.id AND owner.role='owner' AND owner.removed_at IS NULL
           JOIN access_code_redemptions redemption ON redemption.user_id=teacher.id
           WHERE members.user_id=$1 AND members.role='participant' AND members.removed_at IS NULL
             AND spaces.archived_at IS NULL AND teacher.classroom_role='teacher'
             AND teacher.blocked_at IS NULL AND redemption.access_code_id=codes.id
         ) ORDER BY codes.id FOR UPDATE OF codes",
    )
    .bind(user_id)
    .fetch_all(&mut *tx)
    .await?;
    let has_free_access = student
        .get::<Option<OffsetDateTime>, _>("free_access_started_at")
        .is_some();
    if codes.len() > 1 {
        if has_free_access {
            return Ok(());
        }
        return Err(ApiError::conflict(
            "classroom_access_ambiguous",
            "Your classes use different access codes. Ask your teacher to confirm your access.",
        ));
    }
    let Some(code) = codes.first() else {
        return Ok(());
    };
    if code.get::<Option<OffsetDateTime>, _>("paused_at").is_some() {
        if has_free_access {
            return Ok(());
        }
        return Err(ApiError::conflict(
            "classroom_access_paused",
            "Your teacher's access code is paused. Ask your teacher to restore access.",
        ));
    }
    let code_id: uuid::Uuid = code.get("id");
    let used: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM access_code_redemptions WHERE access_code_id=$1")
            .bind(code_id)
            .fetch_one(&mut *tx)
            .await?;
    if used >= i64::from(code.get::<i32, _>("max_users")) {
        if has_free_access {
            return Ok(());
        }
        return Err(ApiError::conflict(
            "classroom_access_full",
            "Your teacher's access code has no seats available. Ask your teacher to increase capacity.",
        ));
    }
    let plan: String = code.get("plan");
    plan_for(&plan)?;
    sqlx::query("INSERT INTO access_code_redemptions(user_id,access_code_id)VALUES($1,$2)")
        .bind(user_id)
        .bind(code_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE users SET plan=$2,updated_at=NOW() WHERE id=$1")
        .bind(user_id)
        .bind(plan)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
