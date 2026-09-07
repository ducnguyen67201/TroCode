use std::collections::BTreeMap;

use super::*;

impl Environment for BTreeMap<String, String> {
    fn get(&self, key: &str) -> Option<String> {
        self.get(key).cloned()
    }
}

fn environment() -> BTreeMap<String, String> {
    BTreeMap::from([
        (
            "DATABASE_URL".to_owned(),
            "postgres://local/test".to_owned(),
        ),
        ("GOOGLE_OAUTH_CLIENT_ID".to_owned(), "client".to_owned()),
        ("OPENAI_API_KEY".to_owned(), "openai".to_owned()),
        ("TROCODE_SESSION_TOKEN_HMAC_KEY".to_owned(), "x".repeat(32)),
    ])
}

#[test]
fn loads_defaults() {
    let config = Config::from_source(&environment()).expect("valid config");
    assert_eq!(config.port, 8080);
    assert!(config.openai_models.contains("gpt-5.6-luna"));
}

#[test]
fn configures_knowledge_object_storage_without_a_feature_flag() {
    let mut values = environment();
    values.extend([
        (
            "TROCODE_KNOWLEDGE_S3_ACCESS_KEY_ID".to_owned(),
            "access-key".to_owned(),
        ),
        (
            "TROCODE_KNOWLEDGE_S3_BUCKET".to_owned(),
            "knowledge".to_owned(),
        ),
        (
            "TROCODE_KNOWLEDGE_S3_REGION".to_owned(),
            "us-east-1".to_owned(),
        ),
        (
            "TROCODE_KNOWLEDGE_S3_SECRET_ACCESS_KEY".to_owned(),
            "secret-key".to_owned(),
        ),
    ]);

    let config = Config::from_source(&values).expect("valid object store config");

    assert!(config.knowledge_spaces.object_store.is_some());
}

#[test]
fn rejects_partial_knowledge_object_storage_configuration() {
    let mut values = environment();
    values.insert(
        "TROCODE_KNOWLEDGE_S3_BUCKET".to_owned(),
        "knowledge".to_owned(),
    );

    let error = Config::from_source(&values).expect_err("partial object store config");

    assert!(
        error
            .to_string()
            .contains("TROCODE_KNOWLEDGE_S3_ACCESS_KEY_ID")
    );
}

#[test]
fn connector_defaults_are_disabled() {
    let config = Config::from_source(&environment()).expect("valid config");
    assert!(!config.connectors.enabled);
    assert!(config.connectors.callback_url.is_none());
}

#[test]
fn connector_rollout_requires_separate_secrets_and_exact_callback() {
    let mut values = environment();
    values.extend([
        ("TROCODE_CONNECTORS_ENABLED".to_owned(), "true".to_owned()),
        (
            "TROCODE_CONNECTOR_ROLLOUT_PERCENT".to_owned(),
            "100".to_owned(),
        ),
        (
            "TROCODE_CONNECTOR_TOKEN_ENCRYPTION_KEYS".to_owned(),
            "1:eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg=".to_owned(),
        ),
        (
            "TROCODE_GMAIL_CONNECTOR_CLIENT_ID".to_owned(),
            "gmail-client".to_owned(),
        ),
        (
            "TROCODE_GMAIL_CONNECTOR_CLIENT_SECRET".to_owned(),
            "gmail-secret".to_owned(),
        ),
        (
            "TROCODE_CONNECTOR_CALLBACK_URL".to_owned(),
            "https://api.example.com/wrong".to_owned(),
        ),
    ]);
    assert!(Config::from_source(&values).is_err());
    values.insert(
        "TROCODE_CONNECTOR_CALLBACK_URL".to_owned(),
        "https://api.example.com/v1/connectors/oauth/callback".to_owned(),
    );
    assert!(Config::from_source(&values).is_ok());
}
