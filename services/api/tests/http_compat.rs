use std::{collections::BTreeSet, time::Duration};

use aws_credential_types::Credentials;
use aws_sdk_s3::{Client as S3Client, config::Region};
use axum::{
    Router,
    body::Body,
    http::{HeaderMap, Method, Request, StatusCode},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use http_body_util::BodyExt as _;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tower::ServiceExt as _;
use trocode_api::{
    app::AppState,
    auth::User,
    config::{
        AdminConfig, Config, ConnectorConfig, CostGuardConfig, CostGuardMode, KnowledgeConfig,
        ObjectStoreConfig,
    },
    knowledge::IngestionWorker,
    postgres::PgPoolOptions,
    providers::{CompanionImageService, ResponsesService, TranscriptionService},
    query, query_scalar,
};
use url::Url;
use uuid::Uuid;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

const ADMIN_TOKEN: &str = "trocode_test_admin_token_0123456789abcdef";
const HMAC_KEY: &str = "trocode_test_hmac_key_0123456789abcdef";

struct TestResponse {
    body: Vec<u8>,
    headers: HeaderMap,
    status: StatusCode,
}

impl TestResponse {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|error| {
            panic!(
                "response was not JSON ({error}): {}",
                String::from_utf8_lossy(&self.body)
            )
        })
    }
}

fn disposable_database_url() -> String {
    let value = std::env::var("TEST_DATABASE_URL")
        .expect("TEST_DATABASE_URL is required for this ignored integration test");
    let parsed = Url::parse(&value).expect("TEST_DATABASE_URL must be a URL");
    let local = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"));
    let test_database = parsed.path().trim_start_matches('/').ends_with("_test");
    assert!(
        local && test_database,
        "refusing to reset a database that is not local and suffixed _test"
    );
    value
}

async fn reset_database(database_url: &str) {
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await
        .expect("connect to disposable PostgreSQL");
    query("DROP SCHEMA IF EXISTS public CASCADE")
        .execute(&pool)
        .await
        .expect("drop disposable schema");
    query("CREATE SCHEMA public")
        .execute(&pool)
        .await
        .expect("create disposable schema");
    pool.close().await;
}

fn test_config(database_url: String) -> Config {
    test_config_with_store(database_url, None)
}

fn test_config_with_store(database_url: String, object_store: Option<ObjectStoreConfig>) -> Config {
    Config {
        classroom_test_fixture_enabled: false,
        admin: AdminConfig {
            access_token: Some(ADMIN_TOKEN.to_owned()),
        },
        connectors: ConnectorConfig {
            callback_url: None,
            canary_users: BTreeSet::new(),
            current_encryption_key_version: 1,
            enabled: false,
            encryption_keys: None,
            gmail_client_id: None,
            gmail_client_secret: None,
            max_result_bytes: 512_000,
            max_schema_bytes: 128_000,
            mcp_timeout_ms: 30_000,
            oauth_attempt_ttl_ms: 600_000,
            rollout_percent: 0,
        },
        cost_guard: CostGuardConfig {
            daily_micro_usd: 8_000_000,
            enabled: true,
            mode: CostGuardMode::Enforce,
            monthly_micro_usd: 45_000_000,
            realtime_call_micro_usd: 5_000,
            reservation_ttl_ms: 120_000,
            speech_micro_usd_per_thousand_characters: 60_000,
            task_micro_usd: 5_000_000,
            transcription_micro_usd_per_minute: 6_000,
            warning_percent: 80,
        },
        database_pool_max: 8,
        database_url,
        eleven_labs_api_key: None,
        eleven_labs_model_id: "eleven_multilingual_v2".to_owned(),
        eleven_labs_voice_id: None,
        google_client_id: "http-test.apps.googleusercontent.com".to_owned(),
        knowledge_spaces: KnowledgeConfig { object_store },
        openai_api_key: "test-openai-key".to_owned(),
        openai_models: BTreeSet::from([
            "gpt-5.6-luna".to_owned(),
            "gpt-5.6-terra".to_owned(),
            "gpt-5.6-sol".to_owned(),
        ]),
        port: 0,
        railway_git_commit_sha: "http-compat".to_owned(),
        session_duration_days: 30,
        session_token_hmac_key: HMAC_KEY.to_owned(),
    }
}

async fn send(
    router: &Router,
    method: Method,
    path: &str,
    bearer: Option<&str>,
    body: Option<&Value>,
) -> TestResponse {
    send_with_headers(router, method, path, bearer, body, &[]).await
}

async fn send_with_headers(
    router: &Router,
    method: Method,
    path: &str,
    bearer: Option<&str>,
    body: Option<&Value>,
    headers: &[(&str, &str)],
) -> TestResponse {
    let bytes = body
        .map(serde_json::to_vec)
        .transpose()
        .expect("serialize test request")
        .unwrap_or_default();
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "api.example.test")
        .header("x-forwarded-for", "127.0.0.1");
    if body.is_some() {
        request = request.header("content-type", "application/json");
    }
    if let Some(token) = bearer {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(bytes)).expect("build test request"))
        .await
        .expect("router response");
    let status = response.status();
    let headers = response.headers().clone();
    let body = response
        .into_body()
        .collect()
        .await
        .expect("collect response body")
        .to_bytes()
        .to_vec();
    TestResponse {
        body,
        headers,
        status,
    }
}

#[track_caller]
fn assert_status(response: &TestResponse, expected: StatusCode) {
    assert_eq!(
        response.status,
        expected,
        "unexpected response: {}",
        String::from_utf8_lossy(&response.body)
    );
}

async fn issue_user(state: &AppState, id: &str) -> String {
    state
        .sessions
        .issue(User {
            email: format!("{id}@example.test"),
            id: id.to_owned(),
            name: id.to_owned(),
        })
        .await
        .expect("issue test session")
        .expect("user is not blocked")
        .access_token
}

async fn activate_basic(router: &Router, state: &AppState, user: &str, token: &str) {
    let response = send(
        router,
        Method::POST,
        "/v1/access-code-redemptions/free",
        Some(token),
        None,
    )
    .await;
    assert_status(&response, StatusCode::OK);
    query("UPDATE users SET plan='basic' WHERE id=$1")
        .bind(user)
        .execute(&state.pool)
        .await
        .expect("set integration user plan");
}

fn pcm_wav(duration_ms: u32) -> Vec<u8> {
    let data_size = duration_ms * 32;
    let mut bytes = Vec::with_capacity(44 + data_size as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&16_000_u32.to_le_bytes());
    bytes.extend_from_slice(&32_000_u32.to_le_bytes());
    bytes.extend_from_slice(&2_u16.to_le_bytes());
    bytes.extend_from_slice(&16_u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_size.to_le_bytes());
    bytes.resize(44 + data_size as usize, 0);
    bytes
}

