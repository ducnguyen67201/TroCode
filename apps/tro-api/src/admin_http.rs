use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, Payload},
};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get as route_get, patch, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use rand::Rng;
use sea_orm::{
    ConnectionTrait, DatabaseConnection, DbBackend, QueryResult, Statement, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{AppState, bearer, client_identity, error::ApiError};

const ADMIN_COOKIE: &str = "trocode_admin_session";
const ADMIN_SESSION_SECONDS: u64 = 30 * 24 * 60 * 60;
const ADMIN_HTML: &str = include_str!("../../../services/api/public/admin.html");
const ADMIN_CSS: &str = include_str!("../../../services/api/public/admin.css");
const ADMIN_JAVASCRIPT: &str = include_str!("../../../services/api/public/admin.js");
const ADMIN_FAVICON: &str = include_str!("../../../services/api/public/admin-favicon.svg");

#[derive(Clone)]
pub(crate) struct AdminService {
    database: DatabaseConnection,
    access_token: Arc<str>,
    digest_key: Arc<[u8]>,
    encryption_key: Arc<[u8]>,
}

impl std::fmt::Debug for AdminService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AdminService")
            .finish_non_exhaustive()
    }
}

impl AdminService {
    #[must_use]
    pub(crate) fn new(
        database: DatabaseConnection,
        access_token: String,
        digest_key: String,
        encryption_key: String,
    ) -> Self {
        Self {
            database,
            access_token: Arc::from(access_token),
            digest_key: Arc::from(digest_key.into_bytes()),
            encryption_key: Arc::from(encryption_key.into_bytes()),
        }
    }

