use std::time::Duration;

use anyhow::{Context, Result};
use aws_config::BehaviorVersion;
use aws_sdk_s3::{
    Client as S3Client,
    config::{Credentials, Region},
};
use bytes::Bytes;
use clap::Parser;
use sea_orm::{
    ConnectionTrait, DatabaseConnection, DbBackend, FromQueryResult, Statement, TransactionTrait,
};
use sha2::{Digest, Sha256};
use tokio::signal;
use tokio_util::sync::CancellationToken;
use tracing::{error, info};
use tro_knowledge::{Extractor, KnowledgeError};
use tro_persistence::{DatabaseConfig, IngestionLease, claim_ingestion_job, schema_is_ready};
use uuid::Uuid;

#[derive(Debug, Parser)]
#[command(name = "tro-worker", about = "Tro Knowledge ingestion worker")]
struct Config {
    #[arg(long, env = "DATABASE_URL", hide_env_values = true)]
    database_url: String,
    #[arg(
        long,
        env = "TROCODE_KNOWLEDGE_SPACES_ENABLED",
        default_value_t = false
    )]
    knowledge_enabled: bool,
    #[arg(long, env = "TROCODE_WORKER_POLL_MS", default_value_t = 1_000)]
    poll_ms: u64,
    #[arg(long, env = "TROCODE_WORKER_LEASE_SECONDS", default_value_t = 120)]
    lease_seconds: i64,
    #[arg(
        long,
        env = "TROCODE_WORKER_EXTRACTION_PARALLELISM",
        default_value_t = 2
    )]
    extraction_parallelism: usize,
    #[arg(long, env = "TROCODE_KNOWLEDGE_S3_BUCKET")]
    bucket: Option<String>,
    #[arg(long, env = "TROCODE_KNOWLEDGE_S3_REGION")]
    region: Option<String>,
    #[arg(
        long,
        env = "TROCODE_KNOWLEDGE_S3_ACCESS_KEY_ID",
        hide_env_values = true
    )]
    access_key_id: Option<String>,
    #[arg(
        long,
        env = "TROCODE_KNOWLEDGE_S3_SECRET_ACCESS_KEY",
        hide_env_values = true
    )]
    secret_access_key: Option<String>,
    #[arg(long, env = "TROCODE_KNOWLEDGE_S3_ENDPOINT")]
    endpoint: Option<String>,
    #[arg(
        long,
        env = "TROCODE_KNOWLEDGE_S3_FORCE_PATH_STYLE",
        default_value_t = false
    )]
    force_path_style: bool,
}

#[derive(Debug, FromQueryResult)]
struct SourceRecord {
    id: Uuid,
    object_key: String,
    byte_size: i64,
    media_type: String,
    sha256: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let config = Config::parse();
    let database = DatabaseConfig::production(config.database_url.clone())
        .connect()
        .await
        .context("database connection failed")?;
    if !schema_is_ready(&database)
        .await
        .context("schema check failed")?
    {
        anyhow::bail!("database schema is not ready; run tro-migrate first");
    }
    if !config.knowledge_enabled {
        info!(event = "knowledge.worker.disabled");
        signal::ctrl_c()
            .await
            .context("disabled worker signal listener failed")?;
        info!(event = "knowledge.worker.stopped");
        return Ok(());
    }
    let bucket =
        required_knowledge_setting(config.bucket.as_deref(), "TROCODE_KNOWLEDGE_S3_BUCKET")?;
    let region =
        required_knowledge_setting(config.region.as_deref(), "TROCODE_KNOWLEDGE_S3_REGION")?;
    let access_key_id = required_knowledge_setting(
        config.access_key_id.as_deref(),
        "TROCODE_KNOWLEDGE_S3_ACCESS_KEY_ID",
    )?;
    let secret_access_key = required_knowledge_setting(
        config.secret_access_key.as_deref(),
        "TROCODE_KNOWLEDGE_S3_SECRET_ACCESS_KEY",
    )?;
    let credentials = Credentials::new(access_key_id, secret_access_key, None, None, "tro-worker");
    let mut loader = aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new(region))
        .credentials_provider(credentials);
    if let Some(endpoint) = &config.endpoint {
        loader = loader.endpoint_url(endpoint);
    }
    let shared = loader.load().await;
    let s3_config = aws_sdk_s3::config::Builder::from(&shared)
        .force_path_style(config.force_path_style)
        .build();
    let s3 = S3Client::from_conf(s3_config);
    let extractor = Extractor::new(config.extraction_parallelism);
    let cancellation = CancellationToken::new();
    let signal_token = cancellation.clone();
    tokio::spawn(async move {
        let _ = signal::ctrl_c().await;
        signal_token.cancel();
    });
    let worker_id = Uuid::new_v4();
    info!(event = "knowledge.worker.ready", worker_id = %worker_id);

    while !cancellation.is_cancelled() {
        match claim_ingestion_job(&database, worker_id, config.lease_seconds).await {
            Ok(Some(job)) => {
                if let Err(cause) =
                    process_job(&database, &s3, &bucket, &extractor, worker_id, &job).await
                {
                    let (code, permanent) = classify_error(&cause);
                    reconcile_failure(&database, worker_id, &job, code, permanent).await?;
                    error!(
                        event = "knowledge.ingestion.failed",
                        job_id = %job.id,
                        attempt_count = job.attempt_count,
                        code
                    );
                }
            }
            Ok(None) => {
                tokio::select! {
                    () = cancellation.cancelled() => break,
                    () = tokio::time::sleep(Duration::from_millis(config.poll_ms)) => {}
                }
            }
            Err(cause) => {
                error!(event = "knowledge.worker.poll_failed", code = "database_unavailable", error = %cause);
                tokio::select! {
                    () = cancellation.cancelled() => break,
                    () = tokio::time::sleep(Duration::from_secs(2)) => {}
                }
            }
        }
    }
    info!(event = "knowledge.worker.stopped", worker_id = %worker_id);
    Ok(())
}

