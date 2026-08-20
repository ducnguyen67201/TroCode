#![allow(clippy::print_stdout)]

use std::path::{Path, PathBuf};

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, Payload},
};
use anyhow::{Context, Result};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use clap::{Parser, Subcommand, ValueEnum};
use ed25519_dalek::{
    Signer, SigningKey,
    pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey},
};
use hmac::{Hmac, Mac};
use rand::Rng;
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use sea_orm_migration::MigratorTrait;
use serde::Serialize;
use sha2::Sha256;
use tro_persistence::DatabaseConfig;
use uuid::Uuid;

#[derive(Debug, Parser)]
#[command(name = "tro-admin", about = "Tro operational administration")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    AccessCode {
        #[command(subcommand)]
        command: AccessCodeCommand,
    },
    Membership {
        #[command(subcommand)]
        command: MembershipCommand,
    },
    Contract {
        #[command(subcommand)]
        command: ContractCommand,
    },
    Load {
        #[arg(long)]
        base_url: String,
        #[arg(long, default_value_t = 10)]
        requests: u32,
    },
}

#[derive(Debug, Subcommand)]
enum AccessCodeCommand {
    Create {
        #[arg(long, env = "DATABASE_URL", hide_env_values = true)]
        database_url: String,
        #[arg(long, env = "TROCODE_SESSION_TOKEN_HMAC_KEY", hide_env_values = true)]
        hmac_key: String,
        #[arg(
            long,
            env = "TROCODE_ACCESS_CODE_ENCRYPTION_KEY",
            hide_env_values = true
        )]
        encryption_key: Option<String>,
        #[arg(long, default_value_t = 1)]
        max_users: i32,
        #[arg(long, value_enum, default_value_t = Plan::Free)]
        plan: Plan,
        #[arg(long)]
        label: Option<String>,
        #[arg(long)]
        code: Option<String>,
    },
}

#[derive(Debug, Subcommand)]
enum MembershipCommand {
    Keygen {
        #[arg(long)]
        private_key: PathBuf,
        #[arg(long)]
        public_key: Option<PathBuf>,
    },
    Issue {
        #[arg(long)]
        private_key: PathBuf,
        #[arg(long)]
        reference: String,
        #[arg(long, value_parser = clap::value_parser!(u16).range(1..=3650))]
        days: u16,
        #[arg(long)]
        now: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum Plan {
    Free,
    Basic,
    Pro,
    Max,
}

impl Plan {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Free => "free",
            Self::Basic => "basic",
            Self::Pro => "pro",
            Self::Max => "max",
        }
    }
}

#[derive(Debug, Subcommand)]
enum ContractCommand {
    Compare {
        #[arg(long)]
        node_url: String,
        #[arg(long)]
        rust_url: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccessCodeOutput {
    id: Uuid,
    code: String,
    plan: &'static str,
    max_users: i32,
}

#[tokio::main]
async fn main() -> Result<()> {
    match Cli::parse().command {
        Command::AccessCode { command } => create_access_code(command).await,
        Command::Membership { command } => membership(command),
        Command::Contract { command } => compare_contract(command).await,
        Command::Load { base_url, requests } => safe_load(&base_url, requests).await,
    }
}

async fn create_access_code(command: AccessCodeCommand) -> Result<()> {
    let AccessCodeCommand::Create {
        database_url,
        hmac_key,
        encryption_key,
        max_users,
        plan,
        label,
        code,
    } = command;
    anyhow::ensure!(max_users > 0, "max-users must be positive");
    anyhow::ensure!(
        hmac_key.len() >= 32,
        "HMAC key must have at least 32 characters"
    );
    let encryption_key = encryption_key.unwrap_or_else(|| hmac_key.clone());
    anyhow::ensure!(
        encryption_key.len() >= 32,
        "encryption key must have at least 32 characters"
    );
    let database = DatabaseConfig::production(database_url)
        .connect()
        .await
        .context("database connection failed")?;
    tro_migration::Migrator::up(&database, None)
        .await
        .context("database migration failed")?;
    let code = if let Some(value) = code {
        normalize_access_code(&value)
            .context("access code must contain 4-64 letters, numbers, hyphens, or underscores")?
    } else {
        let random: [u8; 24] = rand::rng().random();
        format!(
            "TRO-{}",
            URL_SAFE_NO_PAD.encode(random).to_ascii_uppercase()
        )
    };
    if let Some(label) = label.as_deref() {
        anyhow::ensure!(
            !label.trim().is_empty() && label.chars().count() <= 100,
            "label must contain 1-100 characters"
        );
    }
    let mut mac =
        <Hmac<Sha256> as Mac>::new_from_slice(hmac_key.as_bytes()).context("invalid HMAC key")?;
    mac.update(b"trocode-access-code-v1\0");
    mac.update(code.to_ascii_uppercase().as_bytes());
    let digest = mac.finalize().into_bytes().to_vec();
    let ciphertext = seal_access_code(&code, encryption_key.as_bytes(), &digest)?;
    let row = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO access_codes (code_digest, code_ciphertext, label, max_users, plan) \
             VALUES ($1, $2, $3, $4, $5) RETURNING id",
            [
                digest.into(),
                ciphertext.into(),
                label.into(),
                max_users.into(),
                plan.as_str().into(),
            ],
        ))
        .await
        .context("access code insert failed")?
        .context("access code insert returned no row")?;
    let id: Uuid = row.try_get("", "id").context("invalid access code id")?;
    let output = AccessCodeOutput {
        id,
        code,
        plan: plan.as_str(),
        max_users,
    };
    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}

