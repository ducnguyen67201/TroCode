use axum::{
    Json,
    body::to_bytes,
    extract::{Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use rand::Rng;
use sea_orm::{ConnectionTrait, DbBackend, QueryResult, Statement, TransactionTrait};
use serde::Deserialize;
use serde_json::{Value, json};
use tro_domain::{PlanId, PlanLimits, plan_limits};
use uuid::Uuid;

use crate::{AppState, error::ApiError, require_access};

const MAX_KNOWLEDGE_BODY: usize = 1_000_000;

pub(crate) async fn dispatch(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, ApiError> {
    let path = request.uri().path().to_owned();
    if !is_knowledge_path(&path) {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Endpoint not found."));
    }
    if !state.config.knowledge_enabled {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Endpoint not found."));
    }
    let session = require_access(&state, request.headers()).await?;
    let method = request.method().clone();
    let segments = path
        .trim_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    match (method, segments.as_slice()) {
        (Method::GET, ["v1", "spaces"]) => list_spaces(&state, &session.user.id).await,
        (Method::POST, ["v1", "spaces"]) => {
            let body: CreateSpace = read_json(request).await?;
            create_space(&state, &session.user.id, body).await
        }
        (Method::POST, ["v1", "space-invites", "redeem"]) => {
            let body: RedeemInvite = read_json(request).await?;
            redeem_invite(&state, &session.user.id, &body.code).await
        }
        (Method::GET, ["v1", "spaces", space_id]) => {
            get_space(&state, &session.user.id, parse_uuid(space_id)?).await
        }
        (Method::GET, ["v1", "spaces", space_id, "sources"]) => {
            list_sources(&state, &session.user.id, parse_uuid(space_id)?).await
        }
        (Method::GET, ["v1", "spaces", space_id, "groups"]) => {
            list_groups(&state, &session.user.id, parse_uuid(space_id)?).await
        }
        (Method::POST, ["v1", "spaces", space_id, "groups"]) => {
            let body: CreateGroup = read_json(request).await?;
            create_group(&state, &session.user.id, parse_uuid(space_id)?, body).await
        }
        (Method::GET, ["v1", "spaces", space_id, "members"]) => {
            list_members(&state, &session.user.id, parse_uuid(space_id)?).await
        }
        (Method::POST, ["v1", "spaces", space_id, "invites"]) => {
            let body: CreateInvite = read_json(request).await?;
            create_invite(&state, &session.user.id, parse_uuid(space_id)?, body).await
        }
        (Method::POST, ["v1", "spaces", space_id, "uploads", "initiate"]) => {
            let body: InitiateUpload = read_json(request).await?;
            initiate_upload(&state, &session.user.id, parse_uuid(space_id)?, None, body).await
        }
        (Method::POST, ["v1", "uploads", "complete"]) => {
            let body: CompleteUpload = read_json(request).await?;
            complete_upload(&state, &session.user.id, body).await
        }
        (Method::POST, ["v1", "attempts", attempt_id, "submissions", "initiate"]) => {
            let body: InitiateUpload = read_json(request).await?;
            initiate_submission(&state, &session.user.id, parse_uuid(attempt_id)?, body).await
        }
        (Method::POST, ["v1", "attempts", attempt_id, "submissions", "commit"]) => {
            let body: CommitSubmission = read_json(request).await?;
            commit_submission(&state, &session.user.id, parse_uuid(attempt_id)?, body).await
        }
        (Method::GET, ["v1", "attempts", attempt_id, "starter-files"]) => {
            starter_files(&state, &session.user.id, parse_uuid(attempt_id)?).await
        }
        _ => activity_dispatch(&state, &session.user.id, request, &segments).await,
    }
}

fn is_knowledge_path(path: &str) -> bool {
    [
        "/v1/spaces",
        "/v1/activities",
        "/v1/runs",
        "/v1/attempts",
        "/v1/work-sessions",
        "/v1/uploads/complete",
        "/v1/assignments/me",
        "/v1/space-invites/redeem",
    ]
    .iter()
    .any(|prefix| path == *prefix || path.starts_with(&format!("{prefix}/")))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateSpace {
    client_id: Uuid,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    purpose_label: Option<String>,
}

async fn list_spaces(state: &AppState, user_id: &str) -> Result<Response, ApiError> {
    let rows = state
        .database
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r"SELECT spaces.id, spaces.name, spaces.description, spaces.purpose_label,
                      members.role, spaces.created_at::TEXT AS created_at,
                      spaces.updated_at::TEXT AS updated_at
               FROM knowledge_spaces spaces
               JOIN knowledge_space_members members ON members.space_id = spaces.id
               WHERE members.user_id = $1 AND members.removed_at IS NULL
                 AND spaces.archived_at IS NULL
               ORDER BY spaces.created_at DESC, spaces.id DESC LIMIT 51",
            [user_id.into()],
        ))
        .await?;
    let has_more = rows.len() > 50;
    let items = rows
        .iter()
        .take(50)
        .map(space_json)
        .collect::<Result<Vec<_>, _>>()?;
    let next_cursor = has_more
        .then(|| items.last().cloned())
        .flatten()
        .map(|last| json!({ "createdAt": last["createdAt"], "id": last["id"] }));
    Ok(Json(json!({ "items": items, "nextCursor": next_cursor })).into_response())
}

async fn create_space(
    state: &AppState,
    user_id: &str,
    body: CreateSpace,
) -> Result<Response, ApiError> {
    let name = bounded(&body.name, 1, 240)?;
    let description = bounded_optional(&body.description, 4_000)?;
    let purpose = match body.purpose_label {
        Some(value) => Some(bounded(&value, 1, 120)?),
        None => None,
    };
    let limits = limits_for_user(state, user_id).await?;
    let transaction = state.database.begin().await?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            [format!("space:{user_id}:{}", body.client_id).into()],
        ))
        .await?;
    if let Some(existing) = transaction
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r"SELECT spaces.id, spaces.name, spaces.description, spaces.purpose_label,
                      members.role, spaces.created_at::TEXT AS created_at,
                      spaces.updated_at::TEXT AS updated_at
               FROM knowledge_spaces spaces JOIN knowledge_space_members members
                 ON members.space_id = spaces.id AND members.user_id = $1
               WHERE spaces.owner_user_id = $1 AND spaces.client_id = $2",
            [user_id.into(), body.client_id.into()],
        ))
        .await?
    {
        let space = space_json(&existing)?;
        transaction.commit().await?;
        return Ok(Json(json!({ "newlyCreated": false, "space": space })).into_response());
    }
    let count = transaction.query_one_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT COUNT(*)::BIGINT AS value FROM knowledge_spaces WHERE owner_user_id=$1 AND archived_at IS NULL",
        [user_id.into()],
    )).await?.ok_or_else(ApiError::internal)?;
    if get::<i64>(&count, "value")? >= i64::from(limits.spaces) {
        transaction.rollback().await?;
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "space_quota_reached",
            "This plan reached its Knowledge Space limit.",
        ));
    }
    let row = transaction
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO knowledge_spaces \
             (client_id, owner_user_id, name, description, purpose_label) \
             VALUES ($1,$2,$3,$4,$5) RETURNING id, name, description, purpose_label, \
             created_at::TEXT AS created_at, updated_at::TEXT AS updated_at",
            [
                body.client_id.into(),
                user_id.into(),
                name.into(),
                description.into(),
                purpose.into(),
            ],
        ))
        .await?
        .ok_or_else(ApiError::internal)?;
    let space_id: Uuid = get(&row, "id")?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO knowledge_space_members (space_id, user_id, role) VALUES ($1,$2,'owner')",
            [space_id.into(), user_id.into()],
        ))
        .await?;
    transaction.commit().await?;
    let space = json!({
        "id": space_id,
        "name": get::<String>(&row, "name")?,
        "description": get::<String>(&row, "description")?,
        "purposeLabel": get::<Option<String>>(&row, "purpose_label")?,
        "role": "owner",
        "createdAt": get::<String>(&row, "created_at")?,
        "updatedAt": get::<String>(&row, "updated_at")?
    });
    let mut response = (
        StatusCode::CREATED,
        Json(json!({ "newlyCreated": true, "space": space })),
    )
        .into_response();
    if let Ok(location) = HeaderValue::from_str(&format!("/v1/spaces/{space_id}")) {
        response.headers_mut().insert(header::LOCATION, location);
    }
    Ok(response)
}

