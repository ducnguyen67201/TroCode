use std::collections::HashSet;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::Value;
use trocode_api::auth::{
    AgentEnvelope, AgentStateCrypto, digest_access_code, issue_admin_session, open_access_code,
    verify_admin_session,
};

fn fixture(name: &str) -> Value {
    serde_json::from_str(match name {
        "crypto" => include_str!("fixtures/crypto_compat.json"),
        "routes" => include_str!("fixtures/route_inventory.json"),
        "schema" => include_str!("fixtures/schema_inventory.json"),
        "pdf" => include_str!("fixtures/pdf_corpus.json"),
        _ => panic!("unknown fixture"),
    })
    .expect("valid compatibility fixture")
}

#[test]
fn pdf_corpus_covers_release_blocking_classes() {
    let value = fixture("pdf");
    let cases = value["cases"].as_array().expect("cases");
    let names: HashSet<_> = cases
        .iter()
        .filter_map(|case| case["name"].as_str())
        .collect();
    for required in [
        "single-page-text",
        "multi-page-unicode",
        "empty-scanned",
        "encrypted",
        "malformed-signature",
        "page-limit",
        "page-limit-exceeded",
        "character-limit",
        "character-limit-exceeded",
    ] {
        assert!(
            names.contains(required),
            "missing PDF corpus case {required}"
        );
    }
}

