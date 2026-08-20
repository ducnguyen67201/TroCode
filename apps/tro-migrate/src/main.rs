use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use sea_orm::{ConnectionTrait, DbBackend, Statement, TransactionTrait};
use sea_orm_migration::MigratorTrait;
use tracing::info;
use tro_migration::Migrator;
use tro_persistence::DatabaseConfig;

#[derive(Debug, Parser)]
#[command(name = "tro-migrate", about = "Run Tro's singleton schema migrations")]
struct Cli {
    #[arg(long, env = "DATABASE_URL", hide_env_values = true)]
    database_url: String,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Clone, Copy, Subcommand)]
enum Command {
    Up,
    Status,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let cli = Cli::parse();
    let database = DatabaseConfig::production(cli.database_url)
        .connect()
        .await
        .context("database connection failed")?;

    match cli.command.unwrap_or(Command::Up) {
        Command::Up => {
            let transaction = database
                .begin()
                .await
                .context("migration transaction failed")?;
            transaction
                .execute_raw(Statement::from_string(
                    DbBackend::Postgres,
                    "SELECT pg_advisory_xact_lock(hashtextextended('tro_schema_migrations', 0))",
                ))
                .await
                .context("migration lock failed")?;
            Migrator::up(&transaction, None)
                .await
                .context("migration failed")?;
            transaction
                .commit()
                .await
                .context("migration commit failed")?;
            info!(event = "migration.completed");
        }
        Command::Status => {
            let migrations = Migrator::get_migration_with_status(&database)
                .await
                .context("migration status failed")?;
            for migration in migrations {
                info!(
                    event = "migration.status",
                    migration = migration.name(),
                    status = ?migration.status()
                );
            }
        }
    }
    Ok(())
}
