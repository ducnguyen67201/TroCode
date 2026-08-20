//! Bounded types shared by Tro's hosted and desktop Rust runtimes.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

pub const API_CONTRACT_VERSION: u16 = 2;
pub const TASK_CONTRACT_VERSION: u8 = 6;
pub const MAX_JSON_BODY_BYTES: usize = 1_000_000;
pub const MAX_ERROR_MESSAGE_CHARS: usize = 240;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicErrorBody {
    pub error: PublicErrorDetail,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicErrorDetail {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UsageBudgetSnapshot {
    pub plan: String,
    pub catalog_version: String,
    pub daily_micro_usd_limit: i64,
    pub daily_micro_usd_used: i64,
    pub monthly_micro_usd_limit: i64,
    pub monthly_micro_usd_used: i64,
    pub provider_calls_per_task: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentTurnRequest {
    pub request_id: Uuid,
    pub task_id: Uuid,
    pub turn_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentTurnResponse {
    pub agent_turn_id: Uuid,
    pub created: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleExchangeRequest {
    pub id_token: String,
    pub nonce: String,
    pub device_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceSessionResponse {
    pub token: String,
    pub expires_at: String,
    pub user: PublicUser,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicUser {
    pub id: String,
    pub email: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateKnowledgeSpaceRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeSpaceSummary {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub role: KnowledgeRole,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeRole {
    Owner,
    Instructor,
    Participant,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopCommand {
    pub command: String,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ContractError {
    #[error("value is empty")]
    Empty,
    #[error("value exceeds {max} characters")]
    TooLong { max: usize },
    #[error("value is outside the accepted range")]
    OutOfRange,
}

/// Trims a boundary string and enforces a non-empty maximum character count.
///
/// # Errors
///
/// Returns [`ContractError::Empty`] when the trimmed value is empty and
/// [`ContractError::TooLong`] when it contains more than `max` characters.
pub fn bounded_trimmed(value: &str, max: usize) -> Result<String, ContractError> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(ContractError::Empty);
    }
    if normalized.chars().count() > max {
        return Err(ContractError::TooLong { max });
    }
    Ok(normalized.to_owned())
}

#[cfg(test)]
mod tests {
    use super::{ContractError, HealthResponse, bounded_trimmed};

    #[test]
    fn health_fixture_serializes_exactly() {
        let value = serde_json::to_value(HealthResponse {
            status: String::from("ok"),
            version: String::from("local"),
        });
        assert_eq!(
            value.ok(),
            Some(serde_json::json!({ "status": "ok", "version": "local" }))
        );
    }

    #[test]
    fn bounded_text_is_trimmed_and_rejected() {
        assert_eq!(bounded_trimmed("  Tro  ", 3), Ok(String::from("Tro")));
        assert_eq!(bounded_trimmed("   ", 3), Err(ContractError::Empty));
        assert_eq!(
            bounded_trimmed("four", 3),
            Err(ContractError::TooLong { max: 3 })
        );
    }
}
