use std::sync::Arc;

use axum::http::StatusCode;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use rand::Rng;
use sea_orm::{
    ConnectionTrait, DatabaseConnection, DbBackend, FromQueryResult, QueryResult, Statement,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::error::ApiError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublicUser {
    pub(crate) id: String,
    pub(crate) email: String,
    pub(crate) name: String,
}

#[derive(Debug, Clone)]
pub(crate) struct AuthenticatedSession {
    pub(crate) session_id: Uuid,
    pub(crate) user: PublicUser,
    pub(crate) plan: String,
}

#[derive(Debug, FromQueryResult)]
struct SessionRow {
    session_id: Uuid,
    user_id: String,
    email: String,
    name: String,
    plan: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IssuedSession {
    #[serde(rename = "accessToken")]
    pub(crate) token: String,
    pub(crate) expires_at: String,
    pub(crate) user: PublicUser,
}

#[derive(Clone)]
pub(crate) struct IdentityService {
    database: DatabaseConnection,
    hmac_key: Arc<[u8]>,
    session_duration_days: i64,
    google: GoogleVerifier,
}

impl std::fmt::Debug for IdentityService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("IdentityService")
            .finish_non_exhaustive()
    }
}

impl IdentityService {
    #[must_use]
    pub(crate) fn new(
        database: DatabaseConnection,
        hmac_key: String,
        session_duration_days: i64,
        google_client_id: String,
    ) -> Self {
        Self {
            database,
            hmac_key: Arc::from(hmac_key.into_bytes()),
            session_duration_days,
            google: GoogleVerifier::new(google_client_id),
        }
    }

    pub(crate) async fn exchange_google(
        &self,
        id_token: &str,
        nonce: &str,
    ) -> Result<IssuedSession, ApiError> {
        let claims = self.google.verify(id_token, nonce).await.map_err(|()| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                "Google sign-in could not be verified.",
            )
        })?;
        self.issue(PublicUser {
            id: claims.sub,
            email: claims.email,
            name: claims.name.unwrap_or_default(),
        })
        .await
    }

    pub(crate) async fn authenticate(&self, token: &str) -> Result<AuthenticatedSession, ApiError> {
        if !token.starts_with("tro_live_") || token.len() > 256 {
            return Err(ApiError::coded(
                StatusCode::UNAUTHORIZED,
                "session_expired",
                "Your session expired. Sign in again.",
            ));
        }
        let digest = self.digest(token)?;
        let row = SessionRow::find_by_statement(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE device_sessions sessions SET last_used_at = NOW() \
             FROM users WHERE sessions.user_id = users.id \
             AND sessions.token_digest = $1 AND sessions.revoked_at IS NULL \
             AND users.blocked_at IS NULL \
             AND sessions.expires_at > NOW() \
             RETURNING sessions.id AS session_id, users.id AS user_id, \
             users.email, users.name, users.plan",
            [digest.into()],
        ))
        .one(&self.database)
        .await?;
        let row = row.ok_or_else(|| {
            ApiError::coded(
                StatusCode::UNAUTHORIZED,
                "session_expired",
                "Your session expired. Sign in again.",
            )
        })?;
        Ok(AuthenticatedSession {
            session_id: row.session_id,
            user: PublicUser {
                id: row.user_id,
                email: row.email,
                name: row.name,
            },
            plan: row.plan,
        })
    }

    pub(crate) async fn rotate(
        &self,
        current: &AuthenticatedSession,
    ) -> Result<IssuedSession, ApiError> {
        let transaction = self.database.begin().await?;
        let revoked = transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "UPDATE device_sessions AS sessions SET revoked_at = NOW() \
                 FROM users WHERE sessions.id = $1 AND sessions.user_id = users.id \
                 AND users.blocked_at IS NULL AND sessions.revoked_at IS NULL \
                 AND sessions.expires_at > NOW()",
                [current.session_id.into()],
            ))
            .await?;
        if revoked.rows_affected() != 1 {
            transaction.rollback().await?;
            return Err(ApiError::new(
                StatusCode::UNAUTHORIZED,
                "Your session expired. Sign in again.",
            ));
        }
        let result = self.issue_in(&transaction, current.user.clone()).await?;
        transaction.commit().await?;
        Ok(result)
    }

    pub(crate) async fn revoke(&self, session_id: Uuid) -> Result<(), ApiError> {
        self.database
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "UPDATE device_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = $1",
                [session_id.into()],
            ))
            .await?;
        Ok(())
    }

    async fn issue(&self, user: PublicUser) -> Result<IssuedSession, ApiError> {
        let transaction = self.database.begin().await?;
        let user_row = transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO users (id, email, name) VALUES ($1, $2, $3) \
                 ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, \
                 name = EXCLUDED.name, updated_at = NOW() \
                 RETURNING blocked_at IS NOT NULL AS blocked",
                [
                    user.id.clone().into(),
                    user.email.clone().into(),
                    user.name.clone().into(),
                ],
            ))
            .await?
            .ok_or_else(ApiError::internal)?;
        let blocked: bool = get(&user_row, "blocked")?;
        if blocked {
            transaction.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::FORBIDDEN,
                "account_blocked",
                "This account has been blocked by an administrator.",
            ));
        }
        let session = self.issue_in(&transaction, user).await?;
        transaction.commit().await?;
        Ok(session)
    }

    async fn issue_in<C: ConnectionTrait>(
        &self,
        connection: &C,
        user: PublicUser,
    ) -> Result<IssuedSession, ApiError> {
        let random: [u8; 32] = rand::rng().random();
        let token = format!("tro_live_{}", URL_SAFE_NO_PAD.encode(random));
        let digest = self.digest(&token)?;
        let row = connection
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO device_sessions (user_id, token_digest, expires_at) \
                 VALUES ($1, $2, NOW() + make_interval(days => $3)) \
                 RETURNING expires_at::TEXT AS expires_at",
                [
                    user.id.clone().into(),
                    digest.into(),
                    self.session_duration_days.into(),
                ],
            ))
            .await?
            .ok_or_else(ApiError::internal)?;
        let expires_at: String = get(&row, "expires_at")?;
        Ok(IssuedSession {
            token,
            expires_at,
            user,
        })
    }

    fn digest(&self, token: &str) -> Result<Vec<u8>, ApiError> {
        let mut mac =
            Hmac::<Sha256>::new_from_slice(&self.hmac_key).map_err(|_| ApiError::internal())?;
        mac.update(token.as_bytes());
        Ok(mac.finalize().into_bytes().to_vec())
    }
}

