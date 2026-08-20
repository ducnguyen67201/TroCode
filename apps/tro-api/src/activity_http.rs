use axum::{
    Json,
    body::to_bytes,
    extract::Request,
    http::{HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use sea_orm::{ConnectionTrait, DbBackend, QueryResult, Statement, TransactionTrait};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tro_domain::{PlanId, PlanLimits, plan_limits};
use uuid::Uuid;

use crate::{AppState, error::ApiError};

const MAX_BODY: usize = 1_000_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveActivityDraft {
    client_id: Uuid,
    definition: Value,
    #[serde(default)]
    source_version_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublishActivity {
    #[serde(rename = "clientId")]
    _client_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum RunTarget {
    Group {
        #[serde(rename = "groupId")]
        group_id: Uuid,
    },
    Participants {
        #[serde(rename = "userIds")]
        user_ids: Vec<String>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateRun {
    client_id: Uuid,
    activity_version_id: Uuid,
    mode: String,
    #[serde(default)]
    opens_at: Option<String>,
    #[serde(default)]
    closes_at: Option<String>,
    target: RunTarget,
    #[serde(default = "default_insight_policy")]
    insight_policy: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AcknowledgeAttempt {
    policy_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequestHelp {
    client_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateWorkSession {
    client_id: Uuid,
    task_id: Uuid,
    launch_kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateWorkSession {
    state: String,
    #[serde(default)]
    help_requested: Option<bool>,
    #[serde(default)]
    hint_level: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecordEvidence {
    client_id: Uuid,
    work_session_id: Uuid,
    criterion_id: String,
    tag: String,
    provenance: String,
    result_code: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchKnowledge {
    query: String,
    #[serde(default = "default_search_limit")]
    limit: i32,
}

fn default_insight_policy() -> String {
    String::from("explicit_and_operational")
}
fn default_search_limit() -> i32 {
    6
}

pub(crate) async fn dispatch(
    state: &AppState,
    user_id: &str,
    request: Request,
    segments: &[&str],
) -> Result<Response, ApiError> {
    let method = request.method().clone();
    match (method, segments) {
        (Method::POST, ["v1", "spaces", space_id, "activities"]) => {
            let body = read_json::<SaveActivityDraft>(request).await?;
            save_activity_draft(state, user_id, parse_uuid(space_id)?, body).await
        }
        (
            Method::POST,
            [
                "v1",
                "spaces",
                space_id,
                "activities",
                activity_id,
                "publish",
            ],
        ) => {
            let body = read_json::<PublishActivity>(request).await?;
            publish_activity(
                state,
                user_id,
                parse_uuid(space_id)?,
                parse_uuid(activity_id)?,
                body,
            )
            .await
        }
        (Method::POST, ["v1", "spaces", space_id, "runs"]) => {
            let body = read_json::<CreateRun>(request).await?;
            create_run(state, user_id, parse_uuid(space_id)?, body).await
        }
        (Method::POST, ["v1", "spaces", space_id, "runs", run_id, action])
            if matches!(*action, "open" | "close") =>
        {
            set_run_state(
                state,
                user_id,
                parse_uuid(space_id)?,
                parse_uuid(run_id)?,
                action,
            )
            .await
        }
        (Method::GET, ["v1", "assignments", "me"]) => list_assignments(state, user_id).await,
        (Method::GET, ["v1", "attempts", attempt_id]) => {
            attempt_context(state, user_id, parse_uuid(attempt_id)?).await
        }
        (Method::POST, ["v1", "attempts", attempt_id, "acknowledge"]) => {
            let body = read_json::<AcknowledgeAttempt>(request).await?;
            acknowledge_attempt(state, user_id, parse_uuid(attempt_id)?, body).await
        }
        (Method::POST, ["v1", "attempts", attempt_id, "help"]) => {
            let body = read_json::<RequestHelp>(request).await?;
            request_help(state, user_id, parse_uuid(attempt_id)?, body).await
        }
        (Method::POST, ["v1", "attempts", attempt_id, "work-sessions"]) => {
            let body = read_json::<CreateWorkSession>(request).await?;
            create_work_session(state, user_id, parse_uuid(attempt_id)?, body).await
        }
        (Method::PATCH, ["v1", "work-sessions", work_session_id]) => {
            let body = read_json::<UpdateWorkSession>(request).await?;
            update_work_session(state, user_id, parse_uuid(work_session_id)?, body).await
        }
        (Method::POST, ["v1", "attempts", attempt_id, "knowledge", "search"]) => {
            let body = read_json::<SearchKnowledge>(request).await?;
            search_knowledge(state, user_id, parse_uuid(attempt_id)?, body).await
        }
        (Method::POST, ["v1", "attempts", attempt_id, "evidence"]) => {
            let body = read_json::<RecordEvidence>(request).await?;
            record_evidence(state, user_id, parse_uuid(attempt_id)?, body).await
        }
        (Method::GET, ["v1", "spaces", space_id, "runs", run_id, "dashboard"]) => {
            let since = request
                .uri()
                .query()
                .and_then(|query| {
                    url::form_urlencoded::parse(query.as_bytes())
                        .find(|(key, _)| key == "sinceSequence")
                        .map(|(_, value)| value.into_owned())
                })
                .map(|value| value.parse::<i64>().map_err(|_| invalid_request()))
                .transpose()?;
            dashboard(
                state,
                user_id,
                parse_uuid(space_id)?,
                parse_uuid(run_id)?,
                since,
            )
            .await
        }
        _ => Err(ApiError::new(StatusCode::NOT_FOUND, "Endpoint not found.")),
    }
}

async fn save_activity_draft(
    state: &AppState,
    user_id: &str,
    space_id: Uuid,
    body: SaveActivityDraft,
) -> Result<Response, ApiError> {
    require_role(state, user_id, space_id, true).await?;
    let definition = validate_activity_definition(&body.definition)?;
    if body.source_version_ids.len() > 200 {
        return Err(invalid_request());
    }
    let transaction = state.database.begin().await?;
    let row = transaction
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO knowledge_activities (client_id,space_id,draft_definition,created_by) \
         VALUES ($1,$2,$3,$4) ON CONFLICT (space_id,client_id) DO UPDATE \
         SET draft_definition=EXCLUDED.draft_definition,updated_at=NOW() \
         RETURNING id,state,draft_definition,updated_at::TEXT AS updated_at",
            [
                body.client_id.into(),
                space_id.into(),
                definition.into(),
                user_id.into(),
            ],
        ))
        .await?
        .ok_or_else(ApiError::internal)?;
    let activity_id: Uuid = get(&row, "id")?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "DELETE FROM knowledge_activity_draft_sources WHERE activity_id=$1",
            [activity_id.into()],
        ))
        .await?;
    for source_id in body.source_version_ids {
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO knowledge_activity_draft_sources (activity_id,source_version_id) \
             SELECT $1,versions.id FROM knowledge_source_versions versions \
             JOIN knowledge_sources sources ON sources.id=versions.source_id \
             WHERE versions.id=$2 AND sources.space_id=$3 AND sources.role<>'submission' \
             ON CONFLICT DO NOTHING",
                [activity_id.into(), source_id.into(), space_id.into()],
            ))
            .await?;
    }
    transaction.commit().await?;
    let result = json!({
        "id": activity_id,
        "state": get::<String>(&row, "state")?,
        "definition": get::<Value>(&row, "draft_definition")?,
        "updatedAt": get::<String>(&row, "updated_at")?
    });
    let mut response = (StatusCode::CREATED, Json(result)).into_response();
    response.headers_mut().insert(
        header::LOCATION,
        HeaderValue::from_str(&format!("/v1/activities/{activity_id}"))
            .map_err(|_| ApiError::internal())?,
    );
    Ok(response)
}

#[allow(clippy::too_many_lines)]
async fn publish_activity(
    state: &AppState,
    user_id: &str,
    space_id: Uuid,
    activity_id: Uuid,
    _body: PublishActivity,
) -> Result<Response, ApiError> {
    require_role(state, user_id, space_id, true).await?;
    let transaction = state.database.begin().await?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [format!("publish:{activity_id}").into()],
        ))
        .await?;
    let Some(draft) = transaction.query_one_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT draft_definition FROM knowledge_activities WHERE id=$1 AND space_id=$2 FOR UPDATE",
        [activity_id.into(), space_id.into()],
    )).await? else {
        transaction.rollback().await?;
        return Err(ApiError::coded(StatusCode::NOT_FOUND, "activity_not_found", "Activity not found."));
    };
    let definition: Value = get(&draft, "draft_definition")?;
    let source_rows = transaction
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT draft.source_version_id FROM knowledge_activity_draft_sources draft \
         JOIN knowledge_source_versions versions ON versions.id=draft.source_version_id \
         JOIN knowledge_sources sources ON sources.id=versions.source_id \
         WHERE draft.activity_id=$1 AND sources.space_id=$2 AND versions.state='ready' \
           AND sources.role<>'submission' ORDER BY draft.source_version_id",
            [activity_id.into(), space_id.into()],
        ))
        .await?;
    let source_ids = source_rows
        .iter()
        .map(|row| get::<Uuid>(row, "source_version_id"))
        .collect::<Result<Vec<_>, _>>()?;
    let canonical = canonical_json(&json!({
        "definition": definition,
        "sourceVersionIds": source_ids,
    }))?;
    let content_hash = format!("{:x}", Sha256::digest(canonical.as_bytes()));
    if let Some(existing) = transaction
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT id,version_number,published_at::TEXT AS published_at \
         FROM knowledge_activity_versions WHERE activity_id=$1 AND content_hash=$2",
            [activity_id.into(), content_hash.clone().into()],
        ))
        .await?
    {
        let result = json!({
            "id": get::<Uuid>(&existing, "id")?,
            "versionNumber": get::<i32>(&existing, "version_number")?,
            "publishedAt": get::<String>(&existing, "published_at")?,
            "newlyCreated": false,
        });
        transaction.commit().await?;
        return Ok(Json(result).into_response());
    }
    let version = transaction
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO knowledge_activity_versions \
           (activity_id,version_number,definition,content_hash,published_by) \
         SELECT $1,COALESCE(MAX(version_number),0)+1,$2,$3,$4 \
         FROM knowledge_activity_versions WHERE activity_id=$1 \
         RETURNING id,version_number,published_at::TEXT AS published_at",
            [
                activity_id.into(),
                definition.into(),
                content_hash.into(),
                user_id.into(),
            ],
        ))
        .await?
        .ok_or_else(ApiError::internal)?;
    let version_id: Uuid = get(&version, "id")?;
    for source_id in source_ids {
        transaction.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO knowledge_activity_version_sources (activity_version_id,source_version_id) \
             VALUES ($1,$2) ON CONFLICT DO NOTHING",
            [version_id.into(), source_id.into()],
        )).await?;
    }
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE knowledge_activities SET state='published',updated_at=NOW() WHERE id=$1",
            [activity_id.into()],
        ))
        .await?;
    transaction.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "id": version_id,
            "versionNumber": get::<i32>(&version, "version_number")?,
            "publishedAt": get::<String>(&version, "published_at")?,
            "newlyCreated": true,
        })),
    )
        .into_response())
}

