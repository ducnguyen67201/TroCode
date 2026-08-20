use std::{env, num::NonZeroU16};

use anyhow::{Context, Result};

#[derive(Clone)]
pub(crate) struct Config {
    pub(crate) admin_access_token: Option<String>,
    pub(crate) access_code_encryption_key: String,
    pub(crate) database_url: String,
    pub(crate) database_pool_max: u32,
    pub(crate) port: NonZeroU16,
    pub(crate) session_hmac_key: String,
    pub(crate) session_duration_days: i64,
    pub(crate) google_client_id: String,
    pub(crate) openai_api_key: String,
    pub(crate) openai_model: String,
    pub(crate) elevenlabs_api_key: Option<String>,
    pub(crate) elevenlabs_voice_id: Option<String>,
    pub(crate) elevenlabs_model_id: String,
    pub(crate) knowledge_enabled: bool,
    pub(crate) knowledge_object_store: Option<KnowledgeObjectStoreConfig>,
    pub(crate) paid_calls_enabled: bool,
    pub(crate) reservation_ttl_ms: i64,
    pub(crate) realtime_call_micro_usd: i64,
    pub(crate) speech_micro_usd_per_thousand_characters: i64,
    pub(crate) transcription_micro_usd_per_minute: i64,
}

#[derive(Clone)]
pub(crate) struct KnowledgeObjectStoreConfig {
    pub(crate) access_key_id: String,
    pub(crate) bucket: String,
    pub(crate) endpoint: Option<String>,
    pub(crate) force_path_style: bool,
    pub(crate) region: String,
    pub(crate) secret_access_key: String,
}

impl Config {
    pub(crate) fn load() -> Result<Self> {
        let session_hmac_key = required("TROCODE_SESSION_TOKEN_HMAC_KEY")?;
        anyhow::ensure!(
            session_hmac_key.len() >= 32,
            "TROCODE_SESSION_TOKEN_HMAC_KEY must be at least 32 characters"
        );
        let admin_access_token = optional("TROCODE_ADMIN_ACCESS_TOKEN");
        if let Some(access_token) = admin_access_token.as_deref() {
            anyhow::ensure!(
                access_token.len() >= 32,
                "TROCODE_ADMIN_ACCESS_TOKEN must be at least 32 characters"
            );
        }
        let access_code_encryption_key = optional("TROCODE_ACCESS_CODE_ENCRYPTION_KEY")
            .unwrap_or_else(|| session_hmac_key.clone());
        anyhow::ensure!(
            access_code_encryption_key.len() >= 32,
            "TROCODE_ACCESS_CODE_ENCRYPTION_KEY must be at least 32 characters"
        );
        let port = optional("PORT")
            .unwrap_or_else(|| String::from("8080"))
            .parse::<NonZeroU16>()
            .context("PORT must be a nonzero 16-bit integer")?;
        let database_pool_max = positive_u32("TROCODE_DATABASE_POOL_MAX", 10)?;
        let session_duration_days = i64::from(positive_u32("TROCODE_SESSION_DURATION_DAYS", 30)?);
        let knowledge_enabled = boolean("TROCODE_KNOWLEDGE_SPACES_ENABLED", false)?;
        let knowledge_object_store = if knowledge_enabled {
            Some(KnowledgeObjectStoreConfig {
                access_key_id: required("TROCODE_KNOWLEDGE_S3_ACCESS_KEY_ID")?,
                bucket: required("TROCODE_KNOWLEDGE_S3_BUCKET")?,
                endpoint: optional("TROCODE_KNOWLEDGE_S3_ENDPOINT"),
                force_path_style: boolean("TROCODE_KNOWLEDGE_S3_FORCE_PATH_STYLE", false)?,
                region: required("TROCODE_KNOWLEDGE_S3_REGION")?,
                secret_access_key: required("TROCODE_KNOWLEDGE_S3_SECRET_ACCESS_KEY")?,
            })
        } else {
            None
        };
        Ok(Self {
            admin_access_token,
            access_code_encryption_key,
            database_url: required("DATABASE_URL")?,
            database_pool_max,
            port,
            session_hmac_key,
            session_duration_days,
            google_client_id: required("GOOGLE_OAUTH_CLIENT_ID")?,
            openai_api_key: required("OPENAI_API_KEY")?,
            openai_model: optional("TROCODE_AGENT_MODEL")
                .unwrap_or_else(|| String::from("gpt-5.6-luna")),
            elevenlabs_api_key: optional("ELEVENLABS_API_KEY"),
            elevenlabs_voice_id: optional("ELEVENLABS_VOICE_ID"),
            elevenlabs_model_id: optional("ELEVENLABS_MODEL_ID")
                .unwrap_or_else(|| String::from("eleven_flash_v2_5")),
            knowledge_enabled,
            knowledge_object_store,
            paid_calls_enabled: boolean("TROCODE_PAID_CALLS_ENABLED", true)?,
            reservation_ttl_ms: i64::from(positive_u32("TROCODE_RESERVATION_TTL_MS", 120_000)?),
            realtime_call_micro_usd: i64::from(positive_u32(
                "TROCODE_REALTIME_CALL_ESTIMATE_MICRO_USD",
                5_000,
            )?),
            speech_micro_usd_per_thousand_characters: i64::from(positive_u32(
                "TROCODE_SPEECH_MICRO_USD_PER_THOUSAND_CHARACTERS",
                60_000,
            )?),
            transcription_micro_usd_per_minute: i64::from(positive_u32(
                "TROCODE_TRANSCRIPTION_MICRO_USD_PER_MINUTE",
                4_500,
            )?),
        })
    }
}

fn required(name: &str) -> Result<String> {
    optional(name).with_context(|| format!("{name} is required"))
}

fn optional(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn positive_u32(name: &str, default: u32) -> Result<u32> {
    match optional(name) {
        Some(value) => {
            let parsed = value
                .parse::<u32>()
                .with_context(|| format!("{name} must be a positive integer"))?;
            anyhow::ensure!(parsed > 0, "{name} must be a positive integer");
            Ok(parsed)
        }
        None => Ok(default),
    }
}

fn boolean(name: &str, default: bool) -> Result<bool> {
    match optional(name).as_deref() {
        Some("true") => Ok(true),
        Some("false") => Ok(false),
        Some(_) => anyhow::bail!("{name} must be true or false"),
        None => Ok(default),
    }
}