fn local_object_store(bucket: String) -> ObjectStoreConfig {
    let endpoint = std::env::var("TROCODE_TEST_S3_ENDPOINT")
        .expect("TROCODE_TEST_S3_ENDPOINT is required for the ignored upload test");
    let parsed = Url::parse(&endpoint).expect("test S3 endpoint must be a URL");
    assert!(
        matches!(parsed.host_str(), Some("127.0.0.1" | "localhost")),
        "refusing to use a non-local S3 integration endpoint"
    );
    ObjectStoreConfig {
        access_key_id: std::env::var("TROCODE_TEST_S3_ACCESS_KEY_ID")
            .unwrap_or_else(|_| "trocode_test_access".to_owned()),
        bucket,
        endpoint: Some(endpoint),
        force_path_style: true,
        region: std::env::var("TROCODE_TEST_S3_REGION").unwrap_or_else(|_| "us-east-1".to_owned()),
        secret_access_key: std::env::var("TROCODE_TEST_S3_SECRET_ACCESS_KEY")
            .unwrap_or_else(|_| "trocode_test_secret_password".to_owned()),
    }
}

async fn s3_client(config: &ObjectStoreConfig) -> S3Client {
    let credentials = Credentials::new(
        &config.access_key_id,
        &config.secret_access_key,
        None,
        None,
        "trocode-http-upload-test",
    );
    let shared = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new(config.region.clone()))
        .credentials_provider(credentials)
        .load()
        .await;
    let mut builder = aws_sdk_s3::config::Builder::from(&shared).force_path_style(true);
    if let Some(endpoint) = &config.endpoint {
        builder = builder.endpoint_url(endpoint);
    }
    S3Client::from_conf(builder.build())
}