async fn get_space(state: &AppState, user_id: &str, space_id: Uuid) -> Result<Response, ApiError> {
    let row = state
        .database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r"SELECT spaces.id, spaces.name, spaces.description, spaces.purpose_label,
                      members.role, spaces.created_at::TEXT AS created_at,
                      spaces.updated_at::TEXT AS updated_at
               FROM knowledge_spaces spaces JOIN knowledge_space_members members
                 ON members.space_id = spaces.id
               WHERE spaces.id=$1 AND members.user_id=$2 AND members.removed_at IS NULL",
            [space_id.into(), user_id.into()],
        ))
        .await?
        .ok_or_else(|| {
            ApiError::coded(StatusCode::NOT_FOUND, "space_not_found", "Space not found.")
        })?;
    Ok(Json(space_json(&row)?).into_response())
}

async fn list_sources(
    state: &AppState,
    user_id: &str,
    space_id: Uuid,
) -> Result<Response, ApiError> {
    require_role(state, user_id, space_id, false).await?;
    let rows = state.database.query_all_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        r"SELECT sources.id, sources.display_name, sources.virtual_path, sources.role,
                  sources.created_at::TEXT AS created_at,
                  versions.id AS version_id, versions.version_number, versions.state,
                  versions.media_type, versions.byte_size, versions.sha256,
                  versions.page_count, versions.error_code, versions.ready_at::TEXT AS ready_at,
                  versions.created_at::TEXT AS version_created_at
           FROM knowledge_sources sources
           JOIN knowledge_space_members members ON members.space_id=sources.space_id
             AND members.user_id=$2 AND members.removed_at IS NULL
           LEFT JOIN LATERAL (
             SELECT * FROM knowledge_source_versions v WHERE v.source_id=sources.id
             ORDER BY v.version_number DESC LIMIT 1
           ) versions ON TRUE
           WHERE sources.space_id=$1 AND sources.archived_at IS NULL AND sources.role<>'submission'
             AND (members.role IN ('owner','facilitator') OR EXISTS (
               SELECT 1 FROM knowledge_activity_version_sources pinned
               JOIN knowledge_activity_runs runs ON runs.activity_version_id=pinned.activity_version_id
               JOIN knowledge_activity_attempts attempts ON attempts.run_id=runs.id
               WHERE pinned.source_version_id=versions.id AND attempts.user_id=$2
                 AND attempts.state<>'withdrawn'
             ))
           ORDER BY sources.created_at DESC, sources.id DESC LIMIT 500",
        [space_id.into(), user_id.into()],
    )).await?;
    let items = rows
        .iter()
        .map(|row| {
            Ok(json!({
                "id": get::<Uuid>(row, "id")?,
                "displayName": get::<String>(row, "display_name")?,
                "relativePath": get::<String>(row, "virtual_path")?,
                "role": get::<String>(row, "role")?,
                "createdAt": get::<String>(row, "created_at")?,
                "latestVersion": get::<Option<Uuid>>(row, "version_id")?.map(|id| json!({
                    "id": id,
                    "versionNumber": get::<i32>(row, "version_number").unwrap_or_default(),
                    "state": get::<String>(row, "state").unwrap_or_default(),
                    "mediaType": get::<String>(row, "media_type").unwrap_or_default(),
                    "byteSize": get::<i64>(row, "byte_size").unwrap_or_default(),
                    "sha256": get::<String>(row, "sha256").unwrap_or_default(),
                    "pageCount": get::<Option<i32>>(row, "page_count").unwrap_or_default(),
                    "errorCode": get::<Option<String>>(row, "error_code").unwrap_or_default(),
                    "readyAt": get::<Option<String>>(row, "ready_at").unwrap_or_default()
                    ,"createdAt": get::<String>(row, "version_created_at").unwrap_or_default()
                }))
            }))
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    Ok(Json(json!({ "items": items })).into_response())
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UploadFile {
    client_id: Uuid,
    relative_path: String,
    display_name: String,
    media_type: String,
    byte_size: i64,
    sha256: String,
    role: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct InitiateUpload {
    files: Vec<UploadFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompleteUpload {
    #[serde(rename = "clientId")]
    _client_id: Uuid,
    source_version_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommitSubmission {
    #[serde(rename = "clientId")]
    _client_id: Uuid,
}

#[derive(Debug)]
struct PendingUpload {
    source_id: Uuid,
    source_version_id: Uuid,
    object_key: String,
    state: String,
    file: UploadFile,
}

async fn initiate_submission(
    state: &AppState,
    user_id: &str,
    attempt_id: Uuid,
    body: InitiateUpload,
) -> Result<Response, ApiError> {
    let row = state
        .database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT runs.space_id FROM knowledge_activity_attempts attempts \
         JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id \
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
    initiate_upload(
        state,
        user_id,
        get::<Uuid>(&row, "space_id")?,
        Some(attempt_id),
        body,
    )
    .await
}

#[allow(clippy::too_many_lines)]
async fn initiate_upload(
    state: &AppState,
    user_id: &str,
    space_id: Uuid,
    submission_attempt_id: Option<Uuid>,
    mut body: InitiateUpload,
) -> Result<Response, ApiError> {
    let object_store = state
        .object_store
        .as_ref()
        .ok_or_else(object_store_unavailable)?;
    if submission_attempt_id.is_none() {
        require_role(state, user_id, space_id, true).await?;
    }
    let limits = limits_for_user(state, user_id).await?;
    state
        .services
        .consume_rate(
            "knowledge.upload",
            user_id,
            i32::try_from(limits.upload_requests_per_minute).unwrap_or(i32::MAX),
            60_000,
        )
        .await?;
    if body.files.is_empty()
        || body.files.len() > usize::try_from(limits.upload_batch_files).unwrap_or(100)
    {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "upload_file_quota",
            "This upload has too many files for the current plan.",
        ));
    }
    if body.files.len() > 100 {
        return Err(invalid_request());
    }
    let mut total_bytes = 0_i64;
    for file in &mut body.files {
        validate_upload_file(file)?;
        total_bytes = total_bytes
            .checked_add(file.byte_size)
            .ok_or_else(invalid_request)?;
        if submission_attempt_id.is_some() {
            file.role = String::from("submission");
        }
    }
    if total_bytes > 250 * 1024 * 1024 {
        return Err(invalid_request());
    }
    let storage = state.database.query_one_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT COALESCE(SUM(versions.byte_size),0)::BIGINT AS value \
         FROM knowledge_source_versions versions JOIN knowledge_sources sources ON sources.id=versions.source_id \
         JOIN knowledge_spaces spaces ON spaces.id=sources.space_id \
         WHERE spaces.owner_user_id=$1 AND sources.archived_at IS NULL",
        [user_id.into()],
    )).await?.ok_or_else(ApiError::internal)?;
    let used = get::<i64>(&storage, "value")?;
    let storage_limit = i64::try_from(limits.storage_bytes).unwrap_or(i64::MAX);
    if used.saturating_add(total_bytes) > storage_limit {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "storage_quota_reached",
            "This plan reached its Knowledge Space storage limit.",
        ));
    }

    let transaction = state.database.begin().await?;
    let mut pending = Vec::with_capacity(body.files.len());
    for file in body.files {
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
                [format!("source:{space_id}:{}", file.client_id).into()],
            ))
            .await?;
        if let Some(existing) = transaction.query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT sources.id,versions.id AS version_id,versions.object_key,versions.byte_size, \
                    versions.sha256,versions.media_type,versions.state \
             FROM knowledge_sources sources JOIN knowledge_source_versions versions ON versions.source_id=sources.id \
             WHERE sources.space_id=$1 AND sources.client_id=$2 \
             ORDER BY versions.version_number DESC LIMIT 1",
            [space_id.into(), file.client_id.into()],
        )).await? {
            if get::<i64>(&existing, "byte_size")? != file.byte_size
                || get::<String>(&existing, "sha256")? != file.sha256
                || get::<String>(&existing, "media_type")? != file.media_type
            {
                transaction.rollback().await?;
                return Err(ApiError::coded(
                    StatusCode::CONFLICT,
                    "upload_conflict",
                    "Upload idempotency key conflicts with different file metadata.",
                ));
            }
            pending.push(PendingUpload {
                source_id: get(&existing, "id")?,
                source_version_id: get(&existing, "version_id")?,
                object_key: get(&existing, "object_key")?,
                state: get(&existing, "state")?,
                file,
            });
            continue;
        }
        let source = transaction.query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO knowledge_sources (client_id,space_id,display_name,virtual_path,role,created_by) \
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
            [
                file.client_id.into(), space_id.into(), file.display_name.clone().into(),
                file.relative_path.clone().into(), file.role.clone().into(), user_id.into(),
            ],
        )).await?.ok_or_else(ApiError::internal)?;
        let source_id: Uuid = get(&source, "id")?;
        let object_key = format!("spaces/{space_id}/{}", Uuid::new_v4());
        let version = transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO knowledge_source_versions \
               (source_id,version_number,state,media_type,byte_size,sha256,object_key,created_by) \
             VALUES ($1,1,'pending_upload',$2,$3,$4,$5,$6) RETURNING id,state",
                [
                    source_id.into(),
                    file.media_type.clone().into(),
                    file.byte_size.into(),
                    file.sha256.clone().into(),
                    object_key.clone().into(),
                    user_id.into(),
                ],
            ))
            .await?
            .ok_or_else(ApiError::internal)?;
        pending.push(PendingUpload {
            source_id,
            source_version_id: get(&version, "id")?,
            object_key,
            state: get(&version, "state")?,
            file,
        });
    }
    if let Some(attempt_id) = submission_attempt_id {
        let attempt_exists = transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT id FROM knowledge_activity_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE",
                [attempt_id.into(), user_id.into()],
            ))
            .await?
            .is_some();
        if !attempt_exists {
            transaction.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::NOT_FOUND,
                "attempt_not_found",
                "Attempt not found.",
            ));
        }
        for item in &pending {
            transaction
                .execute_raw(Statement::from_sql_and_values(
                    DbBackend::Postgres,
                    "INSERT INTO knowledge_submission_artifacts \
                   (client_id,attempt_id,source_version_id,submitted_by) \
                 VALUES ($1,$2,$3,$4) ON CONFLICT (attempt_id,client_id) DO NOTHING",
                    [
                        item.file.client_id.into(),
                        attempt_id.into(),
                        item.source_version_id.into(),
                        user_id.into(),
                    ],
                ))
                .await?;
        }
    }
    transaction.commit().await?;

    let mut uploads = Vec::with_capacity(pending.len());
    for item in pending {
        let upload = if item.state == "pending_upload" {
            let checksum = checksum_base64(&item.file.sha256)?;
            Some(
                object_store
                    .presign_put(
                        &item.object_key,
                        item.file.byte_size,
                        &item.file.media_type,
                        &checksum,
                    )
                    .await
                    .map_err(|_| object_store_unavailable())?,
            )
        } else {
            None
        };
        uploads.push(json!({
            "sourceId": item.source_id,
            "sourceVersionId": item.source_version_id,
            "state": item.state,
            "upload": upload,
        }));
    }
    Ok((StatusCode::CREATED, Json(json!({ "uploads": uploads }))).into_response())
}