fn seal_access_code(code: &str, secret: &[u8], digest: &[u8]) -> Result<Vec<u8>> {
    anyhow::ensure!(digest.len() == 32, "access code digest must be 32 bytes");
    let mut key_mac =
        <Hmac<Sha256> as Mac>::new_from_slice(secret).context("invalid encryption key")?;
    key_mac.update(b"trocode-access-code-encryption-v1\0");
    let key: [u8; 32] = key_mac.finalize().into_bytes().into();
    let cipher = Aes256Gcm::new_from_slice(&key).context("invalid encryption key")?;
    let nonce_bytes: [u8; 12] = rand::rng().random();
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: code.as_bytes(),
                aad: digest,
            },
        )
        .map_err(|_| anyhow::anyhow!("access code encryption failed"))?;
    let tag_start = encrypted
        .len()
        .checked_sub(16)
        .context("access code encryption failed")?;
    let mut sealed = Vec::with_capacity(1 + 12 + encrypted.len());
    sealed.push(1);
    sealed.extend_from_slice(&nonce_bytes);
    sealed.extend_from_slice(&encrypted[tag_start..]);
    sealed.extend_from_slice(&encrypted[..tag_start]);
    Ok(sealed)
}

fn normalize_access_code(value: &str) -> Option<String> {
    let value = value.trim().to_ascii_uppercase();
    let mut characters = value.chars();
    let first = characters.next()?;
    ((4..=64).contains(&value.len())
        && first.is_ascii_alphanumeric()
        && characters
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_')))
    .then_some(value)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MembershipPayload {
    expires_at: String,
    issued_at: String,
    reference_code: String,
    version: u8,
}

fn membership(command: MembershipCommand) -> Result<()> {
    match command {
        MembershipCommand::Keygen {
            private_key,
            public_key,
        } => membership_keygen(&private_key, public_key.as_deref()),
        MembershipCommand::Issue {
            private_key,
            reference,
            days,
            now,
        } => membership_issue(&private_key, &reference, days, now.as_deref()),
    }
}

fn membership_keygen(private_path: &Path, public_path: Option<&Path>) -> Result<()> {
    let secret: [u8; 32] = rand::rng().random();
    let key = SigningKey::from_bytes(&secret);
    let private_der = key.to_pkcs8_der().context("private key encoding failed")?;
    let private_pem = pem("PRIVATE KEY", private_der.as_bytes());
    write_new(private_path, private_pem.as_bytes(), true).context("private key creation failed")?;
    let public_der = key
        .verifying_key()
        .to_public_key_der()
        .context("public key encoding failed")?;
    let public_base64 = STANDARD.encode(public_der.as_bytes());
    if let Some(path) = public_path {
        write_new(path, format!("{public_base64}\n").as_bytes(), false)
            .context("public key creation failed")?;
    }
    println!("TROCODE_MEMBERSHIP_PUBLIC_KEY={public_base64}");
    Ok(())
}

fn membership_issue(
    private_path: &Path,
    reference: &str,
    days: u16,
    now: Option<&str>,
) -> Result<()> {
    let reference_code = reference.trim().to_ascii_uppercase();
    anyhow::ensure!(
        valid_reference(&reference_code),
        "reference code must look like TRC-AAAA-BBBB-CCCC"
    );
    let issued_at = match now {
        Some(value) => {
            time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
                .context("now must be an RFC 3339 timestamp")?
        }
        None => time::OffsetDateTime::now_utc(),
    };
    let expires_at = issued_at
        .checked_add(time::Duration::days(i64::from(days)))
        .context("membership expiry overflow")?;
    let payload = MembershipPayload {
        expires_at: expires_at.format(&time::format_description::well_known::Rfc3339)?,
        issued_at: issued_at.format(&time::format_description::well_known::Rfc3339)?,
        reference_code,
        version: 1,
    };
    let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload)?);
    let pem = std::fs::read_to_string(private_path).context("private key read failed")?;
    let der = decode_pem(&pem, "PRIVATE KEY")?;
    let key = SigningKey::from_pkcs8_der(&der).context("private key is not Ed25519 PKCS#8")?;
    let signature = key.sign(encoded.as_bytes());
    println!("{encoded}.{}", URL_SAFE_NO_PAD.encode(signature.to_bytes()));
    Ok(())
}

