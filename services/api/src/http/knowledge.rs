use std::{collections::HashSet, time::Duration};

use axum::{
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::Response,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use bytes::Bytes;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Row, postgres::PgRow};
use uuid::Uuid;

use crate::{
    app::AppState,
    error::{ApiError, ApiResult},
    http::{
        bearer, classroom,
        core::{access, session},
        json_response, read_json, request_ip,
    },
    usage::{Plan, plan_for},
    validation::{api_uuid, js_string_len, zod_uuid},
};

pub async fn handle(
    state: &AppState,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Option<Response>> {
    let path = uri.path();
    let reads_capabilities = method == Method::GET && path == "/v1/capabilities";
    if !reads_capabilities && !matches_knowledge(path) {
        return Ok(None);
    }
    let current = session(state, headers).await.map_err(|error| {
        if error.status != StatusCode::UNAUTHORIZED {
            return error;
        }
        if bearer(headers).is_none() {
            ApiError::coded(
                StatusCode::UNAUTHORIZED,
                "authentication_required",
                "Sign in to continue.",
            )
        } else {
            ApiError::coded(
                StatusCode::UNAUTHORIZED,
                "session_expired",
                "Your session expired. Sign in again.",
            )
        }
    })?;
    let knowledge_spaces_enabled = state.knowledge.enabled_for(&current.user.id).await?;
    if reads_capabilities {
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"knowledgeSpaces":{"enabled":knowledge_spaces_enabled,"contractVersion":2},"classroomBroadcasts":{"contractVersion":1},"classroomGuidance":{"contractVersion":1}}),
        )?));
    }
    if !knowledge_spaces_enabled {
        return Err(ApiError::coded(
            StatusCode::FORBIDDEN,
            "knowledge_spaces_disabled",
            "Knowledge Spaces are disabled for this account.",
        ));
    }
    let membership = access(state, &current).await.map_err(|error| {
        if error.status == StatusCode::FORBIDDEN {
            ApiError::coded(
                StatusCode::FORBIDDEN,
                "access_required",
                "Enter a valid access code to use TroCode.",
            )
        } else {
            error
        }
    })?;
    let plan = plan_for(membership.plan.as_deref().unwrap_or("free"))?;
    let joins_room = method == Method::POST && path == "/v1/live-rooms/join";
    let scope = if joins_room {
        "classroom.join"
    } else if method == Method::POST && path.ends_with("/knowledge/search") {
        "knowledge.search"
    } else if method == Method::POST
        && (path.ends_with("/uploads/initiate") || path.ends_with("/submissions/initiate"))
    {
        "knowledge.upload"
    } else if method == Method::GET {
        "knowledge.read"
    } else {
        "knowledge.write"
    };
    let rate = if joins_room {
        12
    } else if scope == "knowledge.search" {
        plan.knowledge_queries_per_minute
    } else if scope == "knowledge.upload" {
        plan.upload_initiates_per_minute
    } else if method == Method::GET {
        180
    } else {
        60
    };
    let consumed = state
        .rate_limiter
        .consume(scope, &current.user.id, rate, Duration::from_secs(60))
        .await?;
    if !consumed.allowed {
        return Err(ApiError::coded(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many requests. Please try again shortly.",
        )
        .retry_after(consumed.retry_after_seconds));
    }
    if joins_room {
        let peer = state
            .rate_limiter
            .consume(
                "classroom.join.peer",
                request_ip(headers),
                2_400,
                Duration::from_secs(60),
            )
            .await?;
        if !peer.allowed {
            return Err(ApiError::coded(
                StatusCode::TOO_MANY_REQUESTS,
                "room_join_rate_limited",
                "Too many room join attempts from this network. Try again shortly.",
            )
            .retry_after(peer.retry_after_seconds));
        }
    }
    let response = route(state, &current.user.id, plan, method, uri, headers, body).await?;
    Ok(Some(response))
}
fn matches_knowledge(path: &str) -> bool {
    path.starts_with("/v1/live-rooms")
        || path.starts_with("/v1/spaces")
        || path.starts_with("/v1/activities")
        || path.starts_with("/v1/runs")
        || path.starts_with("/v1/attempts")
        || path.starts_with("/v1/work-sessions")
        || matches!(
            path,
            "/v1/uploads/complete" | "/v1/assignments/me" | "/v1/space-invites/redeem"
        )
}
async fn route(
    state: &AppState,
    user: &str,
    plan: Plan,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Response> {
    if let Some(response) = classroom::route(state, user, plan, method, uri, headers, body).await? {
        return Ok(response);
    }
    let path = uri.path();
    let parts: Vec<_> = path.trim_start_matches('/').split('/').collect();
    if method == Method::GET && path == "/v1/spaces" {
        return json_response(StatusCode::OK, state.knowledge.list_spaces(user).await?);
    }
    if method == Method::POST && path == "/v1/spaces" {
        let input = read_json(headers, body, 64_000)?;
        let (new, result) = state.knowledge.create_space(user, &input, plan).await?;
        let mut response = json_response(
            if new {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            },
            result.clone(),
        )?;
        if let Some(id) = result.pointer("/space/id").and_then(Value::as_str) {
            response.headers_mut().insert(
                "location",
                HeaderValue::from_str(&format!("/v1/spaces/{id}")).map_err(ApiError::internal)?,
            );
        }
        return Ok(response);
    }
    if method == Method::POST && path == "/v1/space-invites/redeem" {
        let input = read_json(headers, body, 16_000)?;
        let code = input
            .as_object()
            .filter(|map| map.len() == 1)
            .and_then(|map| map.get("code"))
            .and_then(Value::as_str)
            .filter(|value| (8..=128).contains(&js_string_len(value.trim())))
            .ok_or_else(invalid)?;
        return json_response(
            StatusCode::OK,
            state.knowledge.redeem_invite(user, code).await?,
        );
    }
    if parts.len() >= 3 && parts[0] == "v1" && parts[1] == "spaces" {
        let space = parse_uuid(parts[2])?;
        if parts.len() == 3 && method == Method::GET {
            return json_response(
                StatusCode::OK,
                state.knowledge.get_space(user, space).await?,
            );
        }
        if parts.len() == 4 && parts[3] == "sources" && method == Method::GET {
            return json_response(
                StatusCode::OK,
                state.knowledge.list_sources(user, space).await?,
            );
        }
        if parts.len() == 5
            && parts[3] == "uploads"
            && parts[4] == "initiate"
            && method == Method::POST
        {
            return initiate_upload(state, user, space, plan, headers, body, None).await;
        }
        if parts.len() == 4 && parts[3] == "groups" && method == Method::GET {
            return json_response(
                StatusCode::OK,
                state.knowledge.list_groups(user, space).await?,
            );
        }
        if parts.len() == 4 && parts[3] == "groups" && method == Method::POST {
            return json_response(
                StatusCode::CREATED,
                state
                    .knowledge
                    .create_group(user, space, &read_json(headers, body, 32_000)?)
                    .await?,
            );
        }
        if parts.len() == 4 && parts[3] == "members" && method == Method::GET {
            return json_response(
                StatusCode::OK,
                state.knowledge.list_members(user, space).await?,
            );
        }
        if parts.len() == 5 && parts[3] == "members" && parts[4] == "bulk" && method == Method::POST
        {
            return json_response(
                StatusCode::OK,
                state
                    .knowledge
                    .add_members(user, space, &read_json(headers, body, 200_000)?)
                    .await?,
            );
        }
        if parts.len() == 4 && parts[3] == "invites" && method == Method::POST {
            return json_response(
                StatusCode::CREATED,
                state
                    .knowledge
                    .create_invite(user, space, &read_json(headers, body, 32_000)?)
                    .await?,
            );
        }
        if parts.len() == 4 && parts[3] == "activities" && method == Method::POST {
            return save_activity(state, user, space, headers, body).await;
        }
        if parts.len() == 4 && parts[3] == "activities" && method == Method::GET {
            return list_published_activities(state, user, space).await;
        }
        if parts.len() == 6
            && parts[3] == "activities"
            && parts[5] == "publish"
            && method == Method::POST
        {
            return publish_activity(state, user, space, parse_uuid(parts[4])?, headers, body)
                .await;
        }
        if parts.len() == 4 && parts[3] == "runs" && method == Method::POST {
            return create_run(state, user, space, plan, headers, body).await;
        }
        if parts.len() == 4 && parts[3] == "sessions" && method == Method::GET {
            return list_class_sessions(state, user, space).await;
        }
        if parts.len() == 4 && parts[3] == "sessions" && method == Method::POST {
            return create_class_session(state, user, space, plan, headers, body).await;
        }
    }
    if method == Method::POST && path == "/v1/uploads/complete" {
        return complete_upload(state, user, headers, body).await;
    }
    if method == Method::GET && path == "/v1/assignments/me" {
        return assignments(state, user).await;
    }
    if parts.len() >= 3 && parts[0] == "v1" && parts[1] == "attempts" {
        let attempt = parse_uuid(parts[2])?;
        if parts.len() == 3 && method == Method::GET {
            return attempt_context(state, user, attempt).await;
        }
        if parts.len() == 4 && parts[3] == "starter-files" && method == Method::GET {
            return starter_files(state, user, attempt).await;
        }
        if parts.len() == 5
            && parts[3] == "submissions"
            && parts[4] == "initiate"
            && method == Method::POST
        {
            let attempt_context=sqlx::query("SELECT attempts.state,runs.space_id FROM knowledge_activity_attempts attempts JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id WHERE attempts.id=$1 AND attempts.user_id=$2").bind(attempt).bind(user).fetch_optional(&state.pool).await?.ok_or_else(||ApiError::coded(StatusCode::NOT_FOUND,"attempt_not_found","Attempt not found."))?;
            if !matches!(
                attempt_context.get::<String, _>("state").as_str(),
                "assigned" | "in_progress" | "blocked" | "ready_for_review"
            ) {
                return Err(ApiError::coded(
                    StatusCode::CONFLICT,
                    "attempt_not_active",
                    "This Attempt is waiting for review or no longer active.",
                ));
            }
            let space: Uuid = attempt_context.get("space_id");
            return initiate_upload(state, user, space, plan, headers, body, Some(attempt)).await;
        }
        if parts.len() == 5
            && parts[3] == "submissions"
            && parts[4] == "commit"
            && method == Method::POST
        {
            return commit_submission(state, user, attempt, headers, body).await;
        }
        if parts.len() == 4 && parts[3] == "acknowledge" && method == Method::POST {
            return acknowledge(state, user, attempt, headers, body).await;
        }
        if parts.len() == 4 && parts[3] == "work-sessions" && method == Method::POST {
            return create_work_session(state, user, attempt, headers, body).await;
        }
        if parts.len() == 5
            && parts[3] == "knowledge"
            && parts[4] == "search"
            && method == Method::POST
        {
            let input = read_json(headers, body, 16_000)?;
            strict_object(&input, &["query", "limit"])?;
            let query = input
                .get("query")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| (2..=1_000).contains(&js_string_len(value)))
                .ok_or_else(invalid)?;
            let limit = input.get("limit").and_then(Value::as_i64).unwrap_or(6);
            if !(1..=6).contains(&limit) {
                return Err(invalid());
            }
            return json_response(
                StatusCode::OK,
                state.knowledge.search(user, attempt, query, limit).await?,
            );
        }
        if parts.len() == 4 && parts[3] == "evidence" && method == Method::POST {
            return record_evidence(state, user, attempt, headers, body).await;
        }
    }
    if parts.len() == 3
        && parts[0] == "v1"
        && parts[1] == "work-sessions"
        && method == Method::PATCH
    {
        return update_work_session(state, user, parse_uuid(parts[2])?, headers, body).await;
    }
    Err(ApiError::new(StatusCode::NOT_FOUND, "Endpoint not found."))
}
fn invalid() -> ApiError {
    ApiError::coded(
        StatusCode::BAD_REQUEST,
        "invalid_request",
        "Request data is invalid.",
    )
}
fn knowledge_storage_unavailable() -> ApiError {
    ApiError::coded(
        StatusCode::SERVICE_UNAVAILABLE,
        "knowledge_storage_unavailable",
        "Knowledge file storage is not configured.",
    )
}
fn strict_object(input: &Value, allowed: &[&str]) -> ApiResult<()> {
    if input
        .as_object()
        .is_none_or(|object| object.keys().any(|key| !allowed.contains(&key.as_str())))
    {
        Err(invalid())
    } else {
        Ok(())
    }
}
fn trimmed_string(input: &Value, key: &str, min: usize, max: usize) -> ApiResult<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| (min..=max).contains(&js_string_len(value)))
        .map(ToOwned::to_owned)
        .ok_or_else(invalid)
}
fn normalize_activity_definition(input: &Value) -> ApiResult<Value> {
    let _ = input.as_object().ok_or_else(invalid)?;
    let title = trimmed_string(input, "title", 1, 240)?;
    let objective = trimmed_string(input, "objective", 1, 4_000)?;
    let instructions = trimmed_string(input, "instructions", 1, 24_000)?;
    let launch_target = input
        .get("launchTarget")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "none" | "workspace" | "current_surface"))
        .ok_or_else(invalid)?;

    let empty_guidance = Value::Object(serde_json::Map::new());
    let guidance = input.get("guidancePolicy").unwrap_or(&empty_guidance);
    if !guidance.is_object() {
        return Err(invalid());
    }
    let answer_reveal = match guidance.get("answerReveal") {
        None => "allowed",
        Some(value) => value.as_str().ok_or_else(invalid)?,
    };
    let hint_mode = match guidance.get("hintMode") {
        None => "guided",
        Some(value) => value.as_str().ok_or_else(invalid)?,
    };
    let max_hint_level = match guidance.get("maxHintLevel") {
        None => 3,
        Some(value) => value.as_i64().ok_or_else(invalid)?,
    };
    if !matches!(answer_reveal, "allowed" | "after_attempt" | "never")
        || !matches!(hint_mode, "direct" | "guided" | "socratic")
        || !(0..=5).contains(&max_hint_level)
    {
        return Err(invalid());
    }

    let raw_criteria = match input.get("criteria") {
        None => &[][..],
        Some(value) => value.as_array().map(Vec::as_slice).ok_or_else(invalid)?,
    };
    if raw_criteria.len() > 40 {
        return Err(invalid());
    }
    let mut criteria = Vec::with_capacity(raw_criteria.len());
    for criterion in raw_criteria {
        let id = trimmed_string(criterion, "id", 1, 80)?;
        if !id.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (index > 0 && matches!(byte, b'_' | b'-'))
        }) {
            return Err(invalid());
        }
        let criterion_title = trimmed_string(criterion, "title", 1, 240)?;
        let description = match criterion.get("description") {
            None => String::new(),
            Some(value) => value
                .as_str()
                .map(str::trim)
                .filter(|value| js_string_len(value) <= 2_000)
                .map(ToOwned::to_owned)
                .ok_or_else(invalid)?,
        };
        let raw_tags = match criterion.get("tags") {
            None => &[][..],
            Some(value) => value.as_array().map(Vec::as_slice).ok_or_else(invalid)?,
        };
        if raw_tags.len() > 20 {
            return Err(invalid());
        }
        let tags = raw_tags
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(str::trim)
                    .filter(|value| (1..=80).contains(&js_string_len(value)))
                    .map(ToOwned::to_owned)
                    .ok_or_else(invalid)
            })
            .collect::<ApiResult<Vec<_>>>()?;
        criteria.push(json!({
            "id": id,
            "title": criterion_title,
            "description": description,
            "tags": tags,
        }));
    }

    let empty_completion = Value::Object(serde_json::Map::new());
    let completion = input.get("completionPolicy").unwrap_or(&empty_completion);
    if !completion.is_object() {
        return Err(invalid());
    }
    let requires_submission = match completion.get("requiresSubmission") {
        None => false,
        Some(value) => value.as_bool().ok_or_else(invalid)?,
    };
    let requires_facilitator_confirmation = match completion.get("requiresFacilitatorConfirmation")
    {
        None => false,
        Some(value) => value.as_bool().ok_or_else(invalid)?,
    };

    let empty_session = Value::Object(serde_json::Map::new());
    let session = input.get("sessionPolicy").unwrap_or(&empty_session);
    if !session.is_object() {
        return Err(invalid());
    }
    let allow_room_join = match session.get("allowRoomJoin") {
        None => false,
        Some(value) => value.as_bool().ok_or_else(invalid)?,
    };
    let raw_origins = match session.get("allowedOrigins") {
        None => &[][..],
        Some(value) => value.as_array().map(Vec::as_slice).ok_or_else(invalid)?,
    };
    if raw_origins.len() > 20 {
        return Err(invalid());
    }
    let allowed_origins = raw_origins
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::trim)
                .filter(|value| js_string_len(value) <= 2_000)
                .and_then(crate::classroom::validated_origin)
                .ok_or_else(invalid)
        })
        .collect::<ApiResult<Vec<_>>>()?;

    Ok(json!({
        "title": title,
        "objective": objective,
        "instructions": instructions,
        "launchTarget": launch_target,
        "guidancePolicy": {
            "answerReveal": answer_reveal,
            "hintMode": hint_mode,
            "maxHintLevel": max_hint_level,
        },
        "criteria": criteria,
        "completionPolicy": {
            "requiresSubmission": requires_submission,
            "requiresFacilitatorConfirmation": requires_facilitator_confirmation,
        },
        "sessionPolicy": {
            "allowRoomJoin": allow_room_join,
            "allowedOrigins": allowed_origins,
        },
    }))
}
fn parse_uuid(value: &str) -> ApiResult<Uuid> {
    api_uuid(value).ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Endpoint not found."))
}
fn required_uuid(input: &Value, key: &str) -> ApiResult<Uuid> {
    let value = input.get(key).and_then(Value::as_str).ok_or_else(invalid)?;
    zod_uuid(value).ok_or_else(invalid)
}
fn optional_timestamp(input: &Value, key: &str) -> ApiResult<Option<time::OffsetDateTime>> {
    input
        .get(key)
        .filter(|value| !value.is_null())
        .map(|value| {
            value.as_str().ok_or_else(invalid).and_then(|value| {
                time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
                    .map_err(|_| invalid())
            })
        })
        .transpose()
}
fn format_time(value: time::OffsetDateTime) -> String {
    value
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}
fn decode_hex(value: &str) -> ApiResult<Vec<u8>> {
    if value.len() != 64 {
        return Err(invalid());
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).map_err(|_| invalid()))
        .collect()
}
async fn initiate_upload(
    state: &AppState,
    user: &str,
    space: Uuid,
    plan: Plan,
    headers: &HeaderMap,
    body: &Bytes,
    attempt: Option<Uuid>,
) -> ApiResult<Response> {
    if attempt.is_none() {
        state
            .knowledge
            .role(user, space, &["owner", "facilitator"])
            .await?;
    }
    let input = read_json(headers, body, 2_000_000)?;
    let files = input
        .as_object()
        .filter(|map| map.len() == 1)
        .and_then(|map| map.get("files"))
        .and_then(Value::as_array)
        .filter(|files| !files.is_empty() && files.len() <= 100)
        .ok_or_else(invalid)?;
    if i64::try_from(files.len()).unwrap_or(i64::MAX) > plan.upload_files_per_batch {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "upload_file_quota",
            "This upload has too many files for the current plan.",
        ));
    }
    if files.iter().any(|file| {
        file.as_object().is_none_or(|object| {
            object.len() != 7
                || object.keys().any(|key| {
                    !matches!(
                        key.as_str(),
                        "byteSize"
                            | "clientId"
                            | "displayName"
                            | "mediaType"
                            | "relativePath"
                            | "role"
                            | "sha256"
                    )
                })
        })
    }) {
        return Err(invalid());
    }
    let mut parsed_files = Vec::with_capacity(files.len());
    for file in files {
        let client = required_uuid(file, "clientId")?;
        let name = file
            .get("displayName")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| (1..=255).contains(&js_string_len(value)))
            .map(ToOwned::to_owned)
            .ok_or_else(invalid)?;
        let path = file
            .get("relativePath")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| (1..=2_000).contains(&js_string_len(value)))
            .map(ToOwned::to_owned)
            .ok_or_else(invalid)?;
        let media = file
            .get("mediaType")
            .and_then(Value::as_str)
            .filter(|value| matches!(*value, "text/plain" | "text/markdown" | "application/pdf"))
            .map(ToOwned::to_owned)
            .ok_or_else(invalid)?;
        let size = file
            .get("byteSize")
            .and_then(Value::as_i64)
            .filter(|value| (1..=25 * 1024 * 1024).contains(value))
            .ok_or_else(invalid)?;
        let sha = file
            .get("sha256")
            .and_then(Value::as_str)
            .filter(|value| {
                value.len() == 64
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            })
            .map(ToOwned::to_owned)
            .ok_or_else(invalid)?;
        let supplied_role = file
            .get("role")
            .and_then(Value::as_str)
            .filter(|value| {
                matches!(
                    *value,
                    "reference" | "instructions" | "rubric" | "starter" | "submission"
                )
            })
            .ok_or_else(invalid)?;
        let role = attempt.map_or_else(|| supplied_role.to_owned(), |_| "submission".to_owned());
        parsed_files.push((client, name, path, media, size, sha, role));
    }
    let requested = parsed_files.iter().map(|file| file.4).sum::<i64>();
    if requested > 250 * 1024 * 1024 {
        return Err(invalid());
    }
    let storage_used: i64 = if attempt.is_some() {
        0
    } else {
        sqlx::query_scalar("SELECT COALESCE(SUM(versions.byte_size),0)::bigint FROM knowledge_source_versions versions JOIN knowledge_sources sources ON sources.id=versions.source_id JOIN knowledge_spaces spaces ON spaces.id=sources.space_id WHERE spaces.owner_user_id=$1 AND sources.archived_at IS NULL").bind(user).fetch_one(&state.pool).await?
    };
    if storage_used.saturating_add(requested) > plan.space_storage_bytes {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "storage_quota_reached",
            "This plan reached its Knowledge Space storage limit.",
        ));
    }
    let store = state
        .knowledge
        .object_store
        .as_ref()
        .ok_or_else(knowledge_storage_unavailable)?;
    let mut tx = state.pool.begin().await?;
    let mut pending = Vec::new();
    for (client, name, path, media, size, sha, role) in parsed_files {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!("source:{space}:{client}"))
            .execute(&mut *tx)
            .await?;
        if let Some(row)=sqlx::query("SELECT sources.id,versions.id version_id,versions.object_key,versions.byte_size,versions.sha256,versions.media_type,versions.state FROM knowledge_sources sources JOIN knowledge_source_versions versions ON versions.source_id=sources.id WHERE sources.space_id=$1 AND sources.client_id=$2 ORDER BY versions.version_number DESC LIMIT 1").bind(space).bind(client).fetch_optional(&mut*tx).await?{if row.get::<i64,_>("byte_size")!=size||row.get::<String,_>("sha256")!=sha||row.get::<String,_>("media_type")!=media{return Err(ApiError::coded(StatusCode::CONFLICT,"upload_conflict","Upload idempotency key conflicts with different file metadata."))}pending.push((row.get("id"),row.get("version_id"),row.get("object_key"),row.get::<String,_>("state"),size,media,sha,client));continue}
        let source:Uuid=sqlx::query_scalar("INSERT INTO knowledge_sources(client_id,space_id,display_name,virtual_path,role,created_by)VALUES($1,$2,$3,$4,$5,$6)RETURNING id").bind(client).bind(space).bind(name).bind(path).bind(role).bind(user).fetch_one(&mut*tx).await?;
        let key = format!("spaces/{space}/{}", Uuid::new_v4());
        let version:Uuid=sqlx::query_scalar("INSERT INTO knowledge_source_versions(source_id,version_number,state,media_type,byte_size,sha256,object_key,created_by)VALUES($1,1,'pending_upload',$2,$3,$4,$5,$6)RETURNING id").bind(source).bind(&media).bind(size).bind(&sha).bind(&key).bind(user).fetch_one(&mut*tx).await?;
        pending.push((
            source,
            version,
            key,
            "pending_upload".to_owned(),
            size,
            media.to_owned(),
            sha.to_owned(),
            client,
        ));
    }
    if let Some(attempt) = attempt {
        for (_, version, _, _, _, _, _, client) in &pending {
            sqlx::query("INSERT INTO knowledge_submission_artifacts(client_id,attempt_id,source_version_id,submitted_by)VALUES($1,$2,$3,$4)ON CONFLICT(attempt_id,client_id)DO NOTHING").bind(client).bind(attempt).bind(version).bind(user).execute(&mut*tx).await?;
        }
    }
    tx.commit().await?;
    let mut uploads = Vec::new();
    for (source, version, key, status, size, media, sha, _) in pending {
        let upload = if status == "pending_upload" {
            let checksum = STANDARD.encode(decode_hex(&sha)?);
            Some(store.put_ticket(&key, size, &media, &checksum).await?)
        } else {
            None
        };
        uploads.push(
            json!({"sourceId":source,"sourceVersionId":version,"state":status,"upload":upload}),
        );
    }
    json_response(StatusCode::CREATED, json!({"uploads":uploads}))
}
async fn complete_upload(
    state: &AppState,
    user: &str,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Response> {
    let input = read_json(headers, body, 32_000)?;
    if input.as_object().is_none_or(|object| {
        object.len() != 2
            || object
                .keys()
                .any(|key| !matches!(key.as_str(), "clientId" | "sourceVersionId"))
    }) {
        return Err(invalid());
    }
    let _ = required_uuid(&input, "clientId")?;
    let version = required_uuid(&input, "sourceVersionId")?;
    let row=sqlx::query("SELECT versions.object_key,versions.byte_size,versions.sha256,versions.media_type,versions.state FROM knowledge_source_versions versions JOIN knowledge_sources sources ON sources.id=versions.source_id LEFT JOIN knowledge_space_members members ON members.space_id=sources.space_id AND members.user_id=$2 AND members.removed_at IS NULL WHERE versions.id=$1 AND(members.role IN('owner','facilitator')OR EXISTS(SELECT 1 FROM knowledge_submission_artifacts artifacts JOIN knowledge_activity_attempts attempts ON attempts.id=artifacts.attempt_id WHERE artifacts.source_version_id=versions.id AND attempts.user_id=$2))").bind(version).bind(user).fetch_optional(&state.pool).await?.ok_or_else(||ApiError::coded(StatusCode::NOT_FOUND,"upload_not_found","Upload not found."))?;
    let status: String = row.get("state");
    if matches!(status.as_str(), "ready" | "processing") {
        return json_response(StatusCode::ACCEPTED, json!({"id":version,"state":status}));
    }
    let store = state
        .knowledge
        .object_store
        .as_ref()
        .ok_or_else(knowledge_storage_unavailable)?;
    let head = store.head(row.get("object_key")).await?;
    let checksum = STANDARD.encode(decode_hex(&row.get::<String, _>("sha256"))?);
    if head.byte_size != row.get::<i64, _>("byte_size")
        || head.media_type.as_deref() != Some(row.get::<String, _>("media_type").as_str())
        || head.checksum_base64.as_deref() != Some(&checksum)
    {
        return Err(ApiError::coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "upload_integrity_mismatch",
            "Uploaded object does not match the reviewed file.",
        ));
    }
    let mut tx = state.pool.begin().await?;
    let updated = sqlx::query_scalar::<_, Uuid>("UPDATE knowledge_source_versions SET state='processing'WHERE id=$1 AND state IN('pending_upload','processing')RETURNING id").bind(version).fetch_optional(&mut*tx).await?;
    if updated.is_none() {
        return Err(ApiError::coded(
            StatusCode::NOT_FOUND,
            "upload_not_found",
            "Upload not found.",
        ));
    }
    sqlx::query("INSERT INTO knowledge_ingestion_jobs(source_version_id)VALUES($1)ON CONFLICT(source_version_id)DO UPDATE SET state=CASE WHEN knowledge_ingestion_jobs.state='completed'THEN knowledge_ingestion_jobs.state ELSE'queued'END,available_at=CASE WHEN knowledge_ingestion_jobs.state='completed'THEN knowledge_ingestion_jobs.available_at ELSE NOW()END,updated_at=NOW()").bind(version).execute(&mut*tx).await?;
    tx.commit().await?;
    json_response(
        StatusCode::ACCEPTED,
        json!({"id":version,"state":"processing"}),
    )
}
async fn save_activity(
    state: &AppState,
    user: &str,
    space: Uuid,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Response> {
    state
        .knowledge
        .role(user, space, &["owner", "facilitator"])
        .await?;
    let input = read_json(headers, body, 128_000)?;
    strict_object(&input, &["clientId", "definition", "sourceVersionIds"])?;
    let client = required_uuid(&input, "clientId")?;
    let definition = normalize_activity_definition(input.get("definition").ok_or_else(invalid)?)?;
    let raw_sources = match input.get("sourceVersionIds") {
        None => Vec::new(),
        Some(value) => value.as_array().cloned().ok_or_else(invalid)?,
    };
    let sources = raw_sources
        .into_iter()
        .map(|value| {
            value
                .as_str()
                .ok_or_else(invalid)
                .and_then(|value| zod_uuid(value).ok_or_else(invalid))
        })
        .collect::<ApiResult<Vec<Uuid>>>()?;
    if sources.len() > 200 {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    let row=sqlx::query("INSERT INTO knowledge_activities(client_id,space_id,draft_definition,created_by)VALUES($1,$2,$3,$4)ON CONFLICT(space_id,client_id)DO UPDATE SET draft_definition=EXCLUDED.draft_definition,updated_at=NOW()RETURNING id,state,draft_definition,updated_at").bind(client).bind(space).bind(&definition).bind(user).fetch_one(&mut*tx).await?;
    let id: Uuid = row.get("id");
    sqlx::query("DELETE FROM knowledge_activity_draft_sources WHERE activity_id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    for source in sources {
        sqlx::query("INSERT INTO knowledge_activity_draft_sources(activity_id,source_version_id)SELECT $1,versions.id FROM knowledge_source_versions versions JOIN knowledge_sources sources ON sources.id=versions.source_id WHERE versions.id=$2 AND sources.space_id=$3 AND sources.role<>'submission'ON CONFLICT DO NOTHING").bind(id).bind(source).bind(space).execute(&mut*tx).await?;
    }
    tx.commit().await?;
    let value = json!({"id":id,"state":row.get::<String,_>("state"),"definition":row.get::<Value,_>("draft_definition"),"updatedAt":format_time(row.get("updated_at"))});
    let mut response = json_response(StatusCode::CREATED, value)?;
    response.headers_mut().insert(
        "location",
        HeaderValue::from_str(&format!("/v1/activities/{id}")).map_err(ApiError::internal)?,
    );
    Ok(response)
}
async fn publish_activity(
    state: &AppState,
    user: &str,
    space: Uuid,
    activity: Uuid,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Response> {
    state
        .knowledge
        .role(user, space, &["owner", "facilitator"])
        .await?;
    let input = read_json(headers, body, 32_000)?;
    strict_object(&input, &["clientId"])?;
    let _ = required_uuid(&input, "clientId")?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("publish:{activity}"))
        .execute(&mut *tx)
        .await?;
    let draft: Value = sqlx::query_scalar(
        "SELECT draft_definition FROM knowledge_activities WHERE id=$1 AND space_id=$2 FOR UPDATE",
    )
    .bind(activity)
    .bind(space)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        ApiError::coded(
            StatusCode::NOT_FOUND,
            "activity_not_found",
            "Activity not found.",
        )
    })?;
    let sources:Vec<Uuid>=sqlx::query_scalar("SELECT draft.source_version_id FROM knowledge_activity_draft_sources draft JOIN knowledge_source_versions versions ON versions.id=draft.source_version_id WHERE draft.activity_id=$1 AND versions.state='ready'ORDER BY draft.source_version_id").bind(activity).fetch_all(&mut*tx).await?;
    let hash = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&json!({"definition":draft,"sourceVersionIds":sources}))
                .map_err(ApiError::internal)?
        )
    );
    if let Some(row)=sqlx::query("SELECT id,version_number,published_at FROM knowledge_activity_versions WHERE activity_id=$1 AND content_hash=$2").bind(activity).bind(&hash).fetch_optional(&mut*tx).await?{tx.commit().await?;return json_response(StatusCode::OK,json!({"id":row.get::<Uuid,_>("id"),"versionNumber":row.get::<i32,_>("version_number"),"publishedAt":format_time(row.get("published_at")),"newlyCreated":false}))}
    let row=sqlx::query("INSERT INTO knowledge_activity_versions(activity_id,version_number,definition,content_hash,published_by)SELECT $1,COALESCE(MAX(version_number),0)+1,$2,$3,$4 FROM knowledge_activity_versions WHERE activity_id=$1 RETURNING id,version_number,published_at").bind(activity).bind(&draft).bind(hash).bind(user).fetch_one(&mut*tx).await?;
    let version: Uuid = row.get("id");
    for source in sources {
        sqlx::query("INSERT INTO knowledge_activity_version_sources(activity_version_id,source_version_id)VALUES($1,$2)").bind(version).bind(source).execute(&mut*tx).await?;
    }
    sqlx::query("UPDATE knowledge_activities SET state='published',updated_at=NOW()WHERE id=$1")
        .bind(activity)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    json_response(
        StatusCode::CREATED,
        json!({"id":version,"versionNumber":row.get::<i32,_>("version_number"),"publishedAt":format_time(row.get("published_at")),"newlyCreated":true}),
    )
}
async fn list_published_activities(
    state: &AppState,
    user: &str,
    space: Uuid,
) -> ApiResult<Response> {
    state
        .knowledge
        .role(user, space, &["owner", "facilitator"])
        .await?;
    let rows = sqlx::query(
        r#"SELECT DISTINCT ON (activities.id)
                  activities.id AS activity_id,versions.id AS version_id,
                  versions.version_number,versions.definition,versions.published_at
           FROM knowledge_activities activities
           JOIN knowledge_activity_versions versions ON versions.activity_id=activities.id
           WHERE activities.space_id=$1 AND activities.archived_at IS NULL
           ORDER BY activities.id,versions.version_number DESC"#,
    )
    .bind(space)
    .fetch_all(&state.pool)
    .await?;
    json_response(
        StatusCode::OK,
        json!({"items":rows.into_iter().map(|row|{
            let definition=row.get::<Value,_>("definition");
            json!({
                "activityId":row.get::<Uuid,_>("activity_id"),
                "versionId":row.get::<Uuid,_>("version_id"),
                "versionNumber":row.get::<i32,_>("version_number"),
                "title":definition.get("title"),
                "objective":definition.get("objective"),
                "criteria":definition.get("criteria").cloned().unwrap_or_else(||json!([])),
                "allowRoomJoin":definition.pointer("/sessionPolicy/allowRoomJoin").and_then(Value::as_bool).unwrap_or(false),
                "allowedOrigins":definition.pointer("/sessionPolicy/allowedOrigins").cloned().unwrap_or_else(||json!([])),
                "publishedAt":format_time(row.get("published_at")),
            })
        }).collect::<Vec<_>>() }),
    )
}

