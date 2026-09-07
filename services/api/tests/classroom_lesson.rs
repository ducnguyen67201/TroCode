use std::{collections::BTreeSet, time::Duration};

use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode, header},
};
use hmac::{Hmac, Mac};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sha2::Sha256;
use tower::ServiceExt;
use trocode_api::{
    PgPool,
    app::AppState,
    config::{
        AdminConfig, Config, ConnectorConfig, CostGuardConfig, CostGuardMode, KnowledgeConfig,
    },
    postgres::PgPoolOptions,
    query,
};
use url::Url;
use uuid::Uuid;

const HMAC_KEY: &str = "rust-classroom-e2e-hmac-key-32-bytes";

struct ResponseBody {
    status: StatusCode,
    body: Value,
}

async fn call(
    router: &Router,
    method: Method,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> ResponseBody {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "api.example.test")
        .header("x-forwarded-for", "198.18.0.1");
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let request_body = if let Some(body) = body {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
        Body::from(serde_json::to_vec(&body).unwrap())
    } else {
        Body::empty()
    };
    let response = router
        .clone()
        .oneshot(builder.body(request_body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    ResponseBody { status, body }
}

struct Fixture {
    teacher_id: String,
    teacher_token: String,
    student_id: String,
    student_token: String,
    space_id: Uuid,
    activity_version_id: Uuid,
    run_id: Uuid,
}

impl Fixture {
    async fn create(pool: &PgPool) -> Self {
        let suffix = Uuid::new_v4();
        let teacher_id = format!("rust-e2e-teacher-{suffix}");
        let student_id = format!("rust-e2e-student-{suffix}");
        let teacher_token = token('t');
        let student_token = token('s');
        query(
            r#"INSERT INTO users
                 (id,email,name,plan,free_access_started_at,classroom_role)
               VALUES ($1,$2,'Rust E2E teacher','basic',NOW(),'teacher'),
                      ($3,$4,'Rust E2E student','basic',NOW(),'student')"#,
        )
        .bind(&teacher_id)
        .bind(format!("{teacher_id}@example.test"))
        .bind(&student_id)
        .bind(format!("{student_id}@example.test"))
        .execute(pool)
        .await
        .unwrap();
        for (user_id, access_token) in
            [(&teacher_id, &teacher_token), (&student_id, &student_token)]
        {
            query(
                r#"INSERT INTO device_sessions (user_id,token_digest,expires_at)
                   VALUES ($1,$2,NOW()+INTERVAL '1 hour')"#,
            )
            .bind(user_id)
            .bind(session_digest(access_token).as_slice())
            .execute(pool)
            .await
            .unwrap();
        }
        let space_id = Uuid::new_v4();
        let activity_id = Uuid::new_v4();
        let activity_version_id = Uuid::new_v4();
        let run_id = Uuid::new_v4();
        let definition = json!({
            "title":"Rust loops lab",
            "objective":"Complete one bounded classroom exercise.",
            "instructions":"Open the exercise and practice loops.",
            "launchTarget":"current_surface",
            "guidancePolicy":{"answerReveal":"allowed","hintMode":"guided","maxHintLevel":2},
            "criteria":[{"id":"loop","title":"Use a loop","description":"","tags":[]}],
            "completionPolicy":{"requiresSubmission":false,"requiresFacilitatorConfirmation":true},
            "sessionPolicy":{"allowRoomJoin":true,"allowedOrigins":["https://class.example"]}
        });
        query(
            r#"INSERT INTO knowledge_spaces (id,client_id,owner_user_id,name,description)
               VALUES ($1,$2,$3,'Rust E2E room','Integration fixture')"#,
        )
        .bind(space_id)
        .bind(Uuid::new_v4())
        .bind(&teacher_id)
        .execute(pool)
        .await
        .unwrap();
        query("INSERT INTO knowledge_space_members (space_id,user_id,role) VALUES ($1,$2,'owner')")
            .bind(space_id)
            .bind(&teacher_id)
            .execute(pool)
            .await
            .unwrap();
        query(
            r#"INSERT INTO knowledge_activities
                 (id,client_id,space_id,state,draft_definition,created_by)
               VALUES ($1,$2,$3,'published',$4,$5)"#,
        )
        .bind(activity_id)
        .bind(Uuid::new_v4())
        .bind(space_id)
        .bind(&definition)
        .bind(&teacher_id)
        .execute(pool)
        .await
        .unwrap();
        query(
            r#"INSERT INTO knowledge_activity_versions
                 (id,activity_id,version_number,definition,content_hash,published_by)
               VALUES ($1,$2,1,$3,$4,$5)"#,
        )
        .bind(activity_version_id)
        .bind(activity_id)
        .bind(&definition)
        .bind("b".repeat(64))
        .bind(&teacher_id)
        .execute(pool)
        .await
        .unwrap();
        query(
            r#"INSERT INTO knowledge_activity_runs
                 (id,client_id,space_id,activity_version_id,mode,state,target_kind,
                  insight_policy,created_by)
               VALUES ($1,$2,$3,$4,'live','draft','room','explicit_and_operational',$5)"#,
        )
        .bind(run_id)
        .bind(Uuid::new_v4())
        .bind(space_id)
        .bind(activity_version_id)
        .bind(&teacher_id)
        .execute(pool)
        .await
        .unwrap();
        Self {
            teacher_id,
            teacher_token,
            student_id,
            student_token,
            space_id,
            activity_version_id,
            run_id,
        }
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
    Config {
        classroom_test_fixture_enabled: false,
        admin: AdminConfig { access_token: None },
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
        database_pool_max: 16,
        database_url,
        eleven_labs_api_key: None,
        eleven_labs_model_id: "eleven_multilingual_v2".to_owned(),
        eleven_labs_voice_id: None,
        google_client_id: "classroom-e2e.apps.googleusercontent.com".to_owned(),
        knowledge_spaces: KnowledgeConfig { object_store: None },
        openai_api_key: "test-openai-key".to_owned(),
        openai_models: BTreeSet::from(["gpt-5.6-luna".to_owned()]),
        port: 0,
        railway_git_commit_sha: "classroom-e2e".to_owned(),
        session_duration_days: 30,
        session_token_hmac_key: HMAC_KEY.to_owned(),
    }
}

fn token(character: char) -> String {
    format!("tro_live_{}", character.to_string().repeat(43))
}

fn session_digest(token: &str) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(HMAC_KEY.as_bytes()).unwrap();
    mac.update(token.as_bytes());
    mac.finalize().into_bytes().into()
}

#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn lesson_delivery_claims_and_stop_are_authorized_and_idempotent() {
    let url = disposable_database_url();
    reset_database(&url).await;
    let state = AppState::compose(test_config(url)).await.unwrap();
    let pool = state.pool.clone();
    let f = Fixture::create(&pool).await;
    let session = Uuid::new_v4();
    query("INSERT INTO knowledge_class_sessions(id,client_id,space_id,title,state,created_by) VALUES($1,$1,$2,'Lesson test','draft',$3)").bind(session).bind(f.space_id).bind(&f.teacher_id).execute(&pool).await.unwrap();
    query("INSERT INTO knowledge_class_session_activities(session_id,position,activity_version_id,run_id) VALUES($1,0,$2,$3)").bind(session).bind(f.activity_version_id).bind(f.run_id).execute(&pool).await.unwrap();
    query("INSERT INTO knowledge_space_members(space_id,user_id,role) VALUES($1,$2,'participant')")
        .bind(f.space_id)
        .bind(&f.student_id)
        .execute(&pool)
        .await
        .unwrap();
    let router = trocode_api::http::router(state.clone());
    let room = call(
        &router,
        Method::POST,
        &format!("/v1/spaces/{}/runs/{}/room-code", f.space_id, f.run_id),
        Some(&f.teacher_token),
        Some(json!({"clientId":Uuid::new_v4(),"maxUses":200,"expiresAt":null})),
    )
    .await;
    assert_eq!(room.status, StatusCode::CREATED, "{}", room.body);
    let joined = call(
        &router,
        Method::POST,
        "/v1/live-rooms/join",
        Some(&f.student_token),
        Some(json!({"clientId":Uuid::new_v4(),"code":room.body["code"]})),
    )
    .await;
    assert_eq!(joined.status, StatusCode::OK, "{}", joined.body);
    let anchor = joined.body["attemptId"].as_str().unwrap();
    let opened = call(
        &router,
        Method::POST,
        &format!("/v1/spaces/{}/runs/{}/open", f.space_id, f.run_id),
        Some(&f.teacher_token),
        None,
    )
    .await;
    assert_eq!(opened.status, StatusCode::OK);
    let base = format!("/v1/spaces/{}/sessions/{session}", f.space_id);
    let context = call(
        &router,
        Method::GET,
        &format!("{base}/lesson-context?runId={}", f.run_id),
        Some(&f.teacher_token),
        None,
    )
    .await;
    assert_eq!(context.status, StatusCode::OK, "{}", context.body);
    let resource = Uuid::new_v4();
    let step = Uuid::new_v4();
    let plan = json!({"schemaVersion":1,"targetRunId":f.run_id,"activityVersionId":f.activity_version_id,"title":"Greeting","objective":"Learn input","language":"vi",
      "resources":[{"id":resource,"kind":"web","title":"Editor","url":"https://class.example/editor","origin":"https://class.example"}],
      "steps":[{"id":step,"mode":"demonstrate","objective":"Greeting","instruction":"Show one greeting.","resourceId":resource,"criterionIds":["loop"],"demonstration":{"exampleDescription":"Print a greeting","expectedResult":"Greeting output"}}]});
    let input = json!({"clientId":Uuid::new_v4(),"plan":plan});
    let commit = format!("{base}/lessons");
    assert_eq!(
        call(
            &router,
            Method::POST,
            &commit,
            Some(&f.student_token),
            Some(input.clone())
        )
        .await
        .status,
        StatusCode::FORBIDDEN
    );
    let (first, second) = tokio::join!(
        call(
            &router,
            Method::POST,
            &commit,
            Some(&f.teacher_token),
            Some(input.clone())
        ),
        call(
            &router,
            Method::POST,
            &commit,
            Some(&f.teacher_token),
            Some(input.clone())
        )
    );
    assert_eq!(first.status, StatusCode::OK, "{}", first.body);
    assert_eq!(second.status, StatusCode::OK, "{}", second.body);
    assert_eq!(
        first.body["lesson"]["lessonId"],
        second.body["lesson"]["lessonId"]
    );
    let lesson = first.body["lesson"]["lessonId"].as_str().unwrap();
    let mut conflict = input.clone();
    conflict["plan"]["objective"] = json!("Changed");
    assert_eq!(
        call(
            &router,
            Method::POST,
            &commit,
            Some(&f.teacher_token),
            Some(conflict)
        )
        .await
        .status,
        StatusCode::CONFLICT
    );
    let feed = call(
        &router,
        Method::GET,
        &format!("/v1/attempts/{anchor}/session-lessons?afterSequence=0"),
        Some(&f.student_token),
        None,
    )
    .await;
    assert_eq!(feed.status, StatusCode::OK, "{}", feed.body);
    assert_eq!(feed.body["items"][0]["lessonId"], lesson);
    let progress = call(
        &router,
        Method::GET,
        &format!("{base}/lessons/{lesson}/progress"),
        Some(&f.teacher_token),
        None,
    )
    .await;
    assert_eq!(progress.body["counts"]["not_received"], 1);
    let student = format!("/v1/attempts/{anchor}/session-lessons/{lesson}");
    let report = json!({"reportId":Uuid::new_v4(),"revision":0,"stepId":null,"status":"received","reasonCode":null,"actionCount":0,"modelRequestCount":0});
    assert_eq!(
        call(
            &router,
            Method::POST,
            &format!("{student}/receipt"),
            Some(&f.student_token),
            Some(report.clone())
        )
        .await
        .status,
        StatusCode::OK
    );
    let start = json!({"clientStartId":Uuid::new_v4(),"clientInstanceId":Uuid::new_v4()});
    let claimed = call(
        &router,
        Method::POST,
        &format!("{student}/starts"),
        Some(&f.student_token),
        Some(start.clone()),
    )
    .await;
    assert_eq!(claimed.status, StatusCode::OK, "{}", claimed.body);
    assert_eq!(claimed.body["ownedByThisRequest"], true);
    let other = call(
        &router,
        Method::POST,
        &format!("{student}/starts"),
        Some(&f.student_token),
        Some(json!({"clientStartId":Uuid::new_v4(),"clientInstanceId":Uuid::new_v4()})),
    )
    .await;
    assert_eq!(other.body["ownedByThisRequest"], false);
    assert_eq!(other.body["executionId"], claimed.body["executionId"]);
    let execution = claimed.body["executionId"].as_str().unwrap();
    let step_input = json!({"taskId":Uuid::new_v4(),"attemptNumber":1,"purpose":"work","clientInstanceId":start["clientInstanceId"]});
    let path = format!("/v1/lesson-executions/{execution}/steps/{step}/starts");
    let child = call(
        &router,
        Method::POST,
        &path,
        Some(&f.student_token),
        Some(step_input.clone()),
    )
    .await;
    assert_eq!(child.status, StatusCode::OK, "{}", child.body);
    let repeated = call(
        &router,
        Method::POST,
        &path,
        Some(&f.student_token),
        Some(step_input),
    )
    .await;
    assert_eq!(repeated.body["workSessionId"], child.body["workSessionId"]);
    let mut running = report;
    running["revision"] = json!(2);
    running["status"] = json!("running");
    running["stepId"] = json!(step);
    let report_path = format!("/v1/lesson-executions/{execution}/progress");
    assert_eq!(
        call(
            &router,
            Method::POST,
            &report_path,
            Some(&f.student_token),
            Some(running.clone())
        )
        .await
        .status,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &router,
            Method::POST,
            &report_path,
            Some(&f.student_token),
            Some(running.clone())
        )
        .await
        .status,
        StatusCode::OK
    );
    running["status"] = json!("finished");
    assert_eq!(
        call(
            &router,
            Method::POST,
            &report_path,
            Some(&f.student_token),
            Some(running)
        )
        .await
        .status,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &router,
            Method::POST,
            &format!("{base}/lessons/{lesson}/stop"),
            Some(&f.teacher_token),
            Some(json!({}))
        )
        .await
        .status,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &router,
            Method::GET,
            &format!("/v1/lesson-executions/{execution}/status"),
            Some(&f.student_token),
            None
        )
        .await
        .status,
        StatusCode::CONFLICT
    );
    let stopped = call(
        &router,
        Method::GET,
        &format!("/v1/attempts/{anchor}/session-lessons?afterSequence=1"),
        Some(&f.student_token),
        None,
    )
    .await;
    assert_eq!(stopped.body["stoppedIds"][0], lesson);
    // Opening material is a v2 plan. Old clients keep their v1 feed and cursor.
    let mut open_input = input.clone();
    open_input["clientId"] = json!(Uuid::new_v4());
    open_input["plan"]["schemaVersion"] = json!(2);
    open_input["plan"]["steps"][0]["mode"] = json!("open");
    open_input["plan"]["steps"][0]["demonstration"] = json!(null);
    open_input["plan"]["steps"][0]["criterionIds"] = json!([]);
    let opened_material = call(
        &router,
        Method::POST,
        &commit,
        Some(&f.teacher_token),
        Some(open_input),
    )
    .await;
    assert_eq!(
        opened_material.status,
        StatusCode::OK,
        "{}",
        opened_material.body
    );
    let legacy = call(
        &router,
        Method::GET,
        &format!("/v1/attempts/{anchor}/session-lessons?afterSequence=1"),
        Some(&f.student_token),
        None,
    )
    .await;
    assert_eq!(legacy.status, StatusCode::OK);
    assert_eq!(legacy.body["items"], json!([]));
    assert_eq!(legacy.body["maxSequence"], 2);
    assert!(legacy.body.get("maxPlanVersion").is_none());
    let modern = call(
        &router,
        Method::GET,
        &format!("/v1/attempts/{anchor}/session-lessons?afterSequence=1&maxPlanVersion=2"),
        Some(&f.student_token),
        None,
    )
    .await;
    assert_eq!(modern.status, StatusCode::OK);
    assert_eq!(
        modern.body["items"][0]["lessonId"],
        opened_material.body["lesson"]["lessonId"]
    );
    assert_eq!(modern.body["maxPlanVersion"], 2);
    let modern_context = call(
        &router,
        Method::GET,
        &format!("{base}/lesson-context?runId={}&maxPlanVersion=2", f.run_id),
        Some(&f.teacher_token),
        None,
    )
    .await;
    assert_eq!(modern_context.body["maxPlanVersion"], 2);
    assert!(context.body.get("maxPlanVersion").is_none());
    state.shutdown.cancel();
    pool.close().await;
}
