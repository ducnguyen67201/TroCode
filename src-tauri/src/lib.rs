use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::Rng;
use reqwest::{Client, Method};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::{
    Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Mutex, RwLock, oneshot};
use tokio_util::sync::CancellationToken;
use tro_contracts::CommandError;
use tro_cua::{CuaHost, DirectCuaHost, PermissionState};
use uuid::Uuid;

type CommandResult<T> = Result<T, CommandError>;

#[derive(Debug, Clone)]
struct DesktopState {
    inner: Arc<DesktopStateInner>,
}

#[derive(Debug)]
struct DesktopStateInner {
    preferences: RwLock<Value>,
    auth: RwLock<Value>,
    membership: RwLock<Value>,
    tasks: RwLock<HashMap<Uuid, Value>>,
    task_attempts: RwLock<HashMap<Uuid, Uuid>>,
    task_cancellations: RwLock<HashMap<Uuid, CancellationToken>>,
    task_sequences: RwLock<HashMap<Uuid, u64>>,
    task_workspaces: RwLock<HashMap<Uuid, Uuid>>,
    pending_approvals: Mutex<HashMap<Uuid, PendingApproval>>,
    pending_inputs: Mutex<HashMap<Uuid, PendingInput>>,
    observations: RwLock<HashMap<Uuid, tro_cua::Observation>>,
    update_status: RwLock<Value>,
    pending_update: Mutex<Option<PendingUpdate>>,
    secret_vault: Mutex<Option<SecretVault>>,
    audio_ducking: Mutex<AudioDuckingState>,
    companion_state: RwLock<String>,
    cua: RwLock<Option<Arc<DirectCuaHost>>>,
    hosted: HostedClient,
    knowledge_selections: RwLock<HashMap<Uuid, KnowledgeSelection>>,
    workspaces: tro_desktop_core::WorkspaceRegistry,
}

#[derive(Debug)]
struct PendingApproval {
    action_digest: String,
    task_id: Uuid,
    sender: oneshot::Sender<tro_agent::ApprovalDecision>,
}

#[derive(Debug)]
struct PendingInput {
    task_id: Uuid,
    sender: oneshot::Sender<String>,
}

#[derive(Debug)]
struct PendingUpdate {
    bytes: Vec<u8>,
    target_version: String,
}

struct SecretVault {
    stronghold: tauri_plugin_stronghold::stronghold::Stronghold,
}

impl std::fmt::Debug for SecretVault {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SecretVault")
            .finish_non_exhaustive()
    }
}

impl SecretVault {
    const CLIENT: &'static [u8] = b"trocode-device-v1";

    fn open(app: &tauri::AppHandle) -> Result<Self, String> {
        let config = app
            .path()
            .app_config_dir()
            .map_err(|_| String::from("config_path"))?;
        std::fs::create_dir_all(&config).map_err(|_| String::from("config_directory"))?;
        let path = config.join("device-secrets.stronghold");
        let entry = keyring::Entry::new("com.ducng.trocode", "stronghold-master-v1")
            .map_err(|_| String::from("keyring_unavailable"))?;
        let create_secret = || -> Result<Vec<u8>, String> {
            let mut secret = vec![0_u8; 32];
            rand::rng().fill(secret.as_mut_slice());
            entry
                .set_secret(&secret)
                .map_err(|_| String::from("keyring_write"))?;
            Ok(secret)
        };
        let password = match entry.get_secret() {
            Ok(secret) if secret.len() >= 32 => secret,
            Ok(_) if path.exists() => return Err(String::from("keyring_invalid")),
            Ok(_) | Err(keyring::Error::NoEntry) if !path.exists() => create_secret()?,
            Ok(_) => return Err(String::from("keyring_invalid")),
            Err(_) => return Err(String::from("keyring_read")),
        };
        let stronghold = tauri_plugin_stronghold::stronghold::Stronghold::new(path, password)
            .map_err(|_| String::from("stronghold_open"))?;
        if stronghold.get_client(Self::CLIENT).is_err() {
            stronghold
                .create_client(Self::CLIENT)
                .map_err(|_| String::from("stronghold_client"))?;
            stronghold
                .save()
                .map_err(|_| String::from("stronghold_save"))?;
        }
        Ok(Self { stronghold })
    }

    fn load_json(&self, key: &str) -> Option<Value> {
        let client = self.stronghold.get_client(Self::CLIENT).ok()?;
        let bytes = client.store().get(key.as_bytes()).ok()??;
        serde_json::from_slice(&bytes).ok()
    }

    fn save_json(&self, key: &str, value: &Value) -> Result<(), String> {
        let client = self
            .stronghold
            .get_client(Self::CLIENT)
            .map_err(|_| String::from("stronghold_client"))?;
        let encoded = serde_json::to_vec(value).map_err(|_| String::from("secret_encode"))?;
        client
            .store()
            .insert(key.as_bytes().to_vec(), encoded, None)
            .map_err(|_| String::from("secret_write"))?;
        self.stronghold
            .save()
            .map_err(|_| String::from("stronghold_save"))
    }

    fn remove(&self, key: &str) -> Result<(), String> {
        let client = self
            .stronghold
            .get_client(Self::CLIENT)
            .map_err(|_| String::from("stronghold_client"))?;
        let _ = client.store().delete(key.as_bytes());
        self.stronghold
            .save()
            .map_err(|_| String::from("stronghold_save"))
    }
}

#[derive(Debug, Default)]
struct AudioDuckingState {
    active: bool,
    previous_muted: Option<bool>,
}

#[derive(Debug, Clone)]
struct SelectedKnowledgeFile {
    absolute_path: PathBuf,
    byte_size: u64,
    client_id: Uuid,
    display_name: String,
    media_type: String,
    modified: std::time::SystemTime,
    relative_path: String,
}

#[derive(Debug, Clone)]
struct KnowledgeSelection {
    files: Vec<SelectedKnowledgeFile>,
    role: String,
}

#[derive(Debug)]
struct HostedClient {
    base_url: String,
    http: Client,
    token: RwLock<Option<String>>,
    expires_at: RwLock<Option<time::OffsetDateTime>>,
    refresh_lock: Mutex<()>,
}

