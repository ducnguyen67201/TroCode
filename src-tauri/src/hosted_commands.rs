#[tauri::command]
async fn get_usage_budget(
    window: tauri::Window,
    state: State<'_, DesktopState>,
    request: Option<Value>,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let path = request
        .and_then(|value| value.get("taskId").and_then(Value::as_str).map(|id| format!("/v1/usage/budget?taskId={id}")))
        .unwrap_or_else(|| String::from("/v1/usage/budget"));
    hosted_json(&state, Method::GET, &path, None, true).await
}

#[tauri::command]
async fn get_knowledge_capabilities(window: tauri::Window, state: State<'_, DesktopState>) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    hosted_json(&state, Method::GET, "/v1/capabilities", None, false).await
}

#[tauri::command]
async fn list_knowledge_spaces(window: tauri::Window, state: State<'_, DesktopState>) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    hosted_json(&state, Method::GET, "/v1/spaces", None, true).await
}

#[tauri::command]
async fn create_knowledge_space(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    hosted_json(&state, Method::POST, "/v1/spaces", Some(request), true).await
}

#[tauri::command]
async fn get_knowledge_space(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let id = required_string(&request, "spaceId")?;
    hosted_json(&state, Method::GET, &format!("/v1/spaces/{id}"), None, true).await
}

#[tauri::command]
async fn list_knowledge_sources(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let id = required_string(&request, "spaceId")?;
    hosted_json(&state, Method::GET, &format!("/v1/spaces/{id}/sources"), None, true).await
}

#[tauri::command]
async fn save_knowledge_activity(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let (space_id, body) = route_body(&request, "spaceId")?;
    hosted_json(&state, Method::POST, &format!("/v1/spaces/{space_id}/activities"), Some(body), true).await
}

#[tauri::command]
async fn publish_knowledge_activity(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let space_id = required_string(&request, "spaceId")?;
    let activity_id = required_string(&request, "activityId")?;
    let client_id = request.get("clientId").cloned().ok_or_else(invalid_hosted_request)?;
    hosted_json(
        &state,
        Method::POST,
        &format!("/v1/spaces/{space_id}/activities/{activity_id}/publish"),
        Some(json!({ "clientId": client_id })),
        true,
    ).await
}

#[tauri::command]
async fn create_knowledge_run(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let (space_id, body) = route_body(&request, "spaceId")?;
    hosted_json(&state, Method::POST, &format!("/v1/spaces/{space_id}/runs"), Some(body), true).await
}

#[tauri::command]
async fn set_knowledge_run_state(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let space_id = required_string(&request, "spaceId")?;
    let run_id = required_string(&request, "runId")?;
    let action = match request.get("state").and_then(Value::as_str) {
        Some("open") => "open",
        Some("closed") => "close",
        _ => return Err(invalid_hosted_request()),
    };
    hosted_json(&state, Method::POST, &format!("/v1/spaces/{space_id}/runs/{run_id}/{action}"), Some(json!({})), true).await
}

#[tauri::command]
async fn list_assigned_activities(window: tauri::Window, state: State<'_, DesktopState>) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    hosted_json(&state, Method::GET, "/v1/assignments/me", None, true).await
}

#[tauri::command]
async fn get_hosted_attempt(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let attempt_id = required_string(&request, "attemptId")?;
    hosted_json(&state, Method::GET, &format!("/v1/attempts/{attempt_id}"), None, true).await
}

#[tauri::command]
async fn acknowledge_hosted_attempt(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let (attempt_id, body) = route_body(&request, "attemptId")?;
    hosted_json(&state, Method::POST, &format!("/v1/attempts/{attempt_id}/acknowledge"), Some(body), true).await
}

#[tauri::command]
async fn get_knowledge_dashboard(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let space_id = required_string(&request, "spaceId")?;
    let run_id = required_string(&request, "runId")?;
    let suffix = request.get("sinceSequence").and_then(Value::as_i64)
        .map(|sequence| format!("?sinceSequence={sequence}"))
        .unwrap_or_default();
    hosted_json(&state, Method::GET, &format!("/v1/spaces/{space_id}/runs/{run_id}/dashboard{suffix}"), None, true).await
}

#[tauri::command]
async fn list_knowledge_groups(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let space_id = required_string(&request, "spaceId")?;
    hosted_json(&state, Method::GET, &format!("/v1/spaces/{space_id}/groups"), None, true).await
}

#[tauri::command]
async fn create_knowledge_group(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let (space_id, body) = route_body(&request, "spaceId")?;
    hosted_json(&state, Method::POST, &format!("/v1/spaces/{space_id}/groups"), Some(body), true).await
}

#[tauri::command]
async fn create_knowledge_invite(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let (space_id, body) = route_body(&request, "spaceId")?;
    hosted_json(&state, Method::POST, &format!("/v1/spaces/{space_id}/invites"), Some(body), true).await
}

#[tauri::command]
async fn redeem_knowledge_invite(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    hosted_json(&state, Method::POST, "/v1/space-invites/redeem", Some(request), true).await
}

#[tauri::command]
async fn request_knowledge_attempt_help(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let (attempt_id, body) = route_body(&request, "attemptId")?;
    hosted_json(&state, Method::POST, &format!("/v1/attempts/{attempt_id}/help"), Some(body), true).await
}

#[tauri::command]
async fn prepare_activity_starter(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    prepare_starter_impl(&window, &state, &request).await
}

#[tauri::command]
async fn select_knowledge_files(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    select_files_impl(&window, &state, &request).await
}

