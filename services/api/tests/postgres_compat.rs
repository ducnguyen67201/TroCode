use std::{borrow::Cow, sync::LazyLock, time::Duration};

use sqlx_core::{
    migrate::{Migration, MigrationType, Migrator},
    raw_sql::raw_sql,
};
use trocode_api::{Row as _, db, postgres::PgPoolOptions, query, query_scalar};
use url::Url;

static DATABASE_TEST_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

fn disposable_database_url() -> String {
    let value = std::env::var("TEST_DATABASE_URL")
        .expect("TEST_DATABASE_URL is required for this ignored integration test");
    let parsed = Url::parse(&value).expect("TEST_DATABASE_URL must be a URL");
    let local = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"));
    let test_database = parsed.path().trim_start_matches('/').ends_with("_test");
    assert!(
        local && test_database,
        "refusing to reset a database that is not local and suffixed _test"
    );
    value
}

async fn open_pool(database_url: &str) -> trocode_api::PgPool {
    PgPoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await
        .expect("connect to disposable PostgreSQL")
}

async fn reset(pool: &trocode_api::PgPool) {
    query("DROP SCHEMA IF EXISTS public CASCADE")
        .execute(pool)
        .await
        .expect("drop disposable schema");
    query("CREATE SCHEMA public")
        .execute(pool)
        .await
        .expect("create disposable schema");
}

async fn apply_legacy_schema(pool: &trocode_api::PgPool) {
    for migration in [
        include_str!("../migrations/001_hosted_sessions.sql"),
        include_str!("../migrations/002_access_codes.sql"),
        include_str!("../migrations/003_model_usage_budgets.sql"),
        include_str!("../migrations/004_audio_transcription_usage.sql"),
        include_str!("../migrations/005_usage_plans_and_rate_limits.sql"),
        include_str!("../migrations/006_agent_turns.sql"),
        include_str!("../migrations/007_free_usage_plan.sql"),
        include_str!("../migrations/008_knowledge_spaces.sql"),
        include_str!("../migrations/009_knowledge_sources.sql"),
        include_str!("../migrations/010_knowledge_activities.sql"),
        include_str!("../migrations/011_admin_access_controls.sql"),
        include_str!("../migrations/012_retrievable_access_codes.sql"),
        include_str!("../migrations/013_access_code_lifecycle.sql"),
        include_str!("../migrations/014_agent_runtime.sql"),
        include_str!("../migrations/015_intent_authorization.sql"),
        include_str!("../migrations/016_admin_code_grants.sql"),
        include_str!("../migrations/017_free_plan_onboarding.sql"),
        include_str!("../migrations/018_classroom_roles.sql"),
        include_str!("../migrations/019_invite_idempotency.sql"),
        include_str!("../migrations/020_live_classroom_room_flow.sql"),
    ] {
        raw_sql(migration)
            .execute(pool)
            .await
            .expect("apply legacy idempotent migration");
    }
}

#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn rust_migrations_are_idempotent_on_an_empty_database() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let database_url = disposable_database_url();
    let pool = open_pool(&database_url).await;
    reset(&pool).await;

    db::migrate(&pool).await.expect("first Rust migration run");
    db::migrate(&pool).await.expect("second Rust migration run");

    let sqlx_count: i64 = query_scalar("SELECT COUNT(*)::bigint FROM _sqlx_migrations")
        .fetch_one(&pool)
        .await
        .expect("SQLx migration count");
    let table_count: i64 = query_scalar(
        "SELECT COUNT(*)::bigint FROM information_schema.tables WHERE table_schema='public'",
    )
    .fetch_one(&pool)
    .await
    .expect("domain table count");
    assert_eq!(sqlx_count, 37);
    assert_eq!(table_count, 66, "65 domain tables plus SQLx bookkeeping");
}

