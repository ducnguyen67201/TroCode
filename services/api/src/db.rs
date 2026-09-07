use std::{borrow::Cow, sync::LazyLock, time::Duration};

use sqlx::{
    PgPool,
    migrate::{Migration, MigrationType, Migrator},
    postgres::PgPoolOptions,
};

use crate::{config::Config, error::ApiError};

static MIGRATOR: LazyLock<Migrator> = LazyLock::new(|| Migrator {
    migrations: Cow::Owned(vec![
        migration(
            1,
            "hosted sessions",
            include_str!("../migrations/001_hosted_sessions.sql"),
        ),
        migration(
            2,
            "access codes",
            include_str!("../migrations/002_access_codes.sql"),
        ),
        migration(
            3,
            "model usage budgets",
            include_str!("../migrations/003_model_usage_budgets.sql"),
        ),
        migration(
            4,
            "audio transcription usage",
            include_str!("../migrations/004_audio_transcription_usage.sql"),
        ),
        migration(
            5,
            "usage plans and rate limits",
            include_str!("../migrations/005_usage_plans_and_rate_limits.sql"),
        ),
        migration(
            6,
            "agent turns",
            include_str!("../migrations/006_agent_turns.sql"),
        ),
        migration(
            7,
            "free usage plan",
            include_str!("../migrations/007_free_usage_plan.sql"),
        ),
        migration(
            8,
            "knowledge spaces",
            include_str!("../migrations/008_knowledge_spaces.sql"),
        ),
        migration(
            9,
            "knowledge sources",
            include_str!("../migrations/009_knowledge_sources.sql"),
        ),
        migration(
            10,
            "knowledge activities",
            include_str!("../migrations/010_knowledge_activities.sql"),
        ),
        migration(
            11,
            "admin access controls",
            include_str!("../migrations/011_admin_access_controls.sql"),
        ),
        migration(
            12,
            "retrievable access codes",
            include_str!("../migrations/012_retrievable_access_codes.sql"),
        ),
        migration(
            13,
            "access code lifecycle",
            include_str!("../migrations/013_access_code_lifecycle.sql"),
        ),
        migration(
            14,
            "agent runtime",
            include_str!("../migrations/014_agent_runtime.sql"),
        ),
        migration(
            15,
            "intent authorization",
            include_str!("../migrations/015_intent_authorization.sql"),
        ),
        migration(
            16,
            "admin code grants",
            include_str!("../migrations/016_admin_code_grants.sql"),
        ),
        migration(
            17,
            "free plan onboarding",
            include_str!("../migrations/017_free_plan_onboarding.sql"),
        ),
        migration(
            18,
            "classroom roles",
            include_str!("../migrations/018_classroom_roles.sql"),
        ),
        migration(
            19,
            "invite idempotency",
            include_str!("../migrations/019_invite_idempotency.sql"),
        ),
        migration(
            20,
            "live classroom room flow",
            include_str!("../migrations/020_live_classroom_room_flow.sql"),
        ),
        migration(
            21,
            "organization managed access",
            include_str!("../migrations/021_organization_managed_access.sql"),
        ),
        migration(
            22,
            "organization profile settings",
            include_str!("../migrations/022_organization_profile_settings.sql"),
        ),
        migration(
            23,
            "user knowledge spaces access",
            include_str!("../migrations/023_user_knowledge_spaces_access.sql"),
        ),
        migration(
            24,
            "companion image generation",
            include_str!("../migrations/024_companion_image_generation.sql"),
        ),
        migration(
            25,
            "canonical agent runtime contract v3",
            include_str!("../migrations/025_agent_runtime_contract_v3.sql"),
        ),
        migration(
            26,
            "organization home banners",
            include_str!("../migrations/026_organization_home_banners.sql"),
        ),
        migration(
            27,
            "verified MCP connectors",
            include_str!("../migrations/027_mcp_connectors.sql"),
        ),
        migration(
            28,
            "class sessions",
            include_str!("../migrations/028_class_sessions.sql"),
        ),
        migration(
            29,
            "class session materials",
            include_str!("../migrations/029_class_session_materials.sql"),
        ),
        migration(
            30,
            "remove agent approval policy",
            include_str!("../migrations/030_remove_agent_approval_policy.sql"),
        ),
        migration(
            31,
            "OpenAI Agents SDK orchestrator",
            include_str!("../migrations/031_agents_sdk_orchestrator.sql"),
        ),
        migration(
            32,
            "orchestrator public protocol digest",
            include_str!("../migrations/032_orchestrator_public_protocol_digest.sql"),
        ),
        migration(
            33,
            "agent run tool snapshots",
            include_str!("../migrations/033_agent_run_tool_snapshots.sql"),
        ),
        migration(
            34,
            "classroom explain assignment directive",
            include_str!("../migrations/034_classroom_explain_assignment_directive.sql"),
        ),
        migration(
            35,
            "class session broadcasts",
            include_str!("../migrations/035_class_session_broadcasts.sql"),
        ),
        migration(
            36,
            "student classroom guidance",
            include_str!("../migrations/036_student_classroom_guidance.sql"),
        ),
        migration(
            37,
            "classroom lessons",
            include_str!("../migrations/037_classroom_lessons.sql"),
        ),
    ]),
    ..Migrator::DEFAULT
});