impl HostedClient {
    fn from_environment() -> Self {
        let base_url = std::env::var("TROCODE_API_BASE_URL")
            .unwrap_or_default()
            .trim()
            .trim_end_matches('/')
            .to_owned();
        let token = std::env::var("TROCODE_DEVICE_SESSION_TOKEN")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let http = Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_mins(3))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            base_url,
            http,
            token: RwLock::new(token),
            expires_at: RwLock::new(None),
            refresh_lock: Mutex::new(()),
        }
    }
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            inner: Arc::new(DesktopStateInner {
                preferences: RwLock::new(json!({
                    "appLanguage": "en",
                    "autonomyMode": "balanced",
                    "muteSystemAudioWhileSpeaking": false,
                    "primaryLanguage": null
                })),
                auth: RwLock::new(json!({
                    "state": "signed_out",
                    "configured": std::env::var("GOOGLE_OAUTH_CLIENT_ID").is_ok(),
                    "user": null,
                    "summary": "Sign in with Google to continue."
                })),
                membership: RwLock::new(json!({
                    "state": "bypassed",
                    "required": false,
                    "referenceCode": null,
                    "expiresAt": null,
                    "plan": "free",
                    "summary": "Hosted access is managed by your Tro account."
                })),
                tasks: RwLock::new(HashMap::new()),
                task_attempts: RwLock::new(HashMap::new()),
                task_cancellations: RwLock::new(HashMap::new()),
                task_sequences: RwLock::new(HashMap::new()),
                task_workspaces: RwLock::new(HashMap::new()),
                pending_approvals: Mutex::new(HashMap::new()),
                pending_inputs: Mutex::new(HashMap::new()),
                observations: RwLock::new(HashMap::new()),
                update_status: RwLock::new(update_status(
                    if cfg!(debug_assertions) {
                        "unsupported"
                    } else {
                        "idle"
                    },
                    if cfg!(debug_assertions) {
                        "Application updates are available in installed builds."
                    } else {
                        "Check whether a newer version of Tro is available."
                    },
                )),
                pending_update: Mutex::new(None),
                secret_vault: Mutex::new(None),
                audio_ducking: Mutex::new(AudioDuckingState::default()),
                companion_state: RwLock::new(String::from("idle")),
                cua: RwLock::new(None),
                hosted: HostedClient::from_environment(),
                knowledge_selections: RwLock::new(HashMap::new()),
                workspaces: tro_desktop_core::WorkspaceRegistry::default(),
            }),
        }
    }
}

fn command_error(code: &str, message: &str) -> CommandError {
    CommandError {
        code: code.to_owned(),
        message: message.to_owned(),
    }
}

async fn persist_hosted_session(state: &DesktopState) {
    let token = state.inner.hosted.token.read().await.clone();
    let expiry = *state.inner.hosted.expires_at.read().await;
    let auth = state.inner.auth.read().await.clone();
    let Some((token, expiry)) = token.zip(expiry) else {
        return;
    };
    let record = json!({
        "accessToken": token,
        "expiresAt": format_time(expiry),
        "auth": auth,
    });
    let vault = state.inner.secret_vault.lock().await;
    if let Some(vault) = vault.as_ref()
        && let Err(code) = vault.save_json("hosted-session-v1", &record)
    {
        tracing::warn!(code, "device session could not be persisted");
    }
}

async fn clear_persisted_hosted_session(state: &DesktopState) {
    let vault = state.inner.secret_vault.lock().await;
    if let Some(vault) = vault.as_ref()
        && let Err(code) = vault.remove("hosted-session-v1")
    {
        tracing::warn!(code, "persisted device session could not be removed");
    }
}

async fn restore_hosted_session(state: &DesktopState, record: Value) {
    let token = record
        .get("accessToken")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let expiry = record
        .get("expiresAt")
        .and_then(Value::as_str)
        .and_then(|value| {
            time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339).ok()
        });
    let auth = record
        .get("auth")
        .filter(|value| {
            value.get("state").and_then(Value::as_str) == Some("signed_in")
                && value.get("user").is_some_and(Value::is_object)
        })
        .cloned();
    if let (Some(token), Some(expiry), Some(auth)) = (token, expiry, auth) {
        *state.inner.hosted.token.write().await = Some(token);
        *state.inner.hosted.expires_at.write().await = Some(expiry);
        *state.inner.auth.write().await = auth;
        *state.inner.membership.write().await = json!({
            "state": "inactive",
            "required": true,
            "referenceCode": null,
            "expiresAt": null,
            "plan": null,
            "summary": "Checking hosted access…",
        });
    }
}

const PRIMARY_LANGUAGES: &[&str] = &[
    "ar", "de", "en", "es", "fr", "hi", "id", "it", "ja", "ko", "ms", "nl", "pl", "pt", "ru", "th",
    "tr", "uk", "vi", "zh",
];

fn normalize_preferences(value: &Value, require_primary_language: bool) -> CommandResult<Value> {
    let object = value
        .as_object()
        .ok_or_else(|| command_error("invalid_request", "Preferences are invalid."))?;
    let app_language = object
        .get("appLanguage")
        .and_then(Value::as_str)
        .unwrap_or("en");
    let autonomy = object
        .get("autonomyMode")
        .and_then(Value::as_str)
        .unwrap_or("balanced");
    let mute = object
        .get("muteSystemAudioWhileSpeaking")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let primary = object.get("primaryLanguage").and_then(Value::as_str);
    if !matches!(app_language, "en" | "vi")
        || !matches!(autonomy, "balanced" | "strict")
        || primary.is_some_and(|language| !PRIMARY_LANGUAGES.contains(&language))
        || (require_primary_language && primary.is_none())
    {
        return Err(command_error("invalid_request", "Preferences are invalid."));
    }
    Ok(json!({
        "appLanguage": app_language,
        "autonomyMode": autonomy,
        "muteSystemAudioWhileSpeaking": mute,
        "primaryLanguage": primary,
    }))
}

fn preferences_path(app: &tauri::AppHandle) -> CommandResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("preferences.json"))
        .map_err(|_| {
            command_error(
                "preferences_unavailable",
                "Preferences storage is unavailable.",
            )
        })
}

fn load_preferences(app: &tauri::AppHandle) -> Option<Value> {
    let bytes = std::fs::read(preferences_path(app).ok()?).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    normalize_preferences(&value, false).ok()
}

fn persist_preferences(app: &tauri::AppHandle, preferences: &Value) -> CommandResult<()> {
    let path = preferences_path(app)?;
    let parent = path.parent().ok_or_else(|| {
        command_error(
            "preferences_unavailable",
            "Preferences storage is unavailable.",
        )
    })?;
    std::fs::create_dir_all(parent)
        .map_err(|_| command_error("preferences_unavailable", "Preferences could not be saved."))?;
    let temporary = parent.join(format!(".preferences-{}.tmp", Uuid::new_v4()));
    let bytes = serde_json::to_vec_pretty(preferences)
        .map_err(|_| command_error("preferences_unavailable", "Preferences could not be saved."))?;
    std::fs::write(&temporary, bytes)
        .map_err(|_| command_error("preferences_unavailable", "Preferences could not be saved."))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o600)).map_err(
            |_| command_error("preferences_unavailable", "Preferences could not be saved."),
        )?;
    }
    std::fs::rename(&temporary, &path).map_err(|_| {
        let _ = std::fs::remove_file(&temporary);
        command_error("preferences_unavailable", "Preferences could not be saved.")
    })
}

