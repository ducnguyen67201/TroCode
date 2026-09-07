use super::{json_response, read_json};
use crate::{app::AppState, error::ApiResult, validation::api_uuid};
use axum::{
    http::{HeaderMap, Method, StatusCode, Uri},
    response::Response,
};
use bytes::Bytes;
use serde::de::DeserializeOwned;
use uuid::Uuid;
fn id(s: &str) -> ApiResult<Uuid> {
    api_uuid(s).ok_or_else(crate::classroom::invalid_request)
}
fn body<T: DeserializeOwned>(headers: &HeaderMap, bytes: &Bytes) -> ApiResult<T> {
    serde_json::from_value(read_json(headers, bytes, 100_000)?)
        .map_err(|_| crate::classroom::invalid_request())
}
fn query(uri: &Uri, key: &str) -> Option<String> {
    url::form_urlencoded::parse(uri.query().unwrap_or_default().as_bytes())
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.into_owned())
}
fn number(uri: &Uri, key: &str) -> ApiResult<Option<i64>> {
    query(uri, key)
        .map(|s| {
            s.parse::<i64>()
                .ok()
                .filter(|v| (0..=9_007_199_254_740_991).contains(v))
                .ok_or_else(crate::classroom::invalid_request)
        })
        .transpose()
}
pub async fn route(
    state: &AppState,
    user: &str,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    bytes: &Bytes,
) -> ApiResult<Option<Response>> {
    let parts: Vec<_> = uri.path().trim_start_matches('/').split('/').collect();
    let c = &state.classroom;
    let value = match (method, parts.as_slice()) {
        (&Method::GET, ["v1", "spaces", space, "sessions", session, "lesson-context"]) => {
            let mut context = c
                .lesson_context(
                    user,
                    id(space)?,
                    id(session)?,
                    id(&query(uri, "runId").ok_or_else(crate::classroom::invalid_request)?)?,
                )
                .await?;
            if number(uri, "maxPlanVersion")?.is_some() {
                context["maxPlanVersion"] = serde_json::json!(2);
            }
            context
        }
        (&Method::POST, ["v1", "spaces", space, "sessions", session, "lessons"]) => {
            c.commit_lesson(user, id(space)?, id(session)?, body(headers, bytes)?)
                .await?
        }
        (
            &Method::GET,
            [
                "v1",
                "spaces",
                space,
                "sessions",
                session,
                "lessons",
                "by-client",
                client,
            ],
        ) => {
            c.lookup_lesson(user, id(space)?, id(session)?, id(client)?)
                .await?
        }
        (
            &Method::POST,
            [
                "v1",
                "spaces",
                space,
                "sessions",
                session,
                "lessons",
                lesson,
                "stop",
            ],
        ) => {
            c.stop_lesson(user, id(space)?, id(session)?, id(lesson)?)
                .await?
        }
        (
            &Method::GET,
            [
                "v1",
                "spaces",
                space,
                "sessions",
                session,
                "lessons",
                lesson,
                "progress",
            ],
        ) => {
            c.lesson_progress(
                user,
                id(space)?,
                id(session)?,
                id(lesson)?,
                query(uri, "cursor"),
            )
            .await?
        }
        (&Method::GET, ["v1", "attempts", anchor, "session-lessons"]) => {
            let mut feed = c
                .lesson_feed(user, id(anchor)?, number(uri, "afterSequence")?)
                .await?;
            // Keep the original cursor so an older client advances past unsupported plans.
            let requested = number(uri, "maxPlanVersion")?;
            let supported = requested.unwrap_or(1).clamp(1, 2);
            if let Some(items) = feed["items"].as_array_mut() {
                items.retain(|item| {
                    item["plan"]["schemaVersion"].as_i64().unwrap_or(1) <= supported
                });
            }
            if requested.is_some() {
                feed["maxPlanVersion"] = serde_json::json!(2);
            }
            feed
        }
        (&Method::POST, ["v1", "attempts", anchor, "lesson-device"]) => {
            c.lesson_device(user, id(anchor)?, body(headers, bytes)?)
                .await?
        }
        (
            &Method::POST,
            [
                "v1",
                "attempts",
                anchor,
                "session-lessons",
                lesson,
                "receipt",
            ],
        ) => {
            c.lesson_receipt(user, id(anchor)?, id(lesson)?, body(headers, bytes)?)
                .await?
        }
        (
            &Method::POST,
            [
                "v1",
                "attempts",
                anchor,
                "session-lessons",
                lesson,
                "starts",
            ],
        ) => {
            c.start_lesson(user, id(anchor)?, id(lesson)?, body(headers, bytes)?)
                .await?
        }
        (&Method::GET, ["v1", "attempts", anchor, "session-lessons", lesson, "start"]) => {
            c.lookup_lesson_start(user, id(anchor)?, id(lesson)?)
                .await?
        }
        (
            &Method::GET,
            [
                "v1",
                "attempts",
                anchor,
                "session-lessons",
                lesson,
                "resources",
                resource,
            ],
        ) => {
            c.lesson_material(
                user,
                id(anchor)?,
                id(lesson)?,
                id(resource)?,
                i32::try_from(number(uri, "ordinal")?.unwrap_or(0))
                    .map_err(|_| crate::classroom::invalid_request())?,
            )
            .await?
        }
        (
            &Method::POST,
            [
                "v1",
                "lesson-executions",
                execution,
                "steps",
                step,
                "starts",
            ],
        ) => {
            c.start_lesson_step(user, id(execution)?, id(step)?, body(headers, bytes)?)
                .await?
        }
        (&Method::GET, ["v1", "lesson-executions", execution, "steps", step, "start"]) => {
            c.lookup_lesson_step(
                user,
                id(execution)?,
                id(step)?,
                number(uri, "attemptNumber")?.ok_or_else(crate::classroom::invalid_request)?,
            )
            .await?
        }
        (&Method::POST, ["v1", "lesson-executions", execution, "progress"]) => {
            c.report_lesson(user, id(execution)?, body(headers, bytes)?)
                .await?
        }
        (&Method::GET, ["v1", "lesson-executions", execution, "status"]) => {
            c.lesson_status(user, id(execution)?).await?
        }
        _ => return Ok(None),
    };
    Ok(Some(json_response(StatusCode::OK, value)?))
}