    async fn list_users(&self, page: &PageInput) -> Result<UserList, ApiError> {
        let pattern = search_pattern(&page.search);
        let status = page.status.as_deref().unwrap_or("");
        let summary = self
            .database
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                r"SELECT COUNT(*)::INTEGER AS total_users,
                      COUNT(*) FILTER (WHERE blocked_at IS NULL)::INTEGER AS active_users,
                      COUNT(*) FILTER (WHERE blocked_at IS NOT NULL)::INTEGER AS blocked_users,
                      COUNT(*) FILTER (
                        WHERE ($1 = '' OR email ILIKE $1 OR name ILIKE $1)
                          AND ($2 = '' OR ($2 = 'active' AND blocked_at IS NULL)
                            OR ($2 = 'blocked' AND blocked_at IS NOT NULL))
                      )::INTEGER AS filtered_users
               FROM users",
                [pattern.clone().into(), status.into()],
            ))
            .await?
            .ok_or_else(ApiError::internal)?;
        let rows = self
            .database
            .query_all_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                r"SELECT users.id, users.email, users.name, users.plan,
                      users.blocked_at::TEXT AS blocked_at,
                      users.created_at::TEXT AS created_at,
                      codes.label AS code_label,
                      latest_session.last_seen_at::TEXT AS last_seen_at
               FROM users
               LEFT JOIN access_code_redemptions redemptions
                 ON redemptions.user_id = users.id
               LEFT JOIN access_codes codes
                 ON codes.id = redemptions.access_code_id
               LEFT JOIN LATERAL (
                 SELECT MAX(device_sessions.last_used_at) AS last_seen_at
                 FROM device_sessions WHERE device_sessions.user_id = users.id
               ) latest_session ON TRUE
               WHERE ($1 = '' OR users.email ILIKE $1 OR users.name ILIKE $1)
                 AND ($2 = '' OR ($2 = 'active' AND users.blocked_at IS NULL)
                   OR ($2 = 'blocked' AND users.blocked_at IS NOT NULL))
               ORDER BY users.created_at DESC, users.id
               LIMIT $3 OFFSET $4",
                [
                    pattern.into(),
                    status.into(),
                    i64::from(page.limit).into(),
                    i64::from(page.offset).into(),
                ],
            ))
            .await?;
        let items = rows
            .iter()
            .map(public_user)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(UserList {
            items,
            page: Page {
                limit: page.limit,
                offset: page.offset,
                total: get(&summary, "filtered_users")?,
            },
            summary: UserSummary {
                active_users: get(&summary, "active_users")?,
                blocked_users: get(&summary, "blocked_users")?,
                total_users: get(&summary, "total_users")?,
            },
        })
    }

    async fn set_user_blocked(&self, user_id: &str, blocked: bool) -> Result<UserAccess, ApiError> {
        let transaction = self.database.begin().await?;
        let row = transaction.query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE users SET blocked_at = CASE WHEN $2 THEN COALESCE(blocked_at, NOW()) ELSE NULL END, \
             updated_at = NOW() WHERE id = $1 RETURNING id, blocked_at::TEXT AS blocked_at",
            [user_id.into(), blocked.into()],
        )).await?;
        let Some(row) = row else {
            transaction.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::NOT_FOUND,
                "user_not_found",
                "User not found.",
            ));
        };
        if blocked {
            transaction.execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "UPDATE device_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
                [user_id.into()],
            )).await?;
        }
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO admin_audit_events (action, target_user_id) VALUES ($1, $2)",
                [
                    if blocked {
                        "user.blocked"
                    } else {
                        "user.unblocked"
                    }
                    .into(),
                    user_id.into(),
                ],
            ))
            .await?;
        transaction.commit().await?;
        let blocked_at: Option<String> = get(&row, "blocked_at")?;
        Ok(UserAccess {
            id: get(&row, "id")?,
            status: if blocked_at.is_some() {
                "blocked"
            } else {
                "active"
            },
            blocked_at,
        })
    }

    async fn list_access_codes(&self, page: &PageInput) -> Result<AccessCodeList, ApiError> {
        let pattern = search_pattern(&page.search);
        let search_digest = if page.search.is_empty() {
            None
        } else {
            access_code_digest(&page.search, &self.digest_key)
        };
        let status = page.status.as_deref().unwrap_or("");
        let summary = self.database.query_one_raw(Statement::from_string(
            DbBackend::Postgres,
            r"WITH usage AS (
                 SELECT codes.id, codes.max_users, codes.code_ciphertext, codes.paused_at,
                        COUNT(redemptions.user_id)::INTEGER AS redeemed_users
                 FROM access_codes codes
                 LEFT JOIN access_code_redemptions redemptions
                   ON redemptions.access_code_id = codes.id
                 GROUP BY codes.id, codes.max_users, codes.code_ciphertext, codes.paused_at
               )
               SELECT COUNT(*)::INTEGER AS total_codes,
                      COUNT(*) FILTER (WHERE paused_at IS NULL AND redeemed_users < max_users)::INTEGER AS available_codes,
                      COUNT(*) FILTER (WHERE redeemed_users >= max_users)::INTEGER AS full_codes,
                      COUNT(*) FILTER (WHERE paused_at IS NOT NULL)::INTEGER AS paused_codes,
                      COUNT(*) FILTER (WHERE code_ciphertext IS NOT NULL)::INTEGER AS retrievable_codes,
                      COALESCE(SUM(redeemed_users), 0)::INTEGER AS total_redemptions
               FROM usage".to_owned(),
        )).await?.ok_or_else(ApiError::internal)?;
        let rows = self
            .database
            .query_all_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                r"WITH usage AS (
                 SELECT codes.id, codes.code_digest, codes.code_ciphertext, codes.label,
                        codes.max_users, codes.plan, codes.created_at, codes.paused_at,
                        COUNT(redemptions.user_id)::INTEGER AS redeemed_users
                 FROM access_codes codes
                 LEFT JOIN access_code_redemptions redemptions
                   ON redemptions.access_code_id = codes.id
                 GROUP BY codes.id, codes.code_digest, codes.code_ciphertext, codes.label,
                          codes.max_users, codes.plan, codes.created_at, codes.paused_at
               )
               SELECT id, code_digest, code_ciphertext, label, max_users, plan,
                      created_at::TEXT AS created_at, paused_at::TEXT AS paused_at, redeemed_users,
                      COUNT(*) OVER()::INTEGER AS filtered_total
               FROM usage
               WHERE ($1 = '' OR ($1 = 'available' AND paused_at IS NULL AND redeemed_users < max_users)
                 OR ($1 = 'full' AND redeemed_users >= max_users)
                 OR ($1 = 'paused' AND paused_at IS NOT NULL))
                 AND ($2 = '' OR COALESCE(label, '') ILIKE $2 OR code_digest = $3)
               ORDER BY created_at DESC, id LIMIT $4 OFFSET $5",
                [
                    status.into(),
                    pattern.into(),
                    search_digest.into(),
                    i64::from(page.limit).into(),
                    i64::from(page.offset).into(),
                ],
            ))
            .await?;
        let items = rows
            .iter()
            .map(|row| self.public_access_code(row))
            .collect::<Result<Vec<_>, _>>()?;
        let total = match rows.first() {
            Some(row) => get(row, "filtered_total")?,
            None => 0,
        };
        Ok(AccessCodeList {
            items,
            page: Page {
                limit: page.limit,
                offset: page.offset,
                total,
            },
            summary: AccessCodeSummary {
                available_codes: get(&summary, "available_codes")?,
                full_codes: get(&summary, "full_codes")?,
                paused_codes: get(&summary, "paused_codes")?,
                retrievable_codes: get(&summary, "retrievable_codes")?,
                total_codes: get(&summary, "total_codes")?,
                total_redemptions: get(&summary, "total_redemptions")?,
            },
        })
    }

    fn public_access_code(&self, row: &QueryResult) -> Result<PublicAccessCode, ApiError> {
        let digest: Vec<u8> = get(row, "code_digest")?;
        let sealed: Option<Vec<u8>> = get(row, "code_ciphertext")?;
        let code = sealed.as_deref().and_then(|sealed| {
            open_access_code(sealed, &self.encryption_key, &digest)
                .or_else(|| open_access_code(sealed, &self.digest_key, &digest))
        });
        let retrievable = code.is_some();
        let max_users: i32 = get(row, "max_users")?;
        let redeemed_users: i32 = get(row, "redeemed_users")?;
        let paused_at: Option<String> = get(row, "paused_at")?;
        Ok(PublicAccessCode {
            id: get(row, "id")?,
            code,
            created_at: get(row, "created_at")?,
            label: get(row, "label")?,
            max_users,
            paused_at: paused_at.clone(),
            plan: get(row, "plan")?,
            redeemed_users,
            remaining_users: max_users.saturating_sub(redeemed_users).max(0),
            retrievable,
            status: if paused_at.is_some() {
                "paused"
            } else if redeemed_users >= max_users {
                "full"
            } else {
                "available"
            },
        })
    }

    async fn list_access_code_users(
        &self,
        code_id: Uuid,
        page: &PageInput,
    ) -> Result<AccessCodeUsers, ApiError> {
        let code = self
            .database
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                r"SELECT codes.id, codes.label, codes.max_users, codes.plan,
                      COUNT(redemptions.user_id)::INTEGER AS redeemed_users
               FROM access_codes codes
               LEFT JOIN access_code_redemptions redemptions
                 ON redemptions.access_code_id = codes.id
               WHERE codes.id = $1
               GROUP BY codes.id, codes.label, codes.max_users, codes.plan",
                [code_id.into()],
            ))
            .await?
            .ok_or_else(|| {
                ApiError::coded(
                    StatusCode::NOT_FOUND,
                    "code_not_found",
                    "Access code not found.",
                )
            })?;
        let rows = self
            .database
            .query_all_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                r"SELECT users.id, users.email, users.name, users.blocked_at,
                      redemptions.redeemed_at::TEXT AS redeemed_at
               FROM access_code_redemptions redemptions
               INNER JOIN users ON users.id = redemptions.user_id
               WHERE redemptions.access_code_id = $1
               ORDER BY redemptions.redeemed_at DESC, users.id LIMIT $2 OFFSET $3",
                [
                    code_id.into(),
                    i64::from(page.limit).into(),
                    i64::from(page.offset).into(),
                ],
            ))
            .await?;
        let redeemed_users: i32 = get(&code, "redeemed_users")?;
        let items = rows
            .iter()
            .map(|row| {
                let blocked_at: Option<time::OffsetDateTime> = get(row, "blocked_at")?;
                Ok(AccessCodeUser {
                    id: get(row, "id")?,
                    email: get(row, "email")?,
                    name: get(row, "name")?,
                    redeemed_at: get(row, "redeemed_at")?,
                    status: if blocked_at.is_some() {
                        "blocked"
                    } else {
                        "active"
                    },
                })
            })
            .collect::<Result<Vec<_>, ApiError>>()?;
        Ok(AccessCodeUsers {
            code: AccessCodeUserSummary {
                id: get(&code, "id")?,
                label: get(&code, "label")?,
                max_users: get(&code, "max_users")?,
                plan: get(&code, "plan")?,
                redeemed_users,
            },
            items,
            page: Page {
                limit: page.limit,
                offset: page.offset,
                total: redeemed_users,
            },
        })
    }

    async fn create_access_codes(&self, input: BulkCodeInput) -> Result<BulkCodeOutput, ApiError> {
        let transaction = self.database.begin().await?;
        let mut items = Vec::with_capacity(usize::from(input.count));
        for index in 0..input.count {
            let code = generate_access_code();
            let digest =
                access_code_digest(&code, &self.digest_key).ok_or_else(ApiError::internal)?;
            let sealed = seal_access_code(&code, &self.encryption_key, &digest)?;
            let label = input.label.as_ref().map(|label| {
                if input.count == 1 {
                    label.clone()
                } else {
                    format!("{label} {}/{}", index + 1, input.count)
                }
            });
            let row = transaction.query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO access_codes (code_digest, code_ciphertext, label, max_users, plan) \
                 VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at::TEXT AS created_at",
                [
                    digest.into(), sealed.into(), label.clone().into(), input.max_users.into(),
                    input.plan.as_str().into(),
                ],
            )).await?.ok_or_else(ApiError::internal)?;
            items.push(CreatedAccessCode {
                id: get(&row, "id")?,
                code,
                created_at: get(&row, "created_at")?,
                label,
                max_users: input.max_users,
                plan: input.plan.as_str(),
            });
        }
        let detail = serde_json::to_string(&json!({
            "count": input.count, "maxUsers": input.max_users, "plan": input.plan.as_str(),
        }))
        .map_err(|_| ApiError::internal())?;
        transaction.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO admin_audit_events (action, detail) VALUES ('access_codes.created', $1::JSONB)",
            [detail.into()],
        )).await?;
        transaction.commit().await?;
        Ok(BulkCodeOutput { items })
    }

    async fn set_access_code_paused(
        &self,
        code_id: Uuid,
        paused: bool,
    ) -> Result<AccessCodeLifecycle, ApiError> {
        let transaction = self.database.begin().await?;
        let row = transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                r"WITH updated AS (
                     UPDATE access_codes
                     SET paused_at = CASE WHEN $2 THEN COALESCE(paused_at, NOW()) ELSE NULL END
                     WHERE id = $1
                     RETURNING id, max_users, paused_at
                   )
                   SELECT updated.id, updated.max_users,
                          updated.paused_at::TEXT AS paused_at,
                          COUNT(redemptions.user_id)::INTEGER AS redeemed_users
                   FROM updated
                   LEFT JOIN access_code_redemptions redemptions
                     ON redemptions.access_code_id = updated.id
                   GROUP BY updated.id, updated.max_users, updated.paused_at",
                [code_id.into(), paused.into()],
            ))
            .await?;
        let Some(row) = row else {
            transaction.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::NOT_FOUND,
                "code_not_found",
                "Access code not found.",
            ));
        };
        let action = if paused {
            "access_codes.paused"
        } else {
            "access_codes.resumed"
        };
        let detail = serde_json::to_string(&json!({ "accessCodeId": code_id }))
            .map_err(|_| ApiError::internal())?;
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO admin_audit_events (action, detail) VALUES ($1, $2::JSONB)",
                [action.into(), detail.into()],
            ))
            .await?;
        let paused_at: Option<String> = get(&row, "paused_at")?;
        let max_users: i32 = get(&row, "max_users")?;
        let redeemed_users: i32 = get(&row, "redeemed_users")?;
        transaction.commit().await?;
        Ok(AccessCodeLifecycle {
            id: code_id,
            paused_at: paused_at.clone(),
            status: if paused_at.is_some() {
                "paused"
            } else if redeemed_users >= max_users {
                "full"
            } else {
                "available"
            },
        })
    }

    async fn delete_access_code(&self, code_id: Uuid) -> Result<DeletedAccessCode, ApiError> {
        let transaction = self.database.begin().await?;
        let exists = transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT id FROM access_codes WHERE id = $1 FOR UPDATE",
                [code_id.into()],
            ))
            .await?;
        if exists.is_none() {
            transaction.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::NOT_FOUND,
                "code_not_found",
                "Access code not found.",
            ));
        }
        let usage = transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT COUNT(*)::INTEGER AS redeemed_users FROM access_code_redemptions WHERE access_code_id = $1",
                [code_id.into()],
            ))
            .await?
            .ok_or_else(ApiError::internal)?;
        let redeemed_users: i32 = get(&usage, "redeemed_users")?;
        if redeemed_users > 0 {
            transaction.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::CONFLICT,
                "code_in_use",
                "Access codes with redemptions cannot be deleted.",
            ));
        }
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "DELETE FROM access_codes WHERE id = $1",
                [code_id.into()],
            ))
            .await?;
        let detail = serde_json::to_string(&json!({ "accessCodeId": code_id }))
            .map_err(|_| ApiError::internal())?;
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO admin_audit_events (action, detail) VALUES ('access_codes.deleted', $1::JSONB)",
                [detail.into()],
            ))
            .await?;
        transaction.commit().await?;
        Ok(DeletedAccessCode {
            id: code_id,
            kind: "deleted",
        })
    }
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/source/admin", route_get(admin_page))
        .route("/source/admin/", route_get(admin_page))
        .route("/source/admin/assets/favicon.svg", route_get(admin_favicon))
        .route("/source/admin/assets/admin.css", route_get(admin_css))
        .route("/source/admin/assets/admin.js", route_get(admin_javascript))
        .route(
            "/v1/admin/session",
            post(create_session).delete(delete_session),
        )
        .route("/v1/admin/users", route_get(list_users))
        .route(
            "/v1/admin/users/{user_id}/access",
            patch(set_user_access).layer(DefaultBodyLimit::max(4_096)),
        )
        .route("/v1/admin/access-codes", route_get(list_access_codes))
        .route(
            "/v1/admin/access-codes/{code_id}",
            patch(set_access_code_paused)
                .delete(delete_access_code)
                .layer(DefaultBodyLimit::max(4_096)),
        )
        .route(
            "/v1/admin/access-codes/{code_id}/users",
            route_get(list_access_code_users),
        )
        .route(
            "/v1/admin/access-codes/bulk",
            post(create_access_codes).layer(DefaultBodyLimit::max(8_192)),
        )
}

