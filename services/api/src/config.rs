use std::{collections::BTreeSet, env};

use anyhow::{Context, bail};

const MIN_SECRET_LENGTH: usize = 32;

#[derive(Clone, Debug)]
pub struct Config {
    pub classroom_test_fixture_enabled: bool,
    pub admin: AdminConfig,
    pub connectors: ConnectorConfig,
    pub cost_guard: CostGuardConfig,
    pub database_pool_max: u32,
    pub database_url: String,
    pub eleven_labs_api_key: Option<String>,
    pub eleven_labs_model_id: String,
    pub eleven_labs_voice_id: Option<String>,
    pub google_client_id: String,
    pub knowledge_spaces: KnowledgeConfig,
    pub openai_api_key: String,
    pub openai_models: BTreeSet<String>,
    pub port: u16,
    pub railway_git_commit_sha: String,
    pub session_duration_days: u32,
    pub session_token_hmac_key: String,
}

#[derive(Clone, Debug)]
pub struct ConnectorConfig {
    pub callback_url: Option<String>,
    pub canary_users: BTreeSet<String>,
    pub current_encryption_key_version: u32,
    pub enabled: bool,
    pub encryption_keys: Option<String>,
    pub gmail_client_id: Option<String>,
    pub gmail_client_secret: Option<String>,
    pub max_result_bytes: usize,
    pub max_schema_bytes: usize,
    pub mcp_timeout_ms: u64,
    pub oauth_attempt_ttl_ms: u64,
    pub rollout_percent: u8,
}

#[derive(Clone, Debug)]
pub struct AdminConfig {
    pub access_token: Option<String>,
}

#[derive(Clone, Debug)]
pub struct CostGuardConfig {
    pub daily_micro_usd: i64,
    pub enabled: bool,
    pub mode: CostGuardMode,
    pub monthly_micro_usd: i64,
    pub realtime_call_micro_usd: i64,
    pub reservation_ttl_ms: u64,
    pub speech_micro_usd_per_thousand_characters: i64,
    pub task_micro_usd: i64,
    pub transcription_micro_usd_per_minute: i64,
    pub warning_percent: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CostGuardMode {
    Enforce,
    Observe,
}

#[derive(Clone, Debug)]
pub struct KnowledgeConfig {
    pub object_store: Option<ObjectStoreConfig>,
}

#[derive(Clone, Debug)]
pub struct ObjectStoreConfig {
    pub access_key_id: String,
    pub bucket: String,
    pub endpoint: Option<String>,
    pub force_path_style: bool,
    pub region: String,
    pub secret_access_key: String,
}

trait Environment {
    fn get(&self, key: &str) -> Option<String>;
}

struct ProcessEnvironment;

impl Environment for ProcessEnvironment {
    fn get(&self, key: &str) -> Option<String> {
        env::var(key).ok()
    }
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Self::from_source(&ProcessEnvironment)
    }