#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn rust_router_preserves_backend_contracts_across_major_route_families() {
    let database_url = disposable_database_url();
    reset_database(&database_url).await;
    let provider = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/json")
                .set_body_json(json!({
                    "id":"resp_http_compat",
                    "model":"gpt-5.6-luna",
                    "output":[{"content":[{"text":"ok","type":"output_text"}],"type":"message"}],
                    "usage":{
                        "input_tokens":100,
                        "input_tokens_details":{"cached_tokens":0},
                        "output_tokens":10,
                        "output_tokens_details":{"reasoning_tokens":0}
                    }
                })),
        )
        .mount(&provider)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/responses/compact"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/json")
                .set_body_json(
                    json!({"output":[{"type":"compaction","encrypted_content":"opaque"}]}),
                ),
        )
        .mount(&provider)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/audio/transcriptions"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/json")
                .set_body_json(json!({"text":"HTTP transcription"})),
        )
        .mount(&provider)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/images/edits"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/json")
                .set_body_json(json!({
                    "data":[{"b64_json":STANDARD.encode([137,80,78,71,13,10,26,10,0,0,0,0])}],
                    "usage":{
                        "input_tokens":12,
                        "input_tokens_details":{"image_tokens":8,"text_tokens":4},
                        "output_tokens":16
                    }
                })),
        )
        .mount(&provider)
        .await;
    let mut state = AppState::compose(test_config(database_url))
        .await
        .expect("compose Rust application");
    state.responses = ResponsesService::new_with_endpoint(
        state.budget.clone(),
        reqwest::Client::new(),
        "test-key",
        &format!("{}/v1/responses", provider.uri()),
    );
    state.transcription = TranscriptionService::new_with_endpoint(
        state.budget.clone(),
        reqwest::Client::new(),
        "test-key",
        &format!("{}/v1/audio/transcriptions", provider.uri()),
    );
    state.companion_images = CompanionImageService::new_with_endpoint(
        state.budget.clone(),
        reqwest::Client::new(),
        "test-key",
        50_000,
        &format!("{}/v1/images/edits", provider.uri()),
    );
    let router = trocode_api::http::router(state.clone());

    let health = send(&router, Method::GET, "/healthz", None, None).await;
    assert_status(&health, StatusCode::OK);
    assert_eq!(health.json()["version"], "http-compat");
    assert_status(
        &send(&router, Method::GET, "/readyz", None, None).await,
        StatusCode::OK,
    );
    let capabilities = send(&router, Method::GET, "/v1/capabilities", None, None).await;
    assert_status(&capabilities, StatusCode::UNAUTHORIZED);
    assert_eq!(capabilities.json()["code"], "authentication_required");
    let asset = send(&router, Method::GET, "/source/admin", None, None).await;
    assert_status(&asset, StatusCode::OK);
    assert!(asset.headers.contains_key("content-security-policy"));
    let admin_html = String::from_utf8_lossy(&asset.body);
    assert!(admin_html.contains("<div id=\"root\"></div>"));
    assert!(admin_html.contains("/source/admin/assets/admin.js"));
    assert!(admin_html.contains("/source/admin/assets/admin.css"));
    let admin_script = send(
        &router,
        Method::GET,
        "/source/admin/assets/admin.js",
        None,
        None,
    )
    .await;
    assert_status(&admin_script, StatusCode::OK);
    assert_eq!(
        admin_script.headers.get("content-type").unwrap(),
        "text/javascript; charset=utf-8"
    );
    assert!(admin_script.body.len() > 100_000);
    assert_status(
        &send_with_headers(
            &router,
            Method::GET,
            "/missing",
            None,
            None,
            &[("origin", "https://attacker.example")],
        )
        .await,
        StatusCode::FORBIDDEN,
    );
    assert_status(
        &send(&router, Method::GET, "/missing", None, None).await,
        StatusCode::NOT_FOUND,
    );

    let owner_token = issue_user(&state, "http-owner").await;
    let participant_token = issue_user(&state, "http-participant").await;
    let facilitator_token = issue_user(&state, "http-facilitator").await;
    let capabilities = send(
        &router,
        Method::GET,
        "/v1/capabilities",
        Some(&owner_token),
        None,
    )
    .await;
    assert_status(&capabilities, StatusCode::OK);
    assert_eq!(capabilities.json()["knowledgeSpaces"]["enabled"], true);
    assert_eq!(capabilities.json()["knowledgeSpaces"]["contractVersion"], 2);
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/auth/google/exchange",
            None,
            Some(&json!({"idToken":"not-a-jwt"})),
        )
        .await,
        StatusCode::UNAUTHORIZED,
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            "/v1/access-code-redemptions/me",
            None,
            None,
        )
        .await,
        StatusCode::UNAUTHORIZED,
    );
    let pending = send(
        &router,
        Method::GET,
        "/v1/access-code-redemptions/me",
        Some(&owner_token),
        None,
    )
    .await;
    assert_status(&pending, StatusCode::OK);
    assert_eq!(pending.json()["state"], "inactive");
    activate_basic(&router, &state, "http-owner", &owner_token).await;
    activate_basic(&router, &state, "http-participant", &participant_token).await;
    activate_basic(&router, &state, "http-facilitator", &facilitator_token).await;

    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/admin/session",
            Some("incorrect-admin-token"),
            None,
        )
        .await,
        StatusCode::UNAUTHORIZED,
    );
    let admin_session = send(
        &router,
        Method::POST,
        "/v1/admin/session",
        Some(ADMIN_TOKEN),
        None,
    )
    .await;
    assert_status(&admin_session, StatusCode::NO_CONTENT);
    assert!(admin_session.headers.contains_key("set-cookie"));
    for (user, role) in [
        ("http-owner", "teacher"),
        ("http-participant", "student"),
        ("http-facilitator", "teacher"),
    ] {
        let assigned = send(
            &router,
            Method::PATCH,
            &format!("/v1/admin/users/{user}/classroom-role"),
            Some(ADMIN_TOKEN),
            Some(&json!({"role":role})),
        )
        .await;
        assert_status(&assigned, StatusCode::OK);
        assert_eq!(assigned.json()["classroomRole"], role);
    }
    let admin_users = send(
        &router,
        Method::GET,
        "/v1/admin/users?status=active&classroomRole=teacher&limit=10",
        Some(ADMIN_TOKEN),
        None,
    )
    .await;
    assert_status(&admin_users, StatusCode::OK);
    assert!(
        admin_users.json()["items"]
            .as_array()
            .expect("admin users")
            .iter()
            .all(|user| user["knowledgeSpacesEnabled"] == true)
    );

    let disabled_knowledge = send(
        &router,
        Method::PATCH,
        "/v1/admin/users/http-participant/knowledge-spaces",
        Some(ADMIN_TOKEN),
        Some(&json!({"enabled":false})),
    )
    .await;
    assert_status(&disabled_knowledge, StatusCode::OK);
    assert_eq!(disabled_knowledge.json()["knowledgeSpacesEnabled"], false);
    let disabled_capabilities = send(
        &router,
        Method::GET,
        "/v1/capabilities",
        Some(&participant_token),
        None,
    )
    .await;
    assert_status(&disabled_capabilities, StatusCode::OK);
    assert_eq!(
        disabled_capabilities.json()["knowledgeSpaces"]["enabled"],
        false
    );
    let disabled_spaces = send(
        &router,
        Method::GET,
        "/v1/spaces",
        Some(&participant_token),
        None,
    )
    .await;
    assert_status(&disabled_spaces, StatusCode::FORBIDDEN);
    assert_eq!(disabled_spaces.json()["code"], "knowledge_spaces_disabled");
    let enabled_knowledge = send(
        &router,
        Method::PATCH,
        "/v1/admin/users/http-participant/knowledge-spaces",
        Some(ADMIN_TOKEN),
        Some(&json!({"enabled":true})),
    )
    .await;
    assert_status(&enabled_knowledge, StatusCode::OK);
    assert_eq!(enabled_knowledge.json()["knowledgeSpacesEnabled"], true);
    let companion_quota = send(
        &router,
        Method::GET,
        "/v1/companion-images/quota",
        Some(&owner_token),
        None,
    )
    .await;
    assert_status(&companion_quota, StatusCode::OK);
    assert_eq!(companion_quota.json()["state"], "available");
    assert_eq!(companion_quota.json()["quota"]["remaining"], 5);
    let participant_quota = send(
        &router,
        Method::GET,
        "/v1/companion-images/quota",
        Some(&participant_token),
        None,
    )
    .await;
    assert_status(&participant_quota, StatusCode::OK);
    assert_eq!(participant_quota.json()["state"], "available");
    let companion_request_id = Uuid::new_v4().to_string();
    let companion = send_with_headers(
        &router,
        Method::POST,
        "/v1/openai/images/companion-edits",
        Some(&participant_token),
        Some(&json!({
            "imageBase64": STANDARD.encode([137,80,78,71,13,10,26,10,0,0,0,0]),
            "mimeType": "image/png",
            "prompt": "blue space cat"
        })),
        &[("x-trocode-request-id", &companion_request_id)],
    )
    .await;
    assert_status(&companion, StatusCode::OK);
    assert_eq!(companion.json()["model"], "gpt-image-2-2026-04-21");
    assert_eq!(companion.json()["quota"]["remaining"], 4);
    assert_status(
        &send(
            &router,
            Method::GET,
            "/v1/admin/usage?range=7d&lane=all",
            Some(ADMIN_TOKEN),
            None,
        )
        .await,
        StatusCode::OK,
    );
    let created_codes = send(
        &router,
        Method::POST,
        "/v1/admin/access-codes/bulk",
        Some(ADMIN_TOKEN),
        Some(&json!({
            "count":2,
            "distributionMode":"shared",
            "label":"HTTP parity",
            "maxUsers":2,
            "plan":"basic"
        })),
    )
    .await;
    assert_status(&created_codes, StatusCode::CREATED);
    let created_codes = created_codes.json();
    let granted_code = created_codes["items"][0]["id"]
        .as_str()
        .expect("granted access-code id");
    let granted_plain_code = created_codes["items"][0]["code"]
        .as_str()
        .expect("granted access-code plaintext");
    let unused_code = created_codes["items"][1]["id"]
        .as_str()
        .expect("unused access-code id");
    assert_status(
        &send(
            &router,
            Method::PATCH,
            &format!("/v1/admin/access-codes/{granted_code}"),
            Some(ADMIN_TOKEN),
            Some(&json!({"paused":true})),
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::PATCH,
            &format!("/v1/admin/access-codes/{granted_code}"),
            Some(ADMIN_TOKEN),
            Some(&json!({"paused":false})),
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/admin/users/http-participant/access-code",
            Some(ADMIN_TOKEN),
            Some(&json!({"accessCodeId":granted_code})),
        )
        .await,
        StatusCode::CREATED,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/access-code-redemptions",
            Some(&owner_token),
            Some(&json!({"code":granted_plain_code})),
        )
        .await,
        StatusCode::CREATED,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/access-code-redemptions",
            Some(&owner_token),
            Some(&json!({"code":granted_plain_code})),
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            &format!("/v1/admin/access-codes/{granted_code}/users"),
            Some(ADMIN_TOKEN),
            None,
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::DELETE,
            &format!("/v1/admin/access-codes/{unused_code}"),
            Some(ADMIN_TOKEN),
            None,
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            "/v1/admin/access-codes?limit=10",
            Some(ADMIN_TOKEN),
            None,
        )
        .await,
        StatusCode::OK,
    );

    let organization_codes = send(
        &router,
        Method::POST,
        "/v1/admin/access-codes/bulk",
        Some(ADMIN_TOKEN),
        Some(&json!({
            "count":1,
            "distributionMode":"organization",
            "label":"HTTP organization",
            "maxUsers":2,
            "plan":"pro"
        })),
    )
    .await;
    assert_status(&organization_codes, StatusCode::CREATED);
    let organization_code = organization_codes.json();
    let organization_code_id = organization_code["items"][0]["id"]
        .as_str()
        .expect("organization access-code id")
        .to_owned();
    let organization_plaintext = organization_code["items"][0]["code"]
        .as_str()
        .expect("organization access-code plaintext")
        .to_owned();
    let organizer_token = issue_user(&state, "http-organizer").await;
    let organizer_claim = send(
        &router,
        Method::POST,
        "/v1/access-code-redemptions",
        Some(&organizer_token),
        Some(&json!({"code":organization_plaintext})),
    )
    .await;
    assert_status(&organizer_claim, StatusCode::CREATED);
    assert_eq!(organizer_claim.json()["usedUsers"], 1);

    let renamed_organization = send(
        &router,
        Method::PATCH,
        "/v1/organizations/me",
        Some(&organizer_token),
        Some(&json!({"name":"  Greenfield School  "})),
    )
    .await;
    assert_status(&renamed_organization, StatusCode::OK);
    assert_eq!(
        renamed_organization.json()["organization"]["name"],
        "Greenfield School"
    );
    let current_organization = send(
        &router,
        Method::GET,
        "/v1/organizations/me",
        Some(&organizer_token),
        None,
    )
    .await;
    assert_status(&current_organization, StatusCode::OK);
    assert_eq!(
        current_organization.json()["organization"]["name"],
        "Greenfield School"
    );
    for invalid_profile in [
        json!({"name":"   "}),
        json!({"name":"School","id":"forbidden"}),
    ] {
        let invalid_update = send(
            &router,
            Method::PATCH,
            "/v1/organizations/me",
            Some(&organizer_token),
            Some(&invalid_profile),
        )
        .await;
        assert_status(&invalid_update, StatusCode::BAD_REQUEST);
        assert_eq!(invalid_update.json()["code"], "invalid_request");
    }

    let outsider_token = issue_user(&state, "http-outsider").await;
    let forwarded_claim = send(
        &router,
        Method::POST,
        "/v1/access-code-redemptions",
        Some(&outsider_token),
        Some(&json!({"code":organization_plaintext})),
    )
    .await;
    assert_status(&forwarded_claim, StatusCode::CONFLICT);
    assert_eq!(forwarded_claim.json()["code"], "organization_managed_code");

    let reserved = send(
        &router,
        Method::POST,
        "/v1/organizations/me/members",
        Some(&organizer_token),
        Some(&json!({"email":"HTTP-INVITED@example.test"})),
    )
    .await;
    assert_status(&reserved, StatusCode::CREATED);
    let reserved_id = reserved.json()["member"]["id"]
        .as_str()
        .expect("reserved membership id")
        .to_owned();
    assert_eq!(reserved.json()["organization"]["capacity"]["state"], "full");
    let full = send(
        &router,
        Method::POST,
        "/v1/organizations/me/members",
        Some(&organizer_token),
        Some(&json!({"email":"another@example.test"})),
    )
    .await;
    assert_status(&full, StatusCode::CONFLICT);
    assert_eq!(full.json()["code"], "organization_capacity_reached");
    assert_status(
        &send(
            &router,
            Method::PATCH,
            &format!("/v1/admin/access-codes/{organization_code_id}"),
            Some(ADMIN_TOKEN),
            Some(&json!({"paused":true})),
        )
        .await,
        StatusCode::OK,
    );
    let invited_token = issue_user(&state, "http-invited").await;
    let invited_access = send(
        &router,
        Method::GET,
        "/v1/access-code-redemptions/me",
        Some(&invited_token),
        None,
    )
    .await;
    assert_status(&invited_access, StatusCode::OK);
    assert_eq!(invited_access.json()["state"], "active");
    assert_eq!(invited_access.json()["plan"], "pro");
    let invited_organization = send(
        &router,
        Method::GET,
        "/v1/organizations/me",
        Some(&invited_token),
        None,
    )
    .await;
    assert_status(&invited_organization, StatusCode::OK);
    assert_eq!(
        invited_organization.json()["organization"]["role"],
        "member"
    );
    assert_eq!(
        invited_organization.json()["organization"]["name"],
        "Greenfield School"
    );
    let member_update = send(
        &router,
        Method::PATCH,
        "/v1/organizations/me",
        Some(&invited_token),
        Some(&json!({"name":"Member rename"})),
    )
    .await;
    assert_status(&member_update, StatusCode::FORBIDDEN);
    assert_eq!(
        member_update.json()["code"],
        "organization_organizer_required"
    );
    let member_roster = send(
        &router,
        Method::GET,
        "/v1/organizations/me/members",
        Some(&invited_token),
        None,
    )
    .await;
    assert_status(&member_roster, StatusCode::FORBIDDEN);
    let active_removal = send(
        &router,
        Method::DELETE,
        &format!("/v1/organizations/me/members/{reserved_id}"),
        Some(&organizer_token),
        None,
    )
    .await;
    assert_status(&active_removal, StatusCode::CONFLICT);
    assert_eq!(active_removal.json()["code"], "organization_member_active");

    let space_client_id = Uuid::new_v4();
    let space_body = json!({
        "clientId":space_client_id,
        "description":"Disposable integration space",
        "name":"HTTP compatibility",
        "purposeLabel":"migration"
    });
    let space = send(
        &router,
        Method::POST,
        "/v1/spaces",
        Some(&owner_token),
        Some(&space_body),
    )
    .await;
    assert_status(&space, StatusCode::CREATED);
    let space_id = space.json()["space"]["id"]
        .as_str()
        .expect("space id")
        .to_owned();
    for index in 0..2 {
        let extra_space = send(
            &router,
            Method::POST,
            "/v1/spaces",
            Some(&owner_token),
            Some(&json!({
                "clientId":Uuid::new_v4(),
                "name":format!("Quota filler {index}")
            })),
        )
        .await;
        assert_status(&extra_space, StatusCode::CREATED);
    }
    let replayed_space = send(
        &router,
        Method::POST,
        "/v1/spaces",
        Some(&owner_token),
        Some(&space_body),
    )
    .await;
    assert_status(&replayed_space, StatusCode::OK);
    assert_eq!(replayed_space.json()["space"]["id"], space_id);
    for path in [
        "/v1/spaces".to_owned(),
        format!("/v1/spaces/{space_id}"),
        format!("/v1/spaces/{space_id}/sources"),
        format!("/v1/spaces/{space_id}/groups"),
        format!("/v1/spaces/{space_id}/members"),
    ] {
        assert_status(
            &send(&router, Method::GET, &path, Some(&owner_token), None).await,
            StatusCode::OK,
        );
    }
    let spaces = send(&router, Method::GET, "/v1/spaces", Some(&owner_token), None).await;
    assert_eq!(spaces.json()["classroomRole"], "teacher");
    assert_eq!(spaces.json()["nextCursor"], Value::Null);
    let participant_batch_id = Uuid::new_v4();
    let added_participant = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/members/bulk"),
        Some(&owner_token),
        Some(&json!({
            "clientId":participant_batch_id,
            "emails":[
                "HTTP-PARTICIPANT@example.test",
                "http-owner@example.test",
                "missing@example.test"
            ],
            "role":"participant"
        })),
    )
    .await;
    assert_status(&added_participant, StatusCode::OK);
    let added_participant_body = added_participant.json();
    assert_eq!(
        added_participant_body["addedEmails"],
        json!(["http-participant@example.test"]),
        "unexpected roster result: {added_participant_body}"
    );
    assert_eq!(
        added_participant_body["alreadyMemberEmails"],
        json!(["http-owner@example.test"]),
        "unexpected roster result: {added_participant_body}"
    );
    assert_eq!(
        added_participant_body["roleMismatchEmails"],
        json!([]),
        "unexpected roster result: {added_participant_body}"
    );
    assert_eq!(
        added_participant_body["unavailableEmails"],
        json!(["missing@example.test"]),
        "unexpected roster result: {added_participant_body}"
    );
    let replayed_batch = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/members/bulk"),
        Some(&owner_token),
        Some(&json!({
            "clientId":participant_batch_id,
            "emails":["different@example.test"],
            "role":"participant"
        })),
    )
    .await;
    assert_status(&replayed_batch, StatusCode::OK);
    assert_eq!(replayed_batch.json(), added_participant_body);
    let added_facilitator = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/members/bulk"),
        Some(&owner_token),
        Some(&json!({
            "clientId":Uuid::new_v4(),
            "emails":[
                "http-facilitator@example.test",
                "http-participant@example.test"
            ],
            "role":"facilitator"
        })),
    )
    .await;
    assert_status(&added_facilitator, StatusCode::OK);
    assert_eq!(
        added_facilitator.json()["addedEmails"],
        json!(["http-facilitator@example.test"])
    );
    assert_eq!(
        added_facilitator.json()["roleMismatchEmails"],
        json!(["http-participant@example.test"])
    );
    let facilitator_cannot_add_teacher = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/members/bulk"),
        Some(&facilitator_token),
        Some(&json!({
            "clientId":Uuid::new_v4(),
            "emails":["http-owner@example.test"],
            "role":"facilitator"
        })),
    )
    .await;
    assert_status(&facilitator_cannot_add_teacher, StatusCode::FORBIDDEN);
    let owner_role_in_use = send(
        &router,
        Method::PATCH,
        "/v1/admin/users/http-owner/classroom-role",
        Some(ADMIN_TOKEN),
        Some(&json!({"role":"student"})),
    )
    .await;
    assert_status(&owner_role_in_use, StatusCode::CONFLICT);
    let group = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/groups"),
        Some(&owner_token),
        Some(&json!({"clientId":Uuid::new_v4(),"name":"Participants"})),
    )
    .await;
    assert_status(&group, StatusCode::CREATED);
    let group_id = group.json()["id"].as_str().expect("group id").to_owned();
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/spaces/{space_id}/invites"),
            Some(&owner_token),
            Some(&json!({
                "clientId":Uuid::new_v4(),
                "groupId":Uuid::new_v4(),
                "maxUses":1,
                "role":"participant"
            })),
        )
        .await,
        StatusCode::NOT_FOUND,
    );
    let invite_client_id = Uuid::new_v4();
    let invite_body = json!({
        "clientId":invite_client_id,
        "groupId":group_id,
        "maxUses":2,
        "role":"participant"
    });
    let invite = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/invites"),
        Some(&owner_token),
        Some(&invite_body),
    )
    .await;
    assert_status(&invite, StatusCode::CREATED);
    let replayed_invite = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/invites"),
        Some(&owner_token),
        Some(&invite_body),
    )
    .await;
    assert_status(&replayed_invite, StatusCode::CREATED);
    assert_eq!(replayed_invite.json()["id"], invite.json()["id"]);
    assert_eq!(replayed_invite.json()["code"], invite.json()["code"]);
    let invite_code = replayed_invite.json()["code"]
        .as_str()
        .expect("invite code")
        .to_owned();
    let redeemed = send(
        &router,
        Method::POST,
        "/v1/space-invites/redeem",
        Some(&participant_token),
        Some(&json!({"code":&invite_code})),
    )
    .await;
    assert_status(&redeemed, StatusCode::OK);
    assert_eq!(redeemed.json()["role"], "participant");
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/space-invites/redeem",
            Some(&participant_token),
            Some(&json!({"code":&invite_code})),
        )
        .await,
        StatusCode::OK,
    );

    let activity = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/activities"),
        Some(&owner_token),
        Some(&json!({
            "clientId":Uuid::new_v4(),
            "definition":{
                "instructions":"Exercise the Rust backend contract.",
                "launchTarget":"none",
                "objective":"Prove the hosted backend contract remains compatible.",
                "sessionPolicy":{
                    "allowRoomJoin":true,
                    "allowedOrigins":["https://class.example"]
                },
                "title":"Migration parity",
                "criteria":[{
                    "id":"rust-router",
                    "title":"Rust router remains compatible",
                    "tags":["integration"]
                }]
            },
            "sourceVersionIds":[]
        })),
    )
    .await;
    assert_status(&activity, StatusCode::CREATED);
    let activity_id = activity.json()["id"]
        .as_str()
        .expect("activity id")
        .to_owned();
    let published = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/activities/{activity_id}/publish"),
        Some(&owner_token),
        Some(&json!({"clientId":Uuid::new_v4()})),
    )
    .await;
    assert_status(&published, StatusCode::CREATED);
    let version_id = published.json()["id"]
        .as_str()
        .expect("activity version id")
        .to_owned();
    let room_run = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/runs"),
        Some(&owner_token),
        Some(&json!({
            "activityVersionId":version_id,
            "clientId":Uuid::new_v4(),
            "insightPolicy":"explicit_and_operational",
            "mode":"live",
            "target":{"kind":"room"}
        })),
    )
    .await;
    assert_status(&room_run, StatusCode::CREATED);
    let room_run_id = room_run.json()["id"]
        .as_str()
        .expect("room run id")
        .to_owned();
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/spaces/{space_id}/runs/{room_run_id}/room-code"),
            Some(&owner_token),
            Some(&json!({"clientId":Uuid::new_v4(),"expiresAt":null,"maxUses":200})),
        )
        .await,
        StatusCode::CREATED,
    );
    let run_client_id = Uuid::new_v4();
    let run_body = json!({
        "activityVersionId":version_id,
        "clientId":run_client_id,
        "insightPolicy":"explicit_and_operational",
        "mode":"live",
        "target":{"kind":"participants","userIds":["http-participant"]}
    });
    let run = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/runs"),
        Some(&owner_token),
        Some(&run_body),
    )
    .await;
    assert_status(&run, StatusCode::CREATED);
    let run_id = run.json()["id"].as_str().expect("run id").to_owned();
    for _ in 0..4 {
        query("INSERT INTO knowledge_activity_runs(client_id,space_id,activity_version_id,mode,target_kind,insight_policy,created_by)VALUES($1,$2,$3,'live','participants','explicit_and_operational','http-owner')")
            .bind(Uuid::new_v4())
            .bind(Uuid::parse_str(&space_id).expect("space UUID"))
            .bind(Uuid::parse_str(&version_id).expect("version UUID"))
            .execute(&state.pool)
            .await
            .expect("fill active run quota");
    }
    let repeated_run = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/runs"),
        Some(&owner_token),
        Some(&run_body),
    )
    .await;
    assert_status(&repeated_run, StatusCode::OK);
    assert_eq!(repeated_run.json()["id"], run_id);
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/spaces/{space_id}/runs/{run_id}/open"),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::OK,
    );
    let assignments = send(
        &router,
        Method::GET,
        "/v1/assignments/me",
        Some(&participant_token),
        None,
    )
    .await;
    assert_status(&assignments, StatusCode::OK);
    assert_eq!(
        assignments.json()["items"][0]["activity"]["title"],
        "Migration parity"
    );
    let attempt_id = assignments.json()["items"][0]["attemptId"]
        .as_str()
        .expect("attempt id")
        .to_owned();
    let attempt_context = send(
        &router,
        Method::GET,
        &format!("/v1/attempts/{attempt_id}"),
        Some(&participant_token),
        None,
    )
    .await;
    assert_status(&attempt_context, StatusCode::OK);
    assert_eq!(attempt_context.json()["attemptId"], attempt_id);
    assert_eq!(attempt_context.json()["priorProgress"]["sessionCount"], 0);
    let starter_files = send(
        &router,
        Method::GET,
        &format!("/v1/attempts/{attempt_id}/starter-files"),
        Some(&participant_token),
        None,
    )
    .await;
    assert_status(&starter_files, StatusCode::OK);
    assert_eq!(starter_files.json()["files"], json!([]));
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/attempts/{attempt_id}/acknowledge"),
            Some(&participant_token),
            Some(&json!({"policyVersion":"1"})),
        )
        .await,
        StatusCode::OK,
    );
    let task_id = Uuid::new_v4();
    let work_client_id = Uuid::new_v4();
    let work = send(
        &router,
        Method::POST,
        &format!("/v1/attempts/{attempt_id}/work-sessions"),
        Some(&participant_token),
        Some(&json!({
            "clientId":work_client_id,
            "launchKind":"none",
            "taskId":task_id
        })),
    )
    .await;
    assert_status(&work, StatusCode::CREATED);
    let work_id = work.json()["id"]
        .as_str()
        .expect("work session id")
        .to_owned();
    let repeated_work = send(
        &router,
        Method::POST,
        &format!("/v1/attempts/{attempt_id}/work-sessions"),
        Some(&participant_token),
        Some(&json!({
            "clientId":work_client_id,
            "launchKind":"none",
            "taskId":Uuid::new_v4()
        })),
    )
    .await;
    assert_status(&repeated_work, StatusCode::CREATED);
    assert_eq!(repeated_work.json()["id"], work_id);
    assert_status(
        &send(
            &router,
            Method::PATCH,
            &format!("/v1/work-sessions/{work_id}"),
            Some(&participant_token),
            Some(&json!({"helpRequested":false,"hintLevel":1,"state":"active"})),
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::PATCH,
            &format!("/v1/work-sessions/{work_id}"),
            Some(&participant_token),
            Some(&json!({"helpRequested":"false","state":"active"})),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/attempts/{attempt_id}/evidence"),
            Some(&participant_token),
            Some(&json!({
                "clientId":Uuid::new_v4(),
                "criterionId":"rust-router",
                "provenance":"participant",
                "resultCode":"passed",
                "tag":"integration",
                "workSessionId":work_id
            })),
        )
        .await,
        StatusCode::CREATED,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/attempts/{attempt_id}/evidence"),
            Some(&participant_token),
            Some(&json!({
                "clientId":Uuid::new_v4(),
                "criterionId":"rust-router",
                "provenance":"participant",
                "resultCode":"passed",
                "tag":"not-allowed",
                "workSessionId":work_id
            })),
        )
        .await,
        StatusCode::FORBIDDEN,
    );
    let search = send(
        &router,
        Method::POST,
        &format!("/v1/attempts/{attempt_id}/knowledge/search"),
        Some(&participant_token),
        Some(&json!({"limit":6,"query":"Rust migration"})),
    )
    .await;
    assert_status(&search, StatusCode::OK);
    assert_eq!(search.json()["results"], json!([]));
    let help_client_id = Uuid::new_v4();
    for _ in 0..2 {
        assert_status(
            &send(
                &router,
                Method::POST,
                &format!("/v1/attempts/{attempt_id}/help"),
                Some(&participant_token),
                Some(&json!({"clientId":help_client_id})),
            )
            .await,
            StatusCode::OK,
        );
    }
    let dashboard = send(
        &router,
        Method::GET,
        &format!("/v1/spaces/{space_id}/runs/{run_id}/dashboard"),
        Some(&owner_token),
        None,
    )
    .await;
    assert_status(&dashboard, StatusCode::OK);
    assert_eq!(dashboard.json()["counts"]["blocked"], 1);
    assert_eq!(
        dashboard.json()["criterionEvidence"][0]["criterionId"],
        "rust-router"
    );
    assert_eq!(dashboard.json()["helpQueue"][0]["attemptId"], attempt_id);
    let delta = send(
        &router,
        Method::GET,
        &format!("/v1/spaces/{space_id}/runs/{run_id}/dashboard?sinceSequence=0"),
        Some(&owner_token),
        None,
    )
    .await;
    assert_status(&delta, StatusCode::OK);
    let delta_json = delta.json();
    let event_types: Vec<_> = delta_json["events"]
        .as_array()
        .expect("delta events")
        .iter()
        .filter_map(|event| event["type"].as_str().map(ToOwned::to_owned))
        .collect();
    assert_eq!(
        event_types
            .iter()
            .filter(|kind| **kind == "work_session_created")
            .count(),
        1
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            &format!("/v1/spaces/{space_id}/runs/{run_id}/dashboard?sinceSequence=0.0"),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            &format!(
                "/v1/spaces/{space_id}/runs/{run_id}/dashboard?sinceSequence=9007199254740992"
            ),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_eq!(
        event_types
            .iter()
            .filter(|kind| **kind == "help_requested")
            .count(),
        1
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/spaces/{space_id}/runs/{run_id}/close"),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/spaces/{space_id}/runs/{run_id}/open"),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::CONFLICT,
    );

    let client_turn_id = Uuid::new_v4();
    let agent_turn = json!({"clientTurnId":client_turn_id,"taskId":task_id});
    let created_turn = send(
        &router,
        Method::POST,
        "/v1/agent-turns",
        Some(&owner_token),
        Some(&agent_turn),
    )
    .await;
    assert_status(&created_turn, StatusCode::CREATED);
    let agent_turn_id = created_turn.json()["id"]
        .as_str()
        .expect("agent turn id")
        .to_owned();
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/agent-turns",
            Some(&owner_token),
            Some(&agent_turn),
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/agent-turns",
            Some(&owner_token),
            Some(&json!({"clientTurnId":client_turn_id,"taskId":Uuid::new_v4()})),
        )
        .await,
        StatusCode::CONFLICT,
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            &format!("/v1/usage/budget?taskId={task_id}"),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/openai/responses",
            Some(&owner_token),
            Some(&json!({"model":"not-allowed"})),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    let provider_request_id = Uuid::new_v4().to_string();
    let task_id_header = task_id.to_string();
    let response_body = json!({
        "input":[{"content":[{"text":"hello","type":"input_text"}],"role":"user"}],
        "max_output_tokens":128,
        "model":"gpt-5.6-luna",
        "parallel_tool_calls":false,
        "store":false,
        "tools":[]
    });
    let responses = send_with_headers(
        &router,
        Method::POST,
        "/v1/openai/responses",
        Some(&owner_token),
        Some(&response_body),
        &[
            ("x-trocode-agent-turn-id", &agent_turn_id),
            ("x-trocode-request-id", &provider_request_id),
            ("x-trocode-task-id", &task_id_header),
        ],
    )
    .await;
    assert_status(&responses, StatusCode::OK);
    assert_eq!(responses.headers["x-trocode-usage-source"], "actual");
    let compact_request_id = Uuid::new_v4().to_string();
    let compact = send_with_headers(
        &router,
        Method::POST,
        "/v1/openai/responses/compact",
        Some(&owner_token),
        Some(&json!({
            "input":[{"content":[{"text":"older context","type":"input_text"}],"role":"user"}],
            "model":"gpt-5.6-luna"
        })),
        &[
            ("x-trocode-agent-turn-id", &agent_turn_id),
            ("x-trocode-request-id", &compact_request_id),
            ("x-trocode-task-id", &task_id_header),
        ],
    )
    .await;
    assert_status(&compact, StatusCode::OK);

    // Saturate this and the next minute so crossing a window cannot flake the test.
    query(
        "INSERT INTO api_rate_limit_buckets(scope,identity_digest,window_started_at,request_count) \
         SELECT DISTINCT scope,identity_digest,date_trunc('minute',NOW())+offset_seconds*INTERVAL '1 second',10000 \
         FROM api_rate_limit_buckets CROSS JOIN (VALUES (0),(60)) AS windows(offset_seconds) \
         WHERE scope='responses.minute' \
         ON CONFLICT(scope,identity_digest,window_started_at) DO UPDATE SET request_count=10000",
    )
    .execute(&state.pool)
    .await
    .unwrap();
    let provider_calls_before_limit = provider.received_requests().await.unwrap().len();
    let rejected_request_id = Uuid::new_v4();
    let limited = send_with_headers(
        &router,
        Method::POST,
        "/v1/openai/responses",
        Some(&owner_token),
        Some(&response_body),
        &[
            ("x-trocode-agent-turn-id", &agent_turn_id),
            ("x-trocode-request-id", &rejected_request_id.to_string()),
            ("x-trocode-task-id", &task_id_header),
        ],
    )
    .await;
    assert_status(&limited, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limited.json()["code"], "rate_limited");
    assert_eq!(limited.json()["retryable"], true);
    assert!(
        limited.headers["retry-after"]
            .to_str()
            .unwrap()
            .parse::<u64>()
            .unwrap()
            > 0
    );
    assert_eq!(
        provider.received_requests().await.unwrap().len(),
        provider_calls_before_limit
    );
    let rejected_reservations: i64 =
        query_scalar("SELECT COUNT(*) FROM model_budget_reservations WHERE request_id=$1")
            .bind(rejected_request_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
    assert_eq!(rejected_reservations, 0);
    query("DELETE FROM api_rate_limit_buckets WHERE scope='responses.minute'")
        .execute(&state.pool)
        .await
        .unwrap();
    let retried = send_with_headers(
        &router,
        Method::POST,
        "/v1/openai/responses",
        Some(&owner_token),
        Some(&response_body),
        &[
            ("x-trocode-agent-turn-id", &agent_turn_id),
            ("x-trocode-request-id", &Uuid::new_v4().to_string()),
            ("x-trocode-task-id", &task_id_header),
        ],
    )
    .await;
    assert_status(&retried, StatusCode::OK);
    assert_eq!(
        provider.received_requests().await.unwrap().len(),
        provider_calls_before_limit + 1
    );

    let transcription_request_id = Uuid::new_v4().to_string();
    let transcription = send_with_headers(
        &router,
        Method::POST,
        "/v1/openai/audio/transcriptions",
        Some(&owner_token),
        Some(&json!({
            "audioBase64":STANDARD.encode(pcm_wav(320)),
            "clientDurationMs":320,
            "language":"en",
            "utteranceId":Uuid::new_v4()
        })),
        &[
            ("x-trocode-request-id", &transcription_request_id),
            ("x-trocode-transcription-contract", "2"),
        ],
    )
    .await;
    assert_status(&transcription, StatusCode::OK);
    assert_eq!(transcription.json()["text"], "HTTP transcription");
    let invalid_language_request_id = Uuid::new_v4().to_string();
    assert_status(
        &send_with_headers(
            &router,
            Method::POST,
            "/v1/openai/audio/transcriptions",
            Some(&owner_token),
            Some(&json!({
                "audioBase64":STANDARD.encode(pcm_wav(320)),
                "clientDurationMs":320,
                "language":"xx",
                "utteranceId":Uuid::new_v4()
            })),
            &[("x-trocode-request-id", &invalid_language_request_id)],
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/openai/audio/transcriptions",
            Some(&owner_token),
            Some(&json!({"audio":"invalid"})),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/openai/realtime/calls",
            Some(&owner_token),
            Some(&json!({"language":"xx","offerSdp":"invalid"})),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/elevenlabs/speech",
            Some(&owner_token),
            Some(&json!({"text":"hello"})),
        )
        .await,
        StatusCode::SERVICE_UNAVAILABLE,
    );

    for removed_path in [
        "/v1/agent-runtime/v5/status",
        "/v1/agent-runtime/v5/tasks",
        "/v1/desktop-worker/connect",
    ] {
        assert_status(
            &send(&router, Method::GET, removed_path, Some(&owner_token), None).await,
            StatusCode::NOT_FOUND,
        );
    }
    assert_status(
        &send(
            &router,
            Method::GET,
            "/v1/legacy-agent-history",
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::OK,
    );
    let refreshed = send(
        &router,
        Method::POST,
        "/v1/auth/session/refresh",
        Some(&owner_token),
        None,
    )
    .await;
    assert_status(&refreshed, StatusCode::OK);
    let refreshed_token = refreshed.json()["accessToken"]
        .as_str()
        .expect("refreshed token")
        .to_owned();
    assert_status(
        &send(
            &router,
            Method::GET,
            "/v1/access-code-redemptions/me",
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::UNAUTHORIZED,
    );
    assert_status(
        &send(
            &router,
            Method::DELETE,
            "/v1/auth/session",
            Some(&refreshed_token),
            None,
        )
        .await,
        StatusCode::NO_CONTENT,
    );

    assert_status(
        &send(
            &router,
            Method::PATCH,
            "/v1/admin/users/http-participant/access",
            Some(ADMIN_TOKEN),
            Some(&json!({"blocked":true})),
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            "/v1/access-code-redemptions/me",
            Some(&participant_token),
            None,
        )
        .await,
        StatusCode::UNAUTHORIZED,
    );
    assert_status(
        &send(
            &router,
            Method::PATCH,
            "/v1/admin/users/http-participant/access",
            Some(ADMIN_TOKEN),
            Some(&json!({"blocked":false})),
        )
        .await,
        StatusCode::OK,
    );

    state.shutdown.cancel();
    state.pool.close().await;
}

#[tokio::test]
#[ignore = "requires disposable local PostgreSQL and S3-compatible integration services"]
async fn rust_upload_routes_preserve_integrity_idempotency_and_worker_handoff() {
    let database_url = disposable_database_url();
    reset_database(&database_url).await;
    let bucket = format!("trocode-http-{}", Uuid::new_v4().simple());
    let object_store = local_object_store(bucket.clone());
    let s3 = s3_client(&object_store).await;
    s3.create_bucket()
        .bucket(&bucket)
        .send()
        .await
        .expect("create disposable HTTP upload bucket");
    let state = AppState::compose(test_config_with_store(database_url, Some(object_store)))
        .await
        .expect("compose upload application");
    let router = trocode_api::http::router(state.clone());
    let token = issue_user(&state, "http-upload-owner").await;
    activate_basic(&router, &state, "http-upload-owner", &token).await;
    let space = send(
        &router,
        Method::POST,
        "/v1/spaces",
        Some(&token),
        Some(&json!({
            "clientId":Uuid::new_v4(),
            "description":"Upload integration",
            "name":"Upload compatibility",
            "purposeLabel":"migration"
        })),
    )
    .await;
    assert_status(&space, StatusCode::CREATED);
    let space_id = space.json()["space"]["id"]
        .as_str()
        .expect("upload space id")
        .to_owned();
    let bytes = b"Searchable Rust upload route integration content.".to_vec();
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let client_id = Uuid::new_v4();
    let file = json!({
        "byteSize":bytes.len(),
        "clientId":client_id,
        "displayName":"integration.txt",
        "mediaType":"text/plain",
        "relativePath":"fixtures/integration.txt",
        "role":"reference",
        "sha256":sha256
    });
    let initiated = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/uploads/initiate"),
        Some(&token),
        Some(&json!({"files":[file.clone()]})),
    )
    .await;
    assert_status(&initiated, StatusCode::CREATED);
    let initiated = initiated.json();
    let version_id = initiated["uploads"][0]["sourceVersionId"]
        .as_str()
        .expect("uploaded source version")
        .to_owned();
    let upload_url = initiated["uploads"][0]["upload"]["url"]
        .as_str()
        .expect("upload URL");
    let mut upload = reqwest::Client::new().put(upload_url).body(bytes.clone());
    for (name, value) in initiated["uploads"][0]["upload"]["headers"]
        .as_object()
        .expect("upload headers")
    {
        upload = upload.header(name, value.as_str().expect("upload header value"));
    }
    let upload = upload.send().await.expect("send presigned upload");
    assert!(upload.status().is_success());
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/uploads/complete",
            Some(&token),
            Some(&json!({
                "clientId":Uuid::new_v4(),
                "sourceVersionId":version_id
            })),
        )
        .await,
        StatusCode::ACCEPTED,
    );
    let worker = IngestionWorker::new(
        state.pool.clone(),
        state
            .knowledge
            .object_store
            .clone()
            .expect("configured upload object store"),
    );
    assert!(worker.run_once().await.expect("ingest HTTP upload"));
    let sources = send(
        &router,
        Method::GET,
        &format!("/v1/spaces/{space_id}/sources"),
        Some(&token),
        None,
    )
    .await;
    assert_status(&sources, StatusCode::OK);
    assert_eq!(
        sources.json()["items"][0]["latestVersion"]["state"],
        "ready"
    );
    let repeated = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/uploads/initiate"),
        Some(&token),
        Some(&json!({"files":[file.clone()]})),
    )
    .await;
    assert_status(&repeated, StatusCode::CREATED);
    assert_eq!(repeated.json()["uploads"][0]["state"], "ready");
    assert!(repeated.json()["uploads"][0]["upload"].is_null());
    let mut conflicting = file;
    conflicting["sha256"] = Value::String("0".repeat(64));
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/spaces/{space_id}/uploads/initiate"),
            Some(&token),
            Some(&json!({"files":[conflicting]})),
        )
        .await,
        StatusCode::CONFLICT,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/uploads/complete",
            Some(&token),
            Some(&json!({"sourceVersionId":version_id})),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/uploads/complete",
            Some(&token),
            Some(&json!({
                "clientId":Uuid::new_v4(),
                "sourceVersionId":version_id
            })),
        )
        .await,
        StatusCode::ACCEPTED,
    );

    let version: Uuid = version_id.parse().unwrap();
    let object_key: String =
        query_scalar("SELECT object_key FROM knowledge_source_versions WHERE id=$1")
            .bind(version)
            .fetch_one(&state.pool)
            .await
            .expect("private object key for fixture cleanup");
    s3.delete_object()
        .bucket(&bucket)
        .key(object_key)
        .send()
        .await
        .expect("delete HTTP upload fixture");
    s3.delete_bucket()
        .bucket(&bucket)
        .send()
        .await
        .expect("delete disposable HTTP upload bucket");
    state.shutdown.cancel();
    state.pool.close().await;
}