fn required_knowledge_setting(value: Option<&str>, name: &str) -> Result<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .with_context(|| format!("{name} is required when Knowledge Spaces are enabled"))
}

#[allow(clippy::too_many_lines)]
async fn process_job(
    database: &DatabaseConnection,
    s3: &S3Client,
    bucket: &str,
    extractor: &Extractor,
    worker_id: Uuid,
    lease: &IngestionLease,
) -> Result<()> {
    let source = SourceRecord::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        r"SELECT versions.id, versions.object_key, versions.byte_size,
                  versions.media_type, versions.sha256
           FROM knowledge_ingestion_jobs jobs
           JOIN knowledge_source_versions versions ON versions.id=jobs.source_version_id
           WHERE jobs.id=$1 AND jobs.lease_owner=$2 AND jobs.state='leased'",
        [lease.id.into(), worker_id.into()],
    ))
    .one(database)
    .await?
    .context("lease was lost before source read")?;
    anyhow::ensure!(
        source.id == lease.source_version_id,
        "source version mismatch"
    );
    let expected_size = usize::try_from(source.byte_size).context("source size is invalid")?;
    anyhow::ensure!(
        expected_size <= tro_knowledge::MAX_SOURCE_BYTES,
        "object_too_large"
    );
    let object = s3
        .get_object()
        .bucket(bucket)
        .key(&source.object_key)
        .checksum_mode(aws_sdk_s3::types::ChecksumMode::Enabled)
        .send()
        .await
        .context("object_get_failed")?;
    let collected = object.body.collect().await.context("object_read_failed")?;
    let bytes = Bytes::copy_from_slice(collected.into_bytes().as_ref());
    anyhow::ensure!(bytes.len() == expected_size, "object_size_mismatch");
    let checksum = format!("{:x}", Sha256::digest(&bytes));
    anyhow::ensure!(checksum == source.sha256, "object_checksum_mismatch");
    let chunks = extractor
        .extract(&source.media_type, bytes)
        .await
        .context("source extraction failed")?;
    let page_count = chunks
        .iter()
        .filter_map(|chunk| {
            chunk
                .locator
                .get("page")
                .and_then(serde_json::Value::as_u64)
        })
        .max()
        .and_then(|value| i32::try_from(value).ok())
        .unwrap_or(1);
    let chunk_count = chunks.len();
    let lease_id = lease.id;

    database
        .transaction::<_, (), sea_orm::DbErr>(|transaction| {
            Box::pin(async move {
                transaction
                    .execute_raw(Statement::from_sql_and_values(
                        DbBackend::Postgres,
                        "DELETE FROM knowledge_source_chunks WHERE source_version_id=$1",
                        [source.id.into()],
                    ))
                    .await?;
                for chunk in &chunks {
                    transaction
                        .execute_raw(Statement::from_sql_and_values(
                            DbBackend::Postgres,
                            "INSERT INTO knowledge_source_chunks \
                             (source_version_id,ordinal,locator,body) VALUES ($1,$2,$3,$4)",
                            [
                                source.id.into(),
                                i32::try_from(chunk.ordinal).unwrap_or(i32::MAX).into(),
                                chunk.locator.clone().into(),
                                chunk.body.clone().into(),
                            ],
                        ))
                        .await?;
                }
                let job = transaction
                    .execute_raw(Statement::from_sql_and_values(
                        DbBackend::Postgres,
                        "UPDATE knowledge_ingestion_jobs SET state='completed',lease_owner=NULL, \
                         lease_expires_at=NULL,error_code=NULL,updated_at=NOW() \
                         WHERE id=$1 AND lease_owner=$2 AND state='leased'",
                        [lease_id.into(), worker_id.into()],
                    ))
                    .await?;
                if job.rows_affected() != 1 {
                    return Err(sea_orm::DbErr::Custom(String::from(
                        "lease lost during commit",
                    )));
                }
                transaction
                    .execute_raw(Statement::from_sql_and_values(
                        DbBackend::Postgres,
                        "UPDATE knowledge_source_versions SET state='ready',parser_version=$2, \
                         page_count=$3,error_code=NULL,ready_at=NOW() WHERE id=$1",
                        [
                            source.id.into(),
                            "knowledge-extractor-v1".into(),
                            page_count.into(),
                        ],
                    ))
                    .await?;
                Ok(())
            })
        })
        .await?;
    info!(
        event = "knowledge.ingestion.completed",
        job_id = %lease.id,
        chunks = chunk_count,
        page_count
    );
    Ok(())
}