#[allow(clippy::too_many_lines)]
async fn create_run(
    state: &AppState,
    user_id: &str,
    space_id: Uuid,
    body: CreateRun,
) -> Result<Response, ApiError> {
    require_role(state, user_id, space_id, true).await?;
    let limits = limits_for_user(state, user_id).await?;
    let opens_at = parse_optional_datetime(body.opens_at.as_deref())?;
    let closes_at = parse_optional_datetime(body.closes_at.as_deref())?;
    if !matches!(body.mode.as_str(), "live" | "async" | "hybrid")
        || !matches!(
            body.insight_policy.as_str(),
            "explicit_and_operational" | "evidence_candidates"
        )
        || opens_at
            .zip(closes_at)
            .is_some_and(|(opens, closes)| opens >= closes)
    {
        return Err(invalid_request());
    }
    let transaction = state.database.begin().await?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [format!("run:{space_id}:{}", body.client_id).into()],
        ))
        .await?;
    if let Some(existing) = transaction
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT id,state FROM knowledge_activity_runs WHERE space_id=$1 AND client_id=$2",
            [space_id.into(), body.client_id.into()],
        ))
        .await?
    {
        let result = json!({
            "id": get::<Uuid>(&existing, "id")?,
            "state": get::<String>(&existing, "state")?,
            "newlyCreated": false,
        });
        transaction.commit().await?;
        return Ok(Json(result).into_response());
    }
    let active = transaction
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT COUNT(*)::INTEGER AS value FROM knowledge_activity_runs \
         WHERE space_id=$1 AND state IN ('draft','open')",
            [space_id.into()],
        ))
        .await?
        .ok_or_else(ApiError::internal)?;
    if get::<i32>(&active, "value")?
        >= i32::try_from(limits.active_runs).map_err(|_| ApiError::internal())?
    {
        transaction.rollback().await?;
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "active_run_quota",
            "This Space reached its active Run limit.",
        ));
    }
    let version_exists = transaction
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT versions.id FROM knowledge_activity_versions versions \
         JOIN knowledge_activities activities ON activities.id=versions.activity_id \
         WHERE versions.id=$1 AND activities.space_id=$2",
            [body.activity_version_id.into(), space_id.into()],
        ))
        .await?
        .is_some();
    if !version_exists {
        transaction.rollback().await?;
        return Err(ApiError::coded(
            StatusCode::NOT_FOUND,
            "activity_version_not_found",
            "Published Activity not found in this Space.",
        ));
    }
    let (target_kind, target_group_id, user_ids) = match body.target {
        RunTarget::Group { group_id } => {
            let group_exists = transaction.query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT id FROM knowledge_space_groups WHERE id=$1 AND space_id=$2 AND archived_at IS NULL",
                [group_id.into(), space_id.into()],
            )).await?.is_some();
            if !group_exists {
                transaction.rollback().await?;
                return Err(ApiError::coded(
                    StatusCode::NOT_FOUND,
                    "group_not_found",
                    "Group not found in this Space.",
                ));
            }
            let rows = transaction
                .query_all_raw(Statement::from_sql_and_values(
                    DbBackend::Postgres,
                    "SELECT members.user_id FROM knowledge_space_group_members members \
                 JOIN knowledge_space_members space_members \
                   ON space_members.space_id=$2 AND space_members.user_id=members.user_id \
                 WHERE members.group_id=$1 AND space_members.removed_at IS NULL",
                    [group_id.into(), space_id.into()],
                ))
                .await?;
            let ids = rows
                .iter()
                .map(|row| get::<String>(row, "user_id"))
                .collect::<Result<Vec<_>, _>>()?;
            ("group", Some(group_id), ids)
        }
        RunTarget::Participants { user_ids } => {
            let mut unique = user_ids
                .into_iter()
                .map(|id| id.trim().to_owned())
                .filter(|id| !id.is_empty() && id.len() <= 255)
                .collect::<Vec<_>>();
            unique.sort();
            unique.dedup();
            if unique.is_empty() || unique.len() > 2_000 {
                transaction.rollback().await?;
                return Err(invalid_request());
            }
            for id in &unique {
                let member = transaction
                    .query_one_raw(Statement::from_sql_and_values(
                        DbBackend::Postgres,
                        "SELECT user_id FROM knowledge_space_members \
                     WHERE space_id=$1 AND user_id=$2 AND removed_at IS NULL",
                        [space_id.into(), id.clone().into()],
                    ))
                    .await?
                    .is_some();
                if !member {
                    transaction.rollback().await?;
                    return Err(ApiError::coded(
                        StatusCode::BAD_REQUEST,
                        "participant_not_in_space",
                        "Every Run participant must belong to this Space.",
                    ));
                }
            }
            ("participants", None, unique)
        }
    };
    if user_ids.len() > usize::try_from(limits.group_members).map_err(|_| ApiError::internal())? {
        transaction.rollback().await?;
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "participant_quota",
            "This Run has too many participants for the current plan.",
        ));
    }
    let run = transaction.query_one_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO knowledge_activity_runs \
           (client_id,space_id,activity_version_id,mode,target_kind,target_group_id,opens_at,closes_at,insight_policy,created_by) \
         VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10) RETURNING id,state",
        [
            body.client_id.into(), space_id.into(), body.activity_version_id.into(),
            body.mode.into(), target_kind.into(), target_group_id.into(),
            body.opens_at.into(), body.closes_at.into(), body.insight_policy.into(), user_id.into(),
        ],
    )).await?.ok_or_else(ApiError::internal)?;
    let run_id: Uuid = get(&run, "id")?;
    for participant in &user_ids {
        let assignment = transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO knowledge_activity_assignments (run_id,user_id) VALUES ($1,$2) \
             ON CONFLICT (run_id,user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING id",
                [run_id.into(), participant.clone().into()],
            ))
            .await?
            .ok_or_else(ApiError::internal)?;
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO knowledge_activity_attempts (run_id,assignment_id,user_id) \
             VALUES ($1,$2,$3) ON CONFLICT (run_id,user_id) DO NOTHING",
                [
                    run_id.into(),
                    get::<Uuid>(&assignment, "id")?.into(),
                    participant.clone().into(),
                ],
            ))
            .await?;
    }
    transaction.commit().await?;
    let mut response = (
        StatusCode::CREATED,
        Json(json!({
            "id": run_id,
            "state": get::<String>(&run, "state")?,
            "assignmentCount": user_ids.len(),
            "newlyCreated": true,
        })),
    )
        .into_response();
    response.headers_mut().insert(
        header::LOCATION,
        HeaderValue::from_str(&format!("/v1/runs/{run_id}")).map_err(|_| ApiError::internal())?,
    );
    Ok(response)
}