fn require_window<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    allowed: &[&str],
) -> CommandResult<()> {
    if allowed.contains(&window.label()) {
        Ok(())
    } else {
        Err(command_error(
            "window_not_authorized",
            "This window cannot perform that operation.",
        ))
    }
}

#[tauri::command]
async fn get_app_preferences(
    window: tauri::Window,
    state: State<'_, DesktopState>,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    Ok(state.inner.preferences.read().await.clone())
}

#[tauri::command]
async fn update_app_preferences(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    request: Value,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let preferences = normalize_preferences(&request, true)?;
    persist_preferences(&app, &preferences)?;
    *state.inner.preferences.write().await = preferences.clone();
    Ok(preferences)
}

#[tauri::command]
async fn get_auth_status(
    window: tauri::Window,
    state: State<'_, DesktopState>,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    Ok(state.inner.auth.read().await.clone())
}

include!("oauth_commands.rs");

#[tauri::command]
async fn get_membership_status(
    window: tauri::Window,
    state: State<'_, DesktopState>,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let hosted = hosted_json(
        &state,
        Method::GET,
        "/v1/access-code-redemptions/me",
        None,
        true,
    )
    .await;
    let status = match hosted {
        Ok(value) => hosted_membership_status(&value),
        Err(error) if error.code == "authentication_required" => return Err(error),
        Err(error) => json!({
            "state": "error",
            "required": true,
            "referenceCode": null,
            "expiresAt": null,
            "plan": null,
            "summary": error.message,
        }),
    };
    *state.inner.membership.write().await = status.clone();
    Ok(status)
}

#[tauri::command]
async fn activate_membership(
    window: tauri::Window,
    state: State<'_, DesktopState>,
    request: Value,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let code = request
        .get("code")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|code| (4..=4_096).contains(&code.len()))
        .ok_or_else(|| command_error("invalid_request", "Membership code is invalid."))?;
    if code.chars().any(char::is_whitespace) {
        return Err(command_error(
            "invalid_request",
            "Membership code is invalid.",
        ));
    }
    let hosted = hosted_json(
        &state,
        Method::POST,
        "/v1/access-code-redemptions",
        Some(json!({ "code": code })),
        true,
    )
    .await?;
    let status = hosted_membership_status(&hosted);
    *state.inner.membership.write().await = status.clone();
    Ok(status)
}

fn hosted_membership_status(value: &Value) -> Value {
    let active = value.get("state").and_then(Value::as_str) == Some("active");
    json!({
        "state": if active { "active" } else { "inactive" },
        "required": true,
        "referenceCode": null,
        "expiresAt": null,
        "plan": value.get("plan").cloned().unwrap_or(Value::Null),
        "summary": value.get("summary").cloned().unwrap_or_else(|| {
            json!(if active { "Access is active." } else { "Enter an access code to continue." })
        }),
    })
}

#[tauri::command]
async fn submit_task(
    window: tauri::Window,
    state: State<'_, DesktopState>,
    request: Value,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let text = request
        .get("text")
        .and_then(Value::as_str)
        .map_or("", str::trim);
    if !(2..=8_000).contains(&text.chars().count()) {
        return Err(command_error("invalid_request", "Task request is invalid."));
    }
    let execution_profile = request
        .get("executionProfile")
        .and_then(Value::as_str)
        .unwrap_or("everyday");
    if !matches!(execution_profile, "everyday" | "workspace") {
        return Err(command_error(
            "invalid_request",
            "Task execution profile is invalid.",
        ));
    }
    let workspace_id = request
        .get("workspaceSelectionId")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    if (execution_profile == "workspace") != workspace_id.is_some() {
        return Err(command_error(
            "invalid_request",
            "Workspace tasks require a trusted Workspace selection.",
        ));
    }
    if let Some(id) = workspace_id
        && !state.inner.workspaces.contains(id).await
    {
        return Err(command_error(
            "unknown_workspace",
            "Select the Workspace again before starting this task.",
        ));
    }
    let attempt_id = request
        .get("activityAttemptId")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let task_id = Uuid::new_v4();
    let now = time_string();
    let snapshot = json!({
        "taskId": task_id,
        "request": text,
        "phase": "ready",
        "goal": null,
        "messages": [{
            "messageId": Uuid::new_v4(), "taskId": task_id, "role":"user",
            "kind":"request", "text":text, "timestamp":now
        }],
        "pendingInteraction": null,
        "approvalGrant": null,
        "progress": null,
        "queuedSteering": [],
        "runtimeResume": null,
        "createdAt": now,
        "updatedAt": now,
        "lastEvent": null
    });
    state
        .inner
        .tasks
        .write()
        .await
        .insert(task_id, snapshot.clone());
    if let Some(id) = workspace_id {
        state
            .inner
            .task_workspaces
            .write()
            .await
            .insert(task_id, id);
    }
    if let Some(id) = attempt_id {
        state.inner.task_attempts.write().await.insert(task_id, id);
    }
    state.inner.task_sequences.write().await.insert(task_id, 0);
    Ok(snapshot)
}

#[tauri::command]
async fn start_task(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    request: Value,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let task_id = value_uuid(&request, "taskId")?;
    let mut tasks = state.inner.tasks.write().await;
    let snapshot = tasks
        .get_mut(&task_id)
        .ok_or_else(|| command_error("task_not_found", "Task not found."))?;
    if snapshot.get("phase").and_then(Value::as_str) != Some("ready") {
        return Err(command_error(
            "task_already_started",
            "This task has already started.",
        ));
    }
    snapshot["phase"] = Value::String(String::from("planning"));
    snapshot["updatedAt"] = Value::String(time_string());
    let event = task_event(task_id, "planning", "success", "Task planning started.");
    snapshot["lastEvent"] = event.clone();
    app.emit(
        "task:update",
        json!({ "event":event, "snapshot":snapshot.clone() }),
    )
    .map_err(|_| command_error("event_failed", "Task update could not be delivered."))?;
    let result = snapshot.clone();
    drop(tasks);
    let cancellation = CancellationToken::new();
    state
        .inner
        .task_cancellations
        .write()
        .await
        .insert(task_id, cancellation);
    register_cancel_shortcut(&app);
    let runtime_state = state.inner().clone();
    let runtime_app = app.clone();
    tokio::spawn(async move {
        execute_hosted_task(runtime_app, runtime_state, task_id).await;
    });
    Ok(result)
}

