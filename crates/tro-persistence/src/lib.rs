//! SeaORM-owned persistence and explicit `PostgreSQL` concurrency primitives.

use std::time::Duration;

use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DatabaseTransaction, DbBackend,
    DbErr, FromQueryResult, Statement, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The production schema inventory. Migrations are authoritative; this list is
/// also used by readiness and contract reporting.
pub const TABLES: &[&str] = &[
    "users",
    "device_sessions",
    "access_codes",
    "access_code_redemptions",
    "model_budget_reservations",
    "model_usage_events",
    "api_rate_limit_buckets",
    "agent_turns",
    "knowledge_spaces",
    "knowledge_space_members",
    "knowledge_space_groups",
    "knowledge_space_group_members",
    "knowledge_space_invites",
    "knowledge_space_invite_redemptions",
    "knowledge_sources",
    "knowledge_source_versions",
    "knowledge_source_chunks",
    "knowledge_ingestion_jobs",
    "knowledge_activities",
    "knowledge_activity_draft_sources",
    "knowledge_activity_versions",
    "knowledge_activity_version_sources",
    "knowledge_activity_runs",
    "knowledge_activity_assignments",
    "knowledge_activity_attempts",
    "knowledge_activity_work_sessions",
    "knowledge_submission_artifacts",
    "knowledge_activity_evidence",
    "knowledge_attempt_help_requests",
    "knowledge_activity_run_events",
    "admin_audit_events",
];

#[derive(Debug, Clone)]
pub struct DatabaseConfig {
    pub url: String,
    pub max_connections: u32,
    pub min_connections: u32,
    pub connect_timeout: Duration,
    pub idle_timeout: Duration,
    pub max_lifetime: Duration,
}

impl DatabaseConfig {
    #[must_use]
    pub fn production(url: String) -> Self {
        Self {
            url,
            max_connections: 12,
            min_connections: 1,
            connect_timeout: Duration::from_secs(10),
            idle_timeout: Duration::from_mins(5),
            max_lifetime: Duration::from_mins(30),
        }
    }

    /// Opens the single SeaORM-owned pool using the configured production bounds.
    ///
    /// # Errors
    ///
    /// Returns a database error when the pool cannot be created or connected.
    pub async fn connect(&self) -> Result<DatabaseConnection, DbErr> {
        let mut options = ConnectOptions::new(self.url.clone());
        options
            .max_connections(self.max_connections)
            .min_connections(self.min_connections)
            .connect_timeout(self.connect_timeout)
            .idle_timeout(self.idle_timeout)
            .max_lifetime(self.max_lifetime)
            .sqlx_logging(false);
        Database::connect(options).await
    }
}

/// Confirms that every table required by the current production schema exists.
///
/// # Errors
///
/// Returns a database error when the schema inventory cannot be queried.
pub async fn schema_is_ready(db: &DatabaseConnection) -> Result<bool, DbErr> {
    #[derive(Debug, FromQueryResult)]
    struct SchemaCount {
        present: i64,
    }

    let expected = i64::try_from(TABLES.len())
        .map_err(|error| DbErr::Custom(format!("invalid schema inventory: {error}")))?;
    let table_names = TABLES
        .iter()
        .map(|table| (*table).to_owned())
        .collect::<Vec<_>>();
    let result = SchemaCount::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT COUNT(*)::BIGINT AS present FROM information_schema.tables \
         WHERE table_schema = 'public' AND table_name = ANY($1)",
        [table_names.into()],
    ))
    .one(db)
    .await?;
    Ok(result.is_some_and(|row| row.present == expected))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReservationStatus {
    Reserved,
    Settled,
    Released,
    Uncertain,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReserveOutcome {
    Reserved {
        request_id: Uuid,
    },
    Duplicate {
        request_id: Uuid,
        status: ReservationStatus,
    },
    Denied,
}

pub struct UsageRepository<'db> {
    db: &'db DatabaseConnection,
}

impl std::fmt::Debug for UsageRepository<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("UsageRepository")
            .finish_non_exhaustive()
    }
}

impl<'db> UsageRepository<'db> {
    #[must_use]
    pub const fn new(db: &'db DatabaseConnection) -> Self {
        Self { db }
    }

    /// Runs an operation in a transaction serialized by the user's `PostgreSQL`
    /// advisory lock.
    ///
    /// # Errors
    ///
    /// Returns a database error if the transaction, advisory lock, operation,
    /// commit, or rollback fails.
    pub async fn with_user_lock<T, F>(&self, user_id: &str, operation: F) -> Result<T, DbErr>
    where
        T: Send,
        F: for<'txn> FnOnce(
                &'txn DatabaseTransaction,
            ) -> std::pin::Pin<
                Box<dyn std::future::Future<Output = Result<T, DbErr>> + Send + 'txn>,
            > + Send,
    {
        let transaction = self.db.begin().await?;
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                [user_id.into()],
            ))
            .await?;
        match operation(&transaction).await {
            Ok(value) => {
                transaction.commit().await?;
                Ok(value)
            }
            Err(error) => {
                transaction.rollback().await?;
                Err(error)
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, FromQueryResult)]
pub struct IngestionLease {
    pub id: Uuid,
    pub source_version_id: Uuid,
    pub attempt_count: i32,
}

/// Atomically claims the next available ingestion job with `SKIP LOCKED`.
///
/// # Errors
///
/// Returns a database error when the lease query cannot be completed.
pub async fn claim_ingestion_job(
    db: &DatabaseConnection,
    lease_owner: Uuid,
    lease_seconds: i64,
) -> Result<Option<IngestionLease>, DbErr> {
    IngestionLease::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        r"WITH candidate AS (
             SELECT jobs.id
             FROM knowledge_ingestion_jobs jobs
             WHERE (
               (jobs.state IN ('queued', 'retry') AND jobs.available_at <= NOW())
               OR (jobs.state = 'leased' AND jobs.lease_expires_at <= NOW())
             )
             ORDER BY jobs.available_at, jobs.created_at
             FOR UPDATE SKIP LOCKED
             LIMIT 1
           )
           UPDATE knowledge_ingestion_jobs jobs
           SET state = 'leased',
               lease_owner = $1,
               lease_expires_at = NOW() + make_interval(secs => $2),
               attempt_count = jobs.attempt_count + 1,
               updated_at = NOW()
           FROM candidate
           WHERE jobs.id = candidate.id
           RETURNING jobs.id, jobs.source_version_id, jobs.attempt_count",
        [lease_owner.into(), lease_seconds.into()],
    ))
    .one(db)
    .await
}

#[cfg(test)]
mod tests {
    use super::TABLES;

    #[test]
    fn schema_inventory_has_no_duplicates() {
        let unique = TABLES
            .iter()
            .copied()
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(unique.len(), TABLES.len());
        assert_eq!(TABLES.len(), 31);
    }
}