async fn admin_page(State(state): State<AppState>) -> Result<Response, ApiError> {
    enabled(&state)?;
    Ok(asset(ADMIN_HTML, "text/html; charset=utf-8"))
}

async fn admin_css(State(state): State<AppState>) -> Result<Response, ApiError> {
    enabled(&state)?;
    Ok(asset(ADMIN_CSS, "text/css; charset=utf-8"))
}

async fn admin_javascript(State(state): State<AppState>) -> Result<Response, ApiError> {
    enabled(&state)?;
    Ok(asset(ADMIN_JAVASCRIPT, "text/javascript; charset=utf-8"))
}

async fn admin_favicon(State(state): State<AppState>) -> Result<Response, ApiError> {
    enabled(&state)?;
    Ok(asset(ADMIN_FAVICON, "image/svg+xml; charset=utf-8"))
}

async fn create_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let admin = authorize(&state, &headers, true).await?;
    let session = issue_admin_session(&admin.access_token)?;
    let cookie = format!(
        "{ADMIN_COOKIE}={session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age={ADMIN_SESSION_SECONDS}"
    );
    empty_with_cookie(&cookie)
}

async fn delete_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    authorize(&state, &headers, false).await?;
    empty_with_cookie(&format!(
        "{ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
    ))
}

async fn list_users(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PageQuery>,
) -> Result<Json<UserList>, ApiError> {
    let admin = authorize(&state, &headers, false).await?;
    let page = query.validate(PageKind::Users)?;
    Ok(Json(admin.list_users(&page).await?))
}