#[tauri::command]
async fn cancel_task(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    request: Value,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let task_id = value_uuid(&request, "taskId")?;
    if let Some(cancellation) = state.inner.task_cancellations.read().await.get(&task_id) {
        cancellation.cancel();
    }
    let interaction_ids = state
        .inner
        .pending_approvals
        .lock()
        .await
        .iter()
        .filter_map(|(id, pending)| (pending.task_id == task_id).then_some(*id))
        .collect::<Vec<_>>();
    for interaction_id in interaction_ids {
        if let Some(pending) = state
            .inner
            .pending_approvals
            .lock()
            .await
            .remove(&interaction_id)
        {
            let _ = pending.sender.send(tro_agent::ApprovalDecision::Deny);
        }
    }
    let input_ids = state
        .inner
        .pending_inputs
        .lock()
        .await
        .iter()
        .filter_map(|(id, pending)| (pending.task_id == task_id).then_some(*id))
        .collect::<Vec<_>>();
    for interaction_id in input_ids {
        if let Some(pending) = state
            .inner
            .pending_inputs
            .lock()
            .await
            .remove(&interaction_id)
        {
            let _ = pending.sender.send(String::new());
        }
    }
    update_task_phase(&app, &state, &request, "cancelled").await
}

#[tauri::command]
async fn steer_task(
    window: tauri::Window,
    state: State<'_, DesktopState>,
    request: Value,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let task_id = value_uuid(&request, "taskId")?;
    let instruction = request
        .get("instruction")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| (1..=8_000).contains(&value.chars().count()))
        .ok_or_else(|| command_error("invalid_request", "Steering instruction is invalid."))?;
    let mut tasks = state.inner.tasks.write().await;
    let snapshot = tasks
        .get_mut(&task_id)
        .ok_or_else(|| command_error("task_not_found", "Task not found."))?;
    if matches!(
        snapshot.get("phase").and_then(Value::as_str),
        Some("completed" | "failed" | "cancelled")
    ) {
        return Err(command_error(
            "task_terminal",
            "A finished task cannot be steered.",
        ));
    }
    if let Some(queue) = snapshot
        .get_mut("queuedSteering")
        .and_then(Value::as_array_mut)
    {
        if queue.len() >= 50 {
            return Err(command_error(
                "steering_limit",
                "This task reached its steering limit.",
            ));
        }
        queue.push(json!({ "id": Uuid::new_v4(), "instruction": instruction, "createdAt": time_string(), "requiresGoalReview": true }));
    }
    if let Some(messages) = snapshot.get_mut("messages").and_then(Value::as_array_mut) {
        messages.push(json!({
            "messageId": Uuid::new_v4(), "taskId": task_id, "role": "user",
            "kind": "steering", "text": instruction, "timestamp": time_string()
        }));
    }
    snapshot["updatedAt"] = json!(time_string());
    Ok(snapshot.clone())
}

#[tauri::command]
async fn respond_to_interaction(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    request: Value,
) -> CommandResult<Value> {
    require_window(&window, &["main", "companion", "guidance"])?;
    let task_id = value_uuid(&request, "taskId")?;
    let interaction_id = value_uuid(&request, "interactionId")?;
    let answer = request
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| (1..=8_000).contains(&value.chars().count()))
        .ok_or_else(|| command_error("invalid_request", "The interaction answer is invalid."))?;
    if request.get("kind").and_then(Value::as_str) != Some("answer") {
        return Err(command_error(
            "invalid_request",
            "The interaction answer is invalid.",
        ));
    }
    let pending = state
        .inner
        .pending_inputs
        .lock()
        .await
        .remove(&interaction_id)
        .ok_or_else(|| {
            command_error("interaction_expired", "This question is no longer active.")
        })?;
    if pending.task_id != task_id {
        state
            .inner
            .pending_inputs
            .lock()
            .await
            .insert(interaction_id, pending);
        return Err(command_error(
            "interaction_mismatch",
            "The answer does not match the active question.",
        ));
    }
    let mut tasks = state.inner.tasks.write().await;
    let snapshot = tasks
        .get_mut(&task_id)
        .ok_or_else(|| command_error("task_not_found", "Task not found."))?;
    let matches_snapshot = snapshot
        .pointer("/pendingInteraction/id")
        .and_then(Value::as_str)
        .is_some_and(|value| value == interaction_id.to_string())
        && snapshot
            .pointer("/pendingInteraction/kind")
            .and_then(Value::as_str)
            == Some("clarification");
    if !matches_snapshot {
        state
            .inner
            .pending_inputs
            .lock()
            .await
            .insert(interaction_id, pending);
        return Err(command_error(
            "interaction_mismatch",
            "The answer does not match the active question.",
        ));
    }
    snapshot["pendingInteraction"] = Value::Null;
    snapshot["phase"] = json!("planning");
    snapshot["updatedAt"] = json!(time_string());
    if let Some(messages) = snapshot.get_mut("messages").and_then(Value::as_array_mut) {
        messages.push(json!({
            "messageId": Uuid::new_v4(), "taskId": task_id, "role": "user",
            "kind": "answer", "text": answer, "timestamp": time_string()
        }));
    }
    let event = task_event(task_id, "planning", "success", "User input received.");
    snapshot["lastEvent"] = event.clone();
    let result = snapshot.clone();
    drop(tasks);
    app.emit(
        "task:update",
        json!({ "event": event, "snapshot": result.clone() }),
    )
    .map_err(|_| command_error("event_failed", "Task update could not be delivered."))?;
    let _ = pending.sender.send(answer.to_owned());
    Ok(result)
}

#[tauri::command]
async fn decide_approval(
    window: tauri::Window,
    state: State<'_, DesktopState>,
    request: Value,
) -> CommandResult<Value> {
    require_window(&window, &["main", "companion", "guidance"])?;
    let task_id = value_uuid(&request, "taskId")?;
    let interaction_id = value_uuid(&request, "interactionId")?;
    let digest = request
        .get("actionDigest")
        .and_then(Value::as_str)
        .filter(|value| {
            value.len() == 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        })
        .ok_or_else(|| command_error("invalid_request", "Approval digest is invalid."))?;
    let decision = match request.get("decision").and_then(Value::as_str) {
        Some("approve") => tro_agent::ApprovalDecision::Approve,
        Some("deny") => tro_agent::ApprovalDecision::Deny,
        _ => {
            return Err(command_error(
                "invalid_request",
                "Approval decision is invalid.",
            ));
        }
    };
    let pending = state
        .inner
        .pending_approvals
        .lock()
        .await
        .remove(&interaction_id)
        .ok_or_else(|| {
            command_error(
                "approval_expired",
                "This approval request is no longer active.",
            )
        })?;
    if pending.task_id != task_id || pending.action_digest != digest {
        state
            .inner
            .pending_approvals
            .lock()
            .await
            .insert(interaction_id, pending);
        return Err(command_error(
            "approval_mismatch",
            "The approval does not match the proposed action.",
        ));
    }
    let mut tasks = state.inner.tasks.write().await;
    let snapshot = tasks
        .get_mut(&task_id)
        .ok_or_else(|| command_error("task_not_found", "Task not found."))?;
    let action = snapshot
        .pointer("/pendingInteraction/action")
        .cloned()
        .unwrap_or(Value::Null);
    snapshot["pendingInteraction"] = Value::Null;
    snapshot["phase"] = json!("planning");
    snapshot["approvalGrant"] = if decision == tro_agent::ApprovalDecision::Approve {
        json!({
            "interactionId": interaction_id, "actionDigest": digest, "action": action,
            "approvedAt": time_string(), "expiresAt": time_after_seconds(120)
        })
    } else {
        Value::Null
    };
    if let Some(messages) = snapshot.get_mut("messages").and_then(Value::as_array_mut) {
        messages.push(json!({
            "messageId": Uuid::new_v4(), "taskId": task_id, "role": "user",
            "kind": "approval_decision",
            "text": if decision == tro_agent::ApprovalDecision::Approve { "Approved this exact action." } else { "Denied this exact action." },
            "timestamp": time_string()
        }));
    }
    snapshot["updatedAt"] = json!(time_string());
    let result = snapshot.clone();
    drop(tasks);
    let _ = pending.sender.send(decision);
    Ok(result)
}