fn valid_reference(value: &str) -> bool {
    let segments = value.split('-').collect::<Vec<_>>();
    segments.len() == 4
        && segments[0] == "TRC"
        && segments[1..].iter().all(|segment| {
            segment.len() == 4
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
        })
}

fn pem(label: &str, der: &[u8]) -> String {
    let encoded = STANDARD.encode(der);
    let body = encoded
        .as_bytes()
        .chunks(64)
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n");
    format!("-----BEGIN {label}-----\n{body}\n-----END {label}-----\n")
}

fn decode_pem(value: &str, label: &str) -> Result<Vec<u8>> {
    let begin = format!("-----BEGIN {label}-----");
    let end = format!("-----END {label}-----");
    let body = value
        .trim()
        .strip_prefix(&begin)
        .and_then(|value| value.strip_suffix(&end))
        .context("private key PEM envelope is invalid")?;
    STANDARD
        .decode(body.lines().map(str::trim).collect::<String>())
        .context("private key PEM body is invalid")
}

fn write_new(path: &Path, bytes: &[u8], private: bool) -> Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(if private { 0o600 } else { 0o644 });
    }
    let mut file = options.open(path)?;
    std::io::Write::write_all(&mut file, bytes)?;
    std::io::Write::flush(&mut file)?;
    Ok(())
}

async fn compare_contract(command: ContractCommand) -> Result<()> {
    let ContractCommand::Compare { node_url, rust_url } = command;
    let http = reqwest::Client::new();
    for path in ["/healthz", "/readyz", "/v1/capabilities"] {
        let left = http
            .get(format!("{}{path}", node_url.trim_end_matches('/')))
            .send()
            .await?;
        let right = http
            .get(format!("{}{path}", rust_url.trim_end_matches('/')))
            .send()
            .await?;
        anyhow::ensure!(
            left.status() == right.status(),
            "status mismatch for {path}"
        );
        let left_body = left.bytes().await?;
        let right_body = right.bytes().await?;
        let left_body = normalized_contract_body(path, &left_body)?;
        let right_body = normalized_contract_body(path, &right_body)?;
        anyhow::ensure!(left_body == right_body, "body mismatch for {path}");
    }
    println!("contract comparison passed");
    Ok(())
}

fn normalized_contract_body(path: &str, body: &[u8]) -> Result<serde_json::Value> {
    let mut value: serde_json::Value = serde_json::from_slice(body)
        .with_context(|| format!("invalid JSON response for {path}"))?;
    if path == "/healthz" {
        let version = value
            .get("version")
            .and_then(serde_json::Value::as_str)
            .context("health response has no version")?;
        anyhow::ensure!(!version.trim().is_empty(), "health version is empty");
        if let serde_json::Value::Object(fields) = &mut value {
            fields.remove("version");
        }
    }
    Ok(value)
}

async fn safe_load(base_url: &str, requests: u32) -> Result<()> {
    anyhow::ensure!(
        (1..=1_000).contains(&requests),
        "requests must be between 1 and 1000"
    );
    let http = reqwest::Client::new();
    for _ in 0..requests {
        let response = http
            .get(format!("{}/healthz", base_url.trim_end_matches('/')))
            .send()
            .await?;
        anyhow::ensure!(response.status().is_success(), "health request failed");
    }
    println!("safe load completed: {requests} requests");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_comparison_is_semantic_and_ignores_health_build_identity() {
        let left = normalized_contract_body("/healthz", br#"{"status":"ok","version":"node-sha"}"#);
        let right =
            normalized_contract_body("/healthz", br#"{"version":"rust-sha","status":"ok"}"#);
        assert_eq!(left.ok(), right.ok());
        assert!(normalized_contract_body("/healthz", br#"{"status":"ok","version":""}"#).is_err());
    }
}
