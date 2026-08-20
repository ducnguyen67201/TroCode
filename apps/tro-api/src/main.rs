mod activity_http;
mod admin_http;
mod config;
mod error;
mod identity;
mod knowledge_http;
mod object_store;
mod services;

use std::{
    io,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Query, State},
    http::{HeaderMap, HeaderValue, Request, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use bytes::Bytes;
use futures_util::{StreamExt, TryStreamExt};
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::{net::TcpListener, signal};
use tower_http::{catch_panic::CatchPanicLayer, timeout::TimeoutLayer, trace::TraceLayer};
use tracing::{info, warn};
use tro_domain::{PlanId, plan_limits};
use tro_persistence::{DatabaseConfig, schema_is_ready};
use tro_providers::{ProviderClients, ProviderConfig, ProviderError, parse_pcm16_mono_wav};
use uuid::Uuid;

use crate::{
    config::Config,
    error::ApiError,
    identity::{AuthenticatedSession, IdentityService},
    object_store::KnowledgeObjectStore,
    services::{HostedServices, ProviderReservation, UsageSettlement},
};

#[derive(Clone)]
pub(crate) struct AppState {
    admin: Option<admin_http::AdminService>,
    database: DatabaseConnection,
    identity: IdentityService,
    services: HostedServices,
    providers: ProviderClients,
    config: Arc<Config>,
    object_store: Option<KnowledgeObjectStore>,
}

impl std::fmt::Debug for AppState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("AppState").finish_non_exhaustive()
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let config = Arc::new(Config::load()?);
    let mut database_config = DatabaseConfig::production(config.database_url.clone());
    database_config.max_connections = config.database_pool_max;
    let database = database_config
        .connect()
        .await
        .context("database connection failed")?;
    let identity = IdentityService::new(
        database.clone(),
        config.session_hmac_key.clone(),
        config.session_duration_days,
        config.google_client_id.clone(),
    );
    let services = HostedServices::new(database.clone(), config.session_hmac_key.clone());
    let providers = ProviderClients::new(ProviderConfig {
        openai_base_url: String::from("https://api.openai.com"),
        openai_api_key: config.openai_api_key.clone(),
        elevenlabs_base_url: String::from("https://api.elevenlabs.io"),
        elevenlabs_api_key: config.elevenlabs_api_key.clone(),
    })
    .context("provider HTTP client failed")?;
    let object_store = match config.knowledge_object_store.as_ref() {
        Some(settings) => Some(KnowledgeObjectStore::new(settings).await?),
        None => None,
    };
    let admin = config.admin_access_token.as_ref().map(|access_token| {
        admin_http::AdminService::new(
            database.clone(),
            access_token.clone(),
            config.session_hmac_key.clone(),
            config.access_code_encryption_key.clone(),
        )
    });
    let state = AppState {
        admin,
        database,
        identity,
        services,
        providers,
        config: config.clone(),
        object_store,
    };
    let app = router(state);
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), config.port.get());
    let listener = TcpListener::bind(address)
        .await
        .context("API bind failed")?;
    info!(event = "server.ready", port = config.port.get());
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("API server failed")?;
    info!(event = "server.stopped");
    Ok(())
}

fn router(state: AppState) -> Router {
    Router::new()
        .merge(admin_http::routes())
        .route("/healthz", get(health))
        .route("/readyz", get(readiness))
        .route("/v1/capabilities", get(capabilities))
        .route("/v1/auth/google/exchange", post(exchange_google))
        .route("/v1/auth/session/refresh", post(refresh_session))
        .route("/v1/auth/session", delete(revoke_session))
        .route("/v1/access-code-redemptions/me", get(access_status))
        .route("/v1/access-code-redemptions", post(redeem_access_code))
        .route("/v1/agent-turns", post(create_agent_turn))
        .route("/v1/openai/responses", post(openai_responses))
        .route("/v1/usage/budget", get(usage_budget))
        .route(
            "/v1/openai/audio/transcriptions",
            post(openai_transcription),
        )
        .route("/v1/openai/realtime/calls", post(realtime_calls))
        .route("/v1/elevenlabs/speech", post(elevenlabs_speech))
        .fallback(knowledge_http::dispatch)
        .layer(DefaultBodyLimit::max(25_000_000))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_mins(3),
        ))
        .layer(CatchPanicLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(middleware::from_fn(security_boundary))
        .with_state(state)
}