async fn complete_upload(
    state: &AppState,
    user_id: &str,
    body: CompleteUpload,
) -> Result<Response, ApiError> {
    let object_store = state
        .object_store
        .as_ref()
        .ok_or_else(object_store_unavailable)?;
    let authority = state
        .database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT versions.id,versions.object_key,versions.byte_size,versions.sha256, \
                versions.media_type,versions.state,sources.space_id \
         FROM knowledge_source_versions versions \
         JOIN knowledge_sources sources ON sources.id=versions.source_id \
         LEFT JOIN knowledge_space_members members ON members.space_id=sources.space_id \
           AND members.user_id=$2 AND members.removed_at IS NULL \
         WHERE versions.id=$1 AND (members.role IN ('owner','facilitator') OR EXISTS ( \
           SELECT 1 FROM knowledge_submission_artifacts artifacts \
           JOIN knowledge_activity_attempts attempts ON attempts.id=artifacts.attempt_id \
           WHERE artifacts.source_version_id=versions.id AND attempts.user_id=$2))",
            [body.source_version_id.into(), user_id.into()],
        ))
        .await?
        .ok_or_else(|| {
            ApiError::coded(
                StatusCode::NOT_FOUND,
                "upload_not_found",
                "Upload not found.",
            )
        })?;
    let current_state: String = get(&authority, "state")?;
    if matches!(current_state.as_str(), "ready" | "processing") {
        return Ok((
            StatusCode::ACCEPTED,
            Json(json!({
                "id": body.source_version_id,
                "state": current_state,
            })),
        )
            .into_response());
    }
    let object_key: String = get(&authority, "object_key")?;
    let head = object_store.head(&object_key).await.map_err(|_| {
        ApiError::coded(
            StatusCode::BAD_GATEWAY,
            "object_store_unavailable",
            "Uploaded object could not be verified.",
        )
    })?;
    let expected_checksum = checksum_base64(&get::<String>(&authority, "sha256")?)?;
    let expected_media_type = get::<String>(&authority, "media_type")?;
    let matches = head.byte_size == get::<i64>(&authority, "byte_size")?
        && head.media_type.as_deref() == Some(expected_media_type.as_str())
        && head.checksum_sha256_base64.as_deref() == Some(expected_checksum.as_str());
    if !matches {
        return Err(ApiError::coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "upload_integrity_mismatch",
            "Uploaded object does not match the reviewed file.",
        ));
    }
    let transaction = state.database.begin().await?;
    let result = transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE knowledge_source_versions SET state='processing' \
         WHERE id=$1 AND state IN ('pending_upload','processing')",
            [body.source_version_id.into()],
        ))
        .await?;
    if result.rows_affected() == 0 {
        transaction.rollback().await?;
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "upload_state_conflict",
            "Upload is not pending.",
        ));
    }
    transaction.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO knowledge_ingestion_jobs (source_version_id) VALUES ($1) \
         ON CONFLICT (source_version_id) DO UPDATE SET \
           state=CASE WHEN knowledge_ingestion_jobs.state='completed' THEN knowledge_ingestion_jobs.state ELSE 'queued' END, \
           available_at=CASE WHEN knowledge_ingestion_jobs.state='completed' THEN knowledge_ingestion_jobs.available_at ELSE NOW() END, \
           updated_at=NOW()",
        [body.source_version_id.into()],
    )).await?;
    transaction.commit().await?;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({
            "id": body.source_version_id,
            "state": "processing",
        })),
    )
        .into_response())
}