async fn update_task_phase(
    app: &tauri::AppHandle,
    state: &DesktopState,
    request: &Value,
    phase: &str,
) -> CommandResult<Value> {
    let task_id = value_uuid(request, "taskId")?;
    let mut tasks = state.inner.tasks.write().await;
    let snapshot = tasks
        .get_mut(&task_id)
        .ok_or_else(|| command_error("task_not_found", "Task not found."))?;
    snapshot["phase"] = Value::String(phase.to_owned());
    snapshot["updatedAt"] = Value::String(time_string());
    let event = task_event(
        task_id,
        phase,
        if phase == "cancelled" {
            "warning"
        } else {
            "success"
        },
        if phase == "cancelled" {
            "Task cancelled."
        } else {
            "Task updated."
        },
    );
    snapshot["lastEvent"] = event.clone();
    app.emit(
        "task:update",
        json!({"event":event,"snapshot":snapshot.clone()}),
    )
    .map_err(|_| command_error("event_failed", "Task update could not be delivered."))?;
    Ok(snapshot.clone())
}

#[tauri::command]
async fn get_task_history(
    window: tauri::Window,
    state: State<'_, DesktopState>,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let snapshots = state
        .inner
        .tasks
        .read()
        .await
        .values()
        .cloned()
        .collect::<Vec<_>>();
    let events = snapshots
        .iter()
        .filter_map(|snapshot| {
            snapshot
                .get("lastEvent")
                .filter(|value| !value.is_null())
                .cloned()
        })
        .collect::<Vec<_>>();
    Ok(
        json!({"events":events,"persistence":{"mode":"session_only","summary":"Task history is retained for this desktop session."},"snapshots":snapshots}),
    )
}

#[tauri::command]
async fn get_app_update_status(
    window: tauri::Window,
    state: State<'_, DesktopState>,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    Ok(state.inner.update_status.read().await.clone())
}
#[tauri::command]
async fn check_for_app_updates(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    if cfg!(debug_assertions) {
        return Ok(state.inner.update_status.read().await.clone());
    }
    set_update_status(&app, &state, "checking", "Checking for updates…", None).await;
    let updater = configured_updater(&app)?;
    let Ok(update) = updater.check().await else {
        set_update_status(
            &app,
            &state,
            "error",
            "Tro could not check for updates. Please try again.",
            None,
        )
        .await;
        return Ok(state.inner.update_status.read().await.clone());
    };
    let Some(update) = update else {
        set_update_status(
            &app,
            &state,
            "up_to_date",
            &format!("Tro {} is up to date.", env!("CARGO_PKG_VERSION")),
            None,
        )
        .await;
        return Ok(state.inner.update_status.read().await.clone());
    };
    let target = update.version.clone();
    set_update_status(
        &app,
        &state,
        "downloading",
        "A newer version is downloading in the background…",
        Some(&target),
    )
    .await;
    let Ok(bytes) = update.download(|_, _| {}, || {}).await else {
        set_update_status(
            &app,
            &state,
            "error",
            "Tro could not download the signed update.",
            Some(&target),
        )
        .await;
        return Ok(state.inner.update_status.read().await.clone());
    };
    *state.inner.pending_update.lock().await = Some(PendingUpdate {
        bytes,
        target_version: target.clone(),
    });
    set_update_status(
        &app,
        &state,
        "ready",
        &format!("Tro {target} is ready to install."),
        Some(&target),
    )
    .await;
    Ok(state.inner.update_status.read().await.clone())
}
#[tauri::command]
async fn restart_and_install_app_update(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> CommandResult<()> {
    require_window(&window, &["main"])?;
    let pending = state
        .inner
        .pending_update
        .lock()
        .await
        .take()
        .ok_or_else(|| command_error("update_not_ready", "No update is ready to install."))?;
    set_update_status(
        &app,
        &state,
        "installing",
        &format!("Restarting to install {}…", pending.target_version),
        Some(&pending.target_version),
    )
    .await;
    let update = configured_updater(&app)?
        .check()
        .await
        .map_err(|_| {
            command_error(
                "update_failed",
                "The signed update could not be revalidated.",
            )
        })?
        .filter(|update| update.version == pending.target_version)
        .ok_or_else(|| {
            command_error(
                "update_changed",
                "The available update changed. Check again before installing.",
            )
        })?;
    update
        .install(&pending.bytes)
        .map_err(|_| command_error("update_failed", "The signed update could not be installed."))?;
    app.request_restart();
    Ok(())
}

#[tauri::command]
async fn get_computer_status(
    window: tauri::Window,
    state: State<'_, DesktopState>,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let host = state.inner.cua.read().await.clone();
    match host {
        Some(host) => {
            let status = host.status().await.map_err(|_| {
                command_error("cua_unavailable", "Computer control is unavailable.")
            })?;
            Ok(cua_status_json(&status))
        }
        None => Ok(
            json!({"state":"disconnected","available":true,"platform":platform_name(),"summary":"Connect computer when Tro needs visible desktop context.","nextActions":["connect"]}),
        ),
    }
}
#[tauri::command]
async fn connect_computer(
    window: tauri::Window,
    state: State<'_, DesktopState>,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let host = Arc::new(
        DirectCuaHost::create(String::from("tro-desktop"))
            .map_err(|_| command_error("cua_unavailable", "Computer control is unavailable."))?,
    );
    let status = host
        .request_permissions_from_user_gesture()
        .await
        .map_err(|_| {
            command_error(
                "cua_unavailable",
                "Computer permissions could not be requested.",
            )
        })?;
    *state.inner.cua.write().await = Some(host);
    Ok(cua_status_json(&status))
}
#[tauri::command]
async fn open_system_permission_settings(
    window: tauri::Window,
    app: tauri::AppHandle,
    request: Value,
) -> CommandResult<()> {
    require_window(&window, &["main"])?;
    let permission = request
        .get("permission")
        .and_then(Value::as_str)
        .ok_or_else(|| command_error("invalid_request", "System permission is invalid."))?;
    let target = if cfg!(target_os = "macos") {
        match permission {
            "accessibility" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
            "microphone" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
            }
            "screen_recording" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
            }
            _ => {
                return Err(command_error(
                    "invalid_request",
                    "System permission is invalid.",
                ));
            }
        }
    } else if cfg!(target_os = "windows") {
        match permission {
            "accessibility" => "ms-settings:easeofaccess",
            "microphone" => "ms-settings:privacy-microphone",
            "screen_recording" => "ms-settings:privacy-screenshots",
            _ => {
                return Err(command_error(
                    "invalid_request",
                    "System permission is invalid.",
                ));
            }
        }
    } else {
        return Err(command_error(
            "permission_settings_unsupported",
            "Open system privacy settings manually on this platform.",
        ));
    };
    app.opener().open_url(target, None::<&str>).map_err(|_| {
        command_error(
            "permission_settings_failed",
            "System privacy settings could not be opened.",
        )
    })
}