    fn from_source(environment: &impl Environment) -> anyhow::Result<Self> {
        let session_token_hmac_key = required(environment, "TROCODE_SESSION_TOKEN_HMAC_KEY")?;
        if session_token_hmac_key.len() < MIN_SECRET_LENGTH {
            bail!(
                "TROCODE_SESSION_TOKEN_HMAC_KEY must be at least {MIN_SECRET_LENGTH} characters."
            );
        }

        let primary_model = optional(environment, "TROCODE_AGENT_MODEL")
            .unwrap_or_else(|| "gpt-5.6-luna".to_owned());
        let knowledge_access_key_id = optional(environment, "TROCODE_KNOWLEDGE_S3_ACCESS_KEY_ID");
        let knowledge_bucket = optional(environment, "TROCODE_KNOWLEDGE_S3_BUCKET");
        let knowledge_endpoint = optional(environment, "TROCODE_KNOWLEDGE_S3_ENDPOINT");
        let knowledge_region = optional(environment, "TROCODE_KNOWLEDGE_S3_REGION");
        let knowledge_secret_access_key =
            optional(environment, "TROCODE_KNOWLEDGE_S3_SECRET_ACCESS_KEY");
        let knowledge_storage_configured = knowledge_access_key_id.is_some()
            || knowledge_bucket.is_some()
            || knowledge_endpoint.is_some()
            || knowledge_region.is_some()
            || knowledge_secret_access_key.is_some();
        let object_store = if knowledge_storage_configured {
            Some(ObjectStoreConfig {
                access_key_id: knowledge_access_key_id
                    .context("TROCODE_KNOWLEDGE_S3_ACCESS_KEY_ID is required.")?,
                bucket: knowledge_bucket.context("TROCODE_KNOWLEDGE_S3_BUCKET is required.")?,
                endpoint: knowledge_endpoint,
                force_path_style: boolean(
                    environment,
                    "TROCODE_KNOWLEDGE_S3_FORCE_PATH_STYLE",
                    false,
                )?,
                region: knowledge_region.context("TROCODE_KNOWLEDGE_S3_REGION is required.")?,
                secret_access_key: knowledge_secret_access_key
                    .context("TROCODE_KNOWLEDGE_S3_SECRET_ACCESS_KEY is required.")?,
            })
        } else {
            None
        };

        let admin_access_token = optional(environment, "TROCODE_ADMIN_ACCESS_TOKEN");
        if admin_access_token
            .as_ref()
            .is_some_and(|token| token.len() < MIN_SECRET_LENGTH)
        {
            bail!("TROCODE_ADMIN_ACCESS_TOKEN must be at least {MIN_SECRET_LENGTH} characters.");
        }

        let mut openai_models = BTreeSet::from([
            primary_model,
            "gpt-5.6-luna".to_owned(),
            "gpt-5.6-terra".to_owned(),
            "gpt-5.6-sol".to_owned(),
        ]);
        openai_models.extend(comma_separated(
            environment,
            "TROCODE_AGENT_MODEL_ALLOWLIST",
        ));

        let cost_mode = match optional(environment, "TROCODE_COST_GUARD_MODE").as_deref() {
            None | Some("enforce") => CostGuardMode::Enforce,
            Some("observe") => CostGuardMode::Observe,
            Some(_) => bail!("TROCODE_COST_GUARD_MODE must be one of: observe, enforce."),
        };

        let warning_percent = positive_u32(environment, "TROCODE_BUDGET_WARNING_PERCENT", 80)?;
        if warning_percent > 100 {
            bail!("TROCODE_BUDGET_WARNING_PERCENT must be at most 100.");
        }

        let connector_enabled = boolean(environment, "TROCODE_CONNECTORS_ENABLED", false)?;
        let connector_canary_users = comma_separated(environment, "TROCODE_CONNECTOR_CANARY_USERS");
        let connector_rollout_percent =
            percentage(environment, "TROCODE_CONNECTOR_ROLLOUT_PERCENT", 0)?;
        let connector_rollout_active = connector_enabled
            && (!connector_canary_users.is_empty() || connector_rollout_percent > 0);
        let connector_callback_url = optional(environment, "TROCODE_CONNECTOR_CALLBACK_URL");
        let connector_encryption_keys =
            optional(environment, "TROCODE_CONNECTOR_TOKEN_ENCRYPTION_KEYS");
        let gmail_connector_client_id = optional(environment, "TROCODE_GMAIL_CONNECTOR_CLIENT_ID");
        let gmail_connector_client_secret =
            optional(environment, "TROCODE_GMAIL_CONNECTOR_CLIENT_SECRET");
        if connector_rollout_active {
            connector_encryption_keys.as_ref().context(
                "TROCODE_CONNECTOR_TOKEN_ENCRYPTION_KEYS is required when connectors are enabled.",
            )?;
            gmail_connector_client_id.as_ref().context(
                "TROCODE_GMAIL_CONNECTOR_CLIENT_ID is required when connectors are enabled.",
            )?;
            gmail_connector_client_secret.as_ref().context(
                "TROCODE_GMAIL_CONNECTOR_CLIENT_SECRET is required when connectors are enabled.",
            )?;
            let callback = connector_callback_url.as_ref().context(
                "TROCODE_CONNECTOR_CALLBACK_URL is required when connectors are enabled.",
            )?;
            let parsed = url::Url::parse(callback)
                .context("TROCODE_CONNECTOR_CALLBACK_URL must be a valid URL.")?;
            if parsed.scheme() != "https"
                || parsed.host_str().is_none()
                || parsed.path() != "/v1/connectors/oauth/callback"
                || parsed.query().is_some()
                || parsed.fragment().is_some()
            {
                bail!(
                    "TROCODE_CONNECTOR_CALLBACK_URL must be a public HTTPS URL with the exact /v1/connectors/oauth/callback path and no query or fragment."
                );
            }
        }
        let connector_max_schema_bytes =
            positive_usize(environment, "TROCODE_CONNECTOR_MAX_SCHEMA_BYTES", 128_000)?;
        if connector_max_schema_bytes > 512_000 {
            bail!("TROCODE_CONNECTOR_MAX_SCHEMA_BYTES must be at most 512000.");
        }
        let connector_max_result_bytes =
            positive_usize(environment, "TROCODE_CONNECTOR_MAX_RESULT_BYTES", 512_000)?;
        if connector_max_result_bytes > 2_000_000 {
            bail!("TROCODE_CONNECTOR_MAX_RESULT_BYTES must be at most 2000000.");
        }

        Ok(Self {
            admin: AdminConfig {
                access_token: admin_access_token,
            },
            connectors: ConnectorConfig {
                callback_url: connector_callback_url,
                canary_users: connector_canary_users,
                current_encryption_key_version: positive_u32(
                    environment,
                    "TROCODE_CONNECTOR_TOKEN_KEY_VERSION",
                    1,
                )?,
                enabled: connector_enabled,
                encryption_keys: connector_encryption_keys,
                gmail_client_id: gmail_connector_client_id,
                gmail_client_secret: gmail_connector_client_secret,
                max_result_bytes: connector_max_result_bytes,
                max_schema_bytes: connector_max_schema_bytes,
                mcp_timeout_ms: positive_u64(
                    environment,
                    "TROCODE_CONNECTOR_MCP_TIMEOUT_MS",
                    30_000,
                )?,
                oauth_attempt_ttl_ms: positive_u64(
                    environment,
                    "TROCODE_CONNECTOR_OAUTH_ATTEMPT_TTL_MS",
                    10 * 60 * 1_000,
                )?,
                rollout_percent: connector_rollout_percent,
            },
            cost_guard: CostGuardConfig {
                daily_micro_usd: positive_i64(
                    environment,
                    "TROCODE_DAILY_BUDGET_MICRO_USD",
                    8_000_000,
                )?,
                enabled: boolean(environment, "TROCODE_PAID_CALLS_ENABLED", true)?,
                mode: cost_mode,
                monthly_micro_usd: positive_i64(
                    environment,
                    "TROCODE_MONTHLY_BUDGET_MICRO_USD",
                    45_000_000,
                )?,
                realtime_call_micro_usd: positive_i64(
                    environment,
                    "TROCODE_REALTIME_CALL_ESTIMATE_MICRO_USD",
                    5_000,
                )?,
                reservation_ttl_ms: positive_u64(
                    environment,
                    "TROCODE_RESERVATION_TTL_MS",
                    120_000,
                )?,
                speech_micro_usd_per_thousand_characters: positive_i64(
                    environment,
                    "TROCODE_SPEECH_MICRO_USD_PER_THOUSAND_CHARACTERS",
                    60_000,
                )?,
                task_micro_usd: positive_i64(
                    environment,
                    "TROCODE_TASK_BUDGET_MICRO_USD",
                    5_000_000,
                )?,
                transcription_micro_usd_per_minute: positive_i64(
                    environment,
                    "TROCODE_TRANSCRIPTION_MICRO_USD_PER_MINUTE",
                    4_500,
                )?,
                warning_percent,
            },
            classroom_test_fixture_enabled: boolean(
                environment,
                "TROCODE_CLASSROOM_TEST_FIXTURE_ENABLED",
                false,
            )?,
            database_pool_max: positive_u32(environment, "TROCODE_DATABASE_POOL_MAX", 10)?,
            database_url: required(environment, "DATABASE_URL")?,
            eleven_labs_api_key: optional(environment, "ELEVENLABS_API_KEY"),
            eleven_labs_model_id: optional(environment, "ELEVENLABS_MODEL_ID")
                .unwrap_or_else(|| "eleven_flash_v2_5".to_owned()),
            eleven_labs_voice_id: optional(environment, "ELEVENLABS_VOICE_ID"),
            google_client_id: required(environment, "GOOGLE_OAUTH_CLIENT_ID")?,
            knowledge_spaces: KnowledgeConfig { object_store },
            openai_api_key: required(environment, "OPENAI_API_KEY")?,
            openai_models,
            port: positive_u16(environment, "PORT", 8080)?,
            railway_git_commit_sha: optional(environment, "RAILWAY_GIT_COMMIT_SHA")
                .unwrap_or_else(|| "local".to_owned()),
            session_duration_days: positive_u32(environment, "TROCODE_SESSION_DURATION_DAYS", 30)?,
            session_token_hmac_key,
        })
    }
}