async fn set_user_access(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(body): Json<UserAccessInput>,
) -> Result<Json<UserAccess>, ApiError> {
    let admin = authorize(&state, &headers, false).await?;
    let user_id = user_id.trim();
    if user_id.is_empty() || user_id.len() > 255 {
        return Err(invalid("User ID is invalid."));
    }
    Ok(Json(admin.set_user_blocked(user_id, body.blocked).await?))
}

async fn list_access_codes(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PageQuery>,
) -> Result<Json<AccessCodeList>, ApiError> {
    let admin = authorize(&state, &headers, false).await?;
    let page = query.validate(PageKind::AccessCodes)?;
    Ok(Json(admin.list_access_codes(&page).await?))
}

async fn list_access_code_users(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(code_id): Path<Uuid>,
    Query(query): Query<PageQuery>,
) -> Result<Json<AccessCodeUsers>, ApiError> {
    let admin = authorize(&state, &headers, false).await?;
    let page = query.validate(PageKind::CodeUsers)?;
    Ok(Json(admin.list_access_code_users(code_id, &page).await?))
}

async fn set_access_code_paused(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(code_id): Path<Uuid>,
    Json(body): Json<AccessCodeStateInput>,
) -> Result<Json<AccessCodeLifecycle>, ApiError> {
    let admin = authorize(&state, &headers, false).await?;
    Ok(Json(
        admin.set_access_code_paused(code_id, body.paused).await?,
    ))
}