#[tauri::command]
async fn get_voice_status(
    window: tauri::Window,
    state: State<'_, DesktopState>,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let ready =
        !state.inner.hosted.base_url.is_empty() && state.inner.hosted.token.read().await.is_some();
    Ok(
        json!({"state":if ready{"ready"}else{"not_configured"},"provider":"openai","model":"gpt-transcribe","summary":if ready{"Hosted voice transcription is ready."}else{"Sign in to use hosted voice transcription."}}),
    )
}
#[tauri::command]
async fn configure_voice(
    window: tauri::Window,
    state: State<'_, DesktopState>,
    _request: Value,
) -> CommandResult<Value> {
    get_voice_status(window, state).await
}
#[tauri::command]
async fn transcribe_voice_segment(
    window: tauri::Window,
    state: State<'_, DesktopState>,
    request: Value,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    refresh_hosted_session_if_needed(&state).await?;
    let token = state
        .inner
        .hosted
        .token
        .read()
        .await
        .clone()
        .ok_or_else(|| {
            command_error(
                "authentication_required",
                "Sign in to use voice transcription.",
            )
        })?;
    let request_id = required_string(&request, "requestId")?;
    let duration = request
        .get("durationMs")
        .and_then(Value::as_u64)
        .ok_or_else(invalid_hosted_request)?;
    let language = state
        .inner
        .preferences
        .read()
        .await
        .get("primaryLanguage")
        .and_then(Value::as_str)
        .unwrap_or("en")
        .to_owned();
    let response=state.inner.hosted.http.post(format!("{}/v1/openai/audio/transcriptions",state.inner.hosted.base_url))
        .bearer_auth(token).header("x-trocode-request-id",request_id).header("x-trocode-transcription-contract","2")
        .json(&json!({"audioBase64":request.get("audioBase64").cloned().ok_or_else(invalid_hosted_request)?,"clientDurationMs":duration,"language":language,"utteranceId":request.get("utteranceId").cloned().ok_or_else(invalid_hosted_request)?}))
        .send().await.map_err(|_|command_error("voice_unavailable","Voice transcription is temporarily unavailable."))?;
    if !response.status().is_success() {
        return Err(command_error("voice_failed", "Voice transcription failed."));
    }
    let value: Value = response.json().await.map_err(|_| {
        command_error(
            "voice_invalid_response",
            "Voice transcription returned an invalid response.",
        )
    })?;
    Ok(
        json!({"audioDurationMs":value.get("durationMs").cloned().unwrap_or(json!(duration)),"billedSeconds":std::time::Duration::from_millis(duration).as_secs_f64(),"model":value.get("model").cloned().unwrap_or(json!("gpt-transcribe")),"sequence":request.get("sequence").cloned().unwrap_or(json!(0)),"text":value.get("text").cloned().unwrap_or(json!("")),"utteranceId":value.get("utteranceId").cloned().unwrap_or_else(||request.get("utteranceId").cloned().unwrap_or(json!(Uuid::nil())))}),
    )
}

#[tauri::command]
async fn record_voice_transcript(window: tauri::Window, request: Value) -> CommandResult<()> {
    require_window(&window, &["main"])?;
    request
        .get("text")
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty() && text.chars().count() <= 8_000)
        .ok_or_else(|| command_error("invalid_request", "Voice transcript is invalid."))?;
    Ok(())
}

#[tauri::command]
async fn report_voice_diagnostic(window: tauri::Window, request: Value) -> CommandResult<()> {
    require_window(&window, &["main"])?;
    let step = request.get("step").and_then(Value::as_str).unwrap_or("");
    if !matches!(
        step,
        "audio_context"
            | "audio_encode"
            | "audio_worklet"
            | "microphone"
            | "segment_upload"
            | "transcription_response"
    ) {
        return Err(command_error(
            "invalid_request",
            "Voice diagnostic is invalid.",
        ));
    }
    Ok(())
}

#[tauri::command]
async fn set_voice_audio_ducking(
    window: tauri::Window,
    state: State<'_, DesktopState>,
    request: Value,
) -> CommandResult<()> {
    require_window(&window, &["main"])?;
    let active = request
        .get("active")
        .and_then(Value::as_bool)
        .ok_or_else(|| command_error("invalid_request", "Audio ducking request is invalid."))?;
    if !cfg!(target_os = "macos") {
        return Ok(());
    }
    let mut ducking = state.inner.audio_ducking.lock().await;
    if ducking.active == active {
        return Ok(());
    }
    if active {
        let output = tokio::process::Command::new("/usr/bin/osascript")
            .args(["-e", "output muted of (get volume settings)"])
            .output()
            .await
            .map_err(|_| {
                command_error(
                    "audio_ducking_failed",
                    "System audio state could not be read.",
                )
            })?;
        if !output.status.success() {
            return Err(command_error(
                "audio_ducking_failed",
                "System audio state could not be read.",
            ));
        }
        let previous = String::from_utf8_lossy(&output.stdout)
            .trim()
            .eq_ignore_ascii_case("true");
        ducking.previous_muted = Some(previous);
        ducking.active = true;
        if !previous {
            set_macos_output_muted(true).await?;
        }
    } else if let Some(previous) = ducking.previous_muted.take() {
        set_macos_output_muted(previous).await?;
        ducking.active = false;
    }
    Ok(())
}

async fn set_macos_output_muted(muted: bool) -> CommandResult<()> {
    let script = if muted {
        "set volume output muted true"
    } else {
        "set volume output muted false"
    };
    let status = tokio::process::Command::new("/usr/bin/osascript")
        .args(["-e", script])
        .status()
        .await
        .map_err(|_| {
            command_error(
                "audio_ducking_failed",
                "System audio mute could not be changed.",
            )
        })?;
    if status.success() {
        Ok(())
    } else {
        Err(command_error(
            "audio_ducking_failed",
            "System audio mute could not be changed.",
        ))
    }
}