async fn set_run_state(
    state: &AppState,
    user_id: &str,
    space_id: Uuid,
    run_id: Uuid,
    action: &str,
) -> Result<Response, ApiError> {
    require_role(state, user_id, space_id, true).await?;
    let next = if action == "open" { "open" } else { "closed" };
    let current = state
        .database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT state FROM knowledge_activity_runs WHERE id=$1 AND space_id=$2",
            [run_id.into(), space_id.into()],
        ))
        .await?
        .ok_or_else(|| ApiError::coded(StatusCode::NOT_FOUND, "run_not_found", "Run not found."))?;
    let current: String = get(&current, "state")?;
    let allowed = current == next
        || matches!(
            (current.as_str(), next),
            ("draft", "open") | ("open", "closed")
        );
    if !allowed {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "invalid_state_transition",
            "This Run state transition is not allowed.",
        ));
    }
    state.database.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE knowledge_activity_runs SET state=$3,updated_at=NOW() WHERE id=$1 AND space_id=$2",
        [run_id.into(), space_id.into(), next.into()],
    )).await?;
    Ok(Json(json!({ "id": run_id, "state": next })).into_response())
}

async fn list_assignments(state: &AppState, user_id: &str) -> Result<Response, ApiError> {
    let rows = state.database.query_all_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT attempts.id AS attempt_id,attempts.state,attempts.updated_at::TEXT AS updated_at, \
                runs.id AS run_id,runs.mode,runs.opens_at::TEXT AS opens_at,runs.closes_at::TEXT AS closes_at, \
                versions.definition,spaces.id AS space_id,spaces.name AS space_name \
         FROM knowledge_activity_attempts attempts \
         JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id \
         JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id \
         JOIN knowledge_spaces spaces ON spaces.id=runs.space_id \
         WHERE attempts.user_id=$1 AND attempts.state<>'withdrawn' \
         ORDER BY attempts.updated_at DESC,attempts.id DESC LIMIT 100",
        [user_id.into()],
    )).await?;
    let items = rows.iter().map(|row| {
        let definition: Value = get(row, "definition")?;
        Ok(json!({
            "attemptId": get::<Uuid>(row, "attempt_id")?,
            "state": get::<String>(row, "state")?,
            "updatedAt": get::<String>(row, "updated_at")?,
            "run": {
                "id": get::<Uuid>(row, "run_id")?,
                "mode": get::<String>(row, "mode")?,
                "opensAt": get::<Option<String>>(row, "opens_at")?,
                "closesAt": get::<Option<String>>(row, "closes_at")?,
            },
            "activity": { "title": definition["title"], "objective": definition["objective"] },
            "space": { "id": get::<Uuid>(row, "space_id")?, "name": get::<String>(row, "space_name")? },
        }))
    }).collect::<Result<Vec<_>, ApiError>>()?;
    Ok(Json(json!({ "items": items })).into_response())
}