#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn rust_migrations_adopt_a_legacy_initialized_database() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let database_url = disposable_database_url();
    let pool = open_pool(&database_url).await;
    reset(&pool).await;
    apply_legacy_schema(&pool).await;
    query("INSERT INTO users(id,email,name)VALUES('compat-user','compat@example.test','Compat')")
        .execute(&pool)
        .await
        .expect("seed existing domain row");
    let domain_table_count: i64 = query_scalar(
        "SELECT COUNT(*)::bigint FROM information_schema.tables WHERE table_schema='public'",
    )
    .fetch_one(&pool)
    .await
    .expect("domain table count");
    assert_eq!(domain_table_count, 45);

    db::migrate(&pool).await.expect("Rust adoption migration");
    db::migrate(&pool).await.expect("Rust second-start no-op");

    let row = query("SELECT email,name,knowledge_spaces_enabled FROM users WHERE id='compat-user'")
        .fetch_one(&pool)
        .await
        .expect("preserved existing user");
    assert_eq!(row.get::<String, _>("email"), "compat@example.test");
    assert_eq!(row.get::<String, _>("name"), "Compat");
    assert!(row.get::<bool, _>("knowledge_spaces_enabled"));
    let sqlx_count: i64 = query_scalar("SELECT COUNT(*)::bigint FROM _sqlx_migrations")
        .fetch_one(&pool)
        .await
        .expect("SQLx bookkeeping count");
    assert_eq!(sqlx_count, 37);
}

// Reproduce both recorded SQLx histories: deployed PR #61 and local PR #63.
// Pin their checksums so an edited fixture cannot silently redefine history.
fn classroom_history(broadcasts_first: bool) -> Migrator {
    let mut sources = vec![
        include_str!("../migrations/001_hosted_sessions.sql"),
        include_str!("../migrations/002_access_codes.sql"),
        include_str!("../migrations/003_model_usage_budgets.sql"),
        include_str!("../migrations/004_audio_transcription_usage.sql"),
        include_str!("../migrations/005_usage_plans_and_rate_limits.sql"),
        include_str!("../migrations/006_agent_turns.sql"),
        include_str!("../migrations/007_free_usage_plan.sql"),
        include_str!("../migrations/008_knowledge_spaces.sql"),
        include_str!("../migrations/009_knowledge_sources.sql"),
        include_str!("../migrations/010_knowledge_activities.sql"),
        include_str!("../migrations/011_admin_access_controls.sql"),
        include_str!("../migrations/012_retrievable_access_codes.sql"),
        include_str!("../migrations/013_access_code_lifecycle.sql"),
        include_str!("../migrations/014_agent_runtime.sql"),
        include_str!("../migrations/015_intent_authorization.sql"),
        include_str!("../migrations/016_admin_code_grants.sql"),
        include_str!("../migrations/017_free_plan_onboarding.sql"),
        include_str!("../migrations/018_classroom_roles.sql"),
        include_str!("../migrations/019_invite_idempotency.sql"),
        include_str!("../migrations/020_live_classroom_room_flow.sql"),
        include_str!("../migrations/021_organization_managed_access.sql"),
        include_str!("../migrations/022_organization_profile_settings.sql"),
        include_str!("../migrations/023_user_knowledge_spaces_access.sql"),
        include_str!("../migrations/024_companion_image_generation.sql"),
        include_str!("../migrations/025_agent_runtime_contract_v3.sql"),
        include_str!("../migrations/026_organization_home_banners.sql"),
        include_str!("../migrations/027_mcp_connectors.sql"),
        include_str!("../migrations/028_class_sessions.sql"),
        include_str!("../migrations/029_class_session_materials.sql"),
        include_str!("../migrations/030_remove_agent_approval_policy.sql"),
        include_str!("../migrations/031_agents_sdk_orchestrator.sql"),
        include_str!("../migrations/032_orchestrator_public_protocol_digest.sql"),
        include_str!("../migrations/033_agent_run_tool_snapshots.sql"),
    ];
    if broadcasts_first {
        sources.extend([
            include_str!("../migrations/035_class_session_broadcasts.sql"),
            include_str!("../migrations/036_student_classroom_guidance.sql"),
        ]);
    } else {
        sources.push(include_str!(
            "../migrations/034_classroom_explain_assignment_directive.sql"
        ));
    }
    let migrations: Vec<_> = sources
        .iter()
        .enumerate()
        .map(|(index, sql)| {
            Migration::new(
                i64::try_from(index + 1).unwrap(),
                Cow::Borrowed("deployed history"),
                MigrationType::Simple,
                Cow::Borrowed(*sql),
                false,
            )
        })
        .collect();
    let expected_checksums: &[&str] = if broadcasts_first {
        &[
            "cd6f87195d9923850e7b119720d22ac398e84f245e9184e439be3969ce524e2a0504d9d92c4af8aa18a23107978eea15",
            "c8d5b0030c997adba3b8c6fb7cd19f814bb1b7ad77f45315b3e7f3b7d9536ca721c65ef176cd02a66e309a60f3c2c43d",
        ]
    } else {
        &[
            "1bdfe5cdfbec5480c7f942ab8c0e03a6e2e49b853530b0b449bdc8e206dc72651a49ce658f8fda167b563320c68d652b",
        ]
    };
    for (migration, expected) in migrations[33..].iter().zip(expected_checksums) {
        assert_eq!(
            migration
                .checksum
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
            *expected
        );
    }
    Migrator {
        migrations: Cow::Owned(migrations),
        ..Migrator::DEFAULT
    }
}

