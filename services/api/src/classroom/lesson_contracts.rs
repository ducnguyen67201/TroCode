use super::invalid_request;
use crate::error::ApiError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum LessonResource {
    Assignment {
        id: Uuid,
        title: String,
    },
    SourceText {
        id: Uuid,
        title: String,
        #[serde(rename = "sourceVersionId")]
        source_version_id: Uuid,
    },
    Web {
        id: Uuid,
        title: String,
        url: String,
        origin: String,
    },
}
impl LessonResource {
    pub fn id(&self) -> Uuid {
        match self {
            Self::Assignment { id, .. } | Self::SourceText { id, .. } | Self::Web { id, .. } => *id,
        }
    }
    pub fn title(&self) -> &str {
        match self {
            Self::Assignment { title, .. }
            | Self::SourceText { title, .. }
            | Self::Web { title, .. } => title,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LessonExample {
    pub example_description: String,
    pub expected_result: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LessonStep {
    pub id: Uuid,
    pub mode: String,
    pub objective: String,
    pub instruction: String,
    pub resource_id: Uuid,
    pub criterion_ids: Vec<String>,
    #[serde(deserialize_with = "required_option")]
    pub demonstration: Option<LessonExample>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LessonPlan {
    pub schema_version: u32,
    pub target_run_id: Uuid,
    pub activity_version_id: Uuid,
    pub title: String,
    pub objective: String,
    pub language: String,
    pub resources: Vec<LessonResource>,
    pub steps: Vec<LessonStep>,
}
fn bounded(s: &str, n: usize) -> bool {
    !s.trim().is_empty() && s.trim() == s && s.encode_utf16().count() <= n
}
impl LessonPlan {
    pub fn validate(&self) -> Result<(), ApiError> {
        if self.schema_version != 1
            || !matches!(self.language.as_str(), "en" | "vi")
            || !bounded(&self.title, 240)
            || !bounded(&self.objective, 4000)
            || !(1..=8).contains(&self.resources.len())
            || !(1..=8).contains(&self.steps.len())
            || serde_json::to_vec(self).map_err(ApiError::internal)?.len() > 65536
        {
            return Err(invalid_request());
        }
        let mut ids = std::collections::HashSet::new();
        for r in &self.resources {
            if !ids.insert(r.id()) || !bounded(r.title(), 240) {
                return Err(invalid_request());
            }
            if let LessonResource::Web { url, origin, .. } = r {
                let u = super::policy::public_https_url(url).ok_or_else(invalid_request)?;
                if url.encode_utf16().count() > 2000
                    || origin.len() > 2000
                    || u.origin().ascii_serialization() != *origin
                {
                    return Err(invalid_request());
                }
            }
        }
        ids.clear();
        for s in &self.steps {
            let resource = self
                .resources
                .iter()
                .find(|r| r.id() == s.resource_id)
                .ok_or_else(invalid_request)?;
            if !ids.insert(s.id)
                || !matches!(
                    s.mode.as_str(),
                    "explain" | "demonstrate" | "practice" | "check"
                )
                || !bounded(&s.instruction, 4000)
                || !bounded(&s.objective, 4000)
                || (s.mode == "demonstrate") != s.demonstration.is_some()
                || s.criterion_ids.len() > 40
                || s.criterion_ids.iter().any(|id| !bounded(id, 120))
                || s.criterion_ids
                    .iter()
                    .collect::<std::collections::HashSet<_>>()
                    .len()
                    != s.criterion_ids.len()
            {
                return Err(invalid_request());
            }
            if let Some(example) = &s.demonstration
                && (!matches!(resource, LessonResource::Web { .. })
                    || !bounded(&example.example_description, 4000)
                    || !bounded(&example.expected_result, 4000))
            {
                return Err(invalid_request());
            }
        }
        Ok(())
    }
    pub fn value(&self) -> Result<Value, ApiError> {
        serde_json::to_value(self).map_err(ApiError::internal)
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LessonCommit {
    pub client_id: Uuid,
    pub plan: LessonPlan,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LessonStart {
    pub client_start_id: Uuid,
    pub client_instance_id: Uuid,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LessonStepStart {
    pub task_id: Uuid,
    pub attempt_number: i64,
    pub purpose: String,
    pub client_instance_id: Uuid,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LessonReport {
    #[serde(default)]
    pub criterion_outcomes: Vec<LessonCriterionOutcome>,
    pub report_id: Uuid,
    pub revision: i64,
    #[serde(deserialize_with = "required_option")]
    pub step_id: Option<Uuid>,
    pub status: String,
    #[serde(deserialize_with = "required_option")]
    pub reason_code: Option<String>,
    pub action_count: i64,
    pub model_request_count: i64,
}
impl LessonReport {
    pub fn validate(&self) -> Result<(), ApiError> {
        if self.criterion_outcomes.len() > 40
            || self.criterion_outcomes.iter().any(|item| {
                !bounded(&item.criterion_id, 120)
                    || !matches!(
                        item.outcome.as_str(),
                        "observed" | "needs_revision" | "insufficient_evidence"
                    )
            })
        {
            return Err(invalid_request());
        }
        if !(0..=9_007_199_254_740_991).contains(&self.revision)
            || !(0..=160).contains(&self.action_count)
            || !(0..=64).contains(&self.model_request_count)
            || !matches!(
                self.status.as_str(),
                "received"
                    | "preparing"
                    | "running"
                    | "waiting_for_student"
                    | "paused"
                    | "blocked"
                    | "stopped"
                    | "failed"
                    | "unknown"
                    | "expired"
                    | "finished"
            )
            || self.reason_code.as_deref().is_some_and(|s| {
                !matches!(
                    s,
                    "device_busy"
                        | "permission_required"
                        | "unsupported"
                        | "resource_unavailable"
                        | "surface_unverified"
                        | "outcome_unknown"
                        | "network_unavailable"
                        | "student_stop"
                        | "session_ended"
                        | "access_changed"
                        | "expired"
                        | "budget_exhausted"
                        | "runtime_failed"
                        | "existing_work"
                        | "restart"
                        | "opted_out"
                )
            })
        {
            return Err(invalid_request());
        }
        Ok(())
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LessonDevice {
    pub client_instance_id: Uuid,
    pub build: String,
    pub lessons_version: u32,
    pub ready: bool,
}

fn required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LessonCriterionOutcome {
    pub criterion_id: String,
    pub outcome: String,
}