async fn delete_access_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(code_id): Path<Uuid>,
) -> Result<Json<DeletedAccessCode>, ApiError> {
    let admin = authorize(&state, &headers, false).await?;
    Ok(Json(admin.delete_access_code(code_id).await?))
}

async fn create_access_codes(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<BulkCodeBody>,
) -> Result<(StatusCode, Json<BulkCodeOutput>), ApiError> {
    let admin = authorize(&state, &headers, false).await?;
    let input = body.validate()?;
    Ok((
        StatusCode::CREATED,
        Json(admin.create_access_codes(input).await?),
    ))
}

async fn authorize(
    state: &AppState,
    headers: &HeaderMap,
    bearer_only: bool,
) -> Result<AdminService, ApiError> {
    assert_same_origin(headers)?;
    let admin = enabled(state)?.clone();
    state
        .services
        .consume_rate("admin.api", &client_identity(headers), 120, 60_000)
        .await?;
    if bearer(headers).is_some_and(|token| token_equal(token, &admin.access_token)) {
        return Ok(admin);
    }
    if !bearer_only
        && admin_session_cookie(headers)
            .is_some_and(|session| verify_admin_session(session, &admin.access_token))
    {
        return Ok(admin);
    }
    Err(ApiError::coded(
        StatusCode::UNAUTHORIZED,
        "admin_required",
        "Admin access token is invalid.",
    ))
}

fn enabled(state: &AppState) -> Result<&AdminService, ApiError> {
    state.admin.as_ref().ok_or_else(|| {
        ApiError::coded(
            StatusCode::NOT_FOUND,
            "not_found",
            "Admin endpoint not found.",
        )
    })
}

fn asset(body: &'static str, content_type: &'static str) -> Response {
    let mut response = Response::new(Body::from(body));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    if let Ok(length) = HeaderValue::from_str(&body.len().to_string()) {
        response
            .headers_mut()
            .insert(header::CONTENT_LENGTH, length);
    }
    response
}

fn empty_with_cookie(cookie: &str) -> Result<Response, ApiError> {
    let mut response = StatusCode::NO_CONTENT.into_response();
    let value = HeaderValue::from_str(cookie).map_err(|_| ApiError::internal())?;
    response.headers_mut().insert(header::SET_COOKIE, value);
    Ok(response)
}

