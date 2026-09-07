use axum::{
    http::{HeaderMap, Method, StatusCode, Uri},
    response::Response,
};
use bytes::Bytes;
use serde::de::DeserializeOwned;
use uuid::Uuid;

use crate::{
    app::AppState,
    classroom::{
        CreateBroadcastRequest, CreateDirectiveRequest, CreateRoomCodeRequest,
        CurrentSessionResponse, GuidanceReport, GuidanceStartRequest, JoinRoomRequest,
        MutationRequest, ReviewAttemptRequest,
    },
    error::{ApiError, ApiResult},
    usage::Plan,
    validation::api_uuid,
};

use super::{json_response, read_json};

pub async fn route(
    state: &AppState,
    user_id: &str,
    plan: Plan,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Option<Response>> {
    if let Some(response) =
        super::classroom_lessons::route(state, user_id, method, uri, headers, body).await?
    {
        return Ok(Some(response));
    }
    let path = uri.path();
    let parts: Vec<_> = path.trim_start_matches('/').split('/').collect();

    if parts.len() >= 6 && parts[0] == "v1" && parts[1] == "spaces" && parts[3] == "sessions" {
        let space = parse_uuid(parts[2])?;
        let session = parse_uuid(parts[4])?;
        if parts.len() == 6 && parts[5] == "teacher-context" && method == Method::GET {
            return response(
                StatusCode::OK,
                state
                    .classroom
                    .teacher_context(user_id, space, session)
                    .await?,
            );
        }
        if parts.len() == 6 && parts[5] == "broadcasts" && method == Method::POST {
            let result = state
                .classroom
                .create_broadcast(
                    user_id,
                    space,
                    session,
                    read_body::<CreateBroadcastRequest>(headers, body)?,
                )
                .await?;
            let status = if result["newlyCreated"] == true {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            };
            return response(status, result);
        }
        if parts.len() == 8
            && parts[5] == "broadcasts"
            && parts[6] == "by-client"
            && method == Method::GET
        {
            return response(
                StatusCode::OK,
                state
                    .classroom
                    .broadcast_receipt(user_id, space, session, parse_uuid(parts[7])?)
                    .await?,
            );
        }
    }
    if parts.len() >= 4
        && parts[0] == "v1"
        && parts[1] == "attempts"
        && parts[3] == "session-broadcasts"
    {
        let anchor = parse_uuid(parts[2])?;
        if parts.len() == 4 && method == Method::GET {
            let after = url::form_urlencoded::parse(uri.query().unwrap_or_default().as_bytes())
                .find(|(key, _)| key == "afterSequence")
                .map(|(_, value)| {
                    value
                        .parse::<i64>()
                        .ok()
                        .filter(|n| (0..=9_007_199_254_740_991).contains(n))
                        .ok_or_else(crate::classroom::invalid_request)
                })
                .transpose()?;
            return response(
                StatusCode::OK,
                state
                    .classroom
                    .list_broadcasts(user_id, anchor, after)
                    .await?,
            );
        }
        if parts.len() == 6 && parts[5] == "assignment" && method == Method::GET {
            return response(
                StatusCode::OK,
                state
                    .classroom
                    .broadcast_assignment(user_id, anchor, parse_uuid(parts[4])?)
                    .await?,
            );
        }
    }

    if parts.len() == 6
        && parts[0] == "v1"
        && parts[1] == "attempts"
        && parts[3] == "session-broadcasts"
    {
        let anchor = parse_uuid(parts[2])?;
        let broadcast = parse_uuid(parts[4])?;
        if method == Method::POST && parts[5] == "guidance-starts" {
            return response(
                StatusCode::OK,
                state
                    .classroom
                    .claim_guidance(
                        user_id,
                        anchor,
                        broadcast,
                        read_body::<GuidanceStartRequest>(headers, body)?,
                    )
                    .await?,
            );
        }
        if method == Method::GET && parts[5] == "guidance-start" {
            return response(
                StatusCode::OK,
                state
                    .classroom
                    .lookup_guidance(user_id, anchor, broadcast)
                    .await?,
            );
        }
    }
    if parts.len() == 4
        && parts[0] == "v1"
        && parts[1] == "work-sessions"
        && parts[3] == "classroom-guidance"
        && method == Method::PATCH
    {
        return response(
            StatusCode::OK,
            state
                .classroom
                .report_guidance(
                    user_id,
                    parse_uuid(parts[2])?,
                    read_body::<GuidanceReport>(headers, body)?,
                )
                .await?,
        );
    }
    if parts.len() == 8
        && parts[0] == "v1"
        && parts[1] == "spaces"
        && parts[3] == "sessions"
        && parts[5] == "broadcasts"
        && parts[7] == "guidance-summary"
        && method == Method::GET
    {
        return response(
            StatusCode::OK,
            state
                .classroom
                .guidance_summary(
                    user_id,
                    parse_uuid(parts[2])?,
                    parse_uuid(parts[4])?,
                    parse_uuid(parts[6])?,
                )
                .await?,
        );
    }

    if method == Method::POST && path == "/v1/live-rooms/join" {
        let mut input: JoinRoomRequest = read_body(headers, body)?;
        input.validate()?;
        return response(
            StatusCode::OK,
            state
                .classroom
                .join_room(user_id, input.client_id, &input.code)
                .await?,
        );
    }
    if method == Method::GET && path == "/v1/live-rooms/current" {
        return response(
            StatusCode::OK,
            CurrentSessionResponse {
                session: state.classroom.current_session(user_id).await?,
            },
        );
    }

    if parts.len() == 6 && parts[0] == "v1" && parts[1] == "spaces" && parts[3] == "runs" {
        let space_id = parse_uuid(parts[2])?;
        let run_id = parse_uuid(parts[4])?;
        match (method, parts[5]) {
            (&Method::POST, "room-code") => {
                let input = read_body::<CreateRoomCodeRequest>(headers, body)?;
                let limit = u32::try_from(plan.group_participants)
                    .ok()
                    .filter(|limit| *limit > 0)
                    .unwrap_or(input.max_uses);
                let room = state
                    .classroom
                    .create_room_code(user_id, limit, space_id, run_id, input)
                    .await?;
                let status = if room.newly_created {
                    StatusCode::CREATED
                } else {
                    StatusCode::OK
                };
                return response(status, room);
            }
            (&Method::DELETE, "room-code") => {
                return response(
                    StatusCode::OK,
                    state
                        .classroom
                        .revoke_room_code(user_id, space_id, run_id)
                        .await?,
                );
            }
            (&Method::POST, "directives") => {
                let directive = state
                    .classroom
                    .create_directive(
                        user_id,
                        space_id,
                        run_id,
                        read_body::<CreateDirectiveRequest>(headers, body)?,
                    )
                    .await?;
                let status = if directive.newly_created == Some(true) {
                    StatusCode::CREATED
                } else {
                    StatusCode::OK
                };
                return response(status, directive);
            }
            (&Method::POST, "open") => {
                return response(
                    StatusCode::OK,
                    state
                        .classroom
                        .set_run_state(user_id, space_id, run_id, "open")
                        .await?,
                );
            }
            (&Method::POST, "close") => {
                return response(
                    StatusCode::OK,
                    state
                        .classroom
                        .set_run_state(user_id, space_id, run_id, "closed")
                        .await?,
                );
            }
            (&Method::GET, "dashboard") => {
                return response(
                    StatusCode::OK,
                    state
                        .classroom
                        .dashboard(user_id, space_id, run_id, since_sequence(uri)?)
                        .await?,
                );
            }
            _ => {}
        }
    }

    if parts.len() >= 8
        && parts[0] == "v1"
        && parts[1] == "spaces"
        && parts[3] == "runs"
        && parts[5] == "attempts"
    {
        let space_id = parse_uuid(parts[2])?;
        let run_id = parse_uuid(parts[4])?;
        let attempt_id = parse_uuid(parts[6])?;
        if parts.len() == 8 && parts[7] == "review" && method == Method::POST {
            let reviewed = state
                .classroom
                .review_attempt(
                    user_id,
                    space_id,
                    run_id,
                    attempt_id,
                    read_body::<ReviewAttemptRequest>(headers, body)?,
                )
                .await?
                .ok_or_else(attempt_not_found)?;
            return response(StatusCode::OK, reviewed);
        }
        if parts.len() == 9 && parts[7] == "help" && parts[8] == "resolve" && method == Method::POST
        {
            let _: MutationRequest = read_body(headers, body)?;
            let resolved = state
                .classroom
                .resolve_help(user_id, space_id, run_id, attempt_id)
                .await?
                .ok_or_else(attempt_not_found)?;
            return response(StatusCode::OK, resolved);
        }
    }

    if parts.len() >= 4 && parts[0] == "v1" && parts[1] == "attempts" {
        let attempt_id = parse_uuid(parts[2])?;
        if parts.len() == 4 && parts[3] == "live-session" && method == Method::GET {
            let session = state
                .classroom
                .session_for_attempt(user_id, attempt_id)
                .await?
                .ok_or_else(class_session_not_found)?;
            return response(StatusCode::OK, session);
        }
        if parts.len() == 5
            && parts[3] == "live-session"
            && parts[4] == "leave"
            && method == Method::POST
        {
            let _: MutationRequest = read_body(headers, body)?;
            let left = state
                .classroom
                .leave_session(user_id, attempt_id)
                .await?
                .ok_or_else(class_session_not_found)?;
            return response(StatusCode::OK, left);
        }
        if parts.len() == 4 && parts[3] == "directives" && method == Method::GET {
            let directives = state
                .classroom
                .list_directives(user_id, attempt_id, since_sequence(uri)?.unwrap_or(0))
                .await?
                .ok_or_else(class_session_not_found)?;
            return response(StatusCode::OK, directives);
        }
        if parts.len() == 6
            && parts[3] == "directives"
            && parts[5] == "claim"
            && method == Method::POST
        {
            let directive_id = parse_uuid(parts[4])?;
            let input: MutationRequest = read_body(headers, body)?;
            let claim = state
                .classroom
                .claim_directive(user_id, attempt_id, directive_id, input.client_id)
                .await?
                .ok_or_else(|| {
                    ApiError::not_found("directive_not_found", "Classroom directive not found.")
                })?;
            return response(StatusCode::OK, claim);
        }
        if parts.len() == 4 && parts[3] == "ready" && method == Method::POST {
            let _: MutationRequest = read_body(headers, body)?;
            let ready = state
                .classroom
                .ready_attempt(user_id, attempt_id)
                .await?
                .ok_or_else(attempt_not_found)?;
            return response(StatusCode::OK, ready);
        }
        if parts.len() == 4 && parts[3] == "help" && method == Method::POST {
            let input: MutationRequest = read_body(headers, body)?;
            return response(
                StatusCode::OK,
                state
                    .classroom
                    .request_help(user_id, attempt_id, input.client_id)
                    .await?,
            );
        }
    }

    Ok(None)
}

fn response(value_status: StatusCode, value: impl serde::Serialize) -> ApiResult<Option<Response>> {
    Ok(Some(json_response(value_status, value)?))
}

fn read_body<T: DeserializeOwned>(headers: &HeaderMap, body: &Bytes) -> ApiResult<T> {
    serde_json::from_value(read_json(headers, body, 1_000_000)?)
        .map_err(|_| crate::classroom::invalid_request())
}

fn parse_uuid(value: &str) -> ApiResult<Uuid> {
    api_uuid(value).ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Endpoint not found."))
}

fn since_sequence(uri: &Uri) -> ApiResult<Option<u64>> {
    url::form_urlencoded::parse(uri.query().unwrap_or_default().as_bytes())
        .find(|(key, _)| key == "sinceSequence")
        .map(|(_, value)| {
            let value = value.trim();
            if value.is_empty() {
                return Ok(0);
            }
            value
                .parse::<f64>()
                .ok()
                .filter(|number| {
                    number.is_finite()
                        && *number >= 0.0
                        && number.fract() == 0.0
                        && *number <= 9_007_199_254_740_991.0
                })
                .map(|number| number as u64)
                .ok_or_else(|| {
                    ApiError::bad_request("invalid_request", "sinceSequence is invalid.")
                })
        })
        .transpose()
}

const fn attempt_not_found() -> ApiError {
    ApiError::not_found("attempt_not_found", "Attempt not found.")
}

const fn class_session_not_found() -> ApiError {
    ApiError::not_found("class_session_not_found", "Class session not found.")
}