async fn starter_files(
    state: &AppState,
    user_id: &str,
    attempt_id: Uuid,
) -> Result<Response, ApiError> {
    let object_store = state
        .object_store
        .as_ref()
        .ok_or_else(object_store_unavailable)?;
    let attempt_exists = state
        .database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT id FROM knowledge_activity_attempts WHERE id=$1 AND user_id=$2",
            [attempt_id.into(), user_id.into()],
        ))
        .await?
        .is_some();
    if !attempt_exists {
        return Err(ApiError::coded(
            StatusCode::NOT_FOUND,
            "attempt_not_found",
            "Attempt not found.",
        ));
    }
    let rows = state.database.query_all_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT versions.id,versions.object_key,versions.byte_size,versions.sha256, \
                versions.media_type,sources.virtual_path \
         FROM knowledge_activity_attempts attempts \
         JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id \
         JOIN knowledge_activity_version_sources pinned ON pinned.activity_version_id=runs.activity_version_id \
         JOIN knowledge_source_versions versions ON versions.id=pinned.source_version_id \
         JOIN knowledge_sources sources ON sources.id=versions.source_id \
         WHERE attempts.id=$1 AND attempts.user_id=$2 AND sources.role='starter' AND versions.state='ready' \
         ORDER BY sources.virtual_path,versions.id",
        [attempt_id.into(), user_id.into()],
    )).await?;
    let mut files = Vec::with_capacity(rows.len());
    for row in rows {
        let object_key: String = get(&row, "object_key")?;
        let download = object_store
            .presign_get(&object_key)
            .await
            .map_err(|_| object_store_unavailable())?;
        files.push(json!({
            "sourceVersionId": get::<Uuid>(&row, "id")?,
            "byteSize": get::<i64>(&row, "byte_size")?,
            "sha256": get::<String>(&row, "sha256")?,
            "mediaType": get::<String>(&row, "media_type")?,
            "relativePath": get::<String>(&row, "virtual_path")?,
            "download": download,
        }));
    }
    Ok(Json(json!({ "files": files })).into_response())
}