fn assert_same_origin(headers: &HeaderMap) -> Result<(), ApiError> {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return Ok(());
    };
    let origin = origin.to_str().map_err(|_| origin_denied())?;
    let parsed = url::Url::parse(origin).map_err(|_| origin_denied())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(origin_denied());
    }
    let authority = &parsed[url::Position::BeforeHost..url::Position::AfterPort];
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(origin_denied)?;
    if !authority.eq_ignore_ascii_case(host) {
        return Err(origin_denied());
    }
    Ok(())
}

fn origin_denied() -> ApiError {
    ApiError::coded(
        StatusCode::FORBIDDEN,
        "origin_denied",
        "Browser origin is not allowed.",
    )
}

fn invalid(message: &'static str) -> ApiError {
    ApiError::coded(StatusCode::BAD_REQUEST, "invalid_request", message)
}

fn token_equal(actual: &str, expected: &str) -> bool {
    let actual_digest: [u8; 32] = Sha256::digest(actual.as_bytes()).into();
    let expected_digest: [u8; 32] = Sha256::digest(expected.as_bytes()).into();
    constant_time_eq(&actual_digest, &expected_digest)
}

fn issue_admin_session(access_token: &str) -> Result<String, ApiError> {
    let expires = unix_seconds()?.saturating_add(ADMIN_SESSION_SECONDS);
    let payload = format!("v1.{expires}");
    let signature = session_signature(&payload, access_token)?;
    Ok(format!("{payload}.{signature}"))
}

fn verify_admin_session(session: &str, access_token: &str) -> bool {
    if session.len() > 256 {
        return false;
    }
    let mut parts = session.split('.');
    let (Some("v1"), Some(expires), Some(signature), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    if !(10..=12).contains(&expires.len())
        || !expires.bytes().all(|byte| byte.is_ascii_digit())
        || signature.len() != 43
        || !signature
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return false;
    }
    let Ok(expires) = expires.parse::<u64>() else {
        return false;
    };
    let Ok(now) = unix_seconds() else {
        return false;
    };
    if expires <= now {
        return false;
    }
    let payload = format!("v1.{expires}");
    session_signature(&payload, access_token)
        .is_ok_and(|expected| constant_time_eq(signature.as_bytes(), expected.as_bytes()))
}

fn session_signature(payload: &str, access_token: &str) -> Result<String, ApiError> {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(access_token.as_bytes())
        .map_err(|_| ApiError::internal())?;
    mac.update(b"trocode-admin-browser-session-v1\0");
    mac.update(payload.as_bytes());
    Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
}

fn admin_session_cookie(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::COOKIE)?.to_str().ok()?;
    if value.len() > 8_192 {
        return None;
    }
    let prefix = format!("{ADMIN_COOKIE}=");
    value
        .split(';')
        .map(str::trim)
        .find_map(|part| part.strip_prefix(&prefix))
}

fn unix_seconds() -> Result<u64, ApiError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| ApiError::internal())
}

fn search_pattern(search: &str) -> String {
    if search.is_empty() {
        String::new()
    } else {
        format!("%{search}%")
    }
}

fn access_code_digest(value: &str, key: &[u8]) -> Option<Vec<u8>> {
    let normalized = normalize_access_code(value)?;
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).ok()?;
    mac.update(b"trocode-access-code-v1\0");
    mac.update(normalized.as_bytes());
    Some(mac.finalize().into_bytes().to_vec())
}

fn normalize_access_code(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_uppercase();
    let mut characters = normalized.chars();
    let first = characters.next()?;
    ((4..=64).contains(&normalized.len())
        && first.is_ascii_alphanumeric()
        && characters
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_')))
    .then_some(normalized)
}

fn generate_access_code() -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let bytes: [u8; 12] = rand::rng().random();
    let mut result = String::with_capacity(28);
    result.push_str("TRO-");
    for byte in bytes {
        result.push(char::from(HEX[usize::from(byte >> 4)]));
        result.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    result
}

fn encryption_key(secret: &[u8]) -> Result<[u8; 32], ApiError> {
    let mut mac =
        <Hmac<Sha256> as Mac>::new_from_slice(secret).map_err(|_| ApiError::internal())?;
    mac.update(b"trocode-access-code-encryption-v1\0");
    Ok(mac.finalize().into_bytes().into())
}

fn seal_access_code(code: &str, secret: &[u8], digest: &[u8]) -> Result<Vec<u8>, ApiError> {
    if digest.len() != 32 {
        return Err(ApiError::internal());
    }
    let key = encryption_key(secret)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| ApiError::internal())?;
    let nonce_bytes: [u8; 12] = rand::rng().random();
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: code.as_bytes(),
                aad: digest,
            },
        )
        .map_err(|_| ApiError::internal())?;
    let tag_start = encrypted
        .len()
        .checked_sub(16)
        .ok_or_else(ApiError::internal)?;
    let mut sealed = Vec::with_capacity(1 + 12 + encrypted.len());
    sealed.push(1);
    sealed.extend_from_slice(&nonce_bytes);
    sealed.extend_from_slice(&encrypted[tag_start..]);
    sealed.extend_from_slice(&encrypted[..tag_start]);
    Ok(sealed)
}