async fn security_boundary(request: Request<Body>, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let admin_surface = path.starts_with("/v1/admin/")
        || path == "/source/admin"
        || path.starts_with("/source/admin/");
    if !admin_surface && request.headers().contains_key(header::ORIGIN) {
        return ApiError::new(
            StatusCode::FORBIDDEN,
            "Browser-origin requests are not allowed.",
        )
        .into_response();
    }
    let request_id = Uuid::new_v4();
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    let content_security_policy = if matches!(path.as_str(), "/source/admin" | "/source/admin/") {
        "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'"
    } else {
        "default-src 'none'; frame-ancestors 'none'"
    };
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(content_security_policy),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    if let Ok(value) = HeaderValue::from_str(&request_id.to_string()) {
        headers.insert("x-request-id", value);
    }
    response
}

async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "version": std::env::var("RAILWAY_GIT_COMMIT_SHA").unwrap_or_else(|_| String::from("local"))
    }))
}

async fn readiness(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match schema_is_ready(&state.database).await {
        Ok(true) => (
            StatusCode::OK,
            Json(json!({ "database": "ok", "status": "ok" })),
        ),
        Ok(false) | Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "database": "unavailable", "status": "degraded" })),
        ),
    }
}

async fn capabilities(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "knowledgeSpaces": {
            "enabled": state.config.knowledge_enabled,
            "contractVersion": 1
        }
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GoogleExchangeBody {
    id_token: String,
    #[serde(default)]
    nonce: String,
}

async fn exchange_google(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<GoogleExchangeBody>,
) -> Result<impl IntoResponse, ApiError> {
    let ip = client_identity(&headers);
    state
        .services
        .consume_rate("auth.exchange", &ip, 15, 15 * 60_000)
        .await?;
    if body.id_token.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "idToken is required.",
        ));
    }
    let session = state
        .identity
        .exchange_google(&body.id_token, &body.nonce)
        .await?;
    Ok((StatusCode::CREATED, Json(session)))
}

async fn refresh_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<identity::IssuedSession>, ApiError> {
    let current = require_session(&state, &headers).await?;
    state
        .services
        .consume_rate("auth.refresh", &current.user.id, 15, 15 * 60_000)
        .await?;
    Ok(Json(state.identity.rotate(&current).await?))
}

