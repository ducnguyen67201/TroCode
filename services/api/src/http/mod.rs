mod admin;
mod classroom;
mod classroom_lessons;
mod classroom_test_fixture;
mod connectors;
mod core;
mod knowledge;
mod middleware;
mod organization;

use axum::{
    Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Extension, State},
    http::{HeaderMap, Method, Uri},
    response::Response,
};
use tower_http::catch_panic::CatchPanicLayer;

use crate::{app::AppState, error::ApiResult};

pub fn router(state: AppState) -> Router {
    Router::new()
        .fallback(dispatch)
        .layer(DefaultBodyLimit::max(48_000_000))
        .layer(CatchPanicLayer::new())
        .layer(axum::middleware::from_fn(middleware::security_and_logs))
        .with_state(state)
}

async fn dispatch(
    State(state): State<AppState>,
    Extension(request_id): Extension<uuid::Uuid>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    let path = uri.path();
    if let Some(response) =
        classroom_test_fixture::handle(state.config.classroom_test_fixture_enabled, &method, &uri)?
    {
        return Ok(response);
    }
    if let Some(response) = connectors::handle_public(&state, &method, &uri).await? {
        return Ok(response);
    }
    if let Some(response) = admin::handle(&state, &method, &uri, &headers, &body).await? {
        return Ok(response);
    }
    if headers.contains_key("origin") {
        return Err(crate::error::ApiError::new(
            http::StatusCode::FORBIDDEN,
            "Browser-origin requests are not allowed.",
        ));
    }
    if let Some(response) =
        connectors::handle_authenticated(&state, &method, &uri, &headers, &body).await?
    {
        return Ok(response);
    }
    if let Some(response) = organization::handle(&state, &method, &uri, &headers, &body).await? {
        return Ok(response);
    }
    if let Some(response) = knowledge::handle(&state, &method, &uri, &headers, &body).await? {
        return Ok(response);
    }
    core::handle(&state, request_id, &method, &uri, &headers, &body, path).await
}

pub(crate) fn json_response(
    status: http::StatusCode,
    value: impl serde::Serialize,
) -> ApiResult<Response> {
    let body = serde_json::to_vec(&value).map_err(crate::error::ApiError::internal)?;
    Response::builder()
        .status(status)
        .header("content-type", "application/json; charset=utf-8")
        .body(axum::body::Body::from(body))
        .map_err(crate::error::ApiError::internal)
}
pub(crate) fn bytes_response(
    status: http::StatusCode,
    content_type: &str,
    body: impl Into<axum::body::Body>,
) -> ApiResult<Response> {
    Response::builder()
        .status(status)
        .header("content-type", content_type)
        .body(body.into())
        .map_err(crate::error::ApiError::internal)
}
pub(crate) fn read_json(
    headers: &HeaderMap,
    body: &Bytes,
    max: usize,
) -> ApiResult<serde_json::Value> {
    if body.len() > max {
        return Err(crate::error::ApiError::new(
            http::StatusCode::PAYLOAD_TOO_LARGE,
            "Request body is too large.",
        ));
    }
    if !headers
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase()
        .starts_with("application/json")
    {
        return Err(crate::error::ApiError::new(
            http::StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Content-Type must be application/json.",
        ));
    }
    serde_json::from_slice(body).map_err(|_| {
        crate::error::ApiError::new(
            http::StatusCode::BAD_REQUEST,
            "Request body must be valid JSON.",
        )
    })
}
pub(crate) fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("authorization")?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .filter(|value| !value.chars().any(char::is_whitespace))
}
pub(crate) fn request_ip(headers: &HeaderMap) -> &str {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next_back())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown")
}
