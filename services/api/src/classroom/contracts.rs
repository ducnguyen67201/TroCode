use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::ApiError;

pub const MAX_ROOM_USES: u32 = 2_000;
pub const MAX_DIRECTIVE_CHARACTERS: usize = 4_000;
pub const MAX_CRITERIA: usize = 40;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateRoomCodeRequest {
    pub client_id: Uuid,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub expires_at: Option<OffsetDateTime>,
    #[serde(default = "default_room_uses")]
    pub max_uses: u32,
}

impl CreateRoomCodeRequest {
    pub fn validate(&self) -> Result<(), ApiError> {
        if !(1..=MAX_ROOM_USES).contains(&self.max_uses) {
            return Err(invalid_request());
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JoinRoomRequest {
    pub client_id: Uuid,
    pub code: String,
}

impl JoinRoomRequest {
    pub fn validate(&mut self) -> Result<(), ApiError> {
        self.code = self.code.trim().to_owned();
        if !(8..=32).contains(&utf16_len(&self.code)) {
            return Err(invalid_request());
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutationRequest {
    pub client_id: Uuid,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewAction {
    Complete,
    Return,
}

impl ReviewAction {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Return => "return",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewAttemptRequest {
    pub client_id: Uuid,
    pub action: ReviewAction,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DirectiveInput {
    Exercise {
        instruction: String,
        #[serde(rename = "criterionIds", default)]
        criterion_ids: Vec<String>,
    },
    OpenUrl {
        instruction: String,
        #[serde(rename = "criterionIds", default)]
        criterion_ids: Vec<String>,
        url: String,
    },
    ExplainAssignment {
        instruction: String,
        #[serde(rename = "criterionIds", default)]
        criterion_ids: Vec<String>,
    },
}

impl DirectiveInput {
    pub fn validate(&mut self) -> Result<(), ApiError> {
        let (instruction, criterion_ids) = match self {
            Self::Exercise {
                instruction,
                criterion_ids,
            }
            | Self::OpenUrl {
                instruction,
                criterion_ids,
                ..
            }
            | Self::ExplainAssignment {
                instruction,
                criterion_ids,
            } => (instruction, criterion_ids),
        };
        *instruction = instruction.trim().to_owned();
        if instruction.is_empty()
            || utf16_len(instruction) > MAX_DIRECTIVE_CHARACTERS
            || criterion_ids.len() > MAX_CRITERIA
        {
            return Err(invalid_request());
        }
        for criterion_id in criterion_ids {
            *criterion_id = criterion_id.trim().to_owned();
            if criterion_id.is_empty() || utf16_len(criterion_id) > 80 {
                return Err(invalid_request());
            }
        }
        if let Self::OpenUrl { url, .. } = self {
            *url = url.trim().to_owned();
            if utf16_len(url) > 2_000 {
                return Err(invalid_request());
            }
        }
        Ok(())
    }

    pub const fn kind(&self) -> &'static str {
        match self {
            Self::Exercise { .. } => "exercise",
            Self::OpenUrl { .. } => "open_url",
            Self::ExplainAssignment { .. } => "explain_assignment",
        }
    }

    pub fn criterion_ids(&self) -> &[String] {
        match self {
            Self::Exercise { criterion_ids, .. }
            | Self::OpenUrl { criterion_ids, .. }
            | Self::ExplainAssignment { criterion_ids, .. } => criterion_ids,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateDirectiveRequest {
    pub client_id: Uuid,
    pub directive: DirectiveInput,
}

impl CreateDirectiveRequest {
    pub fn validate(&mut self) -> Result<(), ApiError> {
        self.directive.validate()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomCodeResponse {
    pub id: Uuid,
    pub code: String,
    pub max_uses: i32,
    pub used_count: i32,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub revoked_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub newly_created: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomRevocationResponse {
    pub revoked: bool,
    #[serde(with = "time::serde::rfc3339::option")]
    pub revoked_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassroomDirective {
    pub id: Uuid,
    pub sequence: u64,
    pub kind: String,
    pub delivery: String,
    pub instruction: String,
    pub criterion_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub newly_created: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassroomSession {
    pub attempt_id: Uuid,
    pub attempt_state: String,
    pub run: SessionRun,
    pub space: SessionSpace,
    pub activity_version_id: Uuid,
    pub activity: SessionActivity,
    pub current_directive: Option<ClassroomDirective>,
    #[serde(with = "time::serde::rfc3339")]
    pub joined_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub left_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionRun {
    pub id: Uuid,
    pub state: String,
    pub mode: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionSpace {
    pub id: Uuid,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionActivity {
    pub title: String,
    pub objective: String,
    pub launch_target: String,
    pub requires_submission: bool,
}

#[derive(Debug, Serialize)]
pub struct CurrentSessionResponse {
    pub session: Option<ClassroomSession>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaveSessionResponse {
    pub attempt_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub left_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectiveListResponse {
    pub attempt_state: String,
    pub run_state: String,
    pub items: Vec<ClassroomDirective>,
    pub max_sequence: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", untagged)]
pub enum DirectiveClaimResponse {
    Ignored {
        execute: bool,
    },
    Execute {
        execute: bool,
        kind: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        url: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        origin: Option<String>,
        #[serde(with = "time::serde::rfc3339")]
        claimed_at: OffsetDateTime,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptTransitionResponse {
    pub attempt_id: Uuid,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        with = "time::serde::rfc3339::option"
    )]
    pub ready_at: Option<OffsetDateTime>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        with = "time::serde::rfc3339::option"
    )]
    pub reviewed_at: Option<OffsetDateTime>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub newly_created: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved: Option<bool>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        with = "time::serde::rfc3339::option"
    )]
    pub resolved_at: Option<OffsetDateTime>,
}

#[derive(Debug, Serialize)]
pub struct HelpResponse {
    pub requested: bool,
    pub state: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStateResponse {
    pub id: Uuid,
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardParticipant {
    #[serde(with = "time::serde::rfc3339::option")]
    pub started_at: Option<OffsetDateTime>,
    pub last_check: Option<Value>,
    pub id: String,
    pub attempt_id: Uuid,
    pub state: String,
    pub status: String,
    #[serde(with = "time::serde::rfc3339::option")]
    pub joined_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub left_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    pub session_count: i32,
    pub evidence_count: i32,
    #[serde(with = "time::serde::rfc3339::option")]
    pub help_requested_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionEvidence {
    pub criterion_id: String,
    pub participant_count: i32,
    pub corroborated_count: i32,
    pub agent_candidate_count: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardEvent {
    pub sequence: u64,
    pub attempt_id: Option<Uuid>,
    #[serde(rename = "type")]
    pub event_type: String,
    pub payload: Value,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SupportSuggestion {
    IndividualFollowUp {
        #[serde(rename = "participantId")]
        participant_id: String,
        reason: &'static str,
    },
    GroupClarification {
        #[serde(rename = "criterionId")]
        criterion_id: String,
        #[serde(rename = "participantCount")]
        participant_count: i32,
        #[serde(rename = "activeParticipants")]
        active_participants: usize,
        confidence: &'static str,
    },
    ReviewEvidence {
        #[serde(rename = "criterionId")]
        criterion_id: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardResponse {
    pub kind: &'static str,
    pub max_sequence: u64,
    pub run_state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub participants: Option<Vec<DashboardParticipant>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<Vec<DashboardEvent>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub counts: Option<BTreeMap<String, usize>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub help_queue: Option<Vec<DashboardParticipant>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub criterion_evidence: Option<Vec<CriterionEvidence>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patterns: Option<Vec<CriterionEvidence>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestions: Option<Vec<SupportSuggestion>>,
}

const fn default_room_uses() -> u32 {
    200
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

pub const fn invalid_request() -> ApiError {
    ApiError::bad_request("invalid_request", "Request data is invalid.")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{CreateDirectiveRequest, DirectiveInput};

    #[test]
    fn directive_variants_reject_unknown_fields() {
        let input = json!({
            "clientId": "00000000-0000-4000-8000-000000000001",
            "directive": {
                "kind": "exercise",
                "instruction": "Practice loops.",
                "criterionIds": [],
                "untrustedAuthority": true
            }
        });
        assert!(serde_json::from_value::<CreateDirectiveRequest>(input).is_err());
    }

    #[test]
    fn directive_limits_count_text_like_the_typescript_contract() {
        let mut directive = DirectiveInput::Exercise {
            instruction: "ế".repeat(4_000),
            criterion_ids: vec![],
        };
        assert!(directive.validate().is_ok());

        let mut too_long = DirectiveInput::Exercise {
            instruction: "ế".repeat(4_001),
            criterion_ids: vec![],
        };
        assert!(too_long.validate().is_err());
    }
}