fn get<T: sea_orm::TryGetable>(row: &QueryResult, column: &str) -> Result<T, ApiError> {
    row.try_get("", column).map_err(|_| ApiError::internal())
}

#[derive(Clone)]
struct GoogleVerifier {
    client_id: String,
    http: reqwest::Client,
    keys: Arc<RwLock<Option<JwkSet>>>,
}

impl GoogleVerifier {
    fn new(client_id: String) -> Self {
        Self {
            client_id,
            http: reqwest::Client::new(),
            keys: Arc::new(RwLock::new(None)),
        }
    }

    async fn verify(&self, token: &str, nonce: &str) -> Result<GoogleClaims, ()> {
        let header = decode_header(token).map_err(|_| ())?;
        let kid = header.kid.ok_or(())?;
        let key_set = self.keys().await?;
        let jwk = key_set.find(&kid).ok_or(())?;
        let key = DecodingKey::from_jwk(jwk).map_err(|_| ())?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[&self.client_id]);
        validation.set_issuer(&["accounts.google.com", "https://accounts.google.com"]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        let claims = decode::<GoogleClaims>(token, &key, &validation)
            .map_err(|_| ())?
            .claims;
        if !claims.email_verified
            || claims.nonce.as_deref() != Some(nonce)
            || claims.email.is_empty()
        {
            return Err(());
        }
        Ok(claims)
    }

    async fn keys(&self) -> Result<JwkSet, ()> {
        if let Some(keys) = self.keys.read().await.clone() {
            return Ok(keys);
        }
        let keys = self
            .http
            .get("https://www.googleapis.com/oauth2/v3/certs")
            .send()
            .await
            .map_err(|_| ())?
            .error_for_status()
            .map_err(|_| ())?
            .json::<JwkSet>()
            .await
            .map_err(|_| ())?;
        *self.keys.write().await = Some(keys.clone());
        Ok(keys)
    }
}

#[derive(Debug, Clone, Deserialize)]
struct GoogleClaims {
    sub: String,
    email: String,
    email_verified: bool,
    name: Option<String>,
    nonce: Option<String>,
}
