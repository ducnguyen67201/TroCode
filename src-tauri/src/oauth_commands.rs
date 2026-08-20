#[tauri::command]
#[allow(clippy::too_many_lines)]
async fn sign_in_with_google(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let client_id = std::env::var("GOOGLE_OAUTH_CLIENT_ID")
        .ok().map(|value| value.trim().to_owned()).filter(|value| !value.is_empty())
        .ok_or_else(|| command_error("auth_not_configured", "Set GOOGLE_OAUTH_CLIENT_ID to enable Google sign-in."))?;
    if state.inner.hosted.base_url.is_empty() {
        return Err(command_error("hosted_not_configured", "Set TROCODE_API_BASE_URL to enable sign-in."));
    }
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await
        .map_err(|_| command_error("auth_callback_failed", "Could not start the Google sign-in callback."))?;
    let port = listener.local_addr().map_err(|_| command_error(
        "auth_callback_failed",
        "Could not determine the Google sign-in callback address.",
    ))?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/oauth2/callback");
    let state_value = random_urlsafe(32);
    let nonce = random_urlsafe(32);
    let verifier = random_urlsafe(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut authorization = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth")
        .map_err(|_| command_error("auth_failed", "Google sign-in could not be prepared."))?;
    authorization.query_pairs_mut()
        .append_pair("access_type", "online")
        .append_pair("client_id", &client_id)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("nonce", &nonce)
        .append_pair("prompt", "select_account")
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("state", &state_value);
    app.opener().open_url(authorization.as_str(), None::<&str>)
        .map_err(|_| command_error("auth_browser_failed", "Could not open Google sign-in."))?;
    let (mut socket, _) = tokio::time::timeout(
        std::time::Duration::from_mins(2),
        listener.accept(),
    ).await.map_err(|_| command_error("auth_timeout", "Google sign-in timed out. Please try again."))?
        .map_err(|_| command_error("auth_callback_failed", "Google sign-in callback failed."))?;
    let mut buffer = vec![0_u8; 16_384];
    let count = tokio::time::timeout(std::time::Duration::from_secs(5), socket.read(&mut buffer))
        .await.map_err(|_| command_error("auth_callback_failed", "Google sign-in callback timed out."))?
        .map_err(|_| command_error("auth_callback_failed", "Google sign-in callback failed."))?;
    let request = std::str::from_utf8(&buffer[..count])
        .map_err(|_| command_error("auth_callback_failed", "Google sign-in response was invalid."))?;
    let target = request.lines().next().and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| command_error("auth_callback_failed", "Google sign-in response was invalid."))?;
    let callback = url::Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| command_error("auth_callback_failed", "Google sign-in response was invalid."))?;
    let query = callback.query_pairs().collect::<std::collections::HashMap<_, _>>();
    let callback_state = query.get("state").map(std::borrow::Cow::as_ref);
    let code = query.get("code").map(std::borrow::Cow::as_ref);
    let valid = callback.path() == "/oauth2/callback" && callback_state == Some(state_value.as_str()) && code.is_some();
    let page = if valid {
        "<!doctype html><meta charset=utf-8><title>Signed in to Tro</title><p>Signed in. You can close this tab and return to Tro.</p>"
    } else {
        "<!doctype html><meta charset=utf-8><title>Tro sign-in failed</title><p>Sign-in failed. Return to Tro and try again.</p>"
    };
    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Security-Policy: default-src 'none'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        if valid { "200 OK" } else { "400 Bad Request" }, page.len(), page,
    );
    let _ = socket.write_all(response.as_bytes()).await;
    if !valid {
        return Err(command_error("auth_response_invalid", "Google sign-in response could not be verified."));
    }
    let code = code.ok_or_else(|| command_error("auth_response_invalid", "Google sign-in response could not be verified."))?;
    let mut token_form = vec![
        ("client_id", client_id),
        ("code", code.to_owned()),
        ("code_verifier", verifier),
        ("grant_type", String::from("authorization_code")),
        ("redirect_uri", redirect_uri),
    ];
    if let Ok(secret) = std::env::var("GOOGLE_OAUTH_CLIENT_SECRET")
        && !secret.trim().is_empty()
    {
        token_form.push(("client_secret", secret));
    }
    let tokens = state.inner.hosted.http
        .post("https://oauth2.googleapis.com/token")
        .form(&token_form)
        .send().await
        .map_err(|_| command_error("auth_google_unavailable", "Google could not complete sign-in."))?;
    if !tokens.status().is_success() {
        return Err(command_error("auth_google_rejected", "Google could not complete sign-in. Please try again."));
    }
    let tokens: Value = tokens.json().await
        .map_err(|_| command_error("auth_google_invalid", "Google returned an invalid sign-in response."))?;
    let id_token = tokens.get("id_token").and_then(Value::as_str)
        .ok_or_else(|| command_error("auth_google_invalid", "Google returned an invalid sign-in response."))?;
    let exchange = state.inner.hosted.http
        .post(format!("{}/v1/auth/google/exchange", state.inner.hosted.base_url))
        .json(&json!({ "idToken": id_token, "nonce": nonce }))
        .send().await
        .map_err(|_| command_error("auth_hosted_unavailable", "Tro sign-in is temporarily unavailable."))?;
    if !exchange.status().is_success() {
        return Err(command_error("auth_hosted_rejected", "Tro could not verify this Google account."));
    }
    let session: Value = exchange.json().await
        .map_err(|_| command_error("auth_hosted_invalid", "Tro returned an invalid sign-in response."))?;
    let token = session.get("accessToken").and_then(Value::as_str)
        .ok_or_else(|| command_error("auth_hosted_invalid", "Tro returned an invalid sign-in response."))?;
    let expires_at = session.get("expiresAt").and_then(Value::as_str)
        .and_then(|value| time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339).ok())
        .ok_or_else(|| command_error("auth_hosted_invalid", "Tro returned an invalid session expiry."))?;
    let user = session.get("user").cloned()
        .ok_or_else(|| command_error("auth_hosted_invalid", "Tro returned an invalid sign-in response."))?;
    *state.inner.hosted.token.write().await = Some(token.to_owned());
    *state.inner.hosted.expires_at.write().await = Some(expires_at);
    let email = user.get("email").and_then(Value::as_str).unwrap_or("your Google account");
    let status = json!({
        "state": "signed_in",
        "configured": true,
        "user": user,
        "summary": format!("Signed in as {email}."),
    });
    *state.inner.auth.write().await = status.clone();
    *state.inner.membership.write().await = json!({
        "state": "inactive",
        "required": true,
        "referenceCode": null,
        "expiresAt": null,
        "plan": null,
        "summary": "Enter an access code to activate hosted access.",
    });
    persist_hosted_session(state.inner()).await;
    Ok(status)
}