async fn commit_submission(
    state: &AppState,
    user_id: &str,
    attempt_id: Uuid,
    _body: CommitSubmission,
) -> Result<Response, ApiError> {
    let transaction = state.database.begin().await?;
    let authority = transaction
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT versions.definition FROM knowledge_activity_attempts attempts \
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
    let definition: Value = get(&authority, "definition")?;
    if definition
        .pointer("/completionPolicy/requiresSubmission")
        .and_then(Value::as_bool)
        != Some(true)
    {
        transaction.rollback().await?;
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "submission_not_required",
            "This Activity does not require a submission.",
        ));
    }
    let row = transaction.query_one_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE knowledge_activity_attempts attempts \
         SET state='submitted',submitted_at=COALESCE(submitted_at,NOW()),updated_at=NOW() \
         WHERE attempts.id=$1 AND attempts.user_id=$2 \
           AND attempts.state IN ('assigned','in_progress','blocked') \
           AND EXISTS (SELECT 1 FROM knowledge_submission_artifacts artifacts \
             JOIN knowledge_source_versions versions ON versions.id=artifacts.source_version_id \
             WHERE artifacts.attempt_id=attempts.id AND versions.state IN ('processing','ready')) \
         RETURNING attempts.id,attempts.run_id,attempts.state,attempts.submitted_at::TEXT AS submitted_at",
        [attempt_id.into(), user_id.into()],
    )).await?;
    let row = match row {
        Some(row) => row,
        None => transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT id,run_id,state,submitted_at::TEXT AS submitted_at \
             FROM knowledge_activity_attempts WHERE id=$1 AND user_id=$2 AND state='submitted'",
                [attempt_id.into(), user_id.into()],
            ))
            .await?
            .ok_or_else(|| {
                ApiError::coded(
                    StatusCode::CONFLICT,
                    "submission_not_ready",
                    "No verified submission files are ready.",
                )
            })?,
    };
    if get::<String>(&row, "state")? == "submitted" {
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload) \
             SELECT $1,$2,'attempt_submitted',jsonb_build_object('state','submitted') \
             WHERE NOT EXISTS (SELECT 1 FROM knowledge_activity_run_events \
               WHERE run_id=$1 AND attempt_id=$2 AND event_type='attempt_submitted')",
                [get::<Uuid>(&row, "run_id")?.into(), attempt_id.into()],
            ))
            .await?;
    }
    transaction.commit().await?;
    Ok(Json(json!({
        "attemptId": attempt_id,
        "state": "submitted",
        "submittedAt": get::<String>(&row, "submitted_at")?,
    }))
    .into_response())
}