#[tauri::command]
async fn set_companion_voice_activity(
    window: tauri::Window,
    app: tauri::AppHandle,
    request: Option<Value>,
) -> CommandResult<()> {
    require_window(&window, &["main"])?;
    app.emit(
        "companion:voice-activity-changed",
        request.filter(|value| !value.is_null()),
    )
    .map_err(|_| command_error("event_failed", "Voice activity could not be delivered."))
}

#[tauri::command]
async fn get_workspace_runtime_availability(window: tauri::Window) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    Ok(
        json!({"available":true,"runtimeVersion":env!("CARGO_PKG_VERSION"),"summary":"Rust workspace tools are available."}),
    )
}
#[tauri::command]
async fn select_workspace(
    window: tauri::Window,
    state: State<'_, DesktopState>,
) -> CommandResult<Value> {
    require_window(&window, &["main"])?;
    let Some(folder) = window.dialog().file().blocking_pick_folder() else {
        return Ok(Value::Null);
    };
    let path = folder
        .into_path()
        .map_err(|_| command_error("workspace_invalid", "The selected Workspace is invalid."))?;
    let selected =
        state.inner.workspaces.register(&path).await.map_err(|_| {
            command_error("workspace_invalid", "The selected Workspace is invalid.")
        })?;
    Ok(
        json!({"selectionId":selected.id,"displayName":selected.display_name,"selectedAt":time_string(),"runtime":{"available":true,"runtimeVersion":env!("CARGO_PKG_VERSION"),"summary":"Rust workspace tools are available."}}),
    )
}

include!("hosted_commands.rs");
include!("selection_support.rs");
include!("task_execution.rs");

#[tauri::command]
async fn set_companion_state(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    request: Value,
) -> CommandResult<()> {
    require_window(&window, &["main"])?;
    let next = request
        .as_str()
        .filter(|value| {
            matches!(
                *value,
                "idle"
                    | "guiding"
                    | "listening"
                    | "processing"
                    | "sending"
                    | "working"
                    | "completed"
                    | "error"
            )
        })
        .ok_or_else(|| command_error("invalid_request", "Companion state is invalid."))?;
    *state.inner.companion_state.write().await = next.to_owned();
    app.emit("companion:state-changed", next)
        .map_err(|_| command_error("event_failed", "Companion state could not be delivered."))
}

macro_rules! unit_companion_command {
    ($($name:ident),+ $(,)?) => {$(
        #[tauri::command]
        async fn $name(window:tauri::Window,_request:Option<Value>)->CommandResult<()>{require_window(&window,&["companion","guidance","voice-island","control-indicator"])?;Ok(())}
    )+};
}
unit_companion_command!(companion_report_speech_playback, companion_response_action);

#[tauri::command]
async fn companion_reveal_main_window(
    window: tauri::Window,
    app: tauri::AppHandle,
) -> CommandResult<()> {
    require_window(
        &window,
        &["companion", "guidance", "voice-island", "control-indicator"],
    )?;
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| command_error("window_unavailable", "The main window is unavailable."))?;
    main.show()
        .map_err(|_| command_error("window_failed", "The main window could not be shown."))?;
    main.set_focus()
        .map_err(|_| command_error("window_failed", "The main window could not be focused."))
}

fn value_uuid(value: &Value, key: &str) -> CommandResult<Uuid> {
    value
        .get(key)
        .and_then(Value::as_str)
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or_else(|| command_error("invalid_request", "Task identifier is invalid."))
}
fn time_string() -> String {
    format_time(time::OffsetDateTime::now_utc())
}
fn time_after_seconds(seconds: i64) -> String {
    format_time(time::OffsetDateTime::now_utc() + time::Duration::seconds(seconds))
}
fn format_time(value: time::OffsetDateTime) -> String {
    value
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| String::from("1970-01-01T00:00:00Z"))
}
fn task_event(task_id: Uuid, phase: &str, status: &str, summary: &str) -> Value {
    json!({"eventId":Uuid::new_v4(),"taskId":task_id,"phase":phase,"timestamp":time_string(),"status":status,"summary":summary,"nextActions":[],"artifacts":[]})
}
fn update_status(phase: &str, message: &str) -> Value {
    json!({"currentVersion":env!("CARGO_PKG_VERSION"),"message":message,"phase":phase,"targetVersion":null})
}
async fn set_update_status(
    app: &tauri::AppHandle,
    state: &DesktopState,
    phase: &str,
    message: &str,
    target: Option<&str>,
) {
    let status = json!({"currentVersion":env!("CARGO_PKG_VERSION"),"message":message,"phase":phase,"targetVersion":target});
    *state.inner.update_status.write().await = status.clone();
    let _ = app.emit("update:status-changed", status);
}
fn configured_updater(app: &tauri::AppHandle) -> CommandResult<tauri_plugin_updater::Updater> {
    let endpoint = std::env::var("TROCODE_UPDATE_ENDPOINT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| option_env!("TROCODE_UPDATE_ENDPOINT").map(str::to_owned))
        .unwrap_or_else(|| {
            String::from(
                "https://github.com/ducnguyen67201/TroCode/releases/latest/download/latest.json",
            )
        });
    let public_key = std::env::var("TROCODE_UPDATE_PUBLIC_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| option_env!("TROCODE_UPDATE_PUBLIC_KEY").map(str::to_owned))
        .ok_or_else(|| {
            command_error(
                "update_not_configured",
                "This build has no update-signing public key.",
            )
        })?;
    let endpoint = url::Url::parse(&endpoint)
        .ok()
        .filter(|url| url.scheme() == "https")
        .ok_or_else(|| {
            command_error(
                "update_not_configured",
                "The update endpoint must use HTTPS.",
            )
        })?;
    app.updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|_| command_error("update_not_configured", "The update endpoint is invalid."))?
        .pubkey(public_key)
        .build()
        .map_err(|_| {
            command_error(
                "update_not_configured",
                "The signed updater is not configured.",
            )
        })
}
fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unsupported"
    }
}
fn cua_status_json(status: &tro_cua::CuaStatus) -> Value {
    let accessibility = status.accessibility == PermissionState::Granted;
    let screen = status.screen_recording == PermissionState::Granted;
    json!({"state":if accessibility&&screen{"ready"}else{"permission_required"},"available":true,"platform":platform_name(),"version":env!("CARGO_PKG_VERSION"),"permissions":{"accessibility":accessibility,"screenRecording":screen},"summary":if accessibility&&screen{"Computer control is ready."}else{"Accessibility and Screen Recording permissions are required."},"nextActions":if accessibility&&screen{json!([])}else{json!(["open_settings"])}})
}