fn optional(environment: &impl Environment, name: &str) -> Option<String> {
    environment
        .get(name)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn required(environment: &impl Environment, name: &str) -> anyhow::Result<String> {
    optional(environment, name).with_context(|| format!("{name} is required."))
}

fn boolean(environment: &impl Environment, name: &str, fallback: bool) -> anyhow::Result<bool> {
    match optional(environment, name).as_deref() {
        None => Ok(fallback),
        Some("true") => Ok(true),
        Some("false") => Ok(false),
        Some(_) => bail!("{name} must be true or false."),
    }
}

fn parsed<T>(environment: &impl Environment, name: &str, fallback: T) -> anyhow::Result<T>
where
    T: std::str::FromStr + Copy,
{
    optional(environment, name).map_or(Ok(fallback), |value| {
        value
            .parse::<T>()
            .map_err(|_| anyhow::anyhow!("{name} must be a positive integer."))
    })
}

fn positive_u64(environment: &impl Environment, name: &str, fallback: u64) -> anyhow::Result<u64> {
    let value = parsed(environment, name, fallback)?;
    if value == 0 {
        bail!("{name} must be a positive integer.");
    }
    Ok(value)
}

fn positive_u32(environment: &impl Environment, name: &str, fallback: u32) -> anyhow::Result<u32> {
    let value = parsed(environment, name, fallback)?;
    if value == 0 {
        bail!("{name} must be a positive integer.");
    }
    Ok(value)
}

fn positive_u16(environment: &impl Environment, name: &str, fallback: u16) -> anyhow::Result<u16> {
    let value = parsed(environment, name, fallback)?;
    if value == 0 {
        bail!("{name} must be a positive integer.");
    }
    Ok(value)
}

fn positive_usize(
    environment: &impl Environment,
    name: &str,
    fallback: usize,
) -> anyhow::Result<usize> {
    let value = parsed(environment, name, fallback)?;
    if value == 0 {
        bail!("{name} must be a positive integer.");
    }
    Ok(value)
}

fn positive_i64(environment: &impl Environment, name: &str, fallback: i64) -> anyhow::Result<i64> {
    let value = parsed(environment, name, fallback)?;
    if value <= 0 {
        bail!("{name} must be a positive integer.");
    }
    Ok(value)
}

fn percentage(environment: &impl Environment, name: &str, fallback: u8) -> anyhow::Result<u8> {
    let value = parsed(environment, name, fallback)?;
    if value > 100 {
        bail!("{name} must be an integer from 0 to 100.");
    }
    Ok(value)
}

fn comma_separated(environment: &impl Environment, name: &str) -> BTreeSet<String> {
    environment
        .get(name)
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