#[tauri::command]
async fn sign_out_google(window: tauri::Window, state: State<'_, DesktopState>) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    if let Some(token) = state.inner.hosted.token.read().await.clone() {
        let _ = state.inner.hosted.http
            .delete(format!("{}/v1/auth/session", state.inner.hosted.base_url))
            .bearer_auth(token)
            .send().await;
    }
    *state.inner.hosted.token.write().await = None;
    *state.inner.hosted.expires_at.write().await = None;
    clear_persisted_hosted_session(state.inner()).await;
    let configured = std::env::var("GOOGLE_OAUTH_CLIENT_ID").is_ok();
    let status = json!({
        "state": "signed_out",
        "configured": configured,
        "user": null,
        "summary": "Signed out. Sign in with Google to continue.",
    });
    *state.inner.auth.write().await = status.clone();
    *state.inner.membership.write().await = json!({
        "state": "inactive",
        "required": true,
        "referenceCode": null,
        "expiresAt": null,
        "plan": null,
        "summary": "Sign in to activate hosted access.",
    });
    Ok(status)
}

fn random_urlsafe(size: usize) -> String {
    let mut bytes = vec![0_u8; size];
    rand::rng().fill(bytes.as_mut_slice());
    URL_SAFE_NO_PAD.encode(bytes)
}
