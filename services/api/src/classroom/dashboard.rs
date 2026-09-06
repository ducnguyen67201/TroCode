use std::collections::BTreeMap;

use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::ApiError;
use crate::{Row, query, query_scalar};

use super::{
    ClassroomService, CriterionEvidence, DashboardEvent, DashboardParticipant, DashboardResponse,
    SupportSuggestion,
};

impl ClassroomService {
    pub async fn dashboard(
        &self,
        user_id: &str,
        space_id: Uuid,
        run_id: Uuid,
        since_sequence: Option<u64>,
    ) -> Result<DashboardResponse, ApiError> {
        self.require_facilitator(user_id, space_id).await?;
        let run_state = query_scalar::<_, String>(
            "SELECT state FROM knowledge_activity_runs WHERE id=$1 AND space_id=$2",
        )
        .bind(run_id)
        .bind(space_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(ApiError::not_found("run_not_found", "Run not found."))?;
        if let Some(since_sequence) = since_sequence {
            return self
                .dashboard_delta(run_id, run_state, since_sequence)
                .await;
        }
        self.dashboard_snapshot(run_id, space_id, run_state).await
    }

    async fn dashboard_delta(
        &self,
        run_id: Uuid,
        run_state: String,
        since_sequence: u64,
    ) -> Result<DashboardResponse, ApiError> {
        let database_sequence = i64::try_from(since_sequence)
            .map_err(|_| ApiError::bad_request("invalid_request", "sinceSequence is invalid."))?;
        let rows = query(
            r#"SELECT sequence,attempt_id,event_type,payload,created_at
               FROM knowledge_activity_run_events
               WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 1000"#,
        )
        .bind(run_id)
        .bind(database_sequence)
        .fetch_all(&self.pool)
        .await?;
        let mut events = Vec::with_capacity(rows.len());
        for row in rows {
            events.push(DashboardEvent {
                sequence: u64::try_from(row.get::<i64, _>("sequence")).map_err(|_| {
                    ApiError::coded(
                        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                        "classroom_data_invalid",
                        "Stored classroom data is invalid.",
                    )
                })?,
                attempt_id: row.get("attempt_id"),
                event_type: row.get("event_type"),
                payload: row.get("payload"),
                created_at: row.get("created_at"),
            });
        }
        let max_sequence = events.last().map_or(since_sequence, |event| event.sequence);
        Ok(DashboardResponse {
            kind: "delta",
            max_sequence,
            run_state,
            participants: None,
            events: Some(events),
            counts: None,
            help_queue: None,
            criterion_evidence: None,
            patterns: None,
            suggestions: None,
        })
    }

    async fn dashboard_snapshot(
        &self,
        run_id: Uuid,
        space_id: Uuid,
        run_state: String,
    ) -> Result<DashboardResponse, ApiError> {
        let rows = query(
            r#"SELECT attempts.id,attempts.user_id,attempts.state,attempts.updated_at,attempts.started_at,
                      participations.joined_at,participations.left_at,runs.state AS run_state,
                      (SELECT jsonb_build_object('state',latest.state,'purpose',latest.purpose) FROM knowledge_activity_work_sessions latest
                       WHERE latest.attempt_id=attempts.id
                       ORDER BY latest.updated_at DESC,latest.id DESC LIMIT 1)
                        AS latest_session,
                      (SELECT jsonb_build_object('workSessionId',checks.id,'state',checks.state,'updatedAt',to_char(checks.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                       FROM knowledge_activity_work_sessions checks WHERE checks.attempt_id=attempts.id AND checks.purpose='check'
                       ORDER BY checks.updated_at DESC,checks.id DESC LIMIT 1) AS last_check,
                      COUNT(DISTINCT sessions.id)::int AS session_count,
                      COUNT(DISTINCT evidence.id)::int AS evidence_count,
                      MAX(help.requested_at) AS help_requested_at
               FROM knowledge_activity_runs runs
               JOIN knowledge_activity_attempts attempts ON attempts.run_id=runs.id
               LEFT JOIN knowledge_run_participations participations
                 ON participations.attempt_id=attempts.id
               LEFT JOIN knowledge_activity_work_sessions sessions
                 ON sessions.attempt_id=attempts.id
               LEFT JOIN knowledge_activity_evidence evidence ON evidence.attempt_id=attempts.id
               LEFT JOIN knowledge_attempt_help_requests help
                 ON help.attempt_id=attempts.id AND help.resolved_at IS NULL
               WHERE runs.id=$1 AND runs.space_id=$2
               GROUP BY attempts.id,participations.joined_at,participations.left_at,runs.state
               ORDER BY attempts.updated_at DESC LIMIT 500"#,
        )
        .bind(run_id)
        .bind(space_id)
        .fetch_all(&self.pool)
        .await?;
        let mut participants = Vec::with_capacity(rows.len());
        for row in rows {
            let state: String = row.get("state");
            let joined_at: Option<OffsetDateTime> = row.get("joined_at");
            let left_at: Option<OffsetDateTime> = row.get("left_at");
            let help_requested_at: Option<OffsetDateTime> = row.get("help_requested_at");
            let latest_session: Option<serde_json::Value> = row.get("latest_session");
            let session_count: i32 = row.get("session_count");
            let row_run_state: String = row.get("run_state");
            let status = participant_status(
                &state,
                joined_at.is_some(),
                left_at.is_some(),
                help_requested_at.is_some(),
                latest_session.as_ref().and_then(|value| {
                    Some((
                        value.get("state")?.as_str()?,
                        value.get("purpose")?.as_str()?,
                    ))
                }),
                session_count,
                &row_run_state,
            );
            participants.push(DashboardParticipant {
                started_at: row.get("started_at"),
                last_check: row.get("last_check"),
                id: row.get("user_id"),
                attempt_id: row.get("id"),
                state,
                status: status.to_owned(),
                joined_at,
                left_at,
                updated_at: row.get("updated_at"),
                session_count,
                evidence_count: row.get("evidence_count"),
                help_requested_at,
            });
        }
        let max_sequence = query_scalar::<_, i64>(
            r#"SELECT COALESCE(MAX(events.sequence),0)
               FROM knowledge_activity_run_events events
               JOIN knowledge_activity_runs runs ON runs.id=events.run_id
               WHERE events.run_id=$1 AND runs.space_id=$2"#,
        )
        .bind(run_id)
        .bind(space_id)
        .fetch_one(&self.pool)
        .await?;
        let evidence_rows = query(
            r#"SELECT evidence.criterion_id,
                      COUNT(DISTINCT evidence.attempt_id)::int AS participant_count,
                      COUNT(*) FILTER (WHERE evidence.provenance='agent_candidate')::int
                        AS agent_candidate_count,
                      COUNT(DISTINCT evidence.provenance)::int AS corroborated_count
               FROM knowledge_activity_evidence evidence
               JOIN knowledge_activity_attempts attempts ON attempts.id=evidence.attempt_id
               JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
               WHERE runs.id=$1 AND runs.space_id=$2
               GROUP BY evidence.criterion_id
               ORDER BY participant_count DESC,evidence.criterion_id LIMIT 100"#,
        )
        .bind(run_id)
        .bind(space_id)
        .fetch_all(&self.pool)
        .await?;
        let patterns: Vec<CriterionEvidence> = evidence_rows
            .into_iter()
            .map(|row| CriterionEvidence {
                criterion_id: row.get("criterion_id"),
                participant_count: row.get("participant_count"),
                corroborated_count: row.get("corroborated_count"),
                agent_candidate_count: row.get("agent_candidate_count"),
            })
            .collect();
        let mut counts = BTreeMap::new();
        for participant in &participants {
            *counts.entry(participant.state.clone()).or_insert(0) += 1;
        }
        let mut help_queue: Vec<_> = participants
            .iter()
            .filter(|participant| participant.status == "needs_help")
            .cloned()
            .collect();
        help_queue.sort_by_key(|participant| participant.help_requested_at);
        let suggestions = support_suggestions(&participants, &patterns);
        Ok(DashboardResponse {
            kind: "snapshot",
            max_sequence: u64::try_from(max_sequence).unwrap_or(0),
            run_state,
            participants: Some(participants),
            events: None,
            counts: Some(counts),
            help_queue: Some(help_queue),
            criterion_evidence: Some(patterns.clone()),
            patterns: Some(patterns),
            suggestions: Some(suggestions),
        })
    }
}

fn participant_status(
    state: &str,
    joined: bool,
    left: bool,
    help_requested: bool,
    latest_session_state: Option<(&str, &str)>,
    session_count: i32,
    run_state: &str,
) -> &'static str {
    match state {
        "completed" => "completed",
        "submitted" => "submitted",
        "ready_for_review" => "ready",
        "withdrawn" => "withdrawn",
        _ if left => "left",
        _ if help_requested => "needs_help",
        _ if joined && run_state == "draft" => "lobby",
        _ if latest_session_state == Some(("failed", "work")) => "launch_failed",
        _ if !joined && session_count == 0 => "not_joined",
        _ => "working",
    }
}

fn support_suggestions(
    participants: &[DashboardParticipant],
    patterns: &[CriterionEvidence],
) -> Vec<SupportSuggestion> {
    let mut suggestions = Vec::new();
    for participant in participants {
        if participant.status == "needs_help" {
            suggestions.push(SupportSuggestion::IndividualFollowUp {
                participant_id: participant.id.clone(),
                reason: "explicit_help_request",
            });
        }
    }
    if participants.len() < 5 {
        return suggestions;
    }
    for evidence in patterns {
        let ratio = f64::from(evidence.participant_count) / participants.len() as f64;
        if evidence.participant_count >= 5 && ratio >= 0.3 && evidence.corroborated_count >= 2 {
            suggestions.push(SupportSuggestion::GroupClarification {
                criterion_id: evidence.criterion_id.clone(),
                participant_count: evidence.participant_count,
                active_participants: participants.len(),
                confidence: if ratio >= 0.6 { "high" } else { "moderate" },
            });
        } else if evidence.agent_candidate_count > 0 {
            suggestions.push(SupportSuggestion::ReviewEvidence {
                criterion_id: evidence.criterion_id.clone(),
            });
        }
    }
    suggestions
}

#[cfg(test)]
mod tests {
    use super::participant_status;

    #[test]
    fn failed_checks_do_not_replace_assignment_status() {
        assert_eq!(
            participant_status(
                "in_progress",
                false,
                false,
                false,
                Some(("failed", "check")),
                1,
                "open"
            ),
            "working"
        );
        assert_eq!(
            participant_status(
                "in_progress",
                false,
                false,
                false,
                Some(("failed", "work")),
                1,
                "open"
            ),
            "launch_failed"
        );
    }

    #[test]
    fn explicit_and_terminal_states_win_over_presence_signals() {
        assert_eq!(
            participant_status(
                "completed",
                true,
                true,
                true,
                Some(("failed", "work")),
                1,
                "open"
            ),
            "completed"
        );
        assert_eq!(
            participant_status("in_progress", true, true, true, None, 1, "open"),
            "left"
        );
        assert_eq!(
            participant_status("blocked", true, false, true, None, 1, "open"),
            "needs_help"
        );
        assert_eq!(
            participant_status("assigned", true, false, false, None, 0, "draft"),
            "lobby"
        );
    }
}