#[tauri::command]
async fn upload_knowledge_selection(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let space_id = required_string(&request, "spaceId")?.to_owned();
    let selection_id = value_uuid(&request, "selectionId")?;
    upload_selection_impl(&state, selection_id, &format!("/v1/spaces/{space_id}/uploads/initiate"), None).await
}

#[tauri::command]
async fn submit_knowledge_selection(window: tauri::Window, state: State<'_, DesktopState>, request: Value) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let attempt_id = required_string(&request, "attemptId")?.to_owned();
    let selection_id = value_uuid(&request, "selectionId")?;
    upload_selection_impl(
        &state,
        selection_id,
        &format!("/v1/attempts/{attempt_id}/submissions/initiate"),
        Some(attempt_id),
    ).await
}

async fn hosted_json(
    state: &DesktopState,
    method: Method,
    path: &str,
    body: Option<Value>,
    authenticated: bool,
) -> CommandResult<Value> {
    let hosted = &state.inner.hosted;
    let parsed = url::Url::parse(&hosted.base_url).map_err(|_| command_error(
        "hosted_not_configured",
        "Set TROCODE_API_BASE_URL to the hosted Tro service.",
    ))?;
    if parsed.scheme() != "https" && !matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "::1")) {
        return Err(command_error("hosted_not_configured", "The hosted Tro service must use HTTPS."));
    }
    let mut request = hosted.http.request(method, format!("{}{path}", hosted.base_url));
    if authenticated {
        refresh_hosted_session_if_needed(state).await?;
        let token = hosted.token.read().await.clone().ok_or_else(|| command_error(
            "authentication_required",
            "Sign in with Google before using Tro.",
        ))?;
        request = request.bearer_auth(token);
    }
    if let Some(body) = body { request = request.json(&body); }
    let response = request.send().await.map_err(|_| command_error(
        "hosted_unavailable",
        "The hosted Tro service is temporarily unavailable.",
    ))?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|_| command_error(
        "hosted_unavailable",
        "The hosted Tro response could not be read.",
    ))?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| command_error(
        "hosted_invalid_response",
        "The hosted Tro response was invalid.",
    ))?;
    if !status.is_success() {
        let code = value.get("code").and_then(Value::as_str).unwrap_or("hosted_request_failed");
        let message = value.get("error").and_then(Value::as_str)
            .or_else(|| value.get("message").and_then(Value::as_str))
            .unwrap_or("The hosted Tro request failed.");
        return Err(command_error(code, message));
    }
    Ok(value)
}

async fn refresh_hosted_session_if_needed(state: &DesktopState) -> CommandResult<()> {
    let refresh_needed = state.inner.hosted.expires_at.read().await
        .is_some_and(|expiry| expiry <= time::OffsetDateTime::now_utc() + time::Duration::days(1));
    if !refresh_needed { return Ok(()); }
    let _guard = state.inner.hosted.refresh_lock.lock().await;
    let refresh_needed = state.inner.hosted.expires_at.read().await
        .is_some_and(|expiry| expiry <= time::OffsetDateTime::now_utc() + time::Duration::days(1));
    if !refresh_needed { return Ok(()); }
    let token = state.inner.hosted.token.read().await.clone()
        .ok_or_else(|| command_error("authentication_required", "Sign in with Google before using Tro."))?;
    let response = state.inner.hosted.http
        .post(format!("{}/v1/auth/session/refresh", state.inner.hosted.base_url))
        .bearer_auth(token).send().await
        .map_err(|_| command_error("hosted_unavailable", "Tro could not refresh the device session."))?;
    if !response.status().is_success() {
        *state.inner.hosted.token.write().await = None;
        *state.inner.hosted.expires_at.write().await = None;
        clear_persisted_hosted_session(state).await;
        *state.inner.auth.write().await = json!({
            "state": "signed_out",
            "configured": std::env::var("GOOGLE_OAUTH_CLIENT_ID").is_ok(),
            "user": null,
            "summary": "Your session expired. Sign in again.",
        });
        return Err(command_error("session_expired", "Your session expired. Sign in again."));
    }
    let value: Value = response.json().await
        .map_err(|_| command_error("hosted_invalid_response", "Tro returned an invalid session refresh."))?;
    let token = value.get("accessToken").and_then(Value::as_str)
        .ok_or_else(|| command_error("hosted_invalid_response", "Tro returned an invalid session refresh."))?;
    let expiry = value.get("expiresAt").and_then(Value::as_str)
        .and_then(|value| time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339).ok())
        .ok_or_else(|| command_error("hosted_invalid_response", "Tro returned an invalid session refresh."))?;
    *state.inner.hosted.token.write().await = Some(token.to_owned());
    *state.inner.hosted.expires_at.write().await = Some(expiry);
    persist_hosted_session(state).await;
    Ok(())
}

fn route_body(request: &Value, route_key: &str) -> CommandResult<(String, Value)> {
    let mut object = request.as_object().cloned().ok_or_else(invalid_hosted_request)?;
    let route_value = object.remove(route_key).and_then(|value| value.as_str().map(str::to_owned))
        .ok_or_else(invalid_hosted_request)?;
    Ok((route_value, Value::Object(object)))
}

fn required_string<'a>(request: &'a Value, key: &str) -> CommandResult<&'a str> {
    request.get(key).and_then(Value::as_str).filter(|value| !value.is_empty())
        .ok_or_else(invalid_hosted_request)
}

fn invalid_hosted_request() -> CommandError {
    command_error("invalid_request", "Knowledge request is invalid.")
}
