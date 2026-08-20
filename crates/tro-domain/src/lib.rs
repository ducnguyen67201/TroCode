//! Pure lifecycle, policy, plan, and accounting decisions.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use url::Url;

pub const PLAN_CATALOG_VERSION: &str = "2026-08-17";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanId {
    Free,
    Basic,
    Pro,
    Max,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlanLimits {
    pub active_runs: u32,
    pub daily_micro_usd: i64,
    pub weekly_assignments: u32,
    pub monthly_price_cents: u32,
    pub monthly_micro_usd: i64,
    pub group_members: u32,
    pub knowledge_queries_per_minute: u32,
    pub provider_calls_per_task: u32,
    pub requests_per_minute: u32,
    pub spaces: u32,
    pub storage_bytes: u64,
    pub upload_batch_files: u32,
    pub upload_requests_per_minute: u32,
    pub task_micro_usd: i64,
}

#[must_use]
pub const fn plan_limits(plan: PlanId) -> PlanLimits {
    match plan {
        PlanId::Free => PlanLimits {
            active_runs: 1,
            daily_micro_usd: 250_000,
            weekly_assignments: 25,
            monthly_price_cents: 0,
            monthly_micro_usd: 1_000_000,
            group_members: 25,
            knowledge_queries_per_minute: 20,
            provider_calls_per_task: 40,
            requests_per_minute: 15,
            spaces: 1,
            storage_bytes: 268_435_456,
            upload_batch_files: 20,
            upload_requests_per_minute: 10,
            task_micro_usd: 100_000,
        },
        PlanId::Basic => PlanLimits {
            active_runs: 5,
            daily_micro_usd: 1_000_000,
            weekly_assignments: 300,
            monthly_price_cents: 2_000,
            monthly_micro_usd: 8_000_000,
            group_members: 200,
            knowledge_queries_per_minute: 60,
            provider_calls_per_task: 40,
            requests_per_minute: 30,
            spaces: 3,
            storage_bytes: 1_073_741_824,
            upload_batch_files: 50,
            upload_requests_per_minute: 20,
            task_micro_usd: 750_000,
        },
        PlanId::Pro => PlanLimits {
            active_runs: 25,
            daily_micro_usd: 3_000_000,
            weekly_assignments: 750,
            monthly_price_cents: 5_000,
            monthly_micro_usd: 20_000_000,
            group_members: 1_000,
            knowledge_queries_per_minute: 180,
            provider_calls_per_task: 40,
            requests_per_minute: 45,
            spaces: 20,
            storage_bytes: 21_474_836_480,
            upload_batch_files: 100,
            upload_requests_per_minute: 60,
            task_micro_usd: 2_000_000,
        },
        PlanId::Max => PlanLimits {
            active_runs: 100,
            daily_micro_usd: 8_000_000,
            weekly_assignments: 1_875,
            monthly_price_cents: 10_000,
            monthly_micro_usd: 45_000_000,
            group_members: 2_000,
            knowledge_queries_per_minute: 360,
            provider_calls_per_task: 40,
            requests_per_minute: 60,
            spaces: 100,
            storage_bytes: 107_374_182_400,
            upload_batch_files: 100,
            upload_requests_per_minute: 120,
            task_micro_usd: 5_000_000,
        },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityState {
    Draft,
    Published,
    Open,
    Closed,
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
#[error("activity transition is not allowed")]
pub struct InvalidActivityTransition;

/// Applies one allowed forward-only activity lifecycle transition.
///
/// # Errors
///
/// Returns [`InvalidActivityTransition`] when the requested state pair is not
/// one of draft-to-published, published-to-open, or open-to-closed.
pub fn transition_activity(
    from: ActivityState,
    to: ActivityState,
) -> Result<ActivityState, InvalidActivityTransition> {
    let allowed = matches!(
        (from, to),
        (ActivityState::Draft, ActivityState::Published)
            | (ActivityState::Published, ActivityState::Open)
            | (ActivityState::Open, ActivityState::Closed)
    );
    allowed.then_some(to).ok_or(InvalidActivityTransition)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetDecision {
    Allow,
    Deny,
}

#[must_use]
pub fn public_https_target(target: &str) -> TargetDecision {
    let Ok(url) = Url::parse(target) else {
        return TargetDecision::Deny;
    };
    if url.scheme() != "https" || url.username() != "" || url.password().is_some() {
        return TargetDecision::Deny;
    }
    let Some(host) = url.host_str() else {
        return TargetDecision::Deny;
    };
    let normalized = host.trim_end_matches('.').to_ascii_lowercase();
    if has_dns_suffix(&normalized, "localhost")
        || has_dns_suffix(&normalized, "local")
        || has_dns_suffix(&normalized, "internal")
        || normalized
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback() || ip.is_unspecified() || is_private_ip(ip))
    {
        return TargetDecision::Deny;
    }
    TargetDecision::Allow
}

fn has_dns_suffix(host: &str, suffix: &str) -> bool {
    host.eq_ignore_ascii_case(suffix)
        || host
            .rsplit_once('.')
            .is_some_and(|(_, final_label)| final_label.eq_ignore_ascii_case(suffix))
}

fn is_private_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => ip.is_private() || ip.is_link_local(),
        std::net::IpAddr::V6(ip) => ip.is_unique_local() || ip.is_unicast_link_local(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Consequence {
    Routine,
    Login,
    Send,
    Submit,
    Upload,
    Download,
    Delete,
    Purchase,
    Install,
    Command,
    FileWrite,
}

#[must_use]
pub const fn requires_exact_approval(consequence: Consequence, strict: bool) -> bool {
    strict || !matches!(consequence, Consequence::Routine)
}

#[must_use]
pub fn approval_digest(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DispatchOutcome {
    Confirmed,
    RejectedBeforeDispatch,
    Uncertain,
}

#[must_use]
pub const fn may_retry(outcome: DispatchOutcome) -> bool {
    matches!(outcome, DispatchOutcome::RejectedBeforeDispatch)
}

#[cfg(test)]
mod tests {
    use super::{
        ActivityState, Consequence, DispatchOutcome, TargetDecision, approval_digest, may_retry,
        public_https_target, requires_exact_approval, transition_activity,
    };

    #[test]
    fn only_public_https_targets_are_admissible() {
        assert_eq!(
            public_https_target("https://example.com/a"),
            TargetDecision::Allow
        );
        assert_eq!(
            public_https_target("http://example.com"),
            TargetDecision::Deny
        );
        assert_eq!(
            public_https_target("https://127.0.0.1"),
            TargetDecision::Deny
        );
        assert_eq!(
            public_https_target("https://10.0.0.1"),
            TargetDecision::Deny
        );
    }

    #[test]
    fn lifecycle_is_forward_only() {
        assert_eq!(
            transition_activity(ActivityState::Draft, ActivityState::Published),
            Ok(ActivityState::Published)
        );
        assert!(transition_activity(ActivityState::Closed, ActivityState::Open).is_err());
    }

    #[test]
    fn consequential_actions_require_exact_approval() {
        assert!(!requires_exact_approval(Consequence::Routine, false));
        assert!(requires_exact_approval(Consequence::Submit, false));
        assert!(requires_exact_approval(Consequence::Routine, true));
    }

    #[test]
    fn approval_digest_is_framed_and_stable() {
        assert_eq!(approval_digest(&["ab", "c"]), approval_digest(&["ab", "c"]));
        assert_ne!(approval_digest(&["ab", "c"]), approval_digest(&["a", "bc"]));
    }

    #[test]
    fn uncertain_dispatch_is_never_retried() {
        assert!(!may_retry(DispatchOutcome::Uncertain));
        assert!(!may_retry(DispatchOutcome::Confirmed));
        assert!(may_retry(DispatchOutcome::RejectedBeforeDispatch));
    }
}