async fn revoke_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    let current = require_session(&state, &headers).await?;
    state.identity.revoke(current.session_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn access_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<services::AccessStatus>, ApiError> {
    let session = require_session(&state, &headers).await?;
    Ok(Json(state.services.access_status(&session.user.id).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RedeemBody {
    code: String,
}

async fn redeem_access_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RedeemBody>,
) -> Result<impl IntoResponse, ApiError> {
    let session = require_session(&state, &headers).await?;
    state
        .services
        .consume_rate("access-code.user", &session.user.id, 10, 15 * 60_000)
        .await?;
    let (status, value) = state
        .services
        .redeem_access_code(&session.user.id, &body.code)
        .await?;
    Ok((status, Json(value)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentTurnBody {
    client_turn_id: Uuid,
    task_id: Uuid,
}

async fn create_agent_turn(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AgentTurnBody>,
) -> Result<Response, ApiError> {
    let session = require_access(&state, &headers).await?;
    let limit = plan_limits(plan_id(&session.plan)).requests_per_minute;
    state
        .services
        .consume_rate(
            "agent-turns.minute",
            &session.user.id,
            i32::try_from(limit).unwrap_or(i32::MAX),
            60_000,
        )
        .await?;
    let (status, turn) = state
        .services
        .create_agent_turn(
            &session.user.id,
            &session.plan,
            body.client_turn_id,
            body.task_id,
        )
        .await?;
    let location = format!("/v1/agent-turns/{}", turn.id);
    let mut response = (status, Json(turn)).into_response();
    if let Ok(value) = HeaderValue::from_str(&location) {
        response.headers_mut().insert(header::LOCATION, value);
    }
    Ok(response)
}

#[allow(clippy::too_many_lines)]
async fn openai_responses(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut body): Json<Value>,
) -> Result<Response, ApiError> {
    let session = require_access(&state, &headers).await?;
    require_paid_calls(&state)?;
    let request_id = required_uuid_header(&headers, "x-trocode-request-id")?;
    let task_id = required_uuid_header(&headers, "x-trocode-task-id")?;
    let agent_turn_id = required_uuid_header(&headers, "x-trocode-agent-turn-id")?;
    let object = body
        .as_object_mut()
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Responses request is invalid."))?;
    object
        .entry("tool_choice")
        .or_insert(Value::String(String::from("auto")));
    let valid = object.get("model").and_then(Value::as_str)
        == Some(state.config.openai_model.as_str())
        && object
            .get("input")
            .and_then(Value::as_array)
            .is_some_and(|items| items.len() <= 256)
        && object
            .get("tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| tools.len() <= 24)
        && object.get("tool_choice").and_then(Value::as_str) == Some("auto")
        && object.get("parallel_tool_calls").and_then(Value::as_bool) == Some(false)
        && object.get("store").and_then(Value::as_bool) == Some(false)
        && object
            .get("max_output_tokens")
            .and_then(Value::as_u64)
            .is_some_and(|count| (1..=4_000).contains(&count));
    if !valid {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Responses request is invalid.",
        ));
    }
    let limit = plan_limits(plan_id(&session.plan)).requests_per_minute;
    state
        .services
        .consume_rate(
            "responses.minute",
            &session.user.id,
            i32::try_from(limit).unwrap_or(i32::MAX),
            60_000,
        )
        .await?;
    let reserved_micro_usd = responses_estimate_micro_usd(&body, &state.config.openai_model)?;
    state
        .services
        .reserve_provider_call(ProviderReservation {
            agent_turn_id: Some(agent_turn_id),
            catalog_version: tro_domain::PLAN_CATALOG_VERSION,
            lane: "responses",
            model: &state.config.openai_model,
            plan: &session.plan,
            request_id,
            reservation_ttl_ms: state.config.reservation_ttl_ms,
            reserved_micro_usd,
            task_id,
            user_id: &session.user.id,
        })
        .await?;
    state
        .services
        .mark_dispatched(&session.user.id, request_id)
        .await?;
    let started = Instant::now();
    let upstream = match state.providers.responses(request_id, body).await {
        Ok(upstream) => upstream,
        Err(error) => {
            reconcile_provider_error(&state.services, &session.user.id, request_id, &error).await;
            return Err(provider_error(&error));
        }
    };
    let content_type = upstream
        .content_type()
        .unwrap_or("application/json")
        .to_owned();
    let services = state.services.clone();
    let user_id = session.user.id.clone();
    let model = state.config.openai_model.clone();
    let (sender, receiver) = tokio::sync::mpsc::channel::<Result<Bytes, io::Error>>(16);
    tokio::spawn(async move {
        let mut stream = Box::pin(upstream.into_stream());
        let mut captured = Vec::new();
        let mut uncertain = false;
        while let Some(item) = stream.next().await {
            match item {
                Ok(bytes) => {
                    if captured.len().saturating_add(bytes.len()) <= 5_000_000 {
                        captured.extend_from_slice(&bytes);
                    } else {
                        uncertain = true;
                    }
                    if sender.send(Ok(bytes)).await.is_err() {
                        uncertain = true;
                        break;
                    }
                }
                Err(error) => {
                    uncertain = true;
                    let _ = sender.send(Err(io::Error::other(error))).await;
                    break;
                }
            }
        }
        if uncertain {
            let _ = services.mark_provider_uncertain(&user_id, request_id).await;
        } else if let Some(mut settlement) = responses_settlement(&captured, &model) {
            settlement.duration_ms =
                i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
            let _ = services
                .settle_provider_call(&user_id, request_id, &settlement)
                .await;
        } else {
            let _ = services.mark_provider_uncertain(&user_id, request_id).await;
        }
    });
    let stream = futures_util::stream::unfold(receiver, |mut receiver| async move {
        receiver.recv().await.map(|item| (item, receiver))
    });
    let mut response = Response::new(Body::from_stream(stream));
    if let Ok(value) = HeaderValue::from_str(&content_type) {
        response.headers_mut().insert(header::CONTENT_TYPE, value);
    }
    Ok(response)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BudgetQuery {
    task_id: Option<Uuid>,
}

async fn usage_budget(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<BudgetQuery>,
) -> Result<Json<services::BudgetSnapshot>, ApiError> {
    let session = require_session(&state, &headers).await?;
    Ok(Json(
        state
            .services
            .budget_snapshot(&session.user.id, query.task_id, &session.plan)
            .await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TranscriptionBody {
    audio_base64: String,
    client_duration_ms: u64,
    language: String,
    utterance_id: Uuid,
}

async fn openai_transcription(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<TranscriptionBody>,
) -> Result<Json<Value>, ApiError> {
    let session = require_access(&state, &headers).await?;
    require_paid_calls(&state)?;
    let request_id = required_uuid_header(&headers, "x-trocode-request-id")?;
    if !(300..=15_000).contains(&body.client_duration_ms)
        || !transcription_language(&body.language)
        || body.audio_base64.len() > 750_000
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Transcription request is invalid.",
        ));
    }
    let wav = STANDARD
        .decode(&body.audio_base64)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Transcription request is invalid."))?;
    let metadata = parse_pcm16_mono_wav(&wav)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Transcription request is invalid."))?;
    let safety = safety_identifier(&session.user.id);
    let reserved_micro_usd = ceil_ratio(
        i64::try_from(metadata.duration_ms).unwrap_or(i64::MAX),
        state.config.transcription_micro_usd_per_minute,
        60_000,
    );
    state
        .services
        .reserve_provider_call(ProviderReservation {
            agent_turn_id: None,
            catalog_version: "voice-estimate-v1",
            lane: "transcription",
            model: "gpt-transcribe",
            plan: &session.plan,
            request_id,
            reservation_ttl_ms: state.config.reservation_ttl_ms,
            reserved_micro_usd,
            task_id: voice_task_id(),
            user_id: &session.user.id,
        })
        .await?;
    state
        .services
        .mark_dispatched(&session.user.id, request_id)
        .await?;
    let started = Instant::now();
    let provider = match state
        .providers
        .transcribe(wav, &body.language, &safety)
        .await
    {
        Ok(value) => value,
        Err(error) => {
            reconcile_provider_error(&state.services, &session.user.id, request_id, &error).await;
            return Err(provider_error(&error));
        }
    };
    state
        .services
        .settle_provider_call(
            &session.user.id,
            request_id,
            &UsageSettlement {
                actual_micro_usd: reserved_micro_usd,
                audio_duration_ms: i64::try_from(metadata.duration_ms).unwrap_or(i64::MAX),
                cached_input_tokens: 0,
                character_count: 0,
                duration_ms: i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX),
                input_tokens: 0,
                output_tokens: 0,
                reasoning_tokens: 0,
                response_id: None,
                source: "estimated",
            },
        )
        .await?;
    let text = provider
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let contract_v2 = headers
        .get("x-trocode-transcription-contract")
        .and_then(|value| value.to_str().ok())
        == Some("2");
    Ok(Json(json!({
        "durationMs": metadata.duration_ms,
        "language": body.language,
        "model": if contract_v2 { "gpt-transcribe" } else { "whisper-1" },
        "text": text,
        "utteranceId": body.utterance_id
    })))
}

async fn realtime_calls(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    let session = require_access(&state, &headers).await?;
    require_paid_calls(&state)?;
    let language = body.get("language").and_then(Value::as_str);
    let offer = body.get("offerSdp").and_then(Value::as_str);
    if !matches!(language, Some("en" | "vi"))
        || !offer.is_some_and(|sdp| sdp.starts_with("v=0") && sdp.len() <= 1_000_000)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Realtime call request is invalid.",
        ));
    }
    state
        .services
        .consume_rate("realtime.minute", &session.user.id, 30, 60_000)
        .await?;
    let request_id = Uuid::new_v4();
    state
        .services
        .reserve_provider_call(ProviderReservation {
            agent_turn_id: None,
            catalog_version: "voice-estimate-v1",
            lane: "realtime_transcription",
            model: "gpt-realtime-whisper",
            plan: &session.plan,
            request_id,
            reservation_ttl_ms: state.config.reservation_ttl_ms,
            reserved_micro_usd: state.config.realtime_call_micro_usd,
            task_id: voice_task_id(),
            user_id: &session.user.id,
        })
        .await?;
    state
        .services
        .mark_dispatched(&session.user.id, request_id)
        .await?;
    let started = Instant::now();
    let upstream = match state
        .providers
        .realtime_transcription_call(
            offer.unwrap_or_default().to_owned(),
            language.unwrap_or("en"),
            &safety_identifier(&session.user.id),
        )
        .await
    {
        Ok(value) => value,
        Err(error) => {
            reconcile_provider_error(&state.services, &session.user.id, request_id, &error).await;
            return Err(provider_error(&error));
        }
    };
    if upstream.status.is_success() {
        state
            .services
            .settle_provider_call(
                &session.user.id,
                request_id,
                &UsageSettlement {
                    actual_micro_usd: state.config.realtime_call_micro_usd,
                    audio_duration_ms: 0,
                    cached_input_tokens: 0,
                    character_count: 0,
                    duration_ms: i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX),
                    input_tokens: 0,
                    output_tokens: 0,
                    reasoning_tokens: 0,
                    response_id: None,
                    source: "estimated",
                },
            )
            .await?;
    } else if explicit_pre_inference_rejection(upstream.status) {
        state
            .services
            .release_provider_call(&session.user.id, request_id)
            .await?;
    } else {
        state
            .services
            .mark_provider_uncertain(&session.user.id, request_id)
            .await?;
    }
    let mut response = Response::new(Body::from(upstream.body));
    *response.status_mut() = upstream.status;
    if let Ok(value) = HeaderValue::from_str(&upstream.content_type) {
        response.headers_mut().insert(header::CONTENT_TYPE, value);
    }
    Ok(response)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SpeechBody {
    text: String,
}

async fn elevenlabs_speech(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SpeechBody>,
) -> Result<Response, ApiError> {
    let session = require_access(&state, &headers).await?;
    require_paid_calls(&state)?;
    let text = body.text.trim();
    if text.is_empty() || text.chars().count() > 240 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Speech text must contain 1 to 240 characters.",
        ));
    }
    let voice_id = state.config.elevenlabs_voice_id.as_deref().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Speech playback is not configured.",
        )
    })?;
    let request_id = Uuid::new_v4();
    let reserved_micro_usd = ceil_ratio(
        i64::try_from(text.chars().count()).unwrap_or(i64::MAX),
        state.config.speech_micro_usd_per_thousand_characters,
        1_000,
    );
    state
        .services
        .reserve_provider_call(ProviderReservation {
            agent_turn_id: None,
            catalog_version: "speech-estimate-v1",
            lane: "speech",
            model: &state.config.elevenlabs_model_id,
            plan: &session.plan,
            request_id,
            reservation_ttl_ms: state.config.reservation_ttl_ms,
            reserved_micro_usd,
            task_id: voice_task_id(),
            user_id: &session.user.id,
        })
        .await?;
    state
        .services
        .mark_dispatched(&session.user.id, request_id)
        .await?;
    let started = Instant::now();
    let upstream = match state
        .providers
        .speech(
            voice_id,
            json!({ "text": text, "model_id": state.config.elevenlabs_model_id }),
        )
        .await
    {
        Ok(value) => value,
        Err(error) => {
            reconcile_provider_error(&state.services, &session.user.id, request_id, &error).await;
            return Err(provider_error(&error));
        }
    };
    state
        .services
        .settle_provider_call(
            &session.user.id,
            request_id,
            &UsageSettlement {
                actual_micro_usd: reserved_micro_usd,
                audio_duration_ms: 0,
                cached_input_tokens: 0,
                character_count: i64::try_from(text.chars().count()).unwrap_or(i64::MAX),
                duration_ms: i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX),
                input_tokens: 0,
                output_tokens: 0,
                reasoning_tokens: 0,
                response_id: None,
                source: "estimated",
            },
        )
        .await?;
    let stream = upstream.into_stream().map_err(io::Error::other);
    let mut response = Response::new(Body::from_stream(stream));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("audio/mpeg"));
    Ok(response)
}