async fn attempt_context(
    state: &AppState,
    user_id: &str,
    attempt_id: Uuid,
) -> Result<Response, ApiError> {
    let row = state.database.query_one_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT attempts.id,attempts.user_id,attempts.state,attempts.acknowledged_policy_version, \
                runs.id AS run_id,runs.state AS run_state,runs.mode, \
                runs.opens_at::TEXT AS opens_at,runs.closes_at::TEXT AS closes_at, \
                runs.insight_policy,runs.insight_policy_version,runs.space_id, \
                versions.id AS activity_version_id,versions.definition,spaces.name AS space_name \
         FROM knowledge_activity_attempts attempts \
         JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id \
         JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id \
         JOIN knowledge_spaces spaces ON spaces.id=runs.space_id \
         WHERE attempts.id=$1 AND attempts.user_id=$2",
        [attempt_id.into(), user_id.into()],
    )).await?.ok_or_else(|| ApiError::coded(StatusCode::NOT_FOUND, "attempt_not_found", "Attempt not found."))?;
    let version_id: Uuid = get(&row, "activity_version_id")?;
    let sources = state.database.query_all_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT sources.display_name,sources.role FROM knowledge_activity_version_sources pinned \
         JOIN knowledge_source_versions versions ON versions.id=pinned.source_version_id \
         JOIN knowledge_sources sources ON sources.id=versions.source_id \
         WHERE pinned.activity_version_id=$1 AND versions.state='ready' \
         ORDER BY sources.virtual_path,versions.id",
        [version_id.into()],
    )).await?;
    let progress = state
        .database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT COUNT(DISTINCT sessions.id)::INTEGER AS session_count, \
                COALESCE(ARRAY_AGG(DISTINCT evidence.criterion_id) \
                  FILTER (WHERE evidence.result_code='passed'),'{}') AS completed_criterion_ids \
         FROM knowledge_activity_attempts attempts \
         LEFT JOIN knowledge_activity_work_sessions sessions ON sessions.attempt_id=attempts.id \
         LEFT JOIN knowledge_activity_evidence evidence ON evidence.attempt_id=attempts.id \
         WHERE attempts.id=$1 GROUP BY attempts.id",
            [attempt_id.into()],
        ))
        .await?;
    let session_count = progress
        .as_ref()
        .map(|value| get::<i32>(value, "session_count"))
        .transpose()?
        .unwrap_or(0);
    let completed = progress
        .as_ref()
        .map(|value| get::<Vec<String>>(value, "completed_criterion_ids"))
        .transpose()?
        .unwrap_or_default();
    let catalog = sources
        .iter()
        .map(|source| {
            Ok(json!({
                "title": get::<String>(source, "display_name")?,
                "role": get::<String>(source, "role")?,
            }))
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    let starter = catalog.iter().any(|value| value["role"] == "starter");
    Ok(Json(json!({
        "attemptId": attempt_id,
        "userId": get::<String>(&row, "user_id")?,
        "state": get::<String>(&row, "state")?,
        "acknowledgedPolicyVersion": get::<Option<String>>(&row, "acknowledged_policy_version")?,
        "run": {
            "id": get::<Uuid>(&row, "run_id")?,
            "state": get::<String>(&row, "run_state")?,
            "mode": get::<String>(&row, "mode")?,
            "opensAt": get::<Option<String>>(&row, "opens_at")?,
            "closesAt": get::<Option<String>>(&row, "closes_at")?,
            "insightPolicy": get::<String>(&row, "insight_policy")?,
            "insightPolicyVersion": get::<String>(&row, "insight_policy_version")?,
        },
        "space": { "id": get::<Uuid>(&row, "space_id")?, "name": get::<String>(&row, "space_name")? },
        "activityVersionId": version_id,
        "definition": get::<Value>(&row, "definition")?,
        "sourceCatalog": catalog,
        "starterAvailable": starter,
        "priorProgress": {
            "completedCriterionIds": completed,
            "sessionCount": session_count,
            "summary": if session_count > 0 {
                format!("This Attempt has {session_count} prior Work Session(s).")
            } else { String::from("No prior Work Sessions.") },
        },
    })).into_response())
}

async fn acknowledge_attempt(
    state: &AppState,
    user_id: &str,
    attempt_id: Uuid,
    body: AcknowledgeAttempt,
) -> Result<Response, ApiError> {
    let policy = bounded(&body.policy_version, 1, 64)?;
    let result = state
        .database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE knowledge_activity_attempts attempts \
         SET acknowledged_policy_version=$3,updated_at=NOW() \
         FROM knowledge_activity_runs runs \
         WHERE attempts.id=$1 AND attempts.user_id=$2 AND attempts.run_id=runs.id \
           AND runs.insight_policy_version=$3",
            [attempt_id.into(), user_id.into(), policy.into()],
        ))
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::coded(
            StatusCode::NOT_FOUND,
            "attempt_not_found",
            "Attempt not found.",
        ));
    }
    Ok(Json(json!({ "acknowledged": true })).into_response())
}

async fn request_help(
    state: &AppState,
    user_id: &str,
    attempt_id: Uuid,
    body: RequestHelp,
) -> Result<Response, ApiError> {
    let transaction = state.database.begin().await?;
    let row = transaction.query_one_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE knowledge_activity_attempts \
         SET state=CASE WHEN state IN ('assigned','in_progress') THEN 'blocked' ELSE state END,updated_at=NOW() \
         WHERE id=$1 AND user_id=$2 AND state NOT IN ('completed','withdrawn') RETURNING id,run_id,state",
        [attempt_id.into(), user_id.into()],
    )).await?.ok_or_else(|| ApiError::coded(StatusCode::NOT_FOUND, "attempt_not_found", "Attempt not found."))?;
    let inserted = transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO knowledge_attempt_help_requests (client_id,attempt_id,requested_by) \
         VALUES ($1,$2,$3) ON CONFLICT (attempt_id,client_id) DO NOTHING",
            [body.client_id.into(), attempt_id.into(), user_id.into()],
        ))
        .await?
        .rows_affected()
        > 0;
    if inserted {
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "UPDATE knowledge_activity_work_sessions \
             SET help_requested_at=COALESCE(help_requested_at,NOW()),updated_at=NOW() \
             WHERE id=(SELECT id FROM knowledge_activity_work_sessions \
                       WHERE attempt_id=$1 ORDER BY created_at DESC LIMIT 1)",
                [attempt_id.into()],
            ))
            .await?;
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload) \
             VALUES ($1,$2,'help_requested',jsonb_build_object('state',$3::text))",
                [
                    get::<Uuid>(&row, "run_id")?.into(),
                    attempt_id.into(),
                    get::<String>(&row, "state")?.into(),
                ],
            ))
            .await?;
    }
    transaction.commit().await?;
    Ok(Json(json!({ "requested": true, "state": get::<String>(&row, "state")? })).into_response())
}

