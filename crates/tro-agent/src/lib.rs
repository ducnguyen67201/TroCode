//! Host-owned Responses tool loop and exact-action approval state machine.

use std::collections::{HashMap, VecDeque};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use tokio_util::sync::CancellationToken;
use tro_domain::{Consequence, approval_digest, requires_exact_approval};
use uuid::Uuid;

pub const MAX_SESSION_ITEMS: usize = 64;
pub const MAX_SESSION_BYTES: usize = 3_500_000;
pub const MAX_TOOL_CALLS: u32 = 40;
pub const MAX_MODEL_SAMPLES: u32 = 48;
pub const MAX_TOOL_ARGUMENT_BYTES: usize = 64 * 1024;
pub const MAX_TOOL_OUTPUT_BYTES: usize = 3_000_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub consequence: ToolConsequence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolConsequence {
    Routine,
    Login,
    Send,
    Submit,
    Upload,
    Download,
    Delete,
    Purchase,
    Install,
    Command,
    FileWrite,
}

impl From<ToolConsequence> for Consequence {
    fn from(value: ToolConsequence) -> Self {
        match value {
            ToolConsequence::Routine => Self::Routine,
            ToolConsequence::Login => Self::Login,
            ToolConsequence::Send => Self::Send,
            ToolConsequence::Submit => Self::Submit,
            ToolConsequence::Upload => Self::Upload,
            ToolConsequence::Download => Self::Download,
            ToolConsequence::Delete => Self::Delete,
            ToolConsequence::Purchase => Self::Purchase,
            ToolConsequence::Install => Self::Install,
            ToolConsequence::Command => Self::Command,
            ToolConsequence::FileWrite => Self::FileWrite,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionItem {
    User {
        text: String,
    },
    Assistant {
        text: String,
    },
    ToolCall {
        call_id: String,
        name: String,
        arguments: Value,
    },
    ToolOutput {
        call_id: String,
        output: Value,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModelRequest {
    pub task_id: Uuid,
    pub items: Vec<SessionItem>,
    pub tools: Vec<ToolSpec>,
    pub parallel_tool_calls: bool,
    pub store: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ModelTurn {
    Final(String),
    ToolCall {
        call_id: String,
        name: String,
        arguments: Value,
    },
}

#[derive(Debug, Error)]
pub enum AgentError {
    #[error("task was cancelled")]
    Cancelled,
    #[error("model request failed with an uncertain outcome")]
    ModelUncertain,
    #[error("model requested an unavailable tool")]
    UnknownTool,
    #[error("model tool arguments exceeded their limit")]
    ToolArgumentsTooLarge,
    #[error("tool output exceeded its limit")]
    ToolOutputTooLarge,
    #[error("task exceeded its tool-call budget")]
    ToolBudgetExceeded,
    #[error("task exceeded its model-sample budget")]
    ModelBudgetExceeded,
    #[error("exact approval was denied")]
    ApprovalDenied,
    #[error("action outcome is unknown; retry is forbidden")]
    ActionUncertain,
    #[error("tool failed")]
    ToolFailed,
}

#[async_trait]
pub trait ResponsesClient: Send + Sync {
    /// Samples exactly one model turn.
    ///
    /// # Errors
    ///
    /// Returns an agent error when the provider outcome is rejected, invalid,
    /// cancelled, or uncertain.
    async fn sample(&self, request: ModelRequest) -> Result<ModelTurn, AgentError>;
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn spec(&self) -> ToolSpec;
    /// Produces the bounded, user-visible summary for an exact approval.
    ///
    /// # Errors
    ///
    /// Returns an agent error when arguments cannot be safely summarized.
    fn approval_summary(&self, arguments: &Value) -> Result<Vec<String>, AgentError>;
    /// Executes one already-validated tool proposal.
    ///
    /// # Errors
    ///
    /// Returns an agent error when execution is rejected, fails, is cancelled,
    /// or has an uncertain outcome.
    async fn execute(&self, arguments: Value) -> Result<Value, AgentError>;
}

#[async_trait]
pub trait ApprovalBroker: Send + Sync {
    /// Requests a decision for one exact argument digest.
    ///
    /// # Errors
    ///
    /// Returns an agent error when the approval interaction is cancelled or
    /// cannot be completed safely.
    async fn decide(&self, request: ApprovalRequest) -> Result<ApprovalDecision, AgentError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovalRequest {
    pub task_id: Uuid,
    pub tool_name: String,
    pub digest: String,
    pub summary: Vec<String>,
    pub arguments: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalDecision {
    Approve,
    Deny,
}

pub struct AgentRuntime<C, A> {
    client: C,
    approvals: A,
    strict_autonomy: bool,
    tools: HashMap<String, Box<dyn Tool>>,
}

impl<C, A> std::fmt::Debug for AgentRuntime<C, A> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AgentRuntime")
            .field("strict_autonomy", &self.strict_autonomy)
            .field("tool_count", &self.tools.len())
            .finish_non_exhaustive()
    }
}

impl<C, A> AgentRuntime<C, A>
where
    C: ResponsesClient,
    A: ApprovalBroker,
{
    #[must_use]
    pub fn new(client: C, approvals: A, strict_autonomy: bool) -> Self {
        Self {
            client,
            approvals,
            strict_autonomy,
            tools: HashMap::new(),
        }
    }

    /// Registers one named trusted tool.
    ///
    /// # Errors
    ///
    /// Returns [`AgentError::UnknownTool`] when a tool with that name is
    /// already registered.
    pub fn register(&mut self, tool: Box<dyn Tool>) -> Result<(), AgentError> {
        let name = tool.spec().name;
        if self.tools.insert(name, tool).is_some() {
            return Err(AgentError::UnknownTool);
        }
        Ok(())
    }

    /// Runs one bounded, serial Responses tool loop.
    ///
    /// # Errors
    ///
    /// Returns an agent error for cancellation, budget/size violations,
    /// unavailable tools, approval failures, provider uncertainty, rejected
    /// tool execution, or uncertain consequential outcomes.
    pub async fn run(
        &self,
        task_id: Uuid,
        user_text: String,
        cancellation: &CancellationToken,
    ) -> Result<String, AgentError> {
        let mut session = VecDeque::from([SessionItem::User { text: user_text }]);
        let mut specs = self
            .tools
            .values()
            .map(|tool| tool.spec())
            .collect::<Vec<_>>();
        specs.sort_by(|left, right| left.name.cmp(&right.name));
        let mut tool_calls = 0_u32;
        let mut model_samples = 0_u32;

        loop {
            if cancellation.is_cancelled() {
                return Err(AgentError::Cancelled);
            }
            model_samples = model_samples.saturating_add(1);
            if model_samples > MAX_MODEL_SAMPLES {
                return Err(AgentError::ModelBudgetExceeded);
            }
            let turn = self
                .client
                .sample(ModelRequest {
                    task_id,
                    items: session.iter().cloned().collect(),
                    tools: specs.clone(),
                    parallel_tool_calls: false,
                    store: false,
                })
                .await?;
            match turn {
                ModelTurn::Final(text) => return Ok(text),
                ModelTurn::ToolCall {
                    call_id,
                    name,
                    arguments,
                } => {
                    self.process_tool_call(
                        task_id,
                        call_id,
                        name,
                        arguments,
                        &mut session,
                        &mut tool_calls,
                    )
                    .await?;
                }
            }
        }
    }

    async fn process_tool_call(
        &self,
        task_id: Uuid,
        call_id: String,
        name: String,
        arguments: Value,
        session: &mut VecDeque<SessionItem>,
        tool_calls: &mut u32,
    ) -> Result<(), AgentError> {
        *tool_calls = tool_calls.saturating_add(1);
        if *tool_calls > MAX_TOOL_CALLS {
            return Err(AgentError::ToolBudgetExceeded);
        }
        if serde_json::to_vec(&arguments)
            .map_err(|_| AgentError::ToolArgumentsTooLarge)?
            .len()
            > MAX_TOOL_ARGUMENT_BYTES
        {
            return Err(AgentError::ToolArgumentsTooLarge);
        }
        let tool = self.tools.get(&name).ok_or(AgentError::UnknownTool)?;
        let spec = tool.spec();
        let summary = tool.approval_summary(&arguments)?;
        push_bounded(
            session,
            SessionItem::ToolCall {
                call_id: call_id.clone(),
                name: name.clone(),
                arguments: arguments.clone(),
            },
        );
        if name != "request_user_input"
            && requires_exact_approval(spec.consequence.into(), self.strict_autonomy)
        {
            let serialized =
                serde_json::to_string(&arguments).map_err(|_| AgentError::ToolArgumentsTooLarge)?;
            let digest = approval_digest(&[&task_id.to_string(), &name, &serialized]);
            let decision = self
                .approvals
                .decide(ApprovalRequest {
                    task_id,
                    tool_name: name.clone(),
                    digest,
                    summary,
                    arguments: arguments.clone(),
                })
                .await?;
            if decision == ApprovalDecision::Deny {
                push_bounded(
                    session,
                    SessionItem::ToolOutput {
                        call_id,
                        output: serde_json::json!({
                            "status": "denied",
                            "message": "The user denied this exact action. Do not retry it without a materially different user request."
                        }),
                    },
                );
                return Ok(());
            }
        }
        let output = match tool.execute(arguments).await {
            Ok(output) => output,
            Err(AgentError::ToolFailed) => {
                push_bounded(
                    session,
                    SessionItem::ToolOutput {
                        call_id,
                        output: serde_json::json!({
                            "status": "rejected",
                            "message": "The trusted Rust host did not execute this action because validation failed or the observed state changed. Obtain a fresh observation before proposing another action."
                        }),
                    },
                );
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        if serde_json::to_vec(&output)
            .map_err(|_| AgentError::ToolOutputTooLarge)?
            .len()
            > MAX_TOOL_OUTPUT_BYTES
        {
            return Err(AgentError::ToolOutputTooLarge);
        }
        push_bounded(session, SessionItem::ToolOutput { call_id, output });
        Ok(())
    }
}

fn push_bounded(session: &mut VecDeque<SessionItem>, item: SessionItem) {
    session.push_back(item);
    while session.len() > MAX_SESSION_ITEMS || session_bytes(session) > MAX_SESSION_BYTES {
        let removed = session.pop_front();
        if let Some(SessionItem::ToolCall { call_id, .. }) = removed
            && matches!(session.front(), Some(SessionItem::ToolOutput { call_id: output_id, .. }) if output_id == &call_id)
        {
            session.pop_front();
        }
    }
}

fn session_bytes(session: &VecDeque<SessionItem>) -> usize {
    session.iter().fold(0_usize, |total, item| {
        total.saturating_add(
            serde_json::to_vec(item)
                .map_or(MAX_SESSION_BYTES.saturating_add(1), |bytes| bytes.len()),
        )
    })
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use super::*;
    use tokio::sync::Mutex;

    type RequestLog = Arc<Mutex<Vec<ModelRequest>>>;
    type TestRuntime = AgentRuntime<ScriptedClient, FixedApproval>;
    type RuntimeHarness = (TestRuntime, Arc<AtomicUsize>, RequestLog);

    #[derive(Debug)]
    struct ScriptedClient {
        requests: Arc<Mutex<Vec<ModelRequest>>>,
        turns: Mutex<VecDeque<Result<ModelTurn, AgentError>>>,
    }

    #[async_trait]
    impl ResponsesClient for ScriptedClient {
        async fn sample(&self, request: ModelRequest) -> Result<ModelTurn, AgentError> {
            self.requests.lock().await.push(request);
            self.turns
                .lock()
                .await
                .pop_front()
                .ok_or(AgentError::ModelUncertain)?
        }
    }

    #[derive(Debug)]
    struct FixedApproval(ApprovalDecision);

    #[async_trait]
    impl ApprovalBroker for FixedApproval {
        async fn decide(&self, _request: ApprovalRequest) -> Result<ApprovalDecision, AgentError> {
            Ok(self.0)
        }
    }

    #[derive(Debug, Clone, Copy)]
    enum ToolBehavior {
        Success,
        Rejected,
        Uncertain,
    }

    #[derive(Debug)]
    struct FakeTool {
        behavior: ToolBehavior,
        calls: Arc<AtomicUsize>,
        consequence: ToolConsequence,
    }

    #[async_trait]
    impl Tool for FakeTool {
        fn spec(&self) -> ToolSpec {
            ToolSpec {
                name: String::from("fake"),
                description: String::from("Test tool."),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }),
                consequence: self.consequence,
            }
        }

        fn approval_summary(&self, _arguments: &Value) -> Result<Vec<String>, AgentError> {
            Ok(vec![String::from("Run the fake tool once.")])
        }

        async fn execute(&self, _arguments: Value) -> Result<Value, AgentError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            match self.behavior {
                ToolBehavior::Success => Ok(serde_json::json!({ "status": "ok" })),
                ToolBehavior::Rejected => Err(AgentError::ToolFailed),
                ToolBehavior::Uncertain => Err(AgentError::ActionUncertain),
            }
        }
    }

    fn scripted_runtime(
        turns: Vec<Result<ModelTurn, AgentError>>,
        approval: ApprovalDecision,
        behavior: ToolBehavior,
        consequence: ToolConsequence,
    ) -> RuntimeHarness {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let client = ScriptedClient {
            requests: Arc::clone(&requests),
            turns: Mutex::new(VecDeque::from(turns)),
        };
        let calls = Arc::new(AtomicUsize::new(0));
        let mut runtime = AgentRuntime::new(client, FixedApproval(approval), false);
        let registered = runtime.register(Box::new(FakeTool {
            behavior,
            calls: Arc::clone(&calls),
            consequence,
        }));
        assert!(registered.is_ok());
        (runtime, calls, requests)
    }

    fn fake_call() -> ModelTurn {
        ModelTurn::ToolCall {
            call_id: String::from("call-1"),
            name: String::from("fake"),
            arguments: serde_json::json!({}),
        }
    }

    #[tokio::test]
    async fn denial_never_dispatches_the_consequential_tool() {
        let (runtime, calls, _) = scripted_runtime(
            vec![
                Ok(fake_call()),
                Ok(ModelTurn::Final(String::from("denied safely"))),
            ],
            ApprovalDecision::Deny,
            ToolBehavior::Success,
            ToolConsequence::Submit,
        );
        let result = runtime
            .run(
                Uuid::new_v4(),
                String::from("test"),
                &CancellationToken::new(),
            )
            .await;
        assert_eq!(result.ok().as_deref(), Some("denied safely"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn known_validation_rejection_is_returned_to_the_model() {
        let (runtime, calls, requests) = scripted_runtime(
            vec![
                Ok(fake_call()),
                Ok(ModelTurn::Final(String::from("recovered"))),
            ],
            ApprovalDecision::Approve,
            ToolBehavior::Rejected,
            ToolConsequence::Routine,
        );
        let result = runtime
            .run(
                Uuid::new_v4(),
                String::from("test"),
                &CancellationToken::new(),
            )
            .await;
        assert_eq!(result.ok().as_deref(), Some("recovered"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let requests = requests.lock().await;
        let has_rejection = requests.get(1).is_some_and(|request| {
            request.items.iter().any(|item| {
                matches!(
                    item,
                    SessionItem::ToolOutput { output, .. }
                        if output.get("status").and_then(Value::as_str) == Some("rejected")
                )
            })
        });
        assert!(has_rejection);
    }

    #[tokio::test]
    async fn uncertain_action_is_terminal_and_never_sampled_again() {
        let (runtime, calls, requests) = scripted_runtime(
            vec![
                Ok(fake_call()),
                Ok(ModelTurn::Final(String::from("must not run"))),
            ],
            ApprovalDecision::Approve,
            ToolBehavior::Uncertain,
            ToolConsequence::Submit,
        );
        let result = runtime
            .run(
                Uuid::new_v4(),
                String::from("test"),
                &CancellationToken::new(),
            )
            .await;
        assert!(matches!(result, Err(AgentError::ActionUncertain)));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(requests.lock().await.len(), 1);
    }
}