pub(crate) async fn require_session(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<AuthenticatedSession, ApiError> {
    let token = bearer(headers).ok_or_else(|| {
        ApiError::coded(
            StatusCode::UNAUTHORIZED,
            "authentication_required",
            "Sign in to continue.",
        )
    })?;
    state.identity.authenticate(token).await
}

pub(crate) async fn require_access(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<AuthenticatedSession, ApiError> {
    let session = require_session(state, headers).await?;
    let access = state.services.access_status(&session.user.id).await?;
    if access_is_inactive(&access) {
        return Err(ApiError::coded(
            StatusCode::FORBIDDEN,
            "access_required",
            "Enter a valid access code to use TroCode.",
        ));
    }
    Ok(session)
}

fn access_is_inactive(access: &services::AccessStatus) -> bool {
    !access.is_active()
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .filter(|token| !token.is_empty() && !token.contains(char::is_whitespace))
}

fn required_uuid_header(headers: &HeaderMap, name: &'static str) -> Result<Uuid, ApiError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Responses request is invalid."))
}

fn client_identity(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next_back())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown")
        .to_owned()
}

fn provider_error(error: &ProviderError) -> ApiError {
    match error {
        ProviderError::Rejected { status } if status.is_client_error() => ApiError::new(
            StatusCode::BAD_GATEWAY,
            "The model provider rejected the request.",
        ),
        ProviderError::NotConfigured => ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Speech playback is not configured.",
        ),
        ProviderError::InvalidWav => {
            ApiError::new(StatusCode::BAD_REQUEST, "Transcription request is invalid.")
        }
        ProviderError::Rejected { .. }
        | ProviderError::Uncertain
        | ProviderError::ResponseTooLarge => ApiError::new(
            StatusCode::BAD_GATEWAY,
            "The model provider is temporarily unavailable.",
        ),
    }
}