async fn create_work_session(
    state: &AppState,
    user_id: &str,
    attempt_id: Uuid,
    body: CreateWorkSession,
) -> Result<Response, ApiError> {
    if !matches!(
        body.launch_kind.as_str(),
        "none" | "workspace" | "current_surface"
    ) {
        return Err(invalid_request());
    }
    let authority = state
        .database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT runs.state AS run_state,versions.definition \
         FROM knowledge_activity_attempts attempts \
         JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id \
         JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id \
         WHERE attempts.id=$1 AND attempts.user_id=$2",
            [attempt_id.into(), user_id.into()],
        ))
        .await?
        .ok_or_else(|| {
            ApiError::coded(
                StatusCode::NOT_FOUND,
                "attempt_not_found",
                "Attempt not found.",
            )
        })?;
    if get::<String>(&authority, "run_state")? != "open" {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "run_not_open",
            "This Run is not open.",
        ));
    }
    let definition: Value = get(&authority, "definition")?;
    if definition.get("launchTarget").and_then(Value::as_str) != Some(body.launch_kind.as_str()) {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "launch_target_mismatch",
            "Launch selection does not match the published Activity.",
        ));
    }
    let transaction = state.database.begin().await?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [format!("work:{attempt_id}:{}", body.client_id).into()],
        ))
        .await?;
    if let Some(existing) = transaction
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT sessions.id,sessions.state,sessions.task_id,sessions.launch_kind, \
                sessions.created_at::TEXT AS created_at \
         FROM knowledge_activity_work_sessions sessions \
         JOIN knowledge_activity_attempts attempts ON attempts.id=sessions.attempt_id \
         WHERE sessions.attempt_id=$1 AND sessions.client_id=$2 AND attempts.user_id=$3",
            [attempt_id.into(), body.client_id.into(), user_id.into()],
        ))
        .await?
    {
        let result = work_session_json(&existing)?;
        transaction.commit().await?;
        return Ok(Json(result).into_response());
    }
    let row = transaction.query_one_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO knowledge_activity_work_sessions (client_id,attempt_id,task_id,launch_kind) \
         VALUES ($1,$2,$3,$4) RETURNING id,state,task_id,launch_kind,created_at::TEXT AS created_at",
        [body.client_id.into(), attempt_id.into(), body.task_id.into(), body.launch_kind.into()],
    )).await?.ok_or_else(ApiError::internal)?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE knowledge_activity_attempts \
         SET state=CASE WHEN state='assigned' THEN 'in_progress' ELSE state END, \
             started_at=COALESCE(started_at,NOW()),updated_at=NOW() WHERE id=$1",
            [attempt_id.into()],
        ))
        .await?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload) \
         SELECT run_id,id,'work_session_created',jsonb_build_object('state','created') \
         FROM knowledge_activity_attempts WHERE id=$1",
            [attempt_id.into()],
        ))
        .await?;
    transaction.commit().await?;
    let mut response = (StatusCode::CREATED, Json(work_session_json(&row)?)).into_response();
    let id: Uuid = get(&row, "id")?;
    response.headers_mut().insert(
        header::LOCATION,
        HeaderValue::from_str(&format!("/v1/work-sessions/{id}"))
            .map_err(|_| ApiError::internal())?,
    );
    Ok(response)
}

async fn update_work_session(
    state: &AppState,
    user_id: &str,
    work_session_id: Uuid,
    body: UpdateWorkSession,
) -> Result<Response, ApiError> {
    if !matches!(
        body.state.as_str(),
        "created" | "active" | "paused" | "completed" | "cancelled" | "failed"
    ) || body
        .hint_level
        .is_some_and(|value| !(0..=5).contains(&value))
    {
        return Err(invalid_request());
    }
    let help_requested = body.help_requested.unwrap_or(false);
    let row = state.database.query_one_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE knowledge_activity_work_sessions sessions SET \
           state=$2, \
           help_requested_at=CASE WHEN $3::boolean THEN COALESCE(help_requested_at,NOW()) ELSE help_requested_at END, \
           hint_level=COALESCE($4,hint_level), \
           started_at=CASE WHEN $2='active' THEN COALESCE(started_at,NOW()) ELSE started_at END, \
           ended_at=CASE WHEN $2 IN ('completed','cancelled','failed') THEN NOW() ELSE ended_at END,updated_at=NOW() \
         FROM knowledge_activity_attempts attempts \
         WHERE sessions.id=$1 AND sessions.attempt_id=attempts.id AND attempts.user_id=$5 \
         RETURNING sessions.id,sessions.attempt_id,sessions.state, \
                   sessions.help_requested_at::TEXT AS help_requested_at,sessions.hint_level",
        [
            work_session_id.into(), body.state.clone().into(), help_requested.into(),
            body.hint_level.into(), user_id.into(),
        ],
    )).await?.ok_or_else(|| ApiError::coded(
        StatusCode::NOT_FOUND,
        "work_session_not_found",
        "Work Session not found.",
    ))?;
    let attempt_id: Uuid = get(&row, "attempt_id")?;
    state.database.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload) \
         SELECT run_id,id,'work_session_updated', \
                jsonb_build_object('state',$2::text,'helpRequested',$3::boolean,'hintLevel',$4::int) \
         FROM knowledge_activity_attempts WHERE id=$1",
        [
            attempt_id.into(), body.state.into(), help_requested.into(),
            get::<i32>(&row, "hint_level")?.into(),
        ],
    )).await?;
    Ok(Json(json!({
        "id": work_session_id,
        "state": get::<String>(&row, "state")?,
        "helpRequestedAt": get::<Option<String>>(&row, "help_requested_at")?,
        "hintLevel": get::<i32>(&row, "hint_level")?,
    }))
    .into_response())
}