// PR #63 was applied to local databases before the deployed PR #61 history
// was reconciled. Preserve those exact version/checksum pairs too. Both paths
// reach the same schema at 036; subsequent migrations come from MIGRATOR.
static BROADCASTS_FIRST_MIGRATOR: LazyLock<Migrator> = LazyLock::new(|| {
    let mut migrations = MIGRATOR.migrations.to_vec();
    migrations[33] = migration(
        34,
        "class session broadcasts",
        include_str!("../migrations/035_class_session_broadcasts.sql"),
    );
    migrations[34] = migration(
        35,
        "student classroom guidance",
        include_str!("../migrations/036_student_classroom_guidance.sql"),
    );
    migrations[35] = migration(
        36,
        "classroom explain assignment directive",
        include_str!("../migrations/034_classroom_explain_assignment_directive.sql"),
    );
    Migrator {
        migrations: Cow::Owned(migrations),
        ..Migrator::DEFAULT
    }
});

fn migration(version: i64, description: &'static str, sql: &'static str) -> Migration {
    Migration::new(
        version,
        Cow::Borrowed(description),
        MigrationType::Simple,
        Cow::Borrowed(sql),
        false,
    )
}

pub async fn connect(config: &Config) -> Result<PgPool, ApiError> {
    let pool = PgPoolOptions::new()
        .max_connections(config.database_pool_max)
        .acquire_timeout(Duration::from_secs(15))
        .connect(&config.database_url)
        .await?;
    Ok(pool)
}

pub async fn migrate(pool: &PgPool) -> Result<(), ApiError> {
    let has_history: bool =
        sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations') IS NOT NULL")
            .fetch_one(pool)
            .await?;
    let checksum = if has_history {
        sqlx::query_scalar::<_, Vec<u8>>(
            "SELECT checksum FROM _sqlx_migrations WHERE version=34 AND success",
        )
        .fetch_optional(pool)
        .await?
    } else {
        None
    };
    let migrator = if checksum.as_deref()
        == Some(BROADCASTS_FIRST_MIGRATOR.migrations[33].checksum.as_ref())
    {
        &*BROADCASTS_FIRST_MIGRATOR
    } else {
        &*MIGRATOR
    };
    // SQLx retains its lock, dirty-history check and validation of every applied
    // checksum. Unknown or concurrently changed histories fail closed.
    migrator.run(pool).await.map_err(ApiError::internal)
}

pub async fn ready(pool: &PgPool) -> bool {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(pool)
        .await
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::{BROADCASTS_FIRST_MIGRATOR, MIGRATOR};
    #[test]
    fn classroom_migrations_are_registered_in_order() {
        let versions: Vec<_> = MIGRATOR.iter().map(|migration| migration.version).collect();
        assert_eq!(versions, (1..=37).collect::<Vec<_>>());
        let historical_versions: Vec<_> = BROADCASTS_FIRST_MIGRATOR
            .iter()
            .map(|migration| migration.version)
            .collect();
        assert_eq!(historical_versions, versions);
    }
}