fn require_paid_calls(state: &AppState) -> Result<(), ApiError> {
    if state.config.paid_calls_enabled {
        Ok(())
    } else {
        Err(ApiError::coded(
            StatusCode::SERVICE_UNAVAILABLE,
            "cost_guard_disabled",
            "Hosted model calls are temporarily disabled.",
        ))
    }
}

async fn reconcile_provider_error(
    services: &HostedServices,
    user_id: &str,
    request_id: Uuid,
    error: &ProviderError,
) {
    match error {
        ProviderError::Rejected { status } if explicit_pre_inference_rejection(*status) => {
            let _ = services.release_provider_call(user_id, request_id).await;
        }
        _ => {
            let _ = services.mark_provider_uncertain(user_id, request_id).await;
        }
    }
}

fn explicit_pre_inference_rejection(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 400 | 401 | 403 | 404 | 422)
}

fn responses_estimate_micro_usd(body: &Value, model: &str) -> Result<i64, ApiError> {
    let input = serde_json::to_string(body.get("input").unwrap_or(&Value::Null))
        .map_err(|_| ApiError::internal())?;
    let tools = serde_json::to_string(body.get("tools").unwrap_or(&Value::Null))
        .map_err(|_| ApiError::internal())?;
    let instructions = body
        .get("instructions")
        .and_then(Value::as_str)
        .unwrap_or("");
    let images = input.matches("\"input_image\"").count();
    let input_tokens = input
        .len()
        .saturating_add(tools.len())
        .saturating_add(instructions.len())
        .saturating_add(images.saturating_mul(20_000));
    let output_tokens = body
        .get("max_output_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(4_000);
    model_cost_micro_usd(
        model,
        i64::try_from(input_tokens).unwrap_or(i64::MAX),
        0,
        i64::try_from(output_tokens).unwrap_or(i64::MAX),
    )
}

fn responses_settlement(bytes: &[u8], model: &str) -> Option<UsageSettlement> {
    let text = std::str::from_utf8(bytes).ok()?;
    let mut completed = None;
    for line in text.lines() {
        let Some(payload) = line.strip_prefix("data:").map(str::trim) else {
            continue;
        };
        if payload == "[DONE]" {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(payload) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) == Some("response.completed") {
            completed = value.get("response").cloned().or(Some(value));
        }
    }
    let response = completed?;
    let usage = response.get("usage")?;
    let input_tokens = usage.get("input_tokens").and_then(Value::as_i64)?;
    let cached_input_tokens = usage
        .pointer("/input_tokens_details/cached_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let output_tokens = usage.get("output_tokens").and_then(Value::as_i64)?;
    let reasoning_tokens = usage
        .pointer("/output_tokens_details/reasoning_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let actual_micro_usd =
        model_cost_micro_usd(model, input_tokens, cached_input_tokens, output_tokens).ok()?;
    Some(UsageSettlement {
        actual_micro_usd,
        audio_duration_ms: 0,
        cached_input_tokens,
        character_count: 0,
        duration_ms: 0,
        input_tokens,
        output_tokens,
        reasoning_tokens,
        response_id: response
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_owned),
        source: "actual",
    })
}

fn model_cost_micro_usd(
    model: &str,
    input: i64,
    cached: i64,
    output: i64,
) -> Result<i64, ApiError> {
    if input < 0 || cached < 0 || output < 0 || cached > input {
        return Err(ApiError::internal());
    }
    let (input_rate, cached_rate, output_rate) = match model {
        "gpt-5.6-luna" => (200_000_i128, 20_000_i128, 1_200_000_i128),
        "gpt-5.6-terra" => (2_000_000_i128, 200_000_i128, 12_000_000_i128),
        _ => {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Responses request is invalid.",
            ));
        }
    };
    let ordinary = i128::from(input.saturating_sub(cached));
    let numerator = ordinary
        .saturating_mul(input_rate)
        .saturating_add(i128::from(cached).saturating_mul(cached_rate))
        .saturating_add(i128::from(output).saturating_mul(output_rate));
    i64::try_from((numerator.saturating_add(999_999)) / 1_000_000).map_err(|_| ApiError::internal())
}