fn create_auxiliary_windows(app: &tauri::AppHandle) -> tauri::Result<()> {
    for (label, mode, width, height) in [
        ("companion", "companion", 360.0, 420.0),
        ("voice-island", "voice-island", 420.0, 110.0),
        ("guidance", "guidance", 420.0, 300.0),
        ("target-marker", "target-marker", 80.0, 80.0),
        ("control-indicator", "control-indicator", 220.0, 60.0),
    ] {
        WebviewWindowBuilder::new(
            app,
            label,
            WebviewUrl::App(format!("index.html?mode={mode}").into()),
        )
        .title("Tro")
        .inner_size(width, height)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    }
    Ok(())
}

fn reveal_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn create_background_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text("show", "Show Tro")
        .separator()
        .text("quit", "Quit Tro")
        .build()?;
    let mut tray = TrayIconBuilder::with_id("tro-background")
        .menu(&menu)
        .tooltip("Tro")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => reveal_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                reveal_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    let _tray = tray.build(app)?;
    Ok(())
}

fn voice_shortcut() -> Shortcut {
    let modifiers = if cfg!(target_os = "macos") {
        Modifiers::SUPER | Modifiers::CONTROL
    } else {
        Modifiers::CONTROL | Modifiers::ALT
    };
    Shortcut::new(Some(modifiers), Code::Space)
}

fn cancel_shortcut() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

fn register_cancel_shortcut(app: &tauri::AppHandle) {
    let manager = app.global_shortcut();
    let shortcut = cancel_shortcut();
    if !manager.is_registered(shortcut)
        && let Err(error) = manager.register(shortcut)
    {
        tracing::warn!(error = %error, "global task-cancel shortcut could not be registered");
    }
}

fn unregister_cancel_shortcut(app: &tauri::AppHandle) {
    let manager = app.global_shortcut();
    let shortcut = cancel_shortcut();
    if manager.is_registered(shortcut)
        && let Err(error) = manager.unregister(shortcut)
    {
        tracing::warn!(error = %error, "global task-cancel shortcut could not be unregistered");
    }
}

async fn cancel_all_tasks_from_shortcut(app: tauri::AppHandle, state: DesktopState) {
    for cancellation in state.inner.task_cancellations.read().await.values() {
        cancellation.cancel();
    }
    let approvals = {
        let mut pending = state.inner.pending_approvals.lock().await;
        std::mem::take(&mut *pending)
    };
    for (_, pending) in approvals {
        let _ = pending.sender.send(tro_agent::ApprovalDecision::Deny);
    }
    let inputs = {
        let mut pending = state.inner.pending_inputs.lock().await;
        std::mem::take(&mut *pending)
    };
    for (_, pending) in inputs {
        let _ = pending.sender.send(String::new());
    }
    let mut tasks = state.inner.tasks.write().await;
    for (task_id, snapshot) in tasks.iter_mut() {
        if matches!(
            snapshot.get("phase").and_then(Value::as_str),
            Some("completed" | "failed" | "cancelled")
        ) {
            continue;
        }
        snapshot["phase"] = json!("cancelled");
        snapshot["pendingInteraction"] = Value::Null;
        snapshot["approvalGrant"] = Value::Null;
        snapshot["updatedAt"] = json!(time_string());
        let event = task_event(
            *task_id,
            "cancelled",
            "warning",
            "Task cancelled by Escape.",
        );
        snapshot["lastEvent"] = event.clone();
        let _ = app.emit(
            "task:update",
            json!({ "event": event, "snapshot": snapshot.clone() }),
        );
    }
}

fn global_shortcut_handler(
    app: &tauri::AppHandle,
    shortcut: &Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    if shortcut.id() == voice_shortcut().id() {
        let action = match event.state {
            ShortcutState::Pressed => "pressed",
            ShortcutState::Released => "released",
        };
        let _ = app.emit(
            "voice:shortcut",
            json!({ "action": action, "source": "global" }),
        );
        return;
    }
    if shortcut.id() == cancel_shortcut().id() && event.state == ShortcutState::Pressed {
        let state = app.state::<DesktopState>().inner().clone();
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            cancel_all_tasks_from_shortcut(handle, state).await;
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::too_many_lines)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(DesktopState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(global_shortcut_handler)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let state = app.state::<DesktopState>();
            match SecretVault::open(app.handle()) {
                Ok(vault) => {
                    let restored = vault.load_json("hosted-session-v1");
                    tauri::async_runtime::block_on(async {
                        *state.inner.secret_vault.lock().await = Some(vault);
                        if let Some(record) = restored {
                            restore_hosted_session(state.inner(), record).await;
                        }
                    });
                }
                Err(code) => tracing::warn!(code, "OS-protected device vault is unavailable"),
            }
            if let Some(preferences) = load_preferences(app.handle()) {
                tauri::async_runtime::block_on(async {
                    *state.inner.preferences.write().await = preferences;
                });
            }
            create_auxiliary_windows(app.handle())?;
            create_background_tray(app.handle())?;
            if let Err(error) = app.global_shortcut().register(voice_shortcut()) {
                tracing::warn!(error = %error, "global voice shortcut could not be registered");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_preferences,
            update_app_preferences,
            get_auth_status,
            sign_in_with_google,
            sign_out_google,
            get_membership_status,
            activate_membership,
            submit_task,
            start_task,
            cancel_task,
            steer_task,
            respond_to_interaction,
            decide_approval,
            get_task_history,
            get_app_update_status,
            check_for_app_updates,
            restart_and_install_app_update,
            get_computer_status,
            connect_computer,
            open_system_permission_settings,
            get_voice_status,
            configure_voice,
            transcribe_voice_segment,
            record_voice_transcript,
            report_voice_diagnostic,
            set_voice_audio_ducking,
            set_companion_voice_activity,
            get_workspace_runtime_availability,
            select_workspace,
            get_usage_budget,
            get_knowledge_capabilities,
            list_knowledge_spaces,
            create_knowledge_space,
            get_knowledge_space,
            list_knowledge_sources,
            select_knowledge_files,
            upload_knowledge_selection,
            save_knowledge_activity,
            publish_knowledge_activity,
            create_knowledge_run,
            set_knowledge_run_state,
            list_assigned_activities,
            get_hosted_attempt,
            acknowledge_hosted_attempt,
            get_knowledge_dashboard,
            prepare_activity_starter,
            submit_knowledge_selection,
            list_knowledge_groups,
            create_knowledge_group,
            create_knowledge_invite,
            redeem_knowledge_invite,
            request_knowledge_attempt_help,
            set_companion_state,
            companion_report_speech_playback,
            companion_response_action,
            companion_reveal_main_window
        ]);
    if let Err(error) = builder.run(tauri::generate_context!()) {
        tracing::error!(error = %error, "Tro desktop failed");
    }
}
