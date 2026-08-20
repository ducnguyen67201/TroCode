//! Narrow CUA capability boundary for a supported Rust embedded host.

use std::sync::Arc;

use async_trait::async_trait;
use cua_driver_sdk::{CuaDriver, current_mac_os_permission_status, request_mac_os_permissions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

pub const SUPPORTED_SEMANTIC_CONTRACT: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionState {
    Granted,
    Denied,
    NotDetermined,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CuaStatus {
    pub accessibility: PermissionState,
    pub screen_recording: PermissionState,
    pub semantic_contract: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Observation {
    pub id: Uuid,
    pub route: ObservationRoute,
    pub width: u32,
    pub height: u32,
    pub fingerprint: String,
    pub elements: Vec<SurfaceElement>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshot_base64: Option<String>,
    #[serde(skip)]
    pub target_pid: Option<i64>,
    #[serde(skip)]
    pub target_window_id: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservationRoute {
    BrowserSemantic,
    Accessibility,
    WindowVision,
    DesktopVision,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SurfaceElement {
    pub reference: String,
    pub role: String,
    pub name: String,
    pub disabled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CuaAction {
    Click {
        observation_id: Uuid,
        x: f64,
        y: f64,
        target_pid: Option<i64>,
        target_window_id: Option<i64>,
    },
    TypeText {
        observation_id: Uuid,
        text: String,
        target_pid: Option<i64>,
        target_window_id: Option<i64>,
    },
    Keypress {
        observation_id: Uuid,
        keys: Vec<String>,
        target_pid: Option<i64>,
        target_window_id: Option<i64>,
    },
    Scroll {
        observation_id: Uuid,
        delta_x: i32,
        delta_y: i32,
        target_pid: Option<i64>,
        target_window_id: Option<i64>,
        x: f64,
        y: f64,
    },
    SemanticClick {
        observation_id: Uuid,
        reference: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionEffect {
    Confirmed,
    NoEffect,
    Unknown,
}

#[derive(Debug, Error)]
pub enum CuaError {
    #[error("computer permissions are unavailable")]
    PermissionDenied,
    #[error("observation is stale")]
    StaleObservation,
    #[error("semantic element reference is unknown")]
    UnknownReference,
    #[error("CUA action was rejected before dispatch")]
    Rejected,
    #[error("CUA action result is unknown")]
    UnknownOutcome,
    #[error("CUA embedded host is unavailable")]
    Unavailable,
}

#[async_trait]
pub trait CuaHost: Send + Sync {
    async fn status(&self) -> Result<CuaStatus, CuaError>;
    async fn request_permissions_from_user_gesture(&self) -> Result<CuaStatus, CuaError>;
    async fn observe(&self) -> Result<Observation, CuaError>;
    async fn execute_once(
        &self,
        action: CuaAction,
    ) -> Result<(ActionEffect, Observation), CuaError>;
}

/// Same-process CUA runtime. Native calls run under the signed Tauri process so
/// macOS TCC attributes permission and capture authority to Tro itself.
pub struct DirectCuaHost {
    driver: Arc<CuaDriver>,
    session: String,
}

impl std::fmt::Debug for DirectCuaHost {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DirectCuaHost")
            .field("session", &self.session)
            .finish_non_exhaustive()
    }
}

impl DirectCuaHost {
    /// Creates a native CUA host for a bounded session identifier.
    ///
    /// # Errors
    ///
    /// Returns [`CuaError::Unavailable`] when the session identifier is invalid
    /// or the native CUA driver cannot be initialized.
    pub fn create(session: String) -> Result<Self, CuaError> {
        if session.trim().is_empty() || session.len() > 100 {
            return Err(CuaError::Unavailable);
        }
        let driver = CuaDriver::create(None).map_err(|_| CuaError::Unavailable)?;
        Ok(Self { driver, session })
    }

    async fn call(
        &self,
        tool: &str,
        arguments: serde_json::Value,
    ) -> Result<cua_driver_sdk::ToolResult, CuaError> {
        self.driver
            .call_tool(tool.to_owned(), arguments.to_string())
            .await
            .map_err(|_| CuaError::UnknownOutcome)
    }

    #[allow(clippy::too_many_lines)]
    async fn current_observation(&self) -> Result<Observation, CuaError> {
        let session_state = self
            .call(
                "get_session_state",
                serde_json::json!({ "session": self.session }),
            )
            .await?;
        let state = parse_structured(&session_state);
        if !session_state.is_error
            && state
                .get("effective_scope")
                .and_then(serde_json::Value::as_str)
                == Some("desktop")
        {
            let ended = self
                .call(
                    "end_session",
                    serde_json::json!({ "session": self.session }),
                )
                .await?;
            if ended.is_error {
                return Err(CuaError::Unavailable);
            }
        }
        let started = self
            .call(
                "start_session",
                serde_json::json!({
                    "session": self.session,
                    "capture_scope": "auto"
                }),
            )
            .await?;
        if started.is_error {
            return Err(CuaError::Unavailable);
        }
        let _ = self
            .call(
                "set_config",
                serde_json::json!({
                    "session": self.session,
                    "max_image_dimension": 1_600
                }),
            )
            .await;
        if let Some(observation) = self.current_window_observation().await? {
            return Ok(observation);
        }
        let escalated = self
            .call(
                "escalate_session",
                serde_json::json!({
                    "session": self.session,
                    "reason": "no_window_target",
                    "detail": "No non-Tro window exposed a truthful bounded snapshot."
                }),
            )
            .await?;
        if escalated.is_error {
            return Err(CuaError::Unavailable);
        }
        let result = self
            .call(
                "get_desktop_state",
                serde_json::json!({ "session": self.session }),
            )
            .await?;
        if result.is_error {
            return Err(CuaError::UnknownOutcome);
        }
        let structured = result
            .structured_json
            .as_deref()
            .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
            .unwrap_or(serde_json::Value::Null);
        let width = structured
            .pointer("/screen/width")
            .or_else(|| structured.get("width"))
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .unwrap_or(1);
        let height = structured
            .pointer("/screen/height")
            .or_else(|| structured.get("height"))
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .unwrap_or(1);
        let screenshot_base64 = result.images.first().map(|image| image.data_base64.clone());
        let fingerprint_source = screenshot_base64.as_deref().unwrap_or(&result.raw_json);
        let fingerprint = format!("{:x}", Sha256::digest(fingerprint_source.as_bytes()));
        Ok(Observation {
            id: Uuid::new_v4(),
            route: ObservationRoute::DesktopVision,
            width,
            height,
            fingerprint,
            elements: Vec::new(),
            screenshot_base64,
            target_pid: None,
            target_window_id: None,
        })
    }

    #[allow(clippy::too_many_lines)]
    async fn current_window_observation(&self) -> Result<Option<Observation>, CuaError> {
        let windows = self
            .call(
                "list_windows",
                serde_json::json!({ "on_screen_only": true }),
            )
            .await?;
        if windows.is_error {
            return Ok(None);
        }
        let structured = parse_structured(&windows);
        let rows = structured
            .get("windows")
            .and_then(serde_json::Value::as_array)
            .or_else(|| structured.as_array());
        let Some(rows) = rows else {
            return Ok(None);
        };
        let process_id = i64::from(std::process::id());
        let has_own_window = rows
            .iter()
            .any(|row| integer(row, &["pid"]) == Some(process_id));
        let Some(window) = rows
            .iter()
            .filter(|row| {
                row.get("is_on_screen")
                    .or_else(|| row.get("isOnScreen"))
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(true)
                    && row
                        .get("on_current_space")
                        .or_else(|| row.get("onCurrentSpace"))
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(true)
            })
            .filter_map(|row| {
                let pid = integer(row, &["pid"])?;
                if pid == process_id {
                    return None;
                }
                let window_id = integer(row, &["window_id", "windowId"])?;
                let z_index = integer(row, &["z_index", "zIndex"]).unwrap_or(i64::MIN);
                Some((z_index, pid, window_id, row))
            })
            .max_by_key(|(z_index, _, _, _)| *z_index)
        else {
            if has_own_window {
                return Err(CuaError::PermissionDenied);
            }
            return Ok(None);
        };
        let (_, pid, window_id, window) = window;
        let result = self
            .call(
                "get_window_state",
                serde_json::json!({
                    "session": self.session,
                    "pid": pid,
                    "window_id": window_id,
                    "max_elements": 240,
                    "max_depth": 14
                }),
            )
            .await?;
        if result.is_error {
            return Ok(None);
        }
        let structured = parse_structured(&result);
        let elements = structured
            .get("elements")
            .and_then(serde_json::Value::as_array)
            .map(|rows| {
                rows.iter()
                    .filter_map(|row| {
                        let reference = row.get("element_token")?.as_str()?.trim();
                        let role = row.get("role")?.as_str()?.trim();
                        if reference.is_empty() || role.is_empty() {
                            return None;
                        }
                        let name = row
                            .get("label")
                            .or_else(|| row.get("name"))
                            .or_else(|| row.get("value"))
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("")
                            .chars()
                            .take(500)
                            .collect();
                        Some(SurfaceElement {
                            reference: reference.chars().take(500).collect(),
                            role: role.chars().take(100).collect(),
                            name,
                            disabled: row.get("enabled").and_then(serde_json::Value::as_bool)
                                == Some(false),
                        })
                    })
                    .take(240)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let screenshot_base64 = result.images.first().map(|image| image.data_base64.clone());
        let fallback_width = window
            .pointer("/bounds/width")
            .and_then(serde_json::Value::as_u64);
        let fallback_height = window
            .pointer("/bounds/height")
            .and_then(serde_json::Value::as_u64);
        let width = unsigned(
            &structured,
            &["screenshot_width", "screenshotWidth", "width"],
        )
        .or(fallback_width)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(1);
        let height = unsigned(
            &structured,
            &["screenshot_height", "screenshotHeight", "height"],
        )
        .or(fallback_height)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(1);
        let fingerprint = if let Some(screenshot) = screenshot_base64.as_deref() {
            format!("{:x}", Sha256::digest(screenshot.as_bytes()))
        } else {
            let semantic = elements
                .iter()
                .map(|element| (&element.role, &element.name, element.disabled))
                .collect::<Vec<_>>();
            let encoded = serde_json::to_vec(&semantic).map_err(|_| CuaError::Unavailable)?;
            format!("{:x}", Sha256::digest(encoded))
        };
        Ok(Some(Observation {
            id: Uuid::new_v4(),
            route: if elements.is_empty() {
                ObservationRoute::WindowVision
            } else {
                ObservationRoute::Accessibility
            },
            width,
            height,
            fingerprint,
            elements,
            screenshot_base64,
            target_pid: Some(pid),
            target_window_id: Some(window_id),
        }))
    }
}

fn parse_structured(result: &cua_driver_sdk::ToolResult) -> serde_json::Value {
    result
        .structured_json
        .as_deref()
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .unwrap_or(serde_json::Value::Null)
}

fn integer(value: &serde_json::Value, names: &[&str]) -> Option<i64> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(serde_json::Value::as_i64))
}

fn unsigned(value: &serde_json::Value, names: &[&str]) -> Option<u64> {
    names.iter().find_map(|name| {
        let value = value.get(*name)?;
        value.as_u64().or_else(|| {
            value
                .as_f64()
                .filter(|number| number.is_finite() && *number >= 1.0 && number.fract() == 0.0)
                .and_then(|number| number.to_string().parse::<u64>().ok())
        })
    })
}

#[async_trait]
impl CuaHost for DirectCuaHost {
    async fn status(&self) -> Result<CuaStatus, CuaError> {
        let status = current_mac_os_permission_status();
        Ok(CuaStatus {
            accessibility: if status.accessibility {
                PermissionState::Granted
            } else {
                PermissionState::Denied
            },
            screen_recording: if status.screen_recording {
                PermissionState::Granted
            } else {
                PermissionState::Denied
            },
            semantic_contract: Some(SUPPORTED_SEMANTIC_CONTRACT),
        })
    }

    async fn request_permissions_from_user_gesture(&self) -> Result<CuaStatus, CuaError> {
        let status = request_mac_os_permissions();
        Ok(CuaStatus {
            accessibility: if status.accessibility {
                PermissionState::Granted
            } else {
                PermissionState::Denied
            },
            screen_recording: if status.screen_recording {
                PermissionState::Granted
            } else {
                PermissionState::Denied
            },
            semantic_contract: Some(SUPPORTED_SEMANTIC_CONTRACT),
        })
    }

    async fn observe(&self) -> Result<Observation, CuaError> {
        self.current_observation().await
    }

    #[allow(clippy::too_many_lines)]
    async fn execute_once(
        &self,
        action: CuaAction,
    ) -> Result<(ActionEffect, Observation), CuaError> {
        let (tool, arguments) = match action {
            CuaAction::Click {
                x,
                y,
                target_pid,
                target_window_id,
                ..
            } => (
                "click",
                target_arguments(&self.session, target_pid, target_window_id, x, y),
            ),
            CuaAction::TypeText {
                text,
                target_pid,
                target_window_id,
                ..
            } => (
                "type_text",
                keyboard_arguments(&self.session, target_pid, target_window_id, "text", &text),
            ),
            CuaAction::Keypress {
                keys,
                target_pid,
                target_window_id,
                ..
            } => {
                if keys.len() == 1 {
                    (
                        "press_key",
                        keyboard_arguments(
                            &self.session,
                            target_pid,
                            target_window_id,
                            "key",
                            &keys[0],
                        ),
                    )
                } else {
                    let mut arguments = target_base(&self.session, target_pid, target_window_id);
                    arguments["keys"] = serde_json::json!(keys);
                    ("hotkey", arguments)
                }
            }
            CuaAction::Scroll {
                delta_x,
                delta_y,
                target_pid,
                target_window_id,
                x,
                y,
                ..
            } => {
                let (direction, amount) = if delta_y.abs() >= delta_x.abs() {
                    (
                        if delta_y < 0 { "up" } else { "down" },
                        delta_y.unsigned_abs(),
                    )
                } else {
                    (
                        if delta_x < 0 { "left" } else { "right" },
                        delta_x.unsigned_abs(),
                    )
                };
                let mut arguments =
                    target_arguments(&self.session, target_pid, target_window_id, x, y);
                arguments["direction"] = serde_json::json!(direction);
                arguments["by"] = serde_json::json!("line");
                arguments["amount"] = serde_json::json!(amount.max(1));
                ("scroll", arguments)
            }
            CuaAction::SemanticClick { reference, .. } => (
                "click",
                serde_json::json!({
                    "session": self.session,
                    "element_token": reference,
                    "delivery_mode": "background"
                }),
            ),
        };
        let result = self.call(tool, arguments).await?;
        if result.is_error {
            let code = result.error_code.as_deref().unwrap_or("");
            let diagnostic = format!(
                "{code} {} {}",
                result.raw_json,
                result.structured_json.as_deref().unwrap_or("")
            );
            if code.contains("stale") || diagnostic.contains("stale_element_token") {
                return Err(CuaError::StaleObservation);
            }
            if diagnostic.contains("unknown") && diagnostic.contains("element") {
                return Err(CuaError::UnknownReference);
            }
            return Err(CuaError::UnknownOutcome);
        }
        let effect_name = result.action.as_ref().and_then(|action| {
            serde_json::to_value(action.effect)
                .ok()
                .and_then(|value| value.as_str().map(str::to_owned))
        });
        let effect = match effect_name.as_deref() {
            Some("confirmed") => ActionEffect::Confirmed,
            Some("suspected_noop") => ActionEffect::NoEffect,
            Some("refused") => return Err(CuaError::Rejected),
            _ => ActionEffect::Unknown,
        };
        if effect == ActionEffect::Unknown {
            return Err(CuaError::UnknownOutcome);
        }
        let observation = self.current_observation().await?;
        Ok((effect, observation))
    }
}

fn target_base(
    session: &str,
    target_pid: Option<i64>,
    target_window_id: Option<i64>,
) -> serde_json::Value {
    match (target_pid, target_window_id) {
        (Some(pid), Some(window_id)) => serde_json::json!({
            "session": session,
            "scope": "window",
            "pid": pid,
            "window_id": window_id
        }),
        _ => serde_json::json!({ "session": session, "scope": "desktop" }),
    }
}

fn target_arguments(
    session: &str,
    target_pid: Option<i64>,
    target_window_id: Option<i64>,
    x: f64,
    y: f64,
) -> serde_json::Value {
    let mut value = target_base(session, target_pid, target_window_id);
    value["x"] = serde_json::json!(x);
    value["y"] = serde_json::json!(y);
    value
}

fn keyboard_arguments(
    session: &str,
    target_pid: Option<i64>,
    target_window_id: Option<i64>,
    key: &str,
    value: &str,
) -> serde_json::Value {
    let mut arguments = target_base(session, target_pid, target_window_id);
    arguments[key] = serde_json::json!(value);
    arguments
}

#[derive(Debug, Default)]
pub struct UnavailableCuaHost;

#[async_trait]
impl CuaHost for UnavailableCuaHost {
    async fn status(&self) -> Result<CuaStatus, CuaError> {
        Ok(CuaStatus {
            accessibility: PermissionState::Unavailable,
            screen_recording: PermissionState::Unavailable,
            semantic_contract: None,
        })
    }

    async fn request_permissions_from_user_gesture(&self) -> Result<CuaStatus, CuaError> {
        Err(CuaError::Unavailable)
    }

    async fn observe(&self) -> Result<Observation, CuaError> {
        Err(CuaError::Unavailable)
    }

    async fn execute_once(
        &self,
        _action: CuaAction,
    ) -> Result<(ActionEffect, Observation), CuaError> {
        Err(CuaError::Unavailable)
    }
}