fn validate_upload_file(file: &UploadFile) -> Result<(), ApiError> {
    bounded(&file.relative_path, 1, 2_000)?;
    bounded(&file.display_name, 1, 255)?;
    if !matches!(
        file.media_type.as_str(),
        "text/plain" | "text/markdown" | "application/pdf"
    ) || !(1..=25 * 1024 * 1024).contains(&file.byte_size)
        || file.sha256.len() != 64
        || !file
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || !matches!(
            file.role.as_str(),
            "reference" | "instructions" | "rubric" | "starter" | "submission"
        )
    {
        return Err(invalid_request());
    }
    Ok(())
}

fn checksum_base64(hex: &str) -> Result<String, ApiError> {
    if hex.len() != 64 {
        return Err(invalid_request());
    }
    let bytes = (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).map_err(|_| invalid_request()))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(STANDARD.encode(bytes))
}

fn object_store_unavailable() -> ApiError {
    ApiError::coded(
        StatusCode::SERVICE_UNAVAILABLE,
        "object_store_unavailable",
        "Knowledge file storage is temporarily unavailable.",
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateGroup {
    client_id: Uuid,
    name: String,
}

async fn create_group(
    state: &AppState,
    user_id: &str,
    space_id: Uuid,
    body: CreateGroup,
) -> Result<Response, ApiError> {
    require_role(state, user_id, space_id, true).await?;
    let name = bounded(&body.name, 1, 240)?;
    let row = state
        .database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO knowledge_space_groups (client_id,space_id,name,created_by) \
         VALUES ($1,$2,$3,$4) ON CONFLICT (space_id,client_id) DO UPDATE \
         SET name=knowledge_space_groups.name RETURNING id,name,created_at::TEXT AS created_at",
            [
                body.client_id.into(),
                space_id.into(),
                name.into(),
                user_id.into(),
            ],
        ))
        .await?
        .ok_or_else(ApiError::internal)?;
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "id": get::<Uuid>(&row,"id")?, "name": get::<String>(&row,"name")?,
            "createdAt": get::<String>(&row,"created_at")?
        })),
    )
        .into_response())
}