async fn search_knowledge(
    state: &AppState,
    user_id: &str,
    attempt_id: Uuid,
    body: SearchKnowledge,
) -> Result<Response, ApiError> {
    let query = bounded(&body.query, 2, 1_000)?;
    if !(1..=6).contains(&body.limit) {
        return Err(invalid_request());
    }
    let limits = limits_for_user(state, user_id).await?;
    state
        .services
        .consume_rate(
            "knowledge.search",
            user_id,
            i32::try_from(limits.knowledge_queries_per_minute).unwrap_or(i32::MAX),
            60_000,
        )
        .await?;
    let rows = state.database.query_all_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT chunks.body,chunks.locator,sources.display_name,sources.virtual_path,sources.role, \
                versions.id AS source_version_id, \
                ts_rank_cd(chunks.search_vector,websearch_to_tsquery('simple',$3)) AS rank \
         FROM knowledge_activity_attempts attempts \
         JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id \
         JOIN knowledge_activity_version_sources pinned ON pinned.activity_version_id=runs.activity_version_id \
         JOIN knowledge_source_versions versions ON versions.id=pinned.source_version_id \
         JOIN knowledge_sources sources ON sources.id=versions.source_id \
         JOIN knowledge_source_chunks chunks ON chunks.source_version_id=versions.id \
         WHERE attempts.id=$1 AND attempts.user_id=$2 AND versions.state='ready' \
           AND chunks.search_vector @@ websearch_to_tsquery('simple',$3) \
         ORDER BY rank DESC,chunks.ordinal LIMIT $4",
        [attempt_id.into(), user_id.into(), query.into(), body.limit.into()],
    )).await?;
    let mut character_count = 0_usize;
    let row_count = rows.len();
    let mut results = Vec::new();
    let mut clipped_any = false;
    for row in rows {
        let text: String = get(&row, "body")?;
        let remaining = 12_000_usize.saturating_sub(character_count);
        if remaining == 0 {
            break;
        }
        let text_characters = text.chars().count();
        let clipped = text.chars().take(remaining.min(4_000)).collect::<String>();
        clipped_any |= clipped.chars().count() < text_characters;
        character_count += clipped.chars().count();
        results.push(json!({
            "snippet": clipped,
            "locator": get::<Value>(&row, "locator")?,
            "sourceTitle": get::<String>(&row, "display_name")?,
            "role": get::<String>(&row, "role")?,
            "score": get::<f32>(&row, "rank")?,
        }));
    }
    let truncated = clipped_any || results.len() < row_count || character_count >= 12_000;
    Ok(Json(json!({ "results": results, "truncated": truncated })).into_response())
}

#[allow(clippy::too_many_lines)]
async fn record_evidence(
    state: &AppState,
    user_id: &str,
    attempt_id: Uuid,
    body: RecordEvidence,
) -> Result<Response, ApiError> {
    if !matches!(body.provenance.as_str(), "participant" | "agent_candidate")
        || !matches!(
            body.result_code.as_str(),
            "observed" | "passed" | "failed" | "blocked" | "needs_review"
        )
    {
        return Err(ApiError::coded(
            StatusCode::FORBIDDEN,
            "evidence_forbidden",
            "Evidence is not permitted for this Attempt.",
        ));
    }
    let criterion_id = bounded(&body.criterion_id, 1, 80)?;
    let tag = bounded(&body.tag, 1, 80)?;
    let authority = state
        .database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT versions.definition,runs.insight_policy,runs.insight_policy_version, \
                attempts.acknowledged_policy_version \
         FROM knowledge_activity_work_sessions sessions \
         JOIN knowledge_activity_attempts attempts ON attempts.id=sessions.attempt_id \
         JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id \
         JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id \
         WHERE sessions.id=$1 AND attempts.id=$2 AND attempts.user_id=$3",
            [
                body.work_session_id.into(),
                attempt_id.into(),
                user_id.into(),
            ],
        ))
        .await?
        .ok_or_else(|| {
            ApiError::coded(
                StatusCode::NOT_FOUND,
                "attempt_not_found",
                "Attempt not found.",
            )
        })?;
    let definition: Value = get(&authority, "definition")?;
    let criterion_allowed = definition
        .get("criteria")
        .and_then(Value::as_array)
        .is_some_and(|criteria| {
            criteria.iter().any(|criterion| {
                criterion.get("id").and_then(Value::as_str) == Some(criterion_id.as_str())
                    && criterion
                        .get("tags")
                        .and_then(Value::as_array)
                        .is_some_and(|tags| {
                            tags.iter()
                                .any(|value| value.as_str() == Some(tag.as_str()))
                        })
            })
        });
    let policy_allowed = body.provenance == "participant"
        || (get::<String>(&authority, "insight_policy")? == "evidence_candidates"
            && get::<Option<String>>(&authority, "acknowledged_policy_version")?
                == Some(get::<String>(&authority, "insight_policy_version")?));
    if !criterion_allowed || !policy_allowed {
        return Err(ApiError::coded(
            StatusCode::FORBIDDEN,
            "evidence_forbidden",
            "Evidence is not permitted for this Attempt.",
        ));
    }
    let transaction = state.database.begin().await?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [format!("evidence:{}", body.work_session_id).into()],
        ))
        .await?;
    if body.provenance == "agent_candidate" {
        let count = transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT COUNT(*)::INTEGER AS value FROM knowledge_activity_evidence \
             WHERE work_session_id=$1 AND provenance='agent_candidate'",
                [body.work_session_id.into()],
            ))
            .await?
            .ok_or_else(ApiError::internal)?;
        if get::<i32>(&count, "value")? >= 20 {
            transaction.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::TOO_MANY_REQUESTS,
                "evidence_limit",
                "This Work Session reached its evidence limit.",
            ));
        }
    }
    let row = transaction.query_one_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO knowledge_activity_evidence \
           (client_id,attempt_id,work_session_id,criterion_id,tag,provenance,result_code,created_by) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) \
         ON CONFLICT (attempt_id,client_id) DO UPDATE SET client_id=EXCLUDED.client_id \
         RETURNING id,criterion_id,tag,provenance,result_code,created_at::TEXT AS created_at",
        [
            body.client_id.into(), attempt_id.into(), body.work_session_id.into(),
            criterion_id.into(), tag.into(), body.provenance.into(), body.result_code.into(), user_id.into(),
        ],
    )).await?.ok_or_else(ApiError::internal)?;
    transaction.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "id": get::<Uuid>(&row, "id")?,
            "criterionId": get::<String>(&row, "criterion_id")?,
            "tag": get::<String>(&row, "tag")?,
            "provenance": get::<String>(&row, "provenance")?,
            "resultCode": get::<String>(&row, "result_code")?,
            "createdAt": get::<String>(&row, "created_at")?,
        })),
    )
        .into_response())
}

