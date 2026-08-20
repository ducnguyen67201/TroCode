//! Tracked, forward-only import of Tro's production SQL migrations.

use sea_orm_migration::prelude::*;

#[derive(Debug)]
pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(SqlMigration::new(
                "m000001_hosted_sessions",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../services/api/migrations/001_hosted_sessions.sql"
                )),
            )),
            Box::new(SqlMigration::new(
                "m000002_access_codes",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../services/api/migrations/002_access_codes.sql"
                )),
            )),
            Box::new(SqlMigration::new(
                "m000003_model_usage_budgets",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../services/api/migrations/003_model_usage_budgets.sql"
                )),
            )),
            Box::new(SqlMigration::new(
                "m000004_audio_transcription_usage",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../services/api/migrations/004_audio_transcription_usage.sql"
                )),
            )),
            Box::new(SqlMigration::new(
                "m000005_usage_plans_and_rate_limits",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../services/api/migrations/005_usage_plans_and_rate_limits.sql"
                )),
            )),
            Box::new(SqlMigration::new(
                "m000006_agent_turns",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../services/api/migrations/006_agent_turns.sql"
                )),
            )),
            Box::new(SqlMigration::new(
                "m000007_free_usage_plan",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../services/api/migrations/007_free_usage_plan.sql"
                )),
            )),
            Box::new(SqlMigration::new(
                "m000008_knowledge_spaces",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../services/api/migrations/008_knowledge_spaces.sql"
                )),
            )),
            Box::new(SqlMigration::new(
                "m000009_knowledge_sources",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../services/api/migrations/009_knowledge_sources.sql"
                )),
            )),
            Box::new(SqlMigration::new(
                "m000010_knowledge_activities",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../services/api/migrations/010_knowledge_activities.sql"
                )),
            )),
            Box::new(SqlMigration::new(
                "m000011_admin_access_controls",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../services/api/migrations/011_admin_access_controls.sql"
                )),
            )),
            Box::new(SqlMigration::new(
                "m000012_retrievable_access_codes",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../services/api/migrations/012_retrievable_access_codes.sql"
                )),
            )),
            Box::new(SqlMigration::new(
                "m000013_access_code_lifecycle",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../services/api/migrations/013_access_code_lifecycle.sql"
                )),
            )),
        ]
    }

    fn migration_table_name() -> sea_orm::DynIden {
        "tro_schema_migrations".into_iden()
    }
}

#[derive(Debug)]
struct SqlMigration {
    name: &'static str,
    sql: &'static str,
}

impl SqlMigration {
    const fn new(name: &'static str, sql: &'static str) -> Self {
        Self { name, sql }
    }
}

impl MigrationName for SqlMigration {
    fn name(&self) -> &str {
        self.name
    }
}

#[async_trait::async_trait]
impl MigrationTrait for SqlMigration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(self.sql)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Err(DbErr::Migration(String::from(
            "Tro production migrations are forward-only",
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_migrations_include_access_code_lifecycle() {
        let migrations = Migrator::migrations();
        assert_eq!(migrations.len(), 13);
        assert_eq!(
            migrations.last().map(|migration| migration.name()),
            Some("m000013_access_code_lifecycle")
        );
    }
}