fn open_access_code(sealed: &[u8], secret: &[u8], digest: &[u8]) -> Option<String> {
    if digest.len() != 32 || sealed.len() < 30 || sealed[0] != 1 {
        return None;
    }
    let key = encryption_key(secret).ok()?;
    let cipher = Aes256Gcm::new_from_slice(&key).ok()?;
    let mut encrypted = sealed[29..].to_vec();
    encrypted.extend_from_slice(&sealed[13..29]);
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&sealed[1..13]),
            Payload {
                msg: &encrypted,
                aad: digest,
            },
        )
        .ok()?;
    String::from_utf8(plaintext).ok()
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn get<T: sea_orm::TryGetable>(row: &QueryResult, column: &str) -> Result<T, ApiError> {
    row.try_get("", column).map_err(|_| ApiError::internal())
}

fn public_user(row: &QueryResult) -> Result<PublicAdminUser, ApiError> {
    let blocked_at: Option<String> = get(row, "blocked_at")?;
    Ok(PublicAdminUser {
        id: get(row, "id")?,
        email: get(row, "email")?,
        name: get(row, "name")?,
        plan: get(row, "plan")?,
        code_label: get(row, "code_label")?,
        created_at: get(row, "created_at")?,
        last_seen_at: get(row, "last_seen_at")?,
        status: if blocked_at.is_some() {
            "blocked"
        } else {
            "active"
        },
        blocked_at,
    })
}

#[derive(Debug, Deserialize)]
struct PageQuery {
    limit: Option<u32>,
    offset: Option<u32>,
    #[serde(default)]
    search: String,
    status: Option<String>,
}

#[derive(Debug, Clone, Copy)]
enum PageKind {
    Users,
    AccessCodes,
    CodeUsers,
}

impl PageQuery {
    fn validate(self, kind: PageKind) -> Result<PageInput, ApiError> {
        let limit = self.limit.unwrap_or(50);
        let offset = self.offset.unwrap_or(0);
        let search = self.search.trim().to_owned();
        if !(1..=100).contains(&limit) || offset > 100_000 || search.len() > 200 {
            return Err(invalid("Pagination values are invalid."));
        }
        let status = match (kind, self.status.as_deref()) {
            (_, None) | (PageKind::CodeUsers, Some("")) => None,
            (PageKind::Users, Some(value @ ("active" | "blocked")))
            | (PageKind::AccessCodes, Some(value @ ("available" | "full" | "paused"))) => {
                Some(value.to_owned())
            }
            _ => return Err(invalid("Status filter is invalid.")),
        };
        Ok(PageInput {
            limit,
            offset,
            search,
            status,
        })
    }
}