#[allow(clippy::too_many_lines)]
async fn dashboard(
    state: &AppState,
    user_id: &str,
    space_id: Uuid,
    run_id: Uuid,
    since: Option<i64>,
) -> Result<Response, ApiError> {
    require_role(state, user_id, space_id, true).await?;
    if since.is_some_and(|value| value < 0) {
        return Err(invalid_request());
    }
    if let Some(sequence) = since {
        let rows = state
            .database
            .query_all_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT sequence,event_type,payload,created_at::TEXT AS created_at \
             FROM knowledge_activity_run_events WHERE run_id=$1 AND sequence>$2 \
             ORDER BY sequence LIMIT 1000",
                [run_id.into(), sequence.into()],
            ))
            .await?;
        let events = rows
            .iter()
            .map(|row| {
                Ok(json!({
                    "sequence": get::<i64>(row, "sequence")?,
                    "type": get::<String>(row, "event_type")?,
                    "payload": get::<Value>(row, "payload")?,
                    "createdAt": get::<String>(row, "created_at")?,
                }))
            })
            .collect::<Result<Vec<_>, ApiError>>()?;
        let maximum = events
            .last()
            .and_then(|event| event["sequence"].as_i64())
            .unwrap_or(sequence);
        return Ok(
            Json(json!({ "kind": "delta", "events": events, "maxSequence": maximum }))
                .into_response(),
        );
    }
    let rows = state.database.query_all_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT attempts.id,attempts.user_id,attempts.state,attempts.updated_at::TEXT AS updated_at, \
                COUNT(DISTINCT sessions.id)::INTEGER AS session_count, \
                COUNT(DISTINCT evidence.id)::INTEGER AS evidence_count, \
                GREATEST(MAX(sessions.help_requested_at),MAX(help.requested_at))::TEXT AS help_requested_at \
         FROM knowledge_activity_runs runs JOIN knowledge_activity_attempts attempts ON attempts.run_id=runs.id \
         LEFT JOIN knowledge_activity_work_sessions sessions ON sessions.attempt_id=attempts.id \
         LEFT JOIN knowledge_activity_evidence evidence ON evidence.attempt_id=attempts.id \
         LEFT JOIN knowledge_attempt_help_requests help ON help.attempt_id=attempts.id AND help.resolved_at IS NULL \
         WHERE runs.id=$1 AND runs.space_id=$2 GROUP BY attempts.id \
         ORDER BY attempts.updated_at DESC LIMIT 500",
        [run_id.into(), space_id.into()],
    )).await?;
    let participants = rows
        .iter()
        .map(|row| {
            Ok(json!({
                "id": get::<String>(row, "user_id")?,
                "attemptId": get::<Uuid>(row, "id")?,
                "state": get::<String>(row, "state")?,
                "updatedAt": get::<String>(row, "updated_at")?,
                "sessionCount": get::<i32>(row, "session_count")?,
                "evidenceCount": get::<i32>(row, "evidence_count")?,
                "helpRequestedAt": get::<Option<String>>(row, "help_requested_at")?,
            }))
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    let maximum = state.database.query_one_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT COALESCE(MAX(events.sequence),0) AS value \
         FROM knowledge_activity_run_events events JOIN knowledge_activity_runs runs ON runs.id=events.run_id \
         WHERE events.run_id=$1 AND runs.space_id=$2",
        [run_id.into(), space_id.into()],
    )).await?.ok_or_else(ApiError::internal)?;
    let evidence = state.database.query_all_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT evidence.criterion_id,COUNT(DISTINCT evidence.attempt_id)::INTEGER AS participant_count, \
                COUNT(*) FILTER (WHERE evidence.provenance='agent_candidate')::INTEGER AS agent_candidate_count, \
                COUNT(DISTINCT evidence.provenance)::INTEGER AS corroborated_count \
         FROM knowledge_activity_evidence evidence \
         JOIN knowledge_activity_attempts attempts ON attempts.id=evidence.attempt_id \
         JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id \
         WHERE runs.id=$1 AND runs.space_id=$2 GROUP BY evidence.criterion_id \
         ORDER BY participant_count DESC,evidence.criterion_id LIMIT 100",
        [run_id.into(), space_id.into()],
    )).await?;
    let criterion_evidence = evidence
        .iter()
        .map(|row| {
            Ok(json!({
                "criterionId": get::<String>(row, "criterion_id")?,
                "participantCount": get::<i32>(row, "participant_count")?,
                "agentCandidateCount": get::<i32>(row, "agent_candidate_count")?,
                "corroboratedCount": get::<i32>(row, "corroborated_count")?,
            }))
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    let mut counts = serde_json::Map::new();
    let mut help_queue = Vec::new();
    for participant in &participants {
        if let Some(state) = participant.get("state").and_then(Value::as_str) {
            let next = counts
                .get(state)
                .and_then(Value::as_i64)
                .unwrap_or(0)
                .saturating_add(1);
            counts.insert(state.to_owned(), json!(next));
        }
        if participant
            .get("helpRequestedAt")
            .is_some_and(|value| !value.is_null())
        {
            help_queue.push(participant.clone());
        }
    }
    help_queue.sort_by(|left, right| {
        left.get("helpRequestedAt")
            .and_then(Value::as_str)
            .unwrap_or("")
            .cmp(
                right
                    .get("helpRequestedAt")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
            )
    });
    let mut suggestions = Vec::new();
    for participant in &participants {
        let help_requested = participant
            .get("helpRequestedAt")
            .is_some_and(|value| !value.is_null());
        let blocked = participant.get("state").and_then(Value::as_str) == Some("blocked")
            && participant
                .get("sessionCount")
                .and_then(Value::as_i64)
                .unwrap_or(0)
                >= 2;
        if help_requested || blocked {
            suggestions.push(json!({
                "kind": "individual_follow_up",
                "participantId": participant.get("id").cloned().unwrap_or(Value::Null),
                "reason": if help_requested { "explicit_help_request" } else { "repeated_blocked_sessions" },
            }));
        }
    }
    if participants.len() >= 5 {
        for item in &criterion_evidence {
            let participant_count = item
                .get("participantCount")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let corroborated_count = item
                .get("corroboratedCount")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let agent_candidate_count = item
                .get("agentCandidateCount")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let participant_count = u32::try_from(participant_count).unwrap_or(u32::MAX);
            let participant_total = u32::try_from(participants.len()).unwrap_or(u32::MAX);
            let ratio = f64::from(participant_count) / f64::from(participant_total);
            if participant_count >= 5 && ratio >= 0.3 && corroborated_count >= 2 {
                suggestions.push(json!({
                    "kind": "group_clarification",
                    "criterionId": item.get("criterionId").cloned().unwrap_or(Value::Null),
                    "participantCount": participant_count,
                    "activeParticipants": participants.len(),
                    "confidence": if ratio >= 0.6 { "high" } else { "moderate" },
                }));
            } else if agent_candidate_count > 0 {
                suggestions.push(json!({
                    "kind": "review_evidence",
                    "criterionId": item.get("criterionId").cloned().unwrap_or(Value::Null),
                }));
            }
        }
    }
    Ok(Json(json!({
        "kind": "snapshot",
        "participants": participants,
        "criterionEvidence": criterion_evidence.clone(),
        "counts": counts,
        "helpQueue": help_queue,
        "suggestions": suggestions,
        "patterns": criterion_evidence,
        "maxSequence": get::<i64>(&maximum, "value")?,
    }))
    .into_response())
}

async fn require_role(
    state: &AppState,
    user_id: &str,
    space_id: Uuid,
    manage: bool,
) -> Result<String, ApiError> {
    let row = state
        .database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT role FROM knowledge_space_members \
         WHERE space_id=$1 AND user_id=$2 AND removed_at IS NULL",
            [space_id.into(), user_id.into()],
        ))
        .await?
        .ok_or_else(|| {
            ApiError::coded(StatusCode::NOT_FOUND, "space_not_found", "Space not found.")
        })?;
    let role: String = get(&row, "role")?;
    if manage && role == "participant" {
        return Err(ApiError::coded(
            StatusCode::FORBIDDEN,
            "space_permission_denied",
            "You do not have permission for this Space operation.",
        ));
    }
    Ok(role)
}

