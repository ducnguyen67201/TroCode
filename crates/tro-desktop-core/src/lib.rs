//! Platform-neutral desktop services. Native presentation is provided by Tauri.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
};

use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use tokio::{io::AsyncReadExt, process::Command, sync::RwLock};
use uuid::Uuid;

pub const MAX_COMMAND_CHARS: usize = 16_000;
pub const MAX_COMMAND_OUTPUT_BYTES: usize = 512 * 1024;
pub const MAX_PATCH_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum DesktopError {
    #[error("authentication is required")]
    AuthenticationRequired,
    #[error("desktop API request failed")]
    ApiUnavailable,
    #[error("workspace selection is unknown")]
    UnknownWorkspace,
    #[error("path escapes the selected workspace")]
    PathEscape,
    #[error("exact approval is required")]
    ApprovalRequired,
    #[error("command exceeds its limit")]
    CommandTooLarge,
    #[error("command output exceeds its limit")]
    OutputTooLarge,
    #[error("filesystem operation failed")]
    Filesystem,
    #[error("secret storage failed")]
    SecretStorage,
}

#[async_trait]
pub trait SecretStore: Send + Sync {
    async fn get(&self, key: &str) -> Result<Option<String>, DesktopError>;
    async fn set(&self, key: &str, value: &str) -> Result<(), DesktopError>;
    async fn delete(&self, key: &str) -> Result<(), DesktopError>;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppPreferences {
    pub autonomy: Autonomy,
    pub voice_enabled: bool,
    pub analytics_enabled: bool,
    pub theme: Theme,
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            autonomy: Autonomy::Balanced,
            voice_enabled: true,
            analytics_enabled: true,
            theme: Theme::System,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Autonomy {
    Balanced,
    Strict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[derive(Clone)]
pub struct HostedApiClient {
    http: Client,
    base_url: String,
    secrets: Arc<dyn SecretStore>,
}

impl std::fmt::Debug for HostedApiClient {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostedApiClient")
            .field("base_url", &self.base_url)
            .finish_non_exhaustive()
    }
}

impl HostedApiClient {
    #[must_use]
    pub fn new(base_url: &str, secrets: Arc<dyn SecretStore>) -> Self {
        Self {
            http: Client::new(),
            base_url: base_url.trim_end_matches('/').to_owned(),
            secrets,
        }
    }

    /// Fetches authenticated JSON from the hosted API.
    ///
    /// # Errors
    ///
    /// Returns an authentication, secret-storage, transport, or response-decoding error.
    pub async fn get_json(&self, path: &str) -> Result<Value, DesktopError> {
        let token = self
            .secrets
            .get("device_session")
            .await?
            .ok_or(DesktopError::AuthenticationRequired)?;
        let response = self
            .http
            .get(format!("{}{path}", self.base_url))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| DesktopError::ApiUnavailable)?;
        if !response.status().is_success() {
            return Err(DesktopError::ApiUnavailable);
        }
        response
            .json()
            .await
            .map_err(|_| DesktopError::ApiUnavailable)
    }

    /// Posts authenticated JSON to the hosted API and decodes its JSON response.
    ///
    /// # Errors
    ///
    /// Returns an authentication, secret-storage, transport, or response-decoding error.
    pub async fn post_json(&self, path: &str, body: &Value) -> Result<Value, DesktopError> {
        let token = self
            .secrets
            .get("device_session")
            .await?
            .ok_or(DesktopError::AuthenticationRequired)?;
        let response = self
            .http
            .post(format!("{}{path}", self.base_url))
            .bearer_auth(token)
            .json(body)
            .send()
            .await
            .map_err(|_| DesktopError::ApiUnavailable)?;
        if !response.status().is_success() {
            return Err(DesktopError::ApiUnavailable);
        }
        response
            .json()
            .await
            .map_err(|_| DesktopError::ApiUnavailable)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSelection {
    pub id: Uuid,
    pub display_name: String,
}

#[derive(Debug, Default)]
pub struct WorkspaceRegistry {
    roots: RwLock<HashMap<Uuid, PathBuf>>,
}

impl WorkspaceRegistry {
    /// Registers a canonical local directory as a workspace.
    ///
    /// # Errors
    ///
    /// Returns [`DesktopError::Filesystem`] when the selected path is inaccessible
    /// or is not a directory.
    pub async fn register(&self, selected: &Path) -> Result<WorkspaceSelection, DesktopError> {
        let canonical = tokio::fs::canonicalize(selected)
            .await
            .map_err(|_| DesktopError::Filesystem)?;
        let metadata = tokio::fs::metadata(&canonical)
            .await
            .map_err(|_| DesktopError::Filesystem)?;
        if !metadata.is_dir() {
            return Err(DesktopError::Filesystem);
        }
        let display_name = canonical
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Workspace")
            .to_owned();
        let id = Uuid::new_v4();
        self.roots.write().await.insert(id, canonical);
        Ok(WorkspaceSelection { id, display_name })
    }

    async fn root(&self, id: Uuid) -> Result<PathBuf, DesktopError> {
        self.roots
            .read()
            .await
            .get(&id)
            .cloned()
            .ok_or(DesktopError::UnknownWorkspace)
    }

    #[must_use]
    pub async fn contains(&self, id: Uuid) -> bool {
        let Ok(root) = self.root(id).await else {
            return false;
        };
        tokio::fs::canonicalize(&root)
            .await
            .is_ok_and(|current| current == root)
    }

    /// Resolves an existing path while proving it remains inside its workspace root.
    ///
    /// # Errors
    ///
    /// Returns an unknown-workspace, path-escape, or filesystem error.
    pub async fn resolve_existing(
        &self,
        id: Uuid,
        relative: &Path,
    ) -> Result<PathBuf, DesktopError> {
        if relative.is_absolute()
            || relative
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
        {
            return Err(DesktopError::PathEscape);
        }
        let root = self.root(id).await?;
        let candidate = tokio::fs::canonicalize(root.join(relative))
            .await
            .map_err(|_| DesktopError::Filesystem)?;
        candidate
            .starts_with(&root)
            .then_some(candidate)
            .ok_or(DesktopError::PathEscape)
    }

    /// Performs one approved, size-bounded atomic file write inside a workspace.
    ///
    /// # Errors
    ///
    /// Returns an approval, path-escape, size, workspace, or filesystem error.
    pub async fn write_file_once(
        &self,
        id: Uuid,
        relative: &Path,
        bytes: &[u8],
        approved: bool,
    ) -> Result<(), DesktopError> {
        if !approved {
            return Err(DesktopError::ApprovalRequired);
        }
        if bytes.len() > MAX_PATCH_BYTES
            || relative.is_absolute()
            || relative
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
        {
            return Err(DesktopError::PathEscape);
        }
        let root = self.root(id).await?;
        let destination = root.join(relative);
        let parent = destination
            .parent()
            .map(Path::to_path_buf)
            .ok_or(DesktopError::PathEscape)?;
        let mut existing = parent.as_path();
        while !tokio::fs::try_exists(existing)
            .await
            .map_err(|_| DesktopError::Filesystem)?
        {
            existing = existing.parent().ok_or(DesktopError::PathEscape)?;
        }
        let canonical_existing = tokio::fs::canonicalize(existing)
            .await
            .map_err(|_| DesktopError::Filesystem)?;
        if !canonical_existing.starts_with(&root) {
            return Err(DesktopError::PathEscape);
        }
        tokio::fs::create_dir_all(&parent)
            .await
            .map_err(|_| DesktopError::Filesystem)?;
        let canonical_parent = tokio::fs::canonicalize(&parent)
            .await
            .map_err(|_| DesktopError::Filesystem)?;
        if !canonical_parent.starts_with(&root) {
            return Err(DesktopError::PathEscape);
        }
        let destination =
            canonical_parent.join(relative.file_name().ok_or(DesktopError::PathEscape)?);
        let temporary = canonical_parent.join(format!(".tro-{}.tmp", Uuid::new_v4()));
        tokio::fs::write(&temporary, bytes)
            .await
            .map_err(|_| DesktopError::Filesystem)?;
        if tokio::fs::rename(&temporary, &destination).await.is_err() {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(DesktopError::Filesystem);
        }
        Ok(())
    }

    /// Performs one approved deletion of a regular, non-symlink workspace file.
    ///
    /// # Errors
    ///
    /// Returns an approval, path-escape, workspace, or filesystem error.
    pub async fn delete_file_once(
        &self,
        id: Uuid,
        relative: &Path,
        approved: bool,
    ) -> Result<(), DesktopError> {
        if !approved {
            return Err(DesktopError::ApprovalRequired);
        }
        let target = self.resolve_existing(id, relative).await?;
        let metadata = tokio::fs::symlink_metadata(&target)
            .await
            .map_err(|_| DesktopError::Filesystem)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(DesktopError::Filesystem);
        }
        tokio::fs::remove_file(target)
            .await
            .map_err(|_| DesktopError::Filesystem)
    }

    /// Executes one approved, bounded command in a registered workspace.
    ///
    /// # Errors
    ///
    /// Returns an approval, workspace, command-size, output-size, or process error.
    pub async fn run_command_once(
        &self,
        id: Uuid,
        program: &str,
        arguments: &[String],
        approved: bool,
    ) -> Result<CommandResult, DesktopError> {
        if !approved {
            return Err(DesktopError::ApprovalRequired);
        }
        let command_chars = program.chars().count().saturating_add(
            arguments
                .iter()
                .map(|argument| argument.chars().count())
                .sum::<usize>(),
        );
        if command_chars > MAX_COMMAND_CHARS {
            return Err(DesktopError::CommandTooLarge);
        }
        let root = self.root(id).await?;
        let mut child = Command::new(program);
        child
            .args(arguments)
            .current_dir(root)
            .env_clear()
            .env("PATH", "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin")
            .env("LANG", "C.UTF-8")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = child.spawn().map_err(|_| DesktopError::Filesystem)?;
        let stdout = child.stdout.take().ok_or(DesktopError::Filesystem)?;
        let stderr = child.stderr.take().ok_or(DesktopError::Filesystem)?;
        let (stdout, stderr, status) =
            tokio::try_join!(read_bounded(stdout), read_bounded(stderr), async {
                child.wait().await.map_err(|_| DesktopError::Filesystem)
            })?;
        Ok(CommandResult {
            exit_code: status.code(),
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
        })
    }
}

async fn read_bounded<R: tokio::io::AsyncRead + Unpin>(reader: R) -> Result<Vec<u8>, DesktopError> {
    let mut output = Vec::new();
    reader
        .take(
            u64::try_from(MAX_COMMAND_OUTPUT_BYTES.saturating_add(1))
                .map_err(|_| DesktopError::OutputTooLarge)?,
        )
        .read_to_end(&mut output)
        .await
        .map_err(|_| DesktopError::Filesystem)?;
    if output.len() > MAX_COMMAND_OUTPUT_BYTES {
        return Err(DesktopError::OutputTooLarge);
    }
    Ok(output)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandResult {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[must_use]
pub fn public_command_error(error: &DesktopError) -> tro_contracts::CommandError {
    let code = match error {
        DesktopError::AuthenticationRequired => "authentication_required",
        DesktopError::UnknownWorkspace => "unknown_workspace",
        DesktopError::PathEscape => "path_escape",
        DesktopError::ApprovalRequired => "approval_required",
        DesktopError::CommandTooLarge => "command_too_large",
        DesktopError::OutputTooLarge => "output_too_large",
        DesktopError::ApiUnavailable | DesktopError::Filesystem | DesktopError::SecretStorage => {
            "desktop_operation_failed"
        }
    };
    tro_contracts::CommandError {
        code: code.to_owned(),
        message: error.to_string(),
    }
}