async fn list_groups(
    state: &AppState,
    user_id: &str,
    space_id: Uuid,
) -> Result<Response, ApiError> {
    require_role(state, user_id, space_id, false).await?;
    let rows = state
        .database
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT groups.id,groups.name,groups.created_at::TEXT AS created_at, \
         COUNT(members.user_id)::INTEGER AS participant_count FROM knowledge_space_groups groups \
         LEFT JOIN knowledge_space_group_members members ON members.group_id=groups.id \
         WHERE groups.space_id=$1 AND groups.archived_at IS NULL GROUP BY groups.id \
         ORDER BY groups.created_at DESC,groups.id DESC LIMIT 500",
            [space_id.into()],
        ))
        .await?;
    let items = rows
        .iter()
        .map(|row| {
            Ok(json!({
                "id": get::<Uuid>(row,"id")?, "name": get::<String>(row,"name")?,
                "createdAt": get::<String>(row,"created_at")?,
                "participantCount": get::<i32>(row,"participant_count")?
            }))
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    Ok(Json(json!({"items":items})).into_response())
}

async fn list_members(
    state: &AppState,
    user_id: &str,
    space_id: Uuid,
) -> Result<Response, ApiError> {
    require_role(state, user_id, space_id, true).await?;
    let rows = state
        .database
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT user_id,role,joined_at::TEXT AS joined_at FROM knowledge_space_members \
         WHERE space_id=$1 AND removed_at IS NULL ORDER BY joined_at,user_id LIMIT 2000",
            [space_id.into()],
        ))
        .await?;
    let items = rows
        .iter()
        .map(|row| {
            Ok(json!({
                "userId": get::<String>(row,"user_id")?, "role": get::<String>(row,"role")?,
                "joinedAt": get::<String>(row,"joined_at")?
            }))
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    Ok(Json(json!({"items":items})).into_response())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateInvite {
    client_id: Uuid,
    #[serde(default)]
    group_id: Option<Uuid>,
    role: String,
    max_uses: i32,
    #[serde(default)]
    expires_at: Option<String>,
}

async fn create_invite(
    state: &AppState,
    user_id: &str,
    space_id: Uuid,
    body: CreateInvite,
) -> Result<Response, ApiError> {
    require_role(state, user_id, space_id, true).await?;
    if !matches!(body.role.as_str(), "facilitator" | "participant")
        || !(1..=10_000).contains(&body.max_uses)
    {
        return Err(invalid_request());
    }
    let random: [u8; 12] = rand::rng().random();
    let code = format!(
        "TROSPACE-{}",
        URL_SAFE_NO_PAD.encode(random).to_ascii_uppercase()
    );
    let digest = state
        .services
        .domain_digest(b"trocode-space-invite-v1\0", &code)?;
    let row = state.database.query_one_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO knowledge_space_invites (client_id,space_id,group_id,code_digest,role,max_uses,expires_at,created_by) \
         SELECT $1,$2,$3,$4,$5,$6,$7::timestamptz,$8 WHERE $3::uuid IS NULL OR EXISTS \
         (SELECT 1 FROM knowledge_space_groups WHERE id=$3 AND space_id=$2 AND archived_at IS NULL) \
         ON CONFLICT (space_id,client_id) DO UPDATE SET client_id=EXCLUDED.client_id \
         RETURNING id,role,max_uses,expires_at::TEXT AS expires_at,created_at::TEXT AS created_at",
        [body.client_id.into(),space_id.into(),body.group_id.into(),digest.into(),body.role.into(),body.max_uses.into(),body.expires_at.into(),user_id.into()],
    )).await?.ok_or_else(|| ApiError::coded(StatusCode::NOT_FOUND,"group_not_found","Group not found in this Space."))?;
    Ok((StatusCode::CREATED,Json(json!({
        "id":get::<Uuid>(&row,"id")?,"role":get::<String>(&row,"role")?,
        "maxUses":get::<i32>(&row,"max_uses")?,"expiresAt":get::<Option<String>>(&row,"expires_at")?,
        "createdAt":get::<String>(&row,"created_at")?,"code":code
    }))).into_response())
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RedeemInvite {
    code: String,
}

async fn redeem_invite(state: &AppState, user_id: &str, code: &str) -> Result<Response, ApiError> {
    if !(8..=128).contains(&code.trim().len()) {
        return Err(invalid_request());
    }
    let digest = state.services.domain_digest(
        b"trocode-space-invite-v1\0",
        &code.trim().to_ascii_uppercase(),
    )?;
    let transaction = state.database.begin().await?;
    let Some(row) = transaction
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT id,space_id,group_id,role,max_uses,used_count,expires_at,revoked_at, \
         (expires_at IS NOT NULL AND expires_at <= NOW()) AS expired \
         FROM knowledge_space_invites WHERE code_digest=$1 FOR UPDATE",
            [digest.into()],
        ))
        .await?
    else {
        transaction.rollback().await?;
        return Err(ApiError::coded(
            StatusCode::BAD_REQUEST,
            "invite_invalid",
            "This Space invite is invalid or expired.",
        ));
    };
    let invite_id: Uuid = get(&row, "id")?;
    let space_id: Uuid = get(&row, "space_id")?;
    let group_id: Option<Uuid> = get(&row, "group_id")?;
    let role: String = get(&row, "role")?;
    let max: i32 = get(&row, "max_uses")?;
    let used: i32 = get(&row, "used_count")?;
    let existing_redemption = transaction.query_one_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT 1 AS value FROM knowledge_space_invite_redemptions WHERE invite_id=$1 AND user_id=$2",
        [invite_id.into(), user_id.into()],
    )).await?.is_some();
    if existing_redemption {
        transaction.commit().await?;
        return Ok(Json(json!({"spaceId":space_id,"role":role})).into_response());
    }
    let invalid = get::<Option<String>>(&row, "revoked_at")?.is_some()
        || get::<bool>(&row, "expired")?
        || used >= max;
    if invalid {
        transaction.rollback().await?;
        return Err(ApiError::coded(
            StatusCode::BAD_REQUEST,
            "invite_invalid",
            "This Space invite is invalid or expired.",
        ));
    }
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO knowledge_space_members (space_id,user_id,role) VALUES ($1,$2,$3) \
         ON CONFLICT (space_id,user_id) DO UPDATE SET removed_at=NULL",
            [space_id.into(), user_id.into(), role.clone().into()],
        ))
        .await?;
    if let Some(group) = group_id {
        transaction.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "INSERT INTO knowledge_space_group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",[group.into(),user_id.into()])).await?;
    }
    transaction.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "INSERT INTO knowledge_space_invite_redemptions (invite_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",[invite_id.into(),user_id.into()])).await?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE knowledge_space_invites SET used_count=used_count+1 WHERE id=$1",
            [invite_id.into()],
        ))
        .await?;
    transaction.commit().await?;
    Ok(Json(json!({"spaceId":space_id,"role":role})).into_response())
}