fn hex(value: &[u8]) -> String {
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[test]
fn opens_stable_crypto_fixtures() {
    let value = fixture("crypto");
    let access = &value["accessCode"];
    let key = access["hmacKey"].as_str().expect("key");
    let digest = digest_access_code(access["normalized"].as_str().expect("code"), key)
        .expect("digest")
        .expect("valid code");
    assert_eq!(hex(&digest), access["digestHex"]);
    let sealed = STANDARD
        .decode(access["sealedBase64"].as_str().expect("sealed"))
        .expect("base64");
    assert_eq!(
        open_access_code(&sealed, key, &digest).expect("decrypt"),
        access["plaintext"]
    );

    let admin = &value["adminSession"];
    let issued_at = admin["issuedAtMs"].as_i64().expect("issued") / 1_000;
    let token = admin["accessToken"].as_str().expect("token");
    let session = admin["value"].as_str().expect("session");
    assert_eq!(
        issue_admin_session(token, issued_at).as_deref(),
        Some(session)
    );
    assert!(verify_admin_session(session, token, issued_at));

    let state = &value["agentState"];
    let crypto = AgentStateCrypto::parse(
        state["keys"].as_str().expect("keys"),
        u32::try_from(state["currentVersion"].as_u64().expect("version")).expect("u32"),
    )
    .expect("agent crypto");
    let envelope: AgentEnvelope =
        serde_json::from_value(state["envelope"].clone()).expect("envelope");
    assert_eq!(
        crypto
            .decrypt_json(&envelope, &state["metadata"])
            .expect("decrypt"),
        state["value"]
    );
}

#[test]
fn route_inventory_is_unique_and_covers_every_family() {
    let value = fixture("routes");
    let routes = value["routes"].as_array().expect("routes");
    let mut keys = HashSet::new();
    let mut families = HashSet::new();
    for route in routes {
        let method = route["method"].as_str().expect("method");
        let path = route["path"].as_str().expect("path");
        assert!(
            keys.insert(format!("{method} {path}")),
            "duplicate route {method} {path}"
        );
        families.insert(route["family"].as_str().expect("family"));
    }
    assert!(routes.len() >= 72);
    assert!(keys.contains("GET /v1/companion-images/quota"));
    assert!(keys.contains("POST /v1/openai/images/companion-edits"));
    assert_eq!(
        families,
        HashSet::from([
            "access",
            "admin",
            "agent",
            "auth",
            "core",
            "knowledge",
            "organization",
            "provider",
            "usage"
        ])
    );
    assert_eq!(value["sse"].as_array().expect("sse").len(), 1);
}

#[test]
fn schema_inventory_matches_embedded_migrations() {
    let value = fixture("schema");
    let tables = value["tables"].as_array().expect("tables");
    assert_eq!(tables.len(), 61);
    assert_eq!(value["migrationCount"], 36);
    let migration_sources = [
        include_str!("../migrations/001_hosted_sessions.sql"),
        include_str!("../migrations/002_access_codes.sql"),
        include_str!("../migrations/003_model_usage_budgets.sql"),
        include_str!("../migrations/004_audio_transcription_usage.sql"),
        include_str!("../migrations/005_usage_plans_and_rate_limits.sql"),
        include_str!("../migrations/006_agent_turns.sql"),
        include_str!("../migrations/007_free_usage_plan.sql"),
        include_str!("../migrations/008_knowledge_spaces.sql"),
        include_str!("../migrations/009_knowledge_sources.sql"),
        include_str!("../migrations/010_knowledge_activities.sql"),
        include_str!("../migrations/011_admin_access_controls.sql"),
        include_str!("../migrations/012_retrievable_access_codes.sql"),
        include_str!("../migrations/013_access_code_lifecycle.sql"),
        include_str!("../migrations/014_agent_runtime.sql"),
        include_str!("../migrations/015_intent_authorization.sql"),
        include_str!("../migrations/016_admin_code_grants.sql"),
        include_str!("../migrations/017_free_plan_onboarding.sql"),
        include_str!("../migrations/018_classroom_roles.sql"),
        include_str!("../migrations/019_invite_idempotency.sql"),
        include_str!("../migrations/020_live_classroom_room_flow.sql"),
        include_str!("../migrations/021_organization_managed_access.sql"),
        include_str!("../migrations/022_organization_profile_settings.sql"),
        include_str!("../migrations/023_user_knowledge_spaces_access.sql"),
        include_str!("../migrations/024_companion_image_generation.sql"),
        include_str!("../migrations/025_agent_runtime_contract_v3.sql"),
        include_str!("../migrations/026_organization_home_banners.sql"),
        include_str!("../migrations/027_mcp_connectors.sql"),
        include_str!("../migrations/028_class_sessions.sql"),
        include_str!("../migrations/029_class_session_materials.sql"),
        include_str!("../migrations/030_remove_agent_approval_policy.sql"),
        include_str!("../migrations/031_agents_sdk_orchestrator.sql"),
        include_str!("../migrations/032_orchestrator_public_protocol_digest.sql"),
        include_str!("../migrations/033_agent_run_tool_snapshots.sql"),
        include_str!("../migrations/034_classroom_explain_assignment_directive.sql"),
        include_str!("../migrations/035_class_session_broadcasts.sql"),
        include_str!("../migrations/036_student_classroom_guidance.sql"),
    ];
    let all = migration_sources.join("\n");
    for table in tables {
        let table = table.as_str().expect("table");
        assert!(
            all.contains(&format!("TABLE IF NOT EXISTS {table}")),
            "missing {table}"
        );
    }
}

#[test]
fn knowledge_spaces_access_defaults_on_per_user() {
    let migration = include_str!("../migrations/023_user_knowledge_spaces_access.sql");
    assert!(migration.contains("knowledge_spaces_enabled BOOLEAN NOT NULL DEFAULT TRUE"));
    assert!(migration.contains("user.knowledge_spaces_access_updated"));
}

#[test]
fn classroom_lesson_contracts_match_typescript() {
    use sha2::{Digest, Sha256};
    use trocode_api::classroom::LessonPlan;
    let cases: Value =
        serde_json::from_str(include_str!("fixtures/classroom-lesson-contracts.json")).unwrap();
    for case in cases.as_array().unwrap() {
        let parsed = serde_json::from_value::<LessonPlan>(case["plan"].clone());
        let valid = parsed.as_ref().is_ok_and(|p| p.validate().is_ok());
        assert_eq!(valid, case["valid"].as_bool().unwrap(), "{}", case["name"]);
        if valid {
            let value = parsed.unwrap().value().unwrap();
            let digest = format!("{:x}", Sha256::digest(serde_json::to_vec(&value).unwrap()));
            assert_eq!(digest, case["digest"].as_str().unwrap());
        }
    }
}