#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn upgrades_deployed_classroom_history_without_rewriting_checksums() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let pool = open_pool(&disposable_database_url()).await;
    reset(&pool).await;
    classroom_history(false)
        .run(&pool)
        .await
        .expect("install deployed PR #61 history");
    query(
        "INSERT INTO users(id,email,name)VALUES('upgrade-user','upgrade@example.test','Preserved')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let history_sql =
        "SELECT jsonb_agg(to_jsonb(m) ORDER BY version) FROM _sqlx_migrations m WHERE version<=34";
    let before: serde_json::Value = query_scalar(history_sql).fetch_one(&pool).await.unwrap();
    db::migrate(&pool)
        .await
        .expect("upgrade from deployed PR #61");
    db::migrate(&pool).await.expect("restart after upgrade");
    let after: serde_json::Value = query_scalar(history_sql).fetch_one(&pool).await.unwrap();
    assert_eq!(
        after, before,
        "existing SQLx checksums and history must remain unchanged"
    );
    let name: String = query_scalar("SELECT name FROM users WHERE id='upgrade-user'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(name, "Preserved");
    let count: i64 = query_scalar("SELECT COUNT(*) FROM _sqlx_migrations WHERE success")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 37);
    for table in [
        "knowledge_class_session_broadcasts",
        "knowledge_classroom_guidance_starts",
    ] {
        let exists: bool = query_scalar("SELECT to_regclass($1) IS NOT NULL")
            .bind(table)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(exists, "new table missing: {table}");
    }
    let constraint: String = query_scalar("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='knowledge_run_directives'::regclass AND conname='knowledge_run_directives_kind_check'").fetch_one(&pool).await.unwrap();
    assert!(constraint.contains("explain_assignment"));

    // Corruption must still fail closed; the upgrade does not bypass SQLx validation.
    query("UPDATE _sqlx_migrations SET checksum=decode('0001','hex') WHERE version=34")
        .execute(&pool)
        .await
        .unwrap();
    assert!(db::migrate(&pool).await.is_err());
}

#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn upgrades_pr63_history_without_resetting_local_databases() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    for applied_count in [34, 35] {
        let pool = open_pool(&disposable_database_url()).await;
        reset(&pool).await;
        let mut old = classroom_history(true);
        old.migrations.to_mut().truncate(applied_count);
        old.run(&pool)
            .await
            .expect("install PR #63 migration history");
        query("INSERT INTO users(id,email,name)VALUES('local-user','local@example.test','Local preserved')").execute(&pool).await.unwrap();
        let history_sql = "SELECT jsonb_agg(to_jsonb(m) ORDER BY version) FROM _sqlx_migrations m WHERE version<=$1";
        let before: serde_json::Value = query_scalar(history_sql)
            .bind(i64::try_from(applied_count).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
        db::migrate(&pool).await.expect("upgrade PR #63 database");
        db::migrate(&pool).await.expect("restart PR #63 database");
        let after: serde_json::Value = query_scalar(history_sql)
            .bind(i64::try_from(applied_count).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(before, after);
        let name: String = query_scalar("SELECT name FROM users WHERE id='local-user'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name, "Local preserved");
        let count: i64 = query_scalar("SELECT COUNT(*) FROM _sqlx_migrations WHERE success")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 37);
        let constraint: String = query_scalar("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='knowledge_run_directives'::regclass AND conname='knowledge_run_directives_kind_check'").fetch_one(&pool).await.unwrap();
        assert!(constraint.contains("explain_assignment"));
        let table_exists: bool =
            query_scalar("SELECT to_regclass('knowledge_classroom_guidance_starts') IS NOT NULL")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(table_exists);
        query("UPDATE _sqlx_migrations SET checksum=decode('0001','hex') WHERE version=35")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            db::migrate(&pool).await.is_err(),
            "known 034 must not bypass validation of 035"
        );
        // A failed SQLx migration keeps its session lock until disconnect.
        // Model the failed startup exiting before trying the next history.
        pool.close().await;
    }
}