async fn activity_dispatch(
    state: &AppState,
    user_id: &str,
    request: Request,
    segments: &[&str],
) -> Result<Response, ApiError> {
    crate::activity_http::dispatch(state, user_id, request, segments).await
}

async fn require_role(
    state: &AppState,
    user_id: &str,
    space_id: Uuid,
    manage: bool,
) -> Result<String, ApiError> {
    let row=state.database.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "SELECT role FROM knowledge_space_members WHERE space_id=$1 AND user_id=$2 AND removed_at IS NULL",
        [space_id.into(),user_id.into()])).await?.ok_or_else(||ApiError::coded(StatusCode::NOT_FOUND,"space_not_found","Space not found."))?;
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
        .and_then(|v| v.to_str().ok())
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
    let bytes = to_bytes(request.into_body(), MAX_KNOWLEDGE_BODY)
        .await
        .map_err(|_| {
            ApiError::coded(
                StatusCode::PAYLOAD_TOO_LARGE,
                "body_too_large",
                "Request body is too large.",
            )
        })?;
    serde_json::from_slice(&bytes).map_err(|_| invalid_request())
}

fn space_json(row: &QueryResult) -> Result<Value, ApiError> {
    Ok(json!({
        "id":get::<Uuid>(row,"id")?,"name":get::<String>(row,"name")?,
        "description":get::<String>(row,"description")?,"purposeLabel":get::<Option<String>>(row,"purpose_label")?,
        "role":get::<String>(row,"role")?,"createdAt":get::<String>(row,"created_at")?,"updatedAt":get::<String>(row,"updated_at")?
    }))
}
fn parse_uuid(value: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(value).map_err(|_| invalid_request())
}
fn bounded(value: &str, min: usize, max: usize) -> Result<String, ApiError> {
    let value = value.trim();
    let len = value.chars().count();
    if !(min..=max).contains(&len) {
        return Err(invalid_request());
    }
    Ok(value.to_owned())
}
fn bounded_optional(value: &str, max: usize) -> Result<String, ApiError> {
    let value = value.trim();
    if value.chars().count() > max {
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