async fn read_json<T: for<'de> Deserialize<'de>>(request: Request) -> Result<T, ApiError> {
    let content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !content_type
        .to_ascii_lowercase()
        .starts_with("application/json")
    {
        return Err(ApiError::coded(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "invalid_content_type",
            "Content-Type must be application/json.",
        ));
    }
    let bytes = to_bytes(request.into_body(), MAX_BODY).await.map_err(|_| {
        ApiError::coded(
            StatusCode::PAYLOAD_TOO_LARGE,
            "body_too_large",
            "Request body is too large.",
        )
    })?;
    serde_json::from_slice(&bytes).map_err(|_| invalid_request())
}

#[allow(clippy::too_many_lines)]
fn validate_activity_definition(value: &Value) -> Result<Value, ApiError> {
    let mut object = value.as_object().ok_or_else(invalid_request)?.clone();
    let require_string = |key: &str, minimum: usize, maximum: usize| -> Result<(), ApiError> {
        let text = object
            .get(key)
            .and_then(Value::as_str)
            .ok_or_else(invalid_request)?;
        let length = text.trim().chars().count();
        if !(minimum..=maximum).contains(&length) {
            return Err(invalid_request());
        }
        Ok(())
    };
    require_string("title", 1, 240)?;
    require_string("objective", 1, 4_000)?;
    require_string("instructions", 1, 24_000)?;
    if !matches!(
        object.get("launchTarget").and_then(Value::as_str),
        Some("none" | "workspace" | "current_surface")
    ) || serde_json::to_vec(value)
        .map_err(|_| invalid_request())?
        .len()
        > 65_000
    {
        return Err(invalid_request());
    }
    let guidance = object
        .entry("guidancePolicy")
        .or_insert_with(|| {
            json!({
                "answerReveal": "allowed", "hintMode": "guided", "maxHintLevel": 3,
            })
        })
        .as_object()
        .ok_or_else(invalid_request)?;
    if !matches!(
        guidance.get("answerReveal").and_then(Value::as_str),
        Some("allowed" | "after_attempt" | "never")
    ) || !matches!(
        guidance.get("hintMode").and_then(Value::as_str),
        Some("direct" | "guided" | "socratic")
    ) || !guidance
        .get("maxHintLevel")
        .and_then(Value::as_i64)
        .is_some_and(|value| (0..=5).contains(&value))
    {
        return Err(invalid_request());
    }
    let completion = object
        .entry("completionPolicy")
        .or_insert_with(|| {
            json!({
                "requiresSubmission": false, "requiresFacilitatorConfirmation": false,
            })
        })
        .as_object()
        .ok_or_else(invalid_request)?;
    if completion
        .get("requiresSubmission")
        .and_then(Value::as_bool)
        .is_none()
        || completion
            .get("requiresFacilitatorConfirmation")
            .and_then(Value::as_bool)
            .is_none()
    {
        return Err(invalid_request());
    }
    let criteria = object
        .entry("criteria")
        .or_insert_with(|| json!([]))
        .as_array()
        .ok_or_else(invalid_request)?;
    if criteria.len() > 40 {
        return Err(invalid_request());
    }
    for criterion in criteria {
        let criterion = criterion.as_object().ok_or_else(invalid_request)?;
        let id = criterion
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(invalid_request)?;
        let valid_id = (1..=80).contains(&id.trim().chars().count())
            && id.bytes().enumerate().all(|(index, byte)| {
                byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || (index > 0 && matches!(byte, b'_' | b'-'))
            });
        let title = criterion
            .get("title")
            .and_then(Value::as_str)
            .ok_or_else(invalid_request)?;
        let description = criterion
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("");
        let tags = criterion
            .get("tags")
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice);
        if !valid_id
            || !(1..=240).contains(&title.trim().chars().count())
            || description.trim().chars().count() > 2_000
            || tags.len() > 20
            || tags.iter().any(|tag| {
                !tag.as_str()
                    .is_some_and(|text| (1..=80).contains(&text.trim().chars().count()))
            })
        {
            return Err(invalid_request());
        }
    }
    Ok(Value::Object(object))
}

fn parse_optional_datetime(value: Option<&str>) -> Result<Option<OffsetDateTime>, ApiError> {
    value
        .map(|text| OffsetDateTime::parse(text, &Rfc3339).map_err(|_| invalid_request()))
        .transpose()
}

async fn limits_for_user(state: &AppState, user_id: &str) -> Result<PlanLimits, ApiError> {
    let row = state
        .database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT plan FROM users WHERE id=$1",
            [user_id.into()],
        ))
        .await?
        .ok_or_else(ApiError::internal)?;
    let plan = match get::<String>(&row, "plan")?.as_str() {
        "basic" => PlanId::Basic,
        "pro" => PlanId::Pro,
        "max" => PlanId::Max,
        _ => PlanId::Free,
    };
    Ok(plan_limits(plan))
}

fn canonical_json(value: &Value) -> Result<String, ApiError> {
    fn sorted(value: &Value) -> Value {
        match value {
            Value::Object(map) => {
                let mut keys = map.keys().collect::<Vec<_>>();
                keys.sort();
                let mut output = serde_json::Map::new();
                for key in keys {
                    output.insert(key.clone(), sorted(&map[key]));
                }
                Value::Object(output)
            }
            Value::Array(items) => Value::Array(items.iter().map(sorted).collect()),
            other => other.clone(),
        }
    }
    serde_json::to_string(&sorted(value)).map_err(|_| ApiError::internal())
}

fn work_session_json(row: &QueryResult) -> Result<Value, ApiError> {
    Ok(json!({
        "id": get::<Uuid>(row, "id")?,
        "state": get::<String>(row, "state")?,
        "taskId": get::<Uuid>(row, "task_id")?,
        "launchKind": get::<String>(row, "launch_kind")?,
        "createdAt": get::<String>(row, "created_at")?,
    }))
}

fn parse_uuid(value: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(value).map_err(|_| invalid_request())
}

fn bounded(value: &str, minimum: usize, maximum: usize) -> Result<String, ApiError> {
    let value = value.trim();
    if !(minimum..=maximum).contains(&value.chars().count()) {
        return Err(invalid_request());
    }
    Ok(value.to_owned())
}

fn invalid_request() -> ApiError {
    ApiError::coded(
        StatusCode::BAD_REQUEST,
        "invalid_request",
        "Request data is invalid.",
    )
}

fn get<T: sea_orm::TryGetable>(row: &QueryResult, column: &str) -> Result<T, ApiError> {
    row.try_get("", column).map_err(|_| ApiError::internal())
}