fn ceil_ratio(value: i64, rate: i64, denominator: i64) -> i64 {
    let numerator = i128::from(value).saturating_mul(i128::from(rate));
    i64::try_from(
        (numerator.saturating_add(i128::from(denominator.saturating_sub(1))))
            / i128::from(denominator),
    )
    .unwrap_or(i64::MAX)
}

fn voice_task_id() -> Uuid {
    Uuid::from_u128(0x00000000_0000_4000_8000_000000000000)
}

fn safety_identifier(user_id: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("trocode:{user_id}").as_bytes())
    )
}

fn transcription_language(language: &str) -> bool {
    matches!(
        language,
        "ar" | "de"
            | "en"
            | "es"
            | "fr"
            | "hi"
            | "id"
            | "it"
            | "ja"
            | "ko"
            | "ms"
            | "nl"
            | "pl"
            | "pt"
            | "ru"
            | "th"
            | "tr"
            | "uk"
            | "vi"
            | "zh"
    )
}

fn plan_id(plan: &str) -> PlanId {
    match plan {
        "basic" => PlanId::Basic,
        "pro" => PlanId::Pro,
        "max" => PlanId::Max,
        _ => PlanId::Free,
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if signal::ctrl_c().await.is_err() {
            warn!(event = "server.signal_failed", signal = "SIGINT");
        }
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut stream) = signal::unix::signal(signal::unix::SignalKind::terminate()) {
            stream.recv().await;
        } else {
            warn!(event = "server.signal_failed", signal = "SIGTERM");
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    info!(event = "server.stopping");
}