async fn reconcile_failure(
    database: &DatabaseConnection,
    worker_id: Uuid,
    lease: &IngestionLease,
    code: &'static str,
    permanent: bool,
) -> Result<()> {
    let failed = permanent || lease.attempt_count >= 12;
    let state = if failed { "failed" } else { "retry" };
    let delay_seconds = i64::from(lease.attempt_count.clamp(1, 8)).saturating_mul(5);
    let transaction = database.begin().await?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE knowledge_ingestion_jobs SET state=$3,lease_owner=NULL,lease_expires_at=NULL, \
             available_at=NOW()+make_interval(secs=>$4),error_code=$5,updated_at=NOW() \
             WHERE id=$1 AND lease_owner=$2 AND state='leased'",
            [
                lease.id.into(),
                worker_id.into(),
                state.into(),
                delay_seconds.into(),
                code.into(),
            ],
        ))
        .await?;
    if failed {
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "UPDATE knowledge_source_versions SET state='failed',error_code=$2 WHERE id=$1",
                [lease.source_version_id.into(), code.into()],
            ))
            .await?;
    }
    transaction.commit().await?;
    Ok(())
}

fn classify_error(error: &anyhow::Error) -> (&'static str, bool) {
    if let Some(knowledge) = error.downcast_ref::<KnowledgeError>() {
        return match knowledge {
            KnowledgeError::SourceTooLarge => ("object_too_large", true),
            KnowledgeError::ChecksumMismatch => ("object_checksum_mismatch", true),
            KnowledgeError::UnsupportedMediaType => ("unsupported_media_type", true),
            KnowledgeError::EncryptedPdf => ("encrypted_pdf_unsupported", true),
            KnowledgeError::ScannedPdf => ("scanned_pdf_unsupported", true),
            KnowledgeError::PdfLimit => ("pdf_limit", true),
            KnowledgeError::ExtractionFailed => ("extraction_failed", true),
            KnowledgeError::ObjectUncertain => ("object_unavailable", false),
        };
    }
    let message = error.to_string();
    for (needle, code, permanent) in [
        ("object_too_large", "object_too_large", true),
        ("object_size_mismatch", "object_size_mismatch", true),
        ("object_checksum_mismatch", "object_checksum_mismatch", true),
        ("lease lost", "lease_lost", false),
    ] {
        if message.contains(needle) {
            return (code, permanent);
        }
    }
    ("ingestion_failed", false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enabled_worker_requires_nonempty_knowledge_settings() {
        assert_eq!(
            required_knowledge_setting(Some(" bucket "), "BUCKET")
                .ok()
                .as_deref(),
            Some("bucket")
        );
        assert!(required_knowledge_setting(None, "BUCKET").is_err());
        assert!(required_knowledge_setting(Some("  "), "BUCKET").is_err());
    }
}