async fn class_session_value(
    state: &AppState,
    space: Uuid,
    session: Uuid,
) -> ApiResult<Option<Value>> {
    let row = sqlx::query(
        r#"SELECT sessions.id,sessions.title,sessions.state,sessions.created_at,sessions.updated_at,
                  jsonb_agg(jsonb_build_object(
                    'position',items.position,
                    'runId',items.run_id,
                    'activityVersionId',items.activity_version_id,
                    'title',versions.definition->'title',
                    'objective',versions.definition->'objective',
                    'criteria',COALESCE(versions.definition->'criteria','[]'::jsonb),
                    'allowRoomJoin',COALESCE((versions.definition#>>'{sessionPolicy,allowRoomJoin}')::boolean,false),
                    'allowedOrigins',COALESCE(versions.definition#>'{sessionPolicy,allowedOrigins}','[]'::jsonb)
                  ) ORDER BY items.position) AS activities
           FROM knowledge_class_sessions sessions
           JOIN knowledge_class_session_activities items ON items.session_id=sessions.id
           JOIN knowledge_activity_versions versions ON versions.id=items.activity_version_id
           WHERE sessions.id=$1 AND sessions.space_id=$2
           GROUP BY sessions.id"#,
    )
    .bind(session)
    .bind(space)
    .fetch_optional(&state.pool)
    .await?;
    Ok(row.as_ref().map(class_session_row_value))
}

fn class_session_row_value(row: &PgRow) -> Value {
    json!({
        "id":row.get::<Uuid,_>("id"),
        "title":row.get::<String,_>("title"),
        "state":row.get::<String,_>("state"),
        "activities":row.get::<Value,_>("activities"),
        "createdAt":format_time(row.get("created_at")),
        "updatedAt":format_time(row.get("updated_at")),
    })
}

async fn list_class_sessions(state: &AppState, user: &str, space: Uuid) -> ApiResult<Response> {
    state
        .knowledge
        .role(user, space, &["owner", "facilitator"])
        .await?;
    let rows = sqlx::query(
        r#"SELECT sessions.id,sessions.title,sessions.state,sessions.created_at,sessions.updated_at,
                  jsonb_agg(jsonb_build_object(
                    'position',items.position,
                    'runId',items.run_id,
                    'activityVersionId',items.activity_version_id,
                    'title',versions.definition->'title',
                    'objective',versions.definition->'objective',
                    'criteria',COALESCE(versions.definition->'criteria','[]'::jsonb),
                    'allowRoomJoin',COALESCE((versions.definition#>>'{sessionPolicy,allowRoomJoin}')::boolean,false),
                    'allowedOrigins',COALESCE(versions.definition#>'{sessionPolicy,allowedOrigins}','[]'::jsonb)
                  ) ORDER BY items.position) AS activities
           FROM knowledge_class_sessions sessions
           JOIN knowledge_class_session_activities items ON items.session_id=sessions.id
           JOIN knowledge_activity_versions versions ON versions.id=items.activity_version_id
           WHERE sessions.space_id=$1 AND sessions.state<>'archived'
           GROUP BY sessions.id
           ORDER BY sessions.created_at DESC,sessions.id DESC
           LIMIT 500"#,
    )
    .bind(space)
    .fetch_all(&state.pool)
    .await?;
    let items = rows.iter().map(class_session_row_value).collect::<Vec<_>>();
    json_response(StatusCode::OK, json!({"items":items}))
}

async fn create_class_session(
    state: &AppState,
    user: &str,
    space: Uuid,
    plan: Plan,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Response> {
    state
        .knowledge
        .role(user, space, &["owner", "facilitator"])
        .await?;
    let input = read_json(headers, body, 64_000)?;
    strict_object(&input, &["clientId", "title", "activityVersionIds"])?;
    let client = required_uuid(&input, "clientId")?;
    let title = trimmed_string(&input, "title", 1, 240)?;
    let raw_versions = input
        .get("activityVersionIds")
        .and_then(Value::as_array)
        .filter(|values| (1..=50).contains(&values.len()))
        .ok_or_else(invalid)?;
    let versions = raw_versions
        .iter()
        .map(|value| value.as_str().and_then(zod_uuid).ok_or_else(invalid))
        .collect::<ApiResult<Vec<_>>>()?;
    if versions.iter().copied().collect::<HashSet<_>>().len() != versions.len() {
        return Err(invalid());
    }

    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("class-session:{space}:{client}"))
        .execute(&mut *tx)
        .await?;
    if let Some(existing) = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM knowledge_class_sessions WHERE space_id=$1 AND client_id=$2",
    )
    .bind(space)
    .bind(client)
    .fetch_optional(&mut *tx)
    .await?
    {
        tx.commit().await?;
        let mut session = class_session_value(state, space, existing)
            .await?
            .ok_or_else(|| {
                ApiError::internal(anyhow::anyhow!("Class Session disappeared after creation."))
            })?;
        session["newlyCreated"] = json!(false);
        return json_response(StatusCode::OK, session);
    }
    let active: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM knowledge_class_sessions WHERE space_id=$1 AND state IN('draft','open')",
    )
    .bind(space)
    .fetch_one(&mut *tx)
    .await?;
    if active >= plan.active_runs {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "active_session_quota",
            "This class reached its active Session limit.",
        ));
    }
    let available = sqlx::query(
        r#"SELECT versions.id,versions.definition
           FROM knowledge_activity_versions versions
           JOIN knowledge_activities activities ON activities.id=versions.activity_id
           WHERE activities.space_id=$1 AND versions.id=ANY($2::uuid[])"#,
    )
    .bind(space)
    .bind(&versions)
    .fetch_all(&mut *tx)
    .await?;
    if available.len() != versions.len() {
        return Err(ApiError::coded(
            StatusCode::NOT_FOUND,
            "activity_version_not_found",
            "Every Session Activity must be published in this class.",
        ));
    }
    if available.iter().any(|row| {
        !row.get::<Value, _>("definition")
            .pointer("/sessionPolicy/allowRoomJoin")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }) {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "activity_room_join_disabled",
            "Every Session Activity must allow live room joining.",
        ));
    }
    let session: Uuid = sqlx::query_scalar(
        "INSERT INTO knowledge_class_sessions(client_id,space_id,title,created_by)VALUES($1,$2,$3,$4)RETURNING id",
    )
    .bind(client)
    .bind(space)
    .bind(title)
    .bind(user)
    .fetch_one(&mut *tx)
    .await?;
    for (position, version) in versions.iter().enumerate() {
        let run: Uuid = sqlx::query_scalar(
            "INSERT INTO knowledge_activity_runs(client_id,space_id,activity_version_id,mode,target_kind,insight_policy,created_by)VALUES($1,$2,$3,'live','room','explicit_and_operational',$4)RETURNING id",
        )
        .bind(Uuid::new_v4())
        .bind(space)
        .bind(version)
        .bind(user)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO knowledge_class_session_activities(session_id,position,activity_version_id,run_id)VALUES($1,$2,$3,$4)",
        )
        .bind(session)
        .bind(i32::try_from(position).map_err(ApiError::internal)?)
        .bind(version)
        .bind(run)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    let mut result = class_session_value(state, space, session)
        .await?
        .ok_or_else(|| {
            ApiError::internal(anyhow::anyhow!("Class Session disappeared after creation."))
        })?;
    result["newlyCreated"] = json!(true);
    json_response(StatusCode::CREATED, result)
}
async fn create_run(
    state: &AppState,
    user: &str,
    space: Uuid,
    plan: Plan,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Response> {
    state
        .knowledge
        .role(user, space, &["owner", "facilitator"])
        .await?;
    let input = read_json(headers, body, 128_000)?;
    strict_object(
        &input,
        &[
            "clientId",
            "activityVersionId",
            "mode",
            "opensAt",
            "closesAt",
            "target",
            "insightPolicy",
        ],
    )?;
    let client = required_uuid(&input, "clientId")?;
    let version = required_uuid(&input, "activityVersionId")?;
    let mode = input
        .get("mode")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "live" | "async" | "hybrid"))
        .ok_or_else(invalid)?;
    let opens_at = optional_timestamp(&input, "opensAt")?;
    let closes_at = optional_timestamp(&input, "closesAt")?;
    if opens_at
        .zip(closes_at)
        .is_some_and(|(opens_at, closes_at)| opens_at >= closes_at)
    {
        return Err(invalid());
    }
    let insight_policy = input
        .get("insightPolicy")
        .and_then(Value::as_str)
        .unwrap_or("explicit_and_operational");
    if !matches!(
        insight_policy,
        "explicit_and_operational" | "evidence_candidates"
    ) {
        return Err(invalid());
    }
    let target = input
        .get("target")
        .filter(|value| value.is_object())
        .ok_or_else(invalid)?;
    let target_kind = target
        .get("kind")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "group" | "participants" | "room"))
        .ok_or_else(invalid)?;
    if target_kind == "room" && mode == "async" {
        return Err(invalid());
    }
    let (group, users) = if target_kind == "group" {
        strict_object(target, &["kind", "groupId"])?;
        (Some(required_uuid(target, "groupId")?), Vec::new())
    } else if target_kind == "room" {
        strict_object(target, &["kind"])?;
        (None, Vec::new())
    } else {
        strict_object(target, &["kind", "userIds"])?;
        let raw_users = target
            .get("userIds")
            .and_then(Value::as_array)
            .filter(|values| (1..=2_000).contains(&values.len()))
            .ok_or_else(invalid)?;
        let mut users = Vec::with_capacity(raw_users.len());
        for value in raw_users {
            let user_id = value
                .as_str()
                .map(str::trim)
                .filter(|value| (1..=255).contains(&js_string_len(value)))
                .ok_or_else(invalid)?;
            if !users.iter().any(|existing| existing == user_id) {
                users.push(user_id.to_owned());
            }
        }
        (None, users)
    };
    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("run:{space}:{client}"))
        .execute(&mut *tx)
        .await?;
    let existing = sqlx::query(
        "SELECT id,state FROM knowledge_activity_runs WHERE space_id=$1 AND client_id=$2",
    )
    .bind(space)
    .bind(client)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(row) = existing {
        tx.commit().await?;
        let id = row.get::<Uuid, _>("id");
        let mut response = json_response(
            StatusCode::OK,
            json!({"id":id,"state":row.get::<String,_>("state"),"newlyCreated":false}),
        )?;
        response.headers_mut().insert(
            "location",
            HeaderValue::from_str(&format!("/v1/runs/{id}")).map_err(ApiError::internal)?,
        );
        return Ok(response);
    }
    let active:i64=sqlx::query_scalar("SELECT COUNT(*)::bigint FROM knowledge_class_sessions WHERE space_id=$1 AND state IN('draft','open')").bind(space).fetch_one(&mut*tx).await?;
    if active >= plan.active_runs {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "active_run_quota",
            "This Space reached its active Run limit.",
        ));
    }
    let count = if let Some(group) = group {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(members.user_id)::bigint FROM knowledge_space_groups groups LEFT JOIN knowledge_space_group_members members ON members.group_id=groups.id WHERE groups.id=$1 AND groups.space_id=$2 AND groups.archived_at IS NULL",
        )
        .bind(group)
        .bind(space)
        .fetch_one(&mut *tx)
        .await?
    } else {
        i64::try_from(users.len()).unwrap_or(i64::MAX)
    };
    if count > plan.group_participants {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "participant_quota",
            "This Run has too many participants for the current plan.",
        ));
    }
    let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM knowledge_activity_versions versions JOIN knowledge_activities activities ON activities.id=versions.activity_id WHERE versions.id=$1 AND activities.space_id=$2)").bind(version).bind(space).fetch_one(&mut*tx).await?;
    if !valid {
        return Err(ApiError::coded(
            StatusCode::NOT_FOUND,
            "activity_version_not_found",
            "Published Activity not found in this Space.",
        ));
    }
    if let Some(group) = group {
        let valid_group: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM knowledge_space_groups WHERE id=$1 AND space_id=$2 AND archived_at IS NULL)",
        )
        .bind(group)
        .bind(space)
        .fetch_one(&mut *tx)
        .await?;
        if !valid_group {
            return Err(ApiError::coded(
                StatusCode::NOT_FOUND,
                "group_not_found",
                "Group not found in this Space.",
            ));
        }
    }
    let row=sqlx::query("INSERT INTO knowledge_activity_runs(client_id,space_id,activity_version_id,mode,target_kind,target_group_id,opens_at,closes_at,insight_policy,created_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)RETURNING id,state").bind(client).bind(space).bind(version).bind(mode).bind(target_kind).bind(group).bind(opens_at).bind(closes_at).bind(insight_policy).bind(user).fetch_one(&mut*tx).await?;
    let run: Uuid = row.get("id");
    sqlx::query(
        r#"INSERT INTO knowledge_class_sessions(id,client_id,space_id,title,state,created_by)
           SELECT $1,$2,$3,LEFT(COALESCE(NULLIF(BTRIM(definition->>'title'),''),'Session'),240),$4,$5
           FROM knowledge_activity_versions WHERE id=$6"#,
    )
    .bind(run)
    .bind(client)
    .bind(space)
    .bind(row.get::<String, _>("state"))
    .bind(user)
    .bind(version)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO knowledge_class_session_activities(session_id,position,activity_version_id,run_id)VALUES($1,0,$2,$1)",
    )
    .bind(run)
    .bind(version)
    .execute(&mut *tx)
    .await?;
    let participants: Vec<String> = if let Some(group) = group {
        sqlx::query_scalar("SELECT members.user_id FROM knowledge_space_group_members members JOIN knowledge_space_members space_members ON space_members.space_id=$2 AND space_members.user_id=members.user_id WHERE members.group_id=$1 AND space_members.removed_at IS NULL")
            .bind(group)
            .bind(space)
            .fetch_all(&mut *tx)
            .await?
    } else {
        let member_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM knowledge_space_members WHERE space_id=$1 AND user_id=ANY($2::text[]) AND removed_at IS NULL",
        )
        .bind(space)
        .bind(&users)
        .fetch_one(&mut *tx)
        .await?;
        if usize::try_from(member_count).ok() != Some(users.len()) {
            return Err(ApiError::coded(
                StatusCode::BAD_REQUEST,
                "participant_not_in_space",
                "Every Run participant must belong to this Space.",
            ));
        }
        users
    };
    for participant in &participants {
        let assignment:Uuid=sqlx::query_scalar("INSERT INTO knowledge_activity_assignments(run_id,user_id)VALUES($1,$2)ON CONFLICT(run_id,user_id)DO UPDATE SET user_id=EXCLUDED.user_id RETURNING id").bind(run).bind(participant).fetch_one(&mut*tx).await?;
        sqlx::query("INSERT INTO knowledge_activity_attempts(run_id,assignment_id,user_id)VALUES($1,$2,$3)ON CONFLICT(run_id,user_id)DO NOTHING").bind(run).bind(assignment).bind(participant).execute(&mut*tx).await?;
    }
    tx.commit().await?;
    let mut response = json_response(
        StatusCode::CREATED,
        json!({"id":run,"state":row.get::<String,_>("state"),"assignmentCount":participants.len(),"newlyCreated":true}),
    )?;
    response.headers_mut().insert(
        "location",
        HeaderValue::from_str(&format!("/v1/runs/{run}")).map_err(ApiError::internal)?,
    );
    Ok(response)
}
async fn assignments(state: &AppState, user: &str) -> ApiResult<Response> {
    let rows=sqlx::query("SELECT attempts.id attempt_id,attempts.state,attempts.updated_at,runs.id run_id,runs.mode,runs.opens_at,runs.closes_at,runs.space_id,versions.definition,spaces.name space_name FROM knowledge_activity_attempts attempts JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id JOIN knowledge_spaces spaces ON spaces.id=runs.space_id WHERE attempts.user_id=$1 AND attempts.state<>'withdrawn'ORDER BY attempts.updated_at DESC,attempts.id DESC LIMIT 100").bind(user).fetch_all(&state.pool).await?;
    json_response(
        StatusCode::OK,
        json!({"items":rows.into_iter().map(|row|{
            let definition=row.get::<Value,_>("definition");
            json!({
                "attemptId":row.get::<Uuid,_>("attempt_id"),
                "state":row.get::<String,_>("state"),
                "updatedAt":format_time(row.get("updated_at")),
                "run":{"id":row.get::<Uuid,_>("run_id"),"mode":row.get::<String,_>("mode"),"opensAt":row.get::<Option<time::OffsetDateTime>,_>("opens_at").map(format_time),"closesAt":row.get::<Option<time::OffsetDateTime>,_>("closes_at").map(format_time)},
                "activity":{"title":definition.get("title"),"objective":definition.get("objective")},
                "space":{"id":row.get::<Uuid,_>("space_id"),"name":row.get::<String,_>("space_name")},
            })
        }).collect::<Vec<_>>() }),
    )
}
async fn attempt_context(state: &AppState, user: &str, attempt: Uuid) -> ApiResult<Response> {
    let row=sqlx::query("SELECT attempts.*,runs.id run_id,runs.state run_state,runs.mode,runs.opens_at,runs.closes_at,runs.insight_policy,runs.insight_policy_version,runs.space_id,versions.id activity_version_id,versions.definition,spaces.name space_name FROM knowledge_activity_attempts attempts JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id JOIN knowledge_spaces spaces ON spaces.id=runs.space_id WHERE attempts.id=$1 AND attempts.user_id=$2").bind(attempt).bind(user).fetch_optional(&state.pool).await?.ok_or_else(||ApiError::coded(StatusCode::NOT_FOUND,"attempt_not_found","Attempt not found."))?;
    let activity_version = row.get::<Uuid, _>("activity_version_id");
    let sources=sqlx::query("SELECT sources.display_name,sources.role FROM knowledge_activity_version_sources pinned JOIN knowledge_source_versions versions ON versions.id=pinned.source_version_id JOIN knowledge_sources sources ON sources.id=versions.source_id WHERE pinned.activity_version_id=$1 AND versions.state='ready'ORDER BY sources.virtual_path,versions.id").bind(activity_version).fetch_all(&state.pool).await?;
    let source_catalog: Vec<_> = sources
        .iter()
        .map(|source| json!({"title":source.get::<String,_>("display_name"),"role":source.get::<String,_>("role")}))
        .collect();
    let starter_available = sources
        .iter()
        .any(|source| source.get::<String, _>("role") == "starter");
    let progress=sqlx::query("SELECT COUNT(DISTINCT sessions.id)::int session_count,COALESCE(ARRAY_AGG(DISTINCT evidence.criterion_id)FILTER(WHERE evidence.result_code='passed'),'{}')completed_criterion_ids FROM knowledge_activity_attempts attempts LEFT JOIN knowledge_activity_work_sessions sessions ON sessions.attempt_id=attempts.id LEFT JOIN knowledge_activity_evidence evidence ON evidence.attempt_id=attempts.id WHERE attempts.id=$1").bind(attempt).fetch_one(&state.pool).await?;
    let session_count = progress.get::<i32, _>("session_count");
    let completed_criterion_ids = progress.get::<Vec<String>, _>("completed_criterion_ids");
    let summary = if session_count == 0 {
        "No prior Work Sessions.".to_owned()
    } else {
        format!("This Attempt has {session_count} prior Work Session(s).")
    };
    json_response(
        StatusCode::OK,
        json!({"startedAt":row.get::<Option<time::OffsetDateTime>,_>("started_at").map(format_time),"attemptId":attempt,"userId":user,"state":row.get::<String,_>("state"),"acknowledgedPolicyVersion":row.get::<Option<String>,_>("acknowledged_policy_version"),"run":{"id":row.get::<Uuid,_>("run_id"),"state":row.get::<String,_>("run_state"),"mode":row.get::<String,_>("mode"),"opensAt":row.get::<Option<time::OffsetDateTime>,_>("opens_at").map(format_time),"closesAt":row.get::<Option<time::OffsetDateTime>,_>("closes_at").map(format_time),"insightPolicy":row.get::<String,_>("insight_policy"),"insightPolicyVersion":row.get::<String,_>("insight_policy_version")},"space":{"id":row.get::<Uuid,_>("space_id"),"name":row.get::<String,_>("space_name")},"activityVersionId":activity_version,"definition":row.get::<Value,_>("definition"),"sourceCatalog":source_catalog,"starterAvailable":starter_available,"priorProgress":{"completedCriterionIds":completed_criterion_ids,"sessionCount":session_count,"summary":summary}}),
    )
}
async fn starter_files(state: &AppState, user: &str, attempt: Uuid) -> ApiResult<Response> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM knowledge_activity_attempts WHERE id=$1 AND user_id=$2)",
    )
    .bind(attempt)
    .bind(user)
    .fetch_one(&state.pool)
    .await?;
    if !exists {
        return Err(ApiError::coded(
            StatusCode::NOT_FOUND,
            "attempt_not_found",
            "Attempt not found.",
        ));
    }
    let rows=sqlx::query("SELECT versions.id version_id,versions.object_key,versions.byte_size,versions.sha256,versions.media_type,sources.virtual_path FROM knowledge_activity_attempts attempts JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id JOIN knowledge_activity_version_sources pinned ON pinned.activity_version_id=runs.activity_version_id JOIN knowledge_source_versions versions ON versions.id=pinned.source_version_id JOIN knowledge_sources sources ON sources.id=versions.source_id WHERE attempts.id=$1 AND attempts.user_id=$2 AND sources.role='starter'AND versions.state='ready'ORDER BY sources.virtual_path,versions.id").bind(attempt).bind(user).fetch_all(&state.pool).await?;
    let mut files = Vec::new();
    for row in rows {
        let store = state
            .knowledge
            .object_store
            .as_ref()
            .ok_or_else(knowledge_storage_unavailable)?;
        files.push(json!({"byteSize":row.get::<i64,_>("byte_size"),"mediaType":row.get::<String,_>("media_type"),"relativePath":row.get::<String,_>("virtual_path"),"sha256":row.get::<String,_>("sha256"),"sourceVersionId":row.get::<Uuid,_>("version_id"),"download":store.get_ticket(row.get("object_key")).await?}));
    }
    json_response(StatusCode::OK, json!({"files":files}))
}
async fn commit_submission(
    state: &AppState,
    user: &str,
    attempt: Uuid,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Response> {
    let input = read_json(headers, body, 32_000)?;
    strict_object(&input, &["clientId"])?;
    let _ = required_uuid(&input, "clientId")?;
    let requires_submission: Option<bool> = sqlx::query_scalar(
        "SELECT COALESCE((versions.definition->'completionPolicy'->>'requiresSubmission')::boolean,false) FROM knowledge_activity_attempts attempts JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id WHERE attempts.id=$1 AND attempts.user_id=$2",
    )
    .bind(attempt)
    .bind(user)
    .fetch_optional(&state.pool)
    .await?;
    if requires_submission == Some(false) {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "submission_not_required",
            "This Activity does not require a submission.",
        ));
    }
    let mut tx = state.pool.begin().await?;
    let updated=sqlx::query("UPDATE knowledge_activity_attempts attempts SET state='submitted',submitted_at=COALESCE(submitted_at,NOW()),updated_at=NOW()WHERE attempts.id=$1 AND attempts.user_id=$2 AND attempts.state IN('assigned','in_progress','blocked','ready_for_review')AND EXISTS(SELECT 1 FROM knowledge_submission_artifacts artifacts JOIN knowledge_source_versions versions ON versions.id=artifacts.source_version_id WHERE artifacts.attempt_id=attempts.id AND versions.state IN('processing','ready'))RETURNING id,run_id,state,submitted_at").bind(attempt).bind(user).fetch_optional(&mut*tx).await?;
    let row = if let Some(row) = updated {
        sqlx::query("INSERT INTO knowledge_activity_run_events(run_id,attempt_id,event_type,payload)VALUES($1,$2,'attempt_submitted',jsonb_build_object('state','submitted'))")
            .bind(row.get::<Uuid, _>("run_id"))
            .bind(row.get::<Uuid, _>("id"))
            .execute(&mut *tx)
            .await?;
        row
    } else {
        sqlx::query("SELECT id,run_id,state,submitted_at FROM knowledge_activity_attempts WHERE id=$1 AND user_id=$2 AND state='submitted'")
            .bind(attempt)
            .bind(user)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(||ApiError::coded(StatusCode::CONFLICT,"submission_not_ready","No verified submission files are ready."))?
    };
    tx.commit().await?;
    json_response(
        StatusCode::OK,
        json!({"attemptId":row.get::<Uuid,_>("id"),"state":row.get::<String,_>("state"),"submittedAt":format_time(row.get("submitted_at"))}),
    )
}
async fn acknowledge(
    state: &AppState,
    user: &str,
    attempt: Uuid,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Response> {
    let input = read_json(headers, body, 16_000)?;
    strict_object(&input, &["policyVersion"])?;
    let policy = input
        .get("policyVersion")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| (1..=64).contains(&js_string_len(value)))
        .ok_or_else(invalid)?;
    let changed=sqlx::query("UPDATE knowledge_activity_attempts attempts SET acknowledged_policy_version=$3,updated_at=NOW()FROM knowledge_activity_runs runs WHERE attempts.id=$1 AND attempts.user_id=$2 AND attempts.run_id=runs.id AND runs.insight_policy_version=$3").bind(attempt).bind(user).bind(policy).execute(&state.pool).await?.rows_affected();
    if changed == 0 {
        return Err(ApiError::coded(
            StatusCode::NOT_FOUND,
            "attempt_not_found",
            "Attempt not found.",
        ));
    }
    json_response(StatusCode::OK, json!({"acknowledged":true}))
}
async fn create_work_session(
    state: &AppState,
    user: &str,
    attempt: Uuid,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Response> {
    let input = read_json(headers, body, 32_000)?;
    strict_object(&input, &["clientId", "taskId", "launchKind", "purpose"])?;
    let client = required_uuid(&input, "clientId")?;
    let task = required_uuid(&input, "taskId")?;
    let launch = input
        .get("launchKind")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "none" | "workspace" | "current_surface"))
        .ok_or_else(invalid)?;
    let purpose = match input.get("purpose") {
        None => "work",
        Some(value) => value
            .as_str()
            .filter(|value| matches!(*value, "work" | "help" | "check"))
            .ok_or_else(invalid)?,
    };
    let context=sqlx::query("SELECT attempts.state,runs.state run_state,runs.opens_at,runs.closes_at,versions.definition FROM knowledge_activity_attempts attempts JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id WHERE attempts.id=$1 AND attempts.user_id=$2").bind(attempt).bind(user).fetch_optional(&state.pool).await?.ok_or_else(||ApiError::coded(StatusCode::NOT_FOUND,"attempt_not_found","Attempt not found."))?;
    let now = time::OffsetDateTime::now_utc();
    let opens_at = context.get::<Option<time::OffsetDateTime>, _>("opens_at");
    let closes_at = context.get::<Option<time::OffsetDateTime>, _>("closes_at");
    if context.get::<String, _>("run_state") != "open"
        || opens_at.is_some_and(|value| now < value)
        || closes_at.is_some_and(|value| now >= value)
    {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "run_not_open",
            "This Run is not open.",
        ));
    }
    if !matches!(
        context.get::<String, _>("state").as_str(),
        "assigned" | "in_progress" | "blocked" | "ready_for_review"
    ) {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "attempt_not_active",
            "This Attempt is waiting for review or no longer active.",
        ));
    }
    if context
        .get::<Value, _>("definition")
        .get("launchTarget")
        .and_then(Value::as_str)
        != Some(launch)
    {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "launch_target_mismatch",
            "Launch selection does not match the published Activity.",
        ));
    }
    if purpose == "help" {
        state.classroom.request_help(user, attempt, client).await?;
    }
    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("work:{attempt}:{client}"))
        .execute(&mut *tx)
        .await?;
    let existing=sqlx::query("SELECT sessions.id,sessions.state,sessions.task_id,sessions.launch_kind,sessions.purpose,sessions.updated_at created_at FROM knowledge_activity_work_sessions sessions JOIN knowledge_activity_attempts attempts ON attempts.id=sessions.attempt_id WHERE sessions.attempt_id=$1 AND sessions.client_id=$2 AND attempts.user_id=$3").bind(attempt).bind(client).bind(user).fetch_optional(&mut*tx).await?;
    let row = if let Some(row) = existing {
        row
    } else {
        let row=sqlx::query("INSERT INTO knowledge_activity_work_sessions(client_id,attempt_id,task_id,launch_kind,purpose)SELECT $2,attempts.id,$3,$4,$6 FROM knowledge_activity_attempts attempts WHERE attempts.id=$1 AND attempts.user_id=$5 RETURNING id,state,task_id,launch_kind,purpose,created_at").bind(attempt).bind(client).bind(task).bind(launch).bind(user).bind(purpose).fetch_optional(&mut*tx).await?.ok_or_else(||ApiError::coded(StatusCode::NOT_FOUND,"attempt_not_found","Attempt not found."))?;
        sqlx::query("UPDATE knowledge_activity_attempts SET state=CASE WHEN state='assigned'THEN'in_progress'ELSE state END,started_at=COALESCE(started_at,NOW()),updated_at=NOW()WHERE id=$1").bind(attempt).execute(&mut*tx).await?;
        sqlx::query("INSERT INTO knowledge_activity_run_events(run_id,attempt_id,event_type,payload)SELECT run_id,id,'work_session_created',jsonb_build_object('state','created','purpose',$2::text)FROM knowledge_activity_attempts WHERE id=$1")
            .bind(attempt)
            .bind(purpose)
            .execute(&mut *tx)
            .await?;
        row
    };
    tx.commit().await?;
    let id: Uuid = row.get("id");
    let mut response = json_response(
        StatusCode::CREATED,
        json!({"id":id,"state":row.get::<String,_>("state"),"taskId":row.get::<Uuid,_>("task_id"),"launchKind":row.get::<String,_>("launch_kind"),"purpose":row.get::<String,_>("purpose"),"createdAt":format_time(row.get("created_at"))}),
    )?;
    response.headers_mut().insert(
        "location",
        HeaderValue::from_str(&format!("/v1/work-sessions/{id}")).map_err(ApiError::internal)?,
    );
    Ok(response)
}
async fn update_work_session(
    state: &AppState,
    user: &str,
    work: Uuid,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Response> {
    let input = read_json(headers, body, 32_000)?;
    strict_object(&input, &["state", "helpRequested", "hintLevel"])?;
    let status = input
        .get("state")
        .and_then(Value::as_str)
        .filter(|value| {
            matches!(
                *value,
                "created" | "active" | "paused" | "completed" | "cancelled" | "failed"
            )
        })
        .ok_or_else(invalid)?;
    let help = match input.get("helpRequested") {
        None => false,
        Some(value) => value.as_bool().ok_or_else(invalid)?,
    };
    let hint = match input.get("hintLevel") {
        None => None,
        Some(value) => Some(value.as_i64().ok_or_else(invalid)?),
    };
    if hint.is_some_and(|value| !(0..=5).contains(&value)) {
        return Err(invalid());
    }
    let hint = hint.and_then(|value| i32::try_from(value).ok());
    let mut tx = state.pool.begin().await?;
    let prior = sqlx::query("SELECT sessions.* FROM knowledge_activity_work_sessions sessions JOIN knowledge_activity_attempts attempts ON attempts.id=sessions.attempt_id WHERE sessions.id=$1 AND attempts.user_id=$2 FOR UPDATE OF sessions")
        .bind(work).bind(user).fetch_optional(&mut *tx).await?
        .ok_or_else(|| ApiError::coded(StatusCode::NOT_FOUND,"work_session_not_found","Work Session not found."))?;
    let prior_state: String = prior.get("state");
    if matches!(prior_state.as_str(), "completed" | "cancelled" | "failed")
        || (prior_state == status && !help && hint.is_none())
    {
        tx.commit().await?;
        return json_response(
            StatusCode::OK,
            json!({"id":work,"state":prior_state,"helpRequestedAt":prior.get::<Option<time::OffsetDateTime>,_>("help_requested_at").map(format_time),"hintLevel":prior.get::<i32,_>("hint_level")}),
        );
    }
    if status == "created" && prior_state != "created" {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "invalid_work_session_transition",
            "A Work Session cannot restart itself.",
        ));
    }
    let row=sqlx::query("UPDATE knowledge_activity_work_sessions sessions SET state=$2,help_requested_at=CASE WHEN $3 THEN COALESCE(sessions.help_requested_at,NOW())ELSE sessions.help_requested_at END,hint_level=COALESCE($4,sessions.hint_level),started_at=CASE WHEN $2='active'THEN COALESCE(sessions.started_at,NOW())ELSE sessions.started_at END,ended_at=CASE WHEN $2 IN('completed','cancelled','failed')THEN NOW()ELSE sessions.ended_at END,updated_at=NOW()FROM knowledge_activity_attempts attempts WHERE sessions.id=$1 AND sessions.attempt_id=attempts.id AND attempts.user_id=$5 RETURNING sessions.id,sessions.attempt_id,sessions.state,sessions.help_requested_at,sessions.hint_level").bind(work).bind(status).bind(help).bind(hint).bind(user).fetch_optional(&mut*tx).await?.ok_or_else(||ApiError::coded(StatusCode::NOT_FOUND,"work_session_not_found","Work Session not found."))?;
    sqlx::query("INSERT INTO knowledge_activity_run_events(run_id,attempt_id,event_type,payload)SELECT run_id,id,'work_session_updated',jsonb_build_object('state',$2::text,'helpRequested',$3::boolean,'hintLevel',$4::int,'purpose',$5::text,'workSessionId',$6::uuid)FROM knowledge_activity_attempts WHERE id=$1")
        .bind(row.get::<Uuid, _>("attempt_id"))
        .bind(status)
        .bind(help)
        .bind(row.get::<i32, _>("hint_level"))
        .bind(prior.get::<String, _>("purpose"))
        .bind(work)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    json_response(
        StatusCode::OK,
        json!({"id":row.get::<Uuid,_>("id"),"state":row.get::<String,_>("state"),"helpRequestedAt":row.get::<Option<time::OffsetDateTime>,_>("help_requested_at").map(format_time),"hintLevel":row.get::<i32,_>("hint_level")}),
    )
}
async fn record_evidence(
    state: &AppState,
    user: &str,
    attempt: Uuid,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Response> {
    let input = read_json(headers, body, 32_000)?;
    strict_object(
        &input,
        &[
            "clientId",
            "workSessionId",
            "criterionId",
            "tag",
            "provenance",
            "resultCode",
        ],
    )?;
    let client = required_uuid(&input, "clientId")?;
    let work = required_uuid(&input, "workSessionId")?;
    let criterion = input
        .get("criterionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| (1..=80).contains(&js_string_len(value)))
        .ok_or_else(invalid)?;
    let tag = input
        .get("tag")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| (1..=80).contains(&js_string_len(value)))
        .ok_or_else(invalid)?;
    let provenance = input
        .get("provenance")
        .and_then(Value::as_str)
        .filter(|value| {
            matches!(
                *value,
                "participant" | "host" | "agent_candidate" | "facilitator"
            )
        })
        .ok_or_else(invalid)?;
    if matches!(provenance, "host" | "facilitator") {
        return Err(ApiError::coded(
            StatusCode::FORBIDDEN,
            "evidence_forbidden",
            "This evidence provenance is not available on the participant endpoint.",
        ));
    }
    let result = input
        .get("resultCode")
        .and_then(Value::as_str)
        .filter(|value| {
            matches!(
                *value,
                "observed" | "passed" | "failed" | "blocked" | "needs_review"
            )
        })
        .ok_or_else(invalid)?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("evidence:{work}"))
        .execute(&mut *tx)
        .await?;
    let authority=sqlx::query("SELECT attempts.id attempt_id,attempts.user_id,attempts.acknowledged_policy_version,runs.insight_policy,runs.insight_policy_version,versions.definition FROM knowledge_activity_work_sessions sessions JOIN knowledge_activity_attempts attempts ON attempts.id=sessions.attempt_id JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id WHERE sessions.id=$1 AND attempts.user_id=$2").bind(work).bind(user).fetch_optional(&mut*tx).await?;
    let Some(authority) = authority else {
        return Err(ApiError::coded(
            StatusCode::NOT_FOUND,
            "attempt_not_found",
            "Attempt not found.",
        ));
    };
    if authority.get::<Uuid, _>("attempt_id") != attempt {
        return Err(ApiError::coded(
            StatusCode::NOT_FOUND,
            "attempt_not_found",
            "Attempt not found.",
        ));
    }
    let definition = authority.get::<Value, _>("definition");
    let tag_allowed = definition
        .get("criteria")
        .and_then(Value::as_array)
        .and_then(|criteria| {
            criteria
                .iter()
                .find(|value| value.get("id").and_then(Value::as_str) == Some(criterion))
        })
        .and_then(|criterion| criterion.get("tags"))
        .and_then(Value::as_array)
        .is_some_and(|tags| tags.iter().any(|value| value.as_str() == Some(tag)));
    let policy_allowed = provenance == "participant"
        || (authority.get::<String, _>("insight_policy") == "evidence_candidates"
            && authority.get::<Option<String>, _>("acknowledged_policy_version")
                == Some(authority.get::<String, _>("insight_policy_version")));
    if !tag_allowed || !policy_allowed {
        return Err(ApiError::coded(
            StatusCode::FORBIDDEN,
            "evidence_forbidden",
            "Evidence is not permitted for this Attempt.",
        ));
    }
    if provenance == "agent_candidate" {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM knowledge_activity_evidence WHERE work_session_id=$1 AND provenance='agent_candidate'")
            .bind(work)
            .fetch_one(&mut *tx)
            .await?;
        if count >= 20 {
            return Err(ApiError::coded(
                StatusCode::TOO_MANY_REQUESTS,
                "evidence_limit",
                "This Work Session reached its evidence limit.",
            ));
        }
    }
    let row=sqlx::query("INSERT INTO knowledge_activity_evidence(client_id,attempt_id,work_session_id,criterion_id,tag,provenance,result_code,created_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8)ON CONFLICT(attempt_id,client_id)DO UPDATE SET client_id=EXCLUDED.client_id RETURNING id,created_at").bind(client).bind(attempt).bind(work).bind(criterion).bind(tag).bind(provenance).bind(result).bind(user).fetch_one(&mut*tx).await?;
    tx.commit().await?;
    json_response(
        StatusCode::CREATED,
        json!({"id":row.get::<Uuid,_>("id"),"criterionId":criterion,"tag":tag,"provenance":provenance,"resultCode":result,"createdAt":format_time(row.get("created_at"))}),
    )
}