#[derive(Debug)]
struct PageInput {
    limit: u32,
    offset: u32,
    search: String,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct UserAccessInput {
    blocked: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AccessCodeStateInput {
    paused: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BulkCodeBody {
    count: u16,
    label: Option<String>,
    max_users: i32,
    plan: String,
}

#[derive(Debug, Clone, Copy)]
enum AdminPlan {
    Free,
    Basic,
    Pro,
    Max,
}

impl AdminPlan {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Free => "free",
            Self::Basic => "basic",
            Self::Pro => "pro",
            Self::Max => "max",
        }
    }
}

impl BulkCodeBody {
    fn validate(self) -> Result<BulkCodeInput, ApiError> {
        if !(1..=100).contains(&self.count) || !(1..=10_000).contains(&self.max_users) {
            return Err(invalid("Request values are invalid."));
        }
        let label = self
            .label
            .map(|label| label.trim().to_owned())
            .filter(|label| !label.is_empty());
        if label
            .as_ref()
            .is_some_and(|label| label.chars().count() > 80)
        {
            return Err(invalid("Request values are invalid."));
        }
        let plan = match self.plan.as_str() {
            "free" => AdminPlan::Free,
            "basic" => AdminPlan::Basic,
            "pro" => AdminPlan::Pro,
            "max" => AdminPlan::Max,
            _ => return Err(invalid("Request values are invalid.")),
        };
        Ok(BulkCodeInput {
            count: self.count,
            label,
            max_users: self.max_users,
            plan,
        })
    }
}

#[derive(Debug)]
struct BulkCodeInput {
    count: u16,
    label: Option<String>,
    max_users: i32,
    plan: AdminPlan,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Page {
    limit: u32,
    offset: u32,
    total: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicAdminUser {
    blocked_at: Option<String>,
    code_label: Option<String>,
    created_at: String,
    email: String,
    id: String,
    last_seen_at: Option<String>,
    name: String,
    plan: String,
    status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_field_names)]
struct UserSummary {
    active_users: i32,
    blocked_users: i32,
    total_users: i32,
}

#[derive(Debug, Serialize)]
struct UserList {
    items: Vec<PublicAdminUser>,
    page: Page,
    summary: UserSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UserAccess {
    blocked_at: Option<String>,
    id: String,
    status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicAccessCode {
    code: Option<String>,
    created_at: String,
    id: Uuid,
    label: Option<String>,
    max_users: i32,
    paused_at: Option<String>,
    plan: String,
    redeemed_users: i32,
    remaining_users: i32,
    retrievable: bool,
    status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccessCodeSummary {
    available_codes: i32,
    full_codes: i32,
    paused_codes: i32,
    retrievable_codes: i32,
    total_codes: i32,
    total_redemptions: i32,
}

#[derive(Debug, Serialize)]
struct AccessCodeList {
    items: Vec<PublicAccessCode>,
    page: Page,
    summary: AccessCodeSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccessCodeUser {
    email: String,
    id: String,
    name: String,
    redeemed_at: String,
    status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccessCodeUserSummary {
    id: Uuid,
    label: Option<String>,
    max_users: i32,
    plan: String,
    redeemed_users: i32,
}

#[derive(Debug, Serialize)]
struct AccessCodeUsers {
    code: AccessCodeUserSummary,
    items: Vec<AccessCodeUser>,
    page: Page,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccessCodeLifecycle {
    id: Uuid,
    paused_at: Option<String>,
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct DeletedAccessCode {
    id: Uuid,
    kind: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatedAccessCode {
    code: String,
    created_at: String,
    id: Uuid,
    label: Option<String>,
    max_users: i32,
    plan: &'static str,
}

#[derive(Debug, Serialize)]
struct BulkCodeOutput {
    items: Vec<CreatedAccessCode>,
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "test-secret-that-is-longer-than-thirty-two-characters";

    #[test]
    fn admin_session_is_signed_and_rejects_tampering() {
        let session = issue_admin_session(SECRET).unwrap_or_default();
        assert!(verify_admin_session(&session, SECRET));
        let replacement = if session.ends_with('A') { 'B' } else { 'A' };
        let tampered = format!(
            "{}{replacement}",
            session
                .get(..session.len().saturating_sub(1))
                .unwrap_or_default()
        );
        assert!(!verify_admin_session(&tampered, SECRET));
        assert!(!verify_admin_session(
            &session,
            "rotated-secret-that-is-longer-than-thirty-two-characters"
        ));
    }

    #[test]
    fn access_code_cipher_matches_digest_and_rejects_wrong_key() {
        let digest = access_code_digest("TRO-ABC123", SECRET.as_bytes()).unwrap_or_default();
        let sealed = seal_access_code("TRO-ABC123", SECRET.as_bytes(), &digest).unwrap_or_default();
        assert_eq!(
            open_access_code(&sealed, SECRET.as_bytes(), &digest).as_deref(),
            Some("TRO-ABC123")
        );
        assert!(
            open_access_code(
                &sealed,
                b"different-secret-that-is-at-least-32-bytes",
                &digest
            )
            .is_none()
        );
        assert!(open_access_code(&sealed, SECRET.as_bytes(), &[8_u8; 32]).is_none());
    }

    #[test]
    fn bulk_input_is_strictly_bounded() {
        let valid = BulkCodeBody {
            count: 100,
            label: Some(" Launch ".into()),
            max_users: 10_000,
            plan: "max".into(),
        };
        assert_eq!(
            valid.validate().ok().map(|input| input.label),
            Some(Some("Launch".into()))
        );
        let invalid = BulkCodeBody {
            count: 0,
            label: None,
            max_users: 1,
            plan: "max".into(),
        };
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn access_code_lifecycle_input_is_strict() {
        let paused = serde_json::from_str::<AccessCodeStateInput>(r#"{"paused":true}"#)
            .ok()
            .map(|input| input.paused);
        assert_eq!(paused, Some(true));
        assert!(serde_json::from_str::<AccessCodeStateInput>(r#"{"paused":"yes"}"#).is_err());
        assert!(
            serde_json::from_str::<AccessCodeStateInput>(r#"{"paused":true,"extra":1}"#).is_err()
        );
    }

    #[test]
    fn access_code_page_accepts_paused_filter_only_for_codes() {
        let access_codes = PageQuery {
            limit: None,
            offset: None,
            search: String::new(),
            status: Some("paused".into()),
        }
        .validate(PageKind::AccessCodes);
        assert_eq!(
            access_codes.ok().and_then(|page| page.status),
            Some("paused".into())
        );

        let users = PageQuery {
            limit: None,
            offset: None,
            search: String::new(),
            status: Some("paused".into()),
        }
        .validate(PageKind::Users);
        assert!(users.is_err());
    }
}
