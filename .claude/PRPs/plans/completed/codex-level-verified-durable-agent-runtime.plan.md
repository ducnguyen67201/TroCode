# Plan: Codex-Level Verified Durable Agent Runtime

## Summary

Move TroCode from an Electron-owned, best-effort agent loop to a backend-owned OpenAI Agents SDK supervisor that can survive desktop disconnects, API restarts, long tasks, and ambiguous tool outcomes. Keep the existing native CUA driver, policy broker, exact approvals, workspace tools, and sandboxed renderer as the trusted local execution boundary.

The central product invariant becomes:

> A task may enter completed only after every required outcome criterion has independent evidence with a passed verifier result.

This plan does not host Codex app-server and does not require users to own a Codex or ChatGPT account. TroCode runs the OpenAI Agents SDK in its Railway backend with the TroCode OpenAI API key, while the signed-in Tro desktop acts as a reconnectable tool worker for local files, terminal commands, browser state, application launch, and native computer use.

The delivery order is intentionally reliability-first:

1. Outcome contracts, evidence ledger, and a hard completion gate.
2. Direct application launch with deterministic post-action verification.
3. Durable backend run state and an authenticated reconnectable desktop worker.
4. Backend Agents SDK ownership, resumable sessions, compaction, and recovery.
5. Existing native CUA retained as the visual/accessibility fallback.
6. Semantic browser control first, with explicitly authorized Playwright/CDP only when deeper DOM access is needed.
7. Adaptive overview images plus original-resolution crops on demand.
8. Host-selected Luna, Terra, and Sol routing with explicit reasoning effort.
9. Trace-driven evaluation, an end-to-end CUA benchmark, canary cohorts, and rollback gates.
10. Safe inference retries, prompt caching, queue backpressure, and cost-per-verified-success optimization.

## User Story

As a TroCode user, I want the agent to keep actively working until my requested outcome is demonstrably complete, recover when either the app or backend disconnects, and tell me honestly when an action is uncertain, so that I can trust long-running Workspace, browser, and desktop tasks without babysitting them.

## Problem to Solution

The current Electron process owns the Agents SDK Runner, in-memory session, completion heuristic, tool counters, and cleanup. A candidate answer can call TaskRuntime.complete directly, application launch is considered confirmed when the OS merely accepts the request, and a restart loses active run state. The backend is mainly a stateless Responses proxy and cost ledger.

Replace that arrangement with a backend run supervisor and durable state machine. The backend owns the task contract, model loop, leases, session items, evidence ledger, outcome verification, model routing, tracing, and task-event stream. Electron main remains the only component allowed to execute local side effects. It consumes durable tool invocations, validates them again, applies local policy and approval, executes once, observes the result, and returns evidence.

## Metadata

- **Complexity**: XL
- **Source PRD**: N/A
- **PRD Phase**: Standalone reliability and runtime program
- **Repository baseline**: origin/main at 895d36d52626cc19054353753e714d8d401aed02
- **Estimated files**: 90-105 files across shared contracts, Electron main, CUA/browser adapters, Railway API, migrations, tests, scripts, configuration, and docs
- **Estimated implementation tasks**: 12 dependency-ordered tasks
- **Recommended delivery**: Six mergeable gates behind a backend runtime feature flag, followed by a canary rollout and one-release local-runtime rollback window
- **OpenAI SDK baseline checked**: @openai/agents 0.17.0 and openai 7.5.0 on 2026-08-20
- **Playwright baseline checked**: playwright-core 1.62.1 on 2026-08-20
- **Security precondition**: Rotate the Railway PostgreSQL credential that was pasted into this conversation before implementation or deployment. Do not copy it into the plan, repository, logs, or test fixtures.

---

## Current Coverage Audit

| Recommended capability | Current state on main | Required change |
|---|---|---|
| Outcome contracts and hard completion gate | Missing. AgentTaskContract v6 has no current success criteria, completion review is a request regex, and TaskRuntime.complete accepts only a summary. | Add contract v7, evidence records, separate verifiers, and completion checks in both the local runtime and backend transaction. |
| Direct application launch and deterministic verification | Partially complete. Chrome is found and launched directly, but an OS-accepted request is reported as confirmed without observing a Chrome window. | Return an accepted receipt, bind or find the Chrome surface, and confirm only after a fresh observation. |
| Native computer runtime using the existing CUA driver | Covered desktop-side. CUA already has lazy task sessions, semantic browser/window routes, screenshot fallback, freshness, exact approval, and unknown-result suppression. | Preserve it and expose it through a reconnectable DesktopToolWorker. Do not replace it with hosted computer use. |
| Original-resolution screenshot transport | Missing. Images wider than 1536 px are always resized to JPEG quality 72. | Keep the bounded overview, retain the original only in memory, and add an on-demand original-resolution crop tool with pixel/token budgets. |
| Browser DOM or Playwright lane | Partially complete. The CUA driver already provides browser semantic state and actions. There is no separate Playwright/CDP adapter. | Keep CUA semantics first; add a feature-flagged, one-use-authorized Playwright CDP adapter for strict locator operations and deterministic DOM verification. |
| Luna, Terra, and Sol routing | Missing. One configured model is used, and the API catalog contains only Luna and Terra. | Add a pure backend routing policy, explicit reasoning effort, Sol pricing, and eval-gated escalation. |
| Durable task-event persistence and recovery | Partially complete. Desktop snapshots/events persist, but SDK state, counters, pending tool calls, approvals, and leases are process memory. | Move active run ownership to the API, add durable model/tool/evidence state, replayable events, worker heartbeats, and restart recovery. |
| Automated CUA benchmark and canary rollout | Partially complete. A semantic fast-path report measures route latency and screenshot count, but not end-to-end verified task success or rollout cohorts. | Add deterministic task fixtures, fault injection, verified-success metrics, stable canary assignment, kill switch, and release gates. |

The native CUA driver and recent Chrome launch work are foundations, not work to redo. The largest missing layer is durable supervision with a truthful completion boundary.

---

## Product Boundary

### In scope

- Everyday and explicitly selected Workspace tasks run through a TroCode-owned Agents SDK supervisor in the hosted API.
- Users authenticate only with the existing TroCode device session. They do not supply an OpenAI API key or sign in to Codex.
- One task can continue through model calls, desktop tools, workspace tools, clarification, approval, steering, compaction, API restart, and desktop reconnect.
- Electron main remains the only authority for local filesystem paths, shell commands, CUA sessions, browser-profile attachment, and exact action approval.
- The backend decides which installed tool can be proposed, but a model tool call is never approval or proof of execution.
- Required outcomes are explicit, versioned, independently verified, and attached to evidence references.
- Task and worker event streams are replayable by sequence number.
- Model and screenshot detail are selected by host policy, not by free-form model choice.
- Existing task history remains readable through forward-only migration.

### Out of scope

- Hosting or exposing Codex app-server to TroCode customers.
- Requiring a Codex, ChatGPT Plus, Pro, Business, or Enterprise account.
- Exposing the TroCode OpenAI key, raw Agents SDK state, raw CUA, Electron IPC, CDP endpoints, cookies, browser tokens, or local paths to the renderer.
- Uploading or persisting screenshot bytes, browser cookies, full DOM snapshots, raw command output, raw tool arguments, chain-of-thought, or unsaved workspace buffers.
- Retrying a consequential action after execution may have started.
- Silently attaching Playwright to the user's daily browser profile.
- Treating a model-authored criterion as new authority, approval, or permission.
- Removing the existing local runtime until the canary meets all gates.

### Privacy change that must be explicit

The current architecture documentation says the hosted service does not receive ordinary task history. A backend-owned SDK necessarily receives the task request, model output, and tool-result envelope in memory and needs short-lived durable state for restart recovery. This is an intentional product and privacy change.

Implement it with all of the following:

- update the privacy notice before enabling the feature;
- encrypt operational session payloads with AES-256-GCM using a dedicated TROCODE_AGENT_STATE_ENCRYPTION_KEY;
- never place raw screenshots, secrets, cookies, command output, or reasoning text in task history or analytics;
- persist only sanitized public events and encrypted, TTL-bound operational state;
- delete encrypted session/tool payloads after the retention window while keeping sanitized lifecycle and billing records;
- make the backend runtime fail closed when the encryption key is absent;
- keep OpenAI Responses store set to false.

---

## UX Design

### Before

~~~text
User: Open Chrome, go to Gmail, and read my latest full email.

Tro
  Working...
  Opened Chrome.
  Opened Gmail.

  Done: Your latest email is ...

Possible hidden failure:
  - Chrome launch was only accepted by the OS.
  - Gmail may still be loading.
  - Only the inbox preview may have been read.
  - The Electron process may have lost the run after restart.
~~~

### After

~~~text
User: Open Chrome, go to Gmail, and read my latest full email.

Tro
  Working
  [passed] Chrome window is visible
  [passed] Gmail inbox is open
  [working] Open and inspect the newest message
  [pending] Read the complete message body

  Reconnecting to your computer...     shown only if the worker disconnects
  Verifying 4 of 4 outcomes...

  Completed and verified
  The latest email is from ...
~~~

### Interaction changes

| Touchpoint | Before | After |
|---|---|---|
| Submission | Electron creates and starts an in-memory run. | Electron submits a versioned contract to the API and subscribes to its event stream. |
| Live status | Generic planning, working, or verifying phase. | Current outcome criterion, tool state, reconnect state, and bounded activity timeline. |
| Completion | Candidate answer plus optional same-agent checkpoint. | Backend refuses completed unless every required criterion is passed. |
| App launch | Confirmed when Electron shell accepts the path. | Accepted first; confirmed only after Chrome is observed. |
| Disconnect | Active run fails or disappears with process memory. | Run waits for the worker, resumes from a durable checkpoint, or becomes honestly blocked. |
| Approval | Held by the local coordinator. | Backend persists the interruption; Electron shows the exact local approval; the same run resumes. |
| History | Lifecycle summary and conversation. | Lifecycle summary plus verified or unverified outcome status; no private evidence payloads. |
| Browser control | CUA semantics or screenshot coordinates. | CUA semantics first, optionally strict Playwright locators after one-use authorization, then accessibility/vision fallback. |
| Screenshot | One globally downscaled image. | Bounded overview by default; original-resolution crop only when requested and budgeted. |

Accessibility requirements:

- announce criterion and phase changes through the existing aria-live surface;
- do not announce token deltas, heartbeats, or every lease renewal;
- use text and icon together for passed, failed, pending, recovering, and unknown;
- keep Stop task available in every nonterminal phase;
- never let reconnection overlays cover an exact approval card.

---

## Target Architecture

~~~text
Sandboxed React renderer
        |
        | narrow validated DesktopApi
        v
Electron main
  HostedTaskClient -------- HTTPS/SSE --------> Railway API
  DesktopToolWorker <---- durable commands ---- AgentRunWorker
        |                                      |
        | local validation + policy            | OpenAI Agents SDK Runner
        | exact approval                       | DurableAgentSession
        |                                      | OutcomeCompiler
        +--> direct APIs / workspace tools      | OutcomeVerifier
        +--> CUA browser semantics              | ModelPolicy
        +--> authorized Playwright/CDP          | BudgetedResponsesTransport
        +--> accessibility / vision fallback    |
        |                                      v
        +------ result + fresh evidence ---- PostgreSQL
                                               |
                                               + agent_runs
                                               + agent_run_events
                                               + agent_session_items
                                               + agent_run_checkpoints
                                               + agent_tool_invocations
                                               + agent_outcome_criteria
                                               + agent_evidence
                                               + agent_worker_sessions
~~~

### Ownership rules

| Concern | Owner |
|---|---|
| User identity, task ownership, task/run phase, event ordering | Railway API and PostgreSQL |
| Agent loop, model selection, reasoning effort, compaction, tracing | Railway API |
| Outcome contract policy and completion authority | Railway API; mirrored pure local gate during rollback window |
| Local tool catalog and normalized operation identity | Shared protocol plus Electron main registry |
| Local path resolution, shell environment, CUA session, CDP attachment | Electron main only |
| Exact approval UI and local action revalidation | Electron main |
| OpenAI key, price catalog, reservations, provider dispatch | Railway API only |
| Renderer presentation | Sandboxed renderer through DesktopApi |

### Why SSE plus POST, not socket-only transport

Use authenticated fetch-based SSE for server-to-desktop task events and tool commands, and bounded POST endpoints for heartbeat, acknowledgement, result, approval, steering, and cancellation.

- Every command and result exists in PostgreSQL before transport.
- Last-Event-ID or an explicit after sequence replays missed events.
- A reconnect can be served by any Railway instance; no sticky session is required.
- PostgreSQL LISTEN/NOTIFY may reduce wake latency, with a bounded polling fallback for missed notifications.
- Existing opaque bearer-session authentication and HTTP hardening are reused.
- The stream is an optimization over the durable outbox, not the source of truth.

Do not hold an uncommitted database transaction for the lifetime of a stream.

---

## Outcome Contract and Completion Gate

### Contract v7

Add an AgentTaskContractV7 schema. Preserve v1-v6 parsing for history, but emit v7 for new runs.

~~~ts
type OutcomeContract = {
  schemaVersion: 1;
  revision: number;
  completionMode: 'all_required';
  criteria: Array<{
    id: string;
    description: string;
    required: boolean;
    verifier:
      | { kind: 'assistant_output'; constraints: string[] }
      | { kind: 'application_surface'; application: 'chrome' }
      | { kind: 'browser_semantic'; assertion: string }
      | { kind: 'filesystem_effect'; assertion: string }
      | { kind: 'tool_effect'; toolId: string; operation: string }
      | { kind: 'semantic_judge'; rubric: string };
  }>;
};
~~~

Rules:

1. A small schema-bound OutcomeCompiler receives the original request, execution profile, and available verifier kinds. It receives no action tools.
2. The compiler may describe an outcome but cannot grant a tool, path, target, approval, or larger limit.
3. OutcomeContractPolicy rejects unknown verifier kinds, unbounded criteria, hidden authority, and criteria unrelated to the request.
4. Simple answer-only tasks may use a deterministic assistant_output template and skip a compiler call.
5. Every actual effectful tool invocation adds a host-generated effect obligation even if the compiler omitted it.
6. Steering that changes the goal creates a new revision. Previously passed evidence is retained only when its criterion identity and verifier digest remain unchanged.
7. A semantic judge is allowed only when deterministic verification is unavailable. It has no tools and cannot mark unrelated criteria.

### Evidence ledger

Evidence is append-only and references an outcome criterion:

~~~ts
type OutcomeEvidence = {
  id: string;
  runId: string;
  criterionId: string;
  source:
    | 'assistant_output'
    | 'tool_result'
    | 'fresh_observation'
    | 'browser_dom'
    | 'filesystem'
    | 'semantic_judge';
  status: 'supports' | 'contradicts' | 'unknown';
  invocationId?: string;
  observationId?: string;
  observationFingerprint?: string;
  createdAt: string;
};
~~~

Persist public metadata and a bounded sanitized summary. If a verifier requires sensitive detail during recovery, store that detail only in the encrypted operational payload with a TTL. Store screenshot fingerprints and crop coordinates, never screenshot bytes.

### Hard completion rule

The backend repository method completeVerified must:

1. lock the run row;
2. reject a terminal, cancelled, expired, or stale-lease run;
3. select the current contract revision;
4. prove that no required criterion is pending, failed, or unknown;
5. require a final assistant output when the contract contains assistant_output;
6. atomically append the completed event and change the run status;
7. return a typed conflict if any criterion is not passed.

TaskRuntime.complete in the local fallback must accept a CompletionDecision rather than a summary and enforce the same pure predicate. The executor's own final text is never sufficient evidence for an effectful outcome.

---

## Durable Run and Tool State

### Run phases

Use one backend state vocabulary and map it to the existing renderer phases:

~~~text
queued
  -> compiling_outcomes
  -> planning
  -> awaiting_worker
  -> executing_tool
  -> awaiting_input
  -> awaiting_approval
  -> verifying
  -> recovering
  -> completed | blocked | failed | cancelled
~~~

Only repository compare-and-set methods may transition these states. Each successful transition appends exactly one event with a monotonic per-run sequence.

### Tool invocation states

~~~text
requested
  -> delivered
  -> executing
  -> confirmed | failed | denied | not_executed | unknown | cancelled | expired
~~~

Rules:

- The API creates invocationId and callId and persists the encrypted bounded request before publishing it.
- Electron validates protocol version, user/session ownership, tool identity, operation, schema, limits, and local policy before asking to execute.
- Electron requests the executing transition before dispatch. The API grants that transition at most once.
- The desktop keeps an in-memory recent-invocation cache and returns the same terminal result for duplicate deliveries.
- requested or delivered commands can be replayed with the same invocationId.
- Once executing is granted, a disconnect before a terminal result is ambiguous.
- Read-only, deterministic operations may be retried only when their policy explicitly declares retrySafe and the same idempotency key is supported.
- A consequential invocation in executing with no terminal result becomes unknown and blocks further consequential work.
- Never turn an unknown into confirmed from a model statement.

### Leases and heartbeats

- One AgentRunWorker claims a runnable task with SELECT FOR UPDATE SKIP LOCKED.
- Default run lease: 30 seconds; renew every 10 seconds while model or tool work is active.
- Desktop worker heartbeat: every 10 seconds; considered unavailable after 35 seconds.
- An expired backend lease makes the run reclaimable.
- A missing desktop worker changes the run to awaiting_worker without consuming model samples.
- Task deadline, tool deadline, provider deadline, and lease deadline are separate fields.
- Queue limits are per user and global; reject excess submissions with a typed retry-after response.

### Session persistence and compaction

Implement a PostgreSQL-backed Session for the Agents SDK and wrap it with OpenAIResponsesCompactionSession from @openai/agents 0.17.0.

- Use Session for completed-turn conversation history and a separate encrypted serialized RunState checkpoint for an interrupted in-flight turn. The SDK Session alone is insufficient because it persists outputs after a run completes.
- Define every Electron-executed function tool with an SDK interruption boundary. When the model selects one, the Runner returns before the effect, and the backend persists result.state.toString() without a tracing API key.
- Create the durable remote invocation only after the RunState checkpoint commits.
- After the desktop commits a terminal result, reconstruct the same versioned agent/tool graph with RunState.fromStringWithContext. Resolve the interruption, then let the tool callback act only as a pure result resolver that reads the already-committed invocation result. It must never execute the local effect.
- Treat this SDK interruption as an execution checkpoint, not as user approval. Electron's policy and exact approval UI remain the only human-authorization boundary.
- Parallel tool calls remain disabled so every remote side effect has one serializable checkpoint and one invocation.
- Persist session items encrypted with AES-256-GCM and authenticated metadata containing run ID, sequence, schema version, and key version.
- Keep the current screenshot or crop only in an in-memory visual sidecar.
- Before persistence, replace image bytes with a typed image-expired marker and retain only observation metadata.
- After restart, a required visual continuation must request a fresh observation rather than replay an old screenshot.
- Use store false and compactionMode input so PostgreSQL is the source of truth.
- Trigger compaction by measured token estimate and item count during an idle boundary, not immediately after the last text delta.
- Treat the compact endpoint result as the canonical replacement window. Do not arbitrarily slice or reorder it.
- Persist the encrypted compaction item and retained items exactly as returned after removing prohibited image bytes.

---

## Direct, Browser, and Vision Capability Order

### Direct application launch

Change DesktopApplicationLauncher.launch to return an accepted receipt instead of void. ApplicationSurfaceVerifier then polls a fresh CUA window list for a bounded period and matches the exact application identity.

~~~text
path found -> shell.openPath accepted -> observe window list
    -> exactly one matching Chrome surface visible: confirmed
    -> timeout or ambiguous match: unknown
    -> OS launch rejection: failed
~~~

Do not automatically launch Chrome again after unknown. Generalize the verifier interface, but keep Chrome as the only launchable application in this delivery unless another app has deterministic cross-platform candidates and tests.

### Browser hierarchy

1. Existing CUA get_browser_state and browser actions.
2. Authorized Playwright/CDP strict locator adapter.
3. Native window accessibility.
4. Window screenshot and original-resolution crop.
5. Full-desktop vision only when the narrower route cannot progress.

Playwright rules:

- add playwright-core only; do not package browser binaries;
- attach only to a CDP endpoint produced by the existing one-use browser authorization flow;
- use chromium.connectOverCDP with noDefaults true and a bounded timeout;
- bind the exact authorized browser/window/tab and reject a changed target;
- use strict locators and fresh DOM assertions after mutations;
- do not enumerate or expose unrelated tabs, cookies, storage, credentials, CDP endpoints, or raw DOM to the model or renderer;
- close only the Playwright connection, never the user's browser;
- treat CDP as lower fidelity than a native Playwright connection and fall back cleanly;
- keep the feature disabled until its browser-profile security tests pass.

### Adaptive screenshot policy

- semantic/accessibility observations carry no image when sufficient;
- overview: maximum width 1536, JPEG quality 72, one current image;
- crop: derive from the current original in memory, clamp to the authorized surface, maximum 2048 by 2048 pixels, and send with original detail when the SDK/provider supports it;
- full original: disabled by default and allowed only by explicit host policy under a per-task pixel/token budget;
- every crop cites the current observation ID and coordinate transform;
- a new observation invalidates prior crop authority;
- no image bytes enter PostgreSQL, analytics, task history, or renderer IPC.

---

## Model Routing, Cost, and Retry Policy

### Pure host-selected routing

Create AgentModelPolicy as a deterministic function of task profile, installed tools, risk, context size, recovery count, verifier type, plan allowance, and benchmark-proven routes.

| Workload | Default model and effort | Escalation |
|---|---|---|
| Outcome compilation, simple direct answer, deterministic verifier | Luna, low | Terra medium only after invalid structured output or eval-proven need |
| Normal Everyday tool task | Terra, medium | Sol high after a bounded recovery threshold |
| Workspace coding, multi-app CUA, difficult semantic reading | Terra, high | Sol high or xhigh when the benchmark predicts material gain |
| Independent semantic completion judge | Terra, medium | Sol high for high-value or repeatedly failed verification |
| Hardest quality-first tasks | Sol, high or xhigh | max or pro only behind a separate eval-proven allowlist |

The model cannot choose or escalate itself. Persist the chosen route and reason code, not task content, in sanitized telemetry.

### Price catalog

Add gpt-5.6-sol with the current official per-million-token prices:

- input: 5,000,000 micro-USD;
- cached input: 500,000 micro-USD;
- cache write: 6,250,000 micro-USD;
- output: 30,000,000 micro-USD.

Keep Luna and Terra prices aligned with official model pages and add the greater-than-272K context multiplier. Replace the current character-equals-token reservation estimate with a conservative token estimator and explicit image estimate. Continue to settle from provider usage.

### Safe provider retry

- SDK retry remains disabled.
- The budgeted transport may retry at most two times only when the provider definitively rejected or failed before any response event was observed.
- Honor Retry-After and use exponential backoff with jitter.
- After headers or any stream event, the model step is uncertain and is not replayed automatically.
- A replayed inference request uses the same logical modelStepId and a new provider request ID.
- Tool invocations are independently idempotent and are never inferred from a retried model response.
- Add a circuit breaker and per-user/global queue backpressure for sustained 429 or 5xx responses.

### Caching

- Keep the stable system instructions, tool schemas, and policy prefix byte-identical and in a consistent order.
- Measure cache writes and reads before enabling explicit cache breakpoints.
- Do not cache user-specific screenshots, secrets, approvals, or volatile tool results.
- Report cost per verified success, not merely cost per model call.

---

## External Documentation

| Source | Implementation consequence |
|---|---|
| [OpenAI Agents SDK guide](https://developers.openai.com/api/docs/guides/agents) | The SDK track fits when the server owns deployment, tool implementations, storage, approvals, and product logic while the SDK runs the loop. |
| [OpenAI Agents SDK sessions](https://openai.github.io/openai-agents-js/guides/sessions/) | Implement a custom PostgreSQL Session and use OpenAIResponsesCompactionSession; schedule compaction at idle boundaries to avoid delaying stream completion. |
| [OpenAI Agents SDK RunState](https://openai.github.io/openai-agents-js/openai/agents/classes/runstate/) | Serialize an interrupted in-flight run with toString and rebuild the same agent graph before resuming. Never persist a tracing API key. |
| [OpenAI Agents SDK human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/) | Use the SDK interruption/resume mechanism as a durable remote-execution checkpoint while keeping TroCode's local policy as the real approval authority. |
| [OpenAI compaction guide](https://developers.openai.com/api/docs/guides/compaction) | Keep store false, preserve encrypted compaction items, and treat the compact endpoint response as the canonical next window. |
| [OpenAI Agents SDK observability](https://developers.openai.com/api/docs/guides/agents/integrations-observability) | Enable tracing in the server runtime with sensitive data disabled; add custom spans around outcome, tool transport, recovery, and compaction. |
| [OpenAI agent evaluation guide](https://developers.openai.com/api/docs/guides/agent-evals) | Debug with traces first, then promote representative failures to repeatable datasets and eval runs. |
| [OpenAI GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model) | Route Sol, Terra, and Luna intentionally, set reasoning effort explicitly, preserve reusable reasoning state, benchmark pro/max, and use original image detail selectively. |
| [OpenAI model catalog](https://developers.openai.com/api/docs/models) | Use official model IDs, context limits, and current token pricing in the API-owned catalog. |
| [Playwright BrowserType.connectOverCDP](https://playwright.dev/docs/api/class-browsertype) | CDP attachment is Chromium-only and lower fidelity; attach only through explicit authorization, set noDefaults true, and keep a semantic/CUA fallback. |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---:|---|
| P0 | src/shared/contracts.ts | 99-120, 254-299, 333-349, 534-557 | Legacy success criteria, current v6 contract, lifecycle phases, and snapshot schema that become v7-compatible |
| P0 | src/main/agent/task-runtime.ts | 238-277 | Current pure verification transition and unconditional complete method |
| P0 | src/main/agent/completion-policy.ts | 91-127 | Regex-based completion review being demoted from authority |
| P0 | src/main/agent/execution-coordinator.ts | 580-650, 776-815, 1045-1157, 1877-1916 | Current application launch receipt, in-memory context, completion path, and cleanup |
| P0 | src/main/agent/openai-agents-runtime.ts | 335-380 | Electron-owned Runner, single model, disabled tracing, disabled retry, and store false |
| P0 | src/main/agent/bounded-agent-session.ts | all | In-memory Session and arbitrary item/byte bounds to replace with durable compaction |
| P0 | src/main/agent/agent-runtime.ts | all | Provider-neutral runtime boundary and callback shape to preserve during migration |
| P0 | src/main/agent/runtime-tool-registry.ts | 850-900 | Trusted direct navigation and application launch schemas and normalization |
| P0 | src/main/application/task-application-service.ts | 21-101 | Submission, trusted workspace/activity resolution, and execution entry point |
| P0 | src/main/application/desktop-application-launcher.ts | all | Cross-platform Chrome candidates and current OS-accepted-only semantics |
| P0 | src/main/cua/cua-service.ts | 62-85, 380-430, 1083-1096 | CUA performance schema, task-scoped sessions, observation, and route telemetry |
| P0 | src/main/cua/cua-surface-router.ts | 664-835 | Existing browser semantic lane to keep ahead of Playwright and vision |
| P0 | services/api/src/server.mjs | 500-600 | Current authenticated Responses proxy route and request validation |
| P0 | services/api/src/openai-responses-service.mjs | 1-224, 226-end | Budget reservation, ambiguous-dispatch handling, streaming usage, and no-retry baseline |
| P0 | services/api/src/main.mjs | 32-157 | API composition root, migrations, services, HTTP server, and graceful shutdown |
| P0 | services/api/src/config.mjs | 1-159 | Strict environment parsing and current single-model allowlist |
| P0 | services/api/src/model-catalog.mjs | all | API-owned price calculation and inaccurate character-based reservation estimate |
| P0 | services/api/src/agent-turn-repository.mjs | all | Transaction, advisory lock, idempotent creation, and conflict pattern |
| P0 | services/api/src/knowledge-ingestion-job-repository.mjs | all | Lease claim with SKIP LOCKED and bounded retry pattern |
| P1 | src/shared/desktop-api.ts | all | Narrow renderer bridge that must not expose a generic tool channel |
| P1 | src/preload.ts | submitTask and task-update handlers | Input/output parsing at the renderer boundary |
| P1 | src/main/ipc/register-ipc.ts | 472-535 | Trusted sender, membership, and task IPC enforcement |
| P1 | src/main/history/task-history-store.ts | 15-140 | Current snapshot/event transaction and desktop-owned persistence |
| P1 | src/main/history/task-history-migration.ts | all | Forward-only v5/v6 read repair and runtimeResume removal |
| P1 | src/main/inference/image-evidence.ts | all | Current 1536-pixel JPEG policy |
| P1 | src/main/analytics/analytics-service.ts | 26-63, 298-312 | Content-free CUA and task telemetry allowlist |
| P1 | scripts/cua-fast-path-report.mjs | 91-126 | Existing benchmark report and regression gate style |
| P1 | services/api/test/server.test.mjs | 123-145, 569-775 | In-memory DI server tests, auth, model allowlist, and true SSE delivery |
| P1 | services/api/test/migrate.test.mjs | all | Migration count/order assertion that must include migration 014 |
| P2 | docs/architecture.md | 38-88, 103-155, 182-212 | Current runtime, trust, hosted-data, and persistence decisions that this program changes |
| P2 | docs/security.md | 1-87, 106-149, 157-170 | Local authority, sensitive data, provider key, cancellation, and release requirements |
| P2 | docs/computer-use-lifecycle.md | all | Freshness, semantic references, approval, unknown-result, and cleanup invariants |
| P2 | docs/inference-cost-lifecycle.md | all | Reservations, settlement, uncertain calls, and privacy rules |
| P2 | .claude/PRPs/plans/completed/seamless-openai-agent-runtime.plan.md | Summary, architecture, safety sections | Historical rationale for the current SDK/CUA design; preserve useful invariants but supersede Electron ownership |
| P2 | .claude/PRPs/plans/completed/cua-semantic-fast-path.plan.md | Summary, validation, rollout sections | Existing semantic route and benchmark gates |

docs/CODEX-NAVIGATION-GUIDE.md is referenced by AGENTS.md but is not present at this repository baseline. Do not block implementation on that missing document; use the ownership map above.

---

## Unified Discovery Table

| Category | File and lines | Pattern to preserve | Key evidence |
|---|---|---|---|
| Similar implementation | services/api/src/knowledge-ingestion-job-repository.mjs:3-48 | Durable worker lease with SKIP LOCKED and bounded retries | Best existing backend pattern for reclaimable work |
| Naming | src/main/application/task-application-service.ts:21-101 | Noun-based service classes with verb methods and injected interfaces | Use AgentRunService.submit, AgentRunWorker.runOnce, HostedTaskClient.subscribe |
| Error handling | services/api/src/http-primitives.mjs:1-44 | Typed HttpError plus bounded JSON parsing | New endpoints return stable error codes without provider or local details |
| Logging | services/api/src/main.mjs:141-149 and src/main/cua/cua-service.ts:1083-1085 | Small structured event logs | Log IDs, phase, route, status, duration, and counts only |
| Type definitions | src/shared/contracts.ts:254-299 | Zod schema first, inferred TypeScript type after | Use versioned discriminated unions at IPC, HTTP, persistence, and model boundaries |
| Tests | services/api/test/server.test.mjs:123-145, 569-775 | Dependency-injected real HTTP server with memory repositories | Test auth, replay, ownership, and first SSE event without live services |
| Configuration | services/api/src/config.mjs:1-159 | Strict startup validation and explicit defaults | Parse all runtime flags, models, limits, TTLs, and keys at boot |
| Dependencies | root and services/api package.json | Exact versions for runtime-sensitive packages | Keep desktop/API Agents SDK versions aligned; add playwright-core without browsers |
| Entry point | TaskApplicationService -> IPC -> HostedTaskClient -> API | Trusted submission resolves workspace/activity before remote work | The backend never accepts a client-provided raw workspace path |
| Data flow | execution-coordinator.ts:1045-1157 | Model tool callback returns through the host broker | Replace local model ownership, not local effect ownership |
| State changes | task-runtime.ts and agent-turn-repository.mjs | Pure lifecycle plus transactional idempotency | Every state transition emits one durable ordered event |
| Contracts | runtime-tool-registry.ts:850-900 | Strict model schema maps to trusted internal identity | Protocol sends internal tool ID/operation selected by the host registry |
| Architecture | docs/architecture.md:103-155 | Model proposes; trusted host authorizes and executes | Backend model loop does not weaken Electron local authority |

---

## Patterns to Mirror

### Schema-first boundary

SOURCE: src/shared/contracts.ts:254-299

~~~ts
export const AgentTaskContractV6Schema = z
  .object({
    schemaVersion: z.literal(6),
    id: z.string().uuid(),
    originalRequest: z.string().min(2).max(8_000),
    runtimeKind: AgentRuntimeKindSchema,
    executionProfile: ExecutionProfileSchema,
  })
  .superRefine((contract, context) => {
    // Cross-field authority validation.
  });
~~~

Define v7 and every worker/API envelope with a strict Zod schema. The backend is plain ESM and cannot import TypeScript directly, so create equivalent API schemas and prove compatibility with shared JSON protocol fixtures and a protocol version constant.

### Dependency-injected application service

SOURCE: src/main/application/task-application-service.ts:21-76

~~~ts
export class TaskApplicationService {
  constructor(
    private readonly runtime: TaskRuntime,
    private readonly execution: TaskExecutionCoordinator,
    private readonly options: TaskApplicationServiceOptions = {},
  ) {}

  async submitAndStart(input: unknown): Promise<TaskSnapshot> {
    const request = SubmitTaskRequestSchema.parse(input);
    // Resolve trusted context, submit, then start.
  }
}
~~~

Keep renderer IPC thin. HostedTaskClient, DesktopToolWorker, AgentRunService, AgentRunWorker, model policy, and verifiers all receive interfaces so tests use fakes.

### Transactional idempotency

SOURCE: services/api/src/agent-turn-repository.mjs:32-98

~~~js
const client = await this.pool.connect();
try {
  await client.query('BEGIN');
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [input.userId],
  );
  // Read duplicate, insert once, commit.
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
~~~

Use row locks or advisory locks for submission idempotency, completion, cancellation, worker execution grants, and event sequence allocation. Never perform a local tool effect inside a database transaction.

### Reclaimable worker lease

SOURCE: services/api/src/knowledge-ingestion-job-repository.mjs:6-25

~~~js
WITH candidate AS (
  SELECT id
  FROM jobs
  WHERE queued_or_expired
  ORDER BY available_at, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE jobs
SET state = 'leased', lease_owner = $1, lease_expires_at = ...
FROM candidate
WHERE jobs.id = candidate.id
RETURNING ...
~~~

Use this for agent_runs. Renew leases with compare-and-set on lease_owner and version; an old worker must not publish after losing its lease.

### Content-free telemetry

SOURCE: src/main/analytics/analytics-service.ts:298-312

~~~ts
this.capture('cua operation completed', {
  duration_ms: Math.round(metric.durationMs),
  fallback_reason: metric.fallbackReason,
  operation: metric.operation,
  route: metric.route,
  screenshot_attached: metric.screenshotAttached,
  status: metric.status,
});
~~~

Extend with verified_completion, false_completion, recovery, queue wait, model route, criterion count, and cost. Never add request text, evidence summary, URL, path, command, selector, typed text, screenshot, or raw arguments.

### Fresh-observation and unknown-outcome rule

SOURCE: docs/computer-use-lifecycle.md:69-77

Every dispatched desktop action returns a fresh observation. Unknown adds the exact action digest to do-not-dispatch. An approved consequential unknown blocks and cleans up. The distributed worker state machine must preserve this exactly.

### Real SSE delivery test

SOURCE: services/api/test/server.test.mjs:720-775

Use a ReadableStream that yields one event, waits on a promise, then yields completion. Assert the client receives the first task or worker event before the producer finishes, and assert Last-Event-ID replay after reconnect.

---

## Files to Change

### Shared contracts and Electron main

- MODIFY src/shared/contracts.ts
- MODIFY src/shared/desktop-api.ts
- MODIFY src/preload.ts
- MODIFY src/main/ipc/register-ipc.ts
- MODIFY src/index.ts
- MODIFY src/main/application/task-application-service.ts
- CREATE src/main/application/hosted-task-client.ts
- CREATE src/main/application/hosted-task-client.test.ts
- CREATE src/main/agent/outcome-contract.ts
- CREATE src/main/agent/outcome-contract.test.ts
- CREATE src/main/agent/outcome-verifier.ts
- CREATE src/main/agent/outcome-verifier.test.ts
- MODIFY src/main/agent/task-contract.ts
- MODIFY src/main/agent/task-contract.test.ts
- MODIFY src/main/agent/task-runtime.ts
- MODIFY src/main/agent/task-runtime.test.ts
- MODIFY src/main/agent/completion-policy.ts
- MODIFY src/main/agent/completion-policy.test.ts
- MODIFY src/main/agent/execution-coordinator.ts
- MODIFY src/main/agent/execution-coordinator.test.ts
- MODIFY src/main/agent/agent-runtime-factory.ts
- MODIFY src/main/agent/agent-runtime-factory.test.ts
- MODIFY src/main/agent/runtime-tool-registry.ts
- MODIFY src/main/agent/runtime-tool-registry.test.ts
- MODIFY src/main/application/desktop-application-launcher.ts
- MODIFY src/main/application/desktop-application-launcher.test.ts
- CREATE src/main/application/application-surface-verifier.ts
- CREATE src/main/application/application-surface-verifier.test.ts
- CREATE src/main/hosted/desktop-worker-client.ts
- CREATE src/main/hosted/desktop-worker-client.test.ts
- CREATE src/main/hosted/desktop-tool-worker.ts
- CREATE src/main/hosted/desktop-tool-worker.test.ts
- MODIFY src/main/cua/cua-service.ts
- MODIFY src/main/cua/cua-service.test.ts
- MODIFY src/main/cua/cua-surface-router.ts
- MODIFY src/main/cua/cua-surface-router.test.ts
- CREATE src/main/browser/browser-dom-adapter.ts
- CREATE src/main/browser/playwright-browser-dom-adapter.ts
- CREATE src/main/browser/playwright-browser-dom-adapter.test.ts
- MODIFY src/main/inference/image-evidence.ts
- CREATE src/main/inference/image-evidence-policy.ts
- CREATE src/main/inference/image-evidence-policy.test.ts
- MODIFY src/main/history/task-history-migration.ts
- MODIFY src/main/history/task-history-migration.test.ts
- MODIFY src/main/history/task-history-service.ts
- MODIFY src/main/history/task-history-service.test.ts
- CREATE src/main/history/hosted-task-history-store.ts
- CREATE src/main/history/hosted-task-history-store.test.ts
- MODIFY src/main/analytics/analytics-service.ts
- MODIFY src/main/analytics/analytics-service.test.ts

### Railway API

- CREATE services/api/migrations/014_agent_runtime.sql
- CREATE services/api/src/agent-runtime-contracts.mjs
- CREATE services/api/src/agent-tool-catalog.mjs
- CREATE services/api/src/agent-state-crypto.mjs
- CREATE services/api/src/agent-run-repository.mjs
- CREATE services/api/src/agent-run-service.mjs
- CREATE services/api/src/agent-run-worker.mjs
- CREATE services/api/src/durable-agent-session.mjs
- CREATE services/api/src/backend-agent-runtime.mjs
- CREATE services/api/src/outcome-compiler.mjs
- CREATE services/api/src/outcome-verifier.mjs
- CREATE services/api/src/desktop-worker-controller.mjs
- CREATE services/api/src/agent-event-stream.mjs
- CREATE services/api/src/budgeted-responses-transport.mjs
- CREATE services/api/src/agent-model-policy.mjs
- CREATE matching services/api/test unit files for every module above
- MODIFY services/api/src/server.mjs
- MODIFY services/api/src/main.mjs
- MODIFY services/api/src/config.mjs
- MODIFY services/api/src/model-catalog.mjs
- MODIFY services/api/src/openai-responses-service.mjs
- MODIFY services/api/src/migrate.mjs if migration discovery assumptions change
- MODIFY services/api/test/server.test.mjs
- MODIFY services/api/test/migrate.test.mjs

### Scripts, configuration, dependencies, and docs

- CREATE scripts/agent-reliability-benchmark.mjs
- CREATE scripts/agent-reliability-benchmark.test.mjs
- CREATE test/fixtures/agent-reliability-scenarios.json
- MODIFY scripts/cua-fast-path-report.mjs
- MODIFY scripts/cua-fast-path-report.test.mjs
- MODIFY package.json and package-lock.json
- MODIFY services/api/package.json and services/api/package-lock.json
- MODIFY .env.example
- MODIFY services/api/railway.json only if a separate worker process is selected during deployment
- MODIFY docs/architecture.md
- MODIFY docs/security.md
- MODIFY docs/computer-use-lifecycle.md
- MODIFY docs/inference-cost-lifecycle.md
- MODIFY docs/conversational-task-execution.md
- CREATE docs/agent-runtime-operations.md

Do not delete OpenAIAgentsRuntime or the existing Responses proxy until the canary passes and one packaged rollback release has shipped.

---

## Implementation Tasks

### Task 1: Add contract v7, outcome policy, evidence types, and local hard completion gate

- **ACTION**: Add versioned schemas, pure policies, migrations, fixtures, and tests.
- **IMPLEMENT**:
  - Add OutcomeContractSchema, OutcomeCriterionSchema, OutcomeEvidenceSchema, CriterionResultSchema, CompletionDecisionSchema, and AgentTaskContractV7Schema.
  - Emit v7 from task-contract.ts and preserve v1-v6 parsing for history.
  - Add a pure outcome contract validator that limits criteria, verifier kinds, descriptions, and authority-bearing fields.
  - Change TaskRuntime.complete(taskId, summary) to complete(taskId, decision), where decision must pass every required current-revision criterion.
  - Keep completion-policy.ts only as a hint for whether semantic judging is needed; remove its ability to authorize completion.
  - Add protocol JSON fixtures parsed by both TypeScript shared schemas and API ESM schemas.
- **MIRROR**: src/shared/contracts.ts schema-first unions; task-history-migration.ts forward-only repair; task-runtime.ts pure lifecycle.
- **IMPORTS**: zod, node:crypto only for stable criterion/verifier digests.
- **GOTCHA**:
  - Do not migrate legacy terminal history into resumable active runs.
  - A compiler output is not a capability grant.
  - Direct-answer tasks still need a bounded assistant_output criterion.
  - Existing UI must tolerate criterion fields being absent on legacy snapshots.
- **VALIDATE**:
  - npm test -- --run src/main/agent/outcome-contract.test.ts src/main/agent/outcome-verifier.test.ts src/main/agent/task-runtime.test.ts src/main/history/task-history-migration.test.ts
  - Add a test proving TaskRuntime rejects completed when one required criterion is pending or unknown.

### Task 2: Make Chrome launch deterministic and evidence-producing

- **ACTION**: Convert OS acceptance into a nonterminal receipt and add bounded surface verification.
- **IMPLEMENT**:
  - Make DesktopApplicationLauncher.launch return application, acceptedAt, and an opaque launch receipt.
  - Add ApplicationSurfaceVerifier using a narrow CuaService window-query method.
  - Poll for at most 10 seconds with cancellation and a short bounded interval.
  - Match Chrome by trusted driver application identity, not window title or page text.
  - Return confirmed with fresh observation evidence only when the surface exists; return unknown on timeout/ambiguity.
  - Register the application_surface evidence against the outcome criterion.
- **MIRROR**: CUA fresh observation and confirmed/unknown/failed result vocabulary.
- **IMPORTS**: Existing CUA driver and AbortSignal; no shell command or process-list package.
- **GOTCHA**:
  - openPath success means accepted, not visible.
  - Do not relaunch automatically after unknown.
  - Verification must not force Screen Recording permissions for text-only tasks before a launch tool is actually used.
- **VALIDATE**:
  - Unit tests for accepted plus observed, accepted plus timeout, duplicate matching surfaces, cancellation, OS rejection, and not installed.
  - Existing execution-coordinator launch test must assert confirmed only after verifier evidence.

### Task 3: Add durable backend schema, repositories, encryption, leases, and event ordering

- **ACTION**: Create migration 014 and repository/service state machines before introducing the backend Runner.
- **IMPLEMENT**:
  - Add agent_runs, agent_run_events, agent_session_items, agent_run_checkpoints, agent_tool_invocations, agent_outcome_criteria, agent_evidence, and agent_worker_sessions.
  - Add ownership foreign keys, unique task/idempotency keys, state checks, sequence uniqueness, lease indexes, TTL indexes, and encrypted payload columns.
  - Encrypt the task request/contract, criterion descriptions/assertions, SDK RunState, session items, tool requests/results, and sensitive evidence detail. Keep only owner IDs, digests, tool IDs/operations, states, timestamps, counts, and sanitized public summaries in plaintext.
  - Implement AES-256-GCM envelope helpers with random 96-bit IVs, authentication tags, key version, and authenticated metadata.
  - Add transactional methods for submit, claim, renew, append event, register invocation, grant execution, record result, revise outcomes, completeVerified, cancel, and expire.
  - Use one monotonic sequence per run and support after-sequence pagination.
  - Add a cleanup method for expired encrypted payloads without deleting billing or sanitized terminal records.
- **MIRROR**: agent-turn-repository.mjs transaction/idempotency and knowledge-ingestion-job-repository.mjs lease claim.
- **IMPORTS**: node:crypto, pg, zod.
- **GOTCHA**:
  - Never encrypt with the session-token HMAC key.
  - Do not log ciphertext, IV, authentication tags, or plaintext.
  - Old lease owners must fail compare-and-set writes.
  - Migration must be safe on an existing Railway database and contain no destructive table rewrite.
- **VALIDATE**:
  - npm --prefix services/api test
  - Repository concurrency tests with two claimers.
  - Migration test expects 14 files and checks all runtime tables/indexes.
  - Encryption round-trip, wrong-key, tampered-ciphertext, and key-version tests.

### Task 4: Build the backend Agents SDK runtime, durable session, compaction, and budgeted transport

- **ACTION**: Run the Agents SDK in the API while preserving current budget and uncertain-dispatch semantics.
- **IMPLEMENT**:
  - Add @openai/agents 0.17.0 and openai 7.5.0 to services/api; align the root Agents SDK version.
  - Implement DurableAgentSession over agent_session_items.
  - Wrap it with OpenAIResponsesCompactionSession using compactionMode input and a token/item trigger.
  - Add a server allowlisted AgentToolCatalog that mirrors model names and strict schemas from RuntimeToolRegistry. Intersect it with the connected worker's signed-in capability advertisement and verify a shared protocol/schema digest.
  - Define every remote effect tool as an SDK interruption. Persist result.state.toString() before publishing the invocation, rebuild with RunState.fromStringWithContext, and use the resumed tool callback only to return the committed result.
  - Add an in-memory visual sidecar that reattaches only the latest current screenshot/crop and never persists bytes.
  - Implement BudgetedResponsesTransport as an injected OpenAI fetch path that reserves before dispatch, streams without buffering, parses completed usage, settles cost, and preserves ambiguous outcomes.
  - Create BackendAgentRuntime and AgentRunWorker. The Runner owns the model/tool continuation; the worker owns leases and recovery.
  - Add schema-bound OutcomeCompiler and separate OutcomeVerifier agents with no effect tools.
  - Enable Agents SDK tracing with traceIncludeSensitiveData false and add custom spans for run, criterion, model route, tool wait, recovery, and compaction.
  - Persist modelStepId, chosen route, provider request ID, dispatch state, response ID, usage status, and sanitized timing metadata.
  - Reserve an AgentTurnService turn for the initial user message, clarification answer, and steering message; internal model/tool continuations reuse the active turn.
- **MIRROR**: openai-agents-runtime.ts Runner settings and openai-responses-service.mjs reservation/settlement.
- **IMPORTS**: @openai/agents, openai, zod; no desktop or Electron modules in services/api.
- **GOTCHA**:
  - The Runner must use only backend-defined remote function tools.
  - Session.addItems is not a mid-run checkpoint. Recovery of an interrupted tool must use serialized RunState.
  - RunState resumption requires the same versioned agent/tool graph. A schema-digest mismatch blocks with upgrade-required instead of guessing.
  - Never serialize with includeTracingApiKey true.
  - Do not call the public TroCode Responses HTTP endpoint from the same API process.
  - Streaming cost settlement must continue if the desktop task-event subscriber disconnects.
  - Compaction is a paid provider call and needs its own reservation/usage lane.
  - Never fall back to arbitrary first-plus-last history slicing.
- **VALIDATE**:
  - Fake OpenAI provider tests for multi-tool continuation, stream-first delivery, compaction replacement, provider ambiguity, and restart reconstruction.
  - A crash-after-model-call fixture resumes without duplicating a tool invocation.
  - npm --prefix services/api test.

### Task 5: Add authenticated replayable task and desktop-worker transport

- **ACTION**: Add API endpoints and Electron clients using durable SSE plus POST.
- **IMPLEMENT**:
  - Add POST /v1/tasks, GET /v1/tasks, GET /v1/tasks/:id, GET /v1/tasks/:id/events, DELETE /v1/tasks/:id, POST steering, POST cancel, and approval endpoints.
  - Add GET /v1/desktop-worker/events plus heartbeat, invocation executing, result, and disconnect endpoints.
  - Authenticate every route with the opaque Tro device session, enforce access membership, and check user ownership.
  - Parse Last-Event-ID or after sequence and replay before following live events.
  - Implement HostedTaskClient to submit, subscribe, reconnect with jitter, coalesce text deltas, and project backend events into TaskSnapshot updates.
  - Route production task history through HostedTaskHistoryStore so packaged clients no longer connect directly to the Railway PostgreSQL database. Keep PostgresTaskHistoryStore only for local development and migration tooling.
  - Implement DesktopWorkerClient in Electron main; it must never cross preload.
  - Add protocol version and capability advertisement. The API routes only tools supported by the connected worker version.
  - Use PostgreSQL notification to wake stream pumps and a bounded polling fallback.
- **MIRROR**: server.test.mjs real SSE test, register-ipc.ts trusted sender checks, preload schema parsing.
- **IMPORTS**: Built-in fetch, ReadableStream, AbortController; no EventSource dependency.
- **GOTCHA**:
  - Node fetch SSE supports Authorization; browser EventSource does not and must not be used in the renderer.
  - A stream disconnect does not cancel the run.
  - Do not hold database clients or transactions for open streams.
  - Backpressure or slow clients must receive a reconnect instruction rather than unbounded buffering.
- **VALIDATE**:
  - Auth, ownership, replay, duplicate submit, stale sequence, slow client, server restart, desktop reconnect, and session revocation tests.
  - First event arrives before producer completion.
  - Renderer never receives invocation payloads or encrypted state.

### Task 6: Adapt the existing local broker into a reconnectable DesktopToolWorker

- **ACTION**: Reuse the existing registry, policy, approval, workspace, and CUA adapters behind the remote invocation protocol.
- **IMPLEMENT**:
  - DesktopToolWorker validates invocation envelopes, resolves the registered internal tool and operation, and requests the one-time executing grant before dispatch.
  - After the result commits, the backend resolves the saved SDK interruption. The resumed function callback only fetches that terminal result; it contains no executor.
  - Reuse ToolExecutionBroker, evaluateAction, exact approval digest, workspace root binding, RuntimeToolDispatcher, CuaService, and ApplicationSurfaceVerifier.
  - Return a bounded result plus fresh evidence and content-free metrics.
  - Keep recent terminal results by invocationId in memory for duplicate delivery.
  - Map clarification and approval interruptions to durable backend events while the local UI remains authoritative for the human click.
  - Keep local OpenAIAgentsRuntime behind TROCODE_BACKEND_AGENT_ENABLED=false for rollback; host-selected routing chooses local or hosted, never the model.
- **MIRROR**: execution-coordinator.ts handleInvocation and cleanup, runtime-tool-registry.ts normalization, action-approval.ts digest.
- **IMPORTS**: Existing Electron main services only.
- **GOTCHA**:
  - Remote tool payloads do not contain raw workspace paths; resolve opaque selection IDs locally.
  - Revalidate held desktop approvals against a fresh observation immediately before execution.
  - Unknown consequential results block and end local CUA state but leave the backend run inspectable.
  - Local cleanup must be idempotent across cancellation, backend terminal event, disconnect, and app shutdown.
- **VALIDATE**:
  - Fake transport tests for duplicate delivery, stale approval, changed screen, unknown consequence, reconnect, cancellation during model wait, and cancellation after local dispatch.
  - Existing CUA and workspace policy suites remain green.

### Task 7: Complete recovery, steering, approval, and unknown-action semantics

- **ACTION**: Make every pause and crash boundary resumable or honestly terminal.
- **IMPLEMENT**:
  - Persist awaiting_input and awaiting_approval interaction data as encrypted operational payloads plus sanitized public events.
  - Reconstruct the Agents SDK session and reconcile tool calls by callId/invocationId after lease reclaim.
  - Append a confirmed tool output once when the result committed before a crash.
  - Wait when a command is requested/delivered; mark unknown when executing lost its result; never synthesize success.
  - Queue steering until a safe model boundary and revise outcome contracts when goal scope changes.
  - Preserve cancellation across reconnect and prevent an expired worker from publishing a late result.
  - Add recovery attempt ceilings and transition to blocked with a specific next action instead of looping.
- **MIRROR**: current one-serialized-run-per-task and safe-boundary steering behavior.
- **IMPORTS**: No new dependency.
- **GOTCHA**:
  - Approval denial is a tool result, not a failed task.
  - Cancellation after an external effect cannot undo or retry it.
  - Reclaimed workers must compare the run version and lease owner before every publish.
  - Recovery model calls count toward task budget.
- **VALIDATE**:
  - Fault-injection matrix at every boundary: before dispatch, after headers, after tool requested, after delivery, after executing grant, after local effect, after result commit, during compaction, and before completion commit.
  - Assert duplicateConsequentialActionCount equals zero in every case.

### Task 8: Add adaptive screenshot evidence and original-resolution crops

- **ACTION**: Replace unconditional global resizing with a host-owned detail policy.
- **IMPLEMENT**:
  - Add ImageEvidencePolicy with semantic, overview, crop, and original modes.
  - Retain one original observation buffer only in CuaService task memory with a strict byte/pixel limit.
  - Add an inspect_surface_region tool that cites current observationId and normalized region.
  - Clamp crop coordinates to the bound surface, preserve coordinate transforms, encode within size limits, and return original detail through the Agents SDK type.
  - Invalidate all crops when a new observation arrives.
  - Count overview and crop pixels/tokens separately in task limits and telemetry.
- **MIRROR**: image-evidence.ts safe degradation and context-window-policy.ts one-current-image rule.
- **IMPORTS**: Electron nativeImage through an injected adapter; no Python or image-processing service.
- **GOTCHA**:
  - Original detail can sharply increase tokens and latency.
  - Never persist or stream screenshots to the renderer.
  - A crop is evidence, not authority to click outside the latest surface.
- **VALIDATE**:
  - Unit tests for crop bounds, scale/DPI, stale observation, oversize request, corrupt image, no-image semantic route, and memory cleanup.
  - Benchmark must show improved small-text verification without violating image budget.

### Task 9: Add a guarded Playwright/CDP browser adapter after CUA semantics

- **ACTION**: Add deterministic DOM operations only for an explicitly authorized exact browser resource.
- **IMPLEMENT**:
  - Add playwright-core 1.62.1 without installing browsers.
  - Define BrowserDomAdapter with observe, click, fill, press, scroll, read, and assert methods using opaque references.
  - Implement PlaywrightBrowserDomAdapter using connectOverCDP, noDefaults true, strict locators, bounded timeouts, and exact target binding.
  - Acquire the endpoint only through the existing browser_prepare one-use authorization broker.
  - Return bounded semantic facts and verification evidence; never raw HTML or cookies.
  - Route CUA browser semantics first. Use Playwright only when required capabilities are unavailable or deterministic DOM verification materially improves the criterion.
  - Fall back to accessibility/vision on connection or fidelity failure.
- **MIRROR**: cua-surface-router.ts reference binding, surface fingerprints, and semantic approval revalidation.
- **IMPORTS**: playwright-core only.
- **GOTCHA**:
  - connectOverCDP is Chromium-only and lower fidelity.
  - Do not launch a hidden browser or reuse a profile without authorization.
  - Do not close the user's browser or mutate context defaults.
  - Selectors and page text are sensitive and must not enter analytics.
- **VALIDATE**:
  - Fake CDP/Playwright tests for exact page binding, strict locator ambiguity, changed tab, popup, disconnect, stale reference, and cleanup.
  - Manual packaged tests on clean macOS and Windows Chrome profiles.

### Task 10: Add model routing, Sol pricing, safe retries, caching, and backpressure

- **ACTION**: Make quality/latency/cost decisions explicit and measurable.
- **IMPLEMENT**:
  - Add gpt-5.6-sol and long-context pricing to ModelCatalog.
  - Add comma-separated allowlist configuration and per-lane model/effort defaults.
  - Implement AgentModelPolicy with stable reason codes and bounded escalation.
  - Set reasoning effort on every model request; keep max/pro disabled until eval gates pass.
  - Replace reservation character counting with a conservative token and image estimator.
  - Add safe pre-event inference retry with Retry-After, jitter, and max two attempts.
  - Add provider circuit breaker, global queue depth, per-user active-run limit, and retry-after responses.
  - Measure prompt-cache read/write tokens and keep stable prefixes ordered.
- **MIRROR**: config.mjs strict parsing, model-catalog.mjs integer micro-USD calculations, cost guard reservation states.
- **IMPORTS**: Existing OpenAI and SDK packages; use a tested tokenizer only if its package size and license are acceptable, otherwise keep a documented conservative estimator.
- **GOTCHA**:
  - Do not route solely from user keywords.
  - Do not downgrade an approval or verification requirement to save cost.
  - Prompts over 272K input have a pricing multiplier.
  - A provider stream that emitted anything is uncertain and not retryable.
- **VALIDATE**:
  - Table-driven routing tests and price fixtures for Luna, Terra, Sol, cached input, cache write, long context, reasoning output, and images.
  - Queue fairness, breaker open/half-open, retryable rejection, and ambiguous stream tests.

### Task 11: Add tracing, end-to-end reliability benchmark, and release gates

- **ACTION**: Measure verified task success and failure modes before canarying.
- **IMPLEMENT**:
  - Enable SDK traces server-side with sensitive payloads disabled.
  - Add custom spans and content-free analytics for queue wait, recovery, criterion results, model route, tool transport, compaction, and completion.
  - Create deterministic benchmark scenarios for direct answer, Chrome launch, Gmail full-message read, form fill, spreadsheet edit, workspace file create/test, login wall, stale approval, browser semantic fallback, crop inspection, API restart, desktop restart, and every ambiguous-action boundary.
  - Build a fake desktop worker and scripted model provider for deterministic fault tests.
  - Extend the live/manual benchmark to record verified completion rate, false completion rate, user intervention rate, recovery rate, duplicate consequential action count, p50/p95 latency, model samples, tool calls, screenshots, input/output tokens, and cost per verified success.
  - Write JSON and Markdown reports and fail CI when a hard gate regresses.
- **MIRROR**: scripts/cua-fast-path-report.mjs buildFastPathReport and node:test script pattern.
- **IMPORTS**: Node built-ins only for deterministic report generation.
- **GOTCHA**:
  - A fast but false completion is a failure.
  - Benchmark fixtures contain no real accounts, email text, URLs, paths, or screenshots.
  - Traces must not include sensitive tool inputs or outputs.
- **VALIDATE**:
  - npm run agent:benchmark -- --baseline test/fixtures/... --candidate ...
  - npm run check
  - npm run package

### Task 12: Canary rollout, rollback, docs, and legacy cleanup

- **ACTION**: Ship backend ownership incrementally and remove legacy paths only after evidence.
- **IMPLEMENT**:
  - Add TROCODE_BACKEND_AGENT_ENABLED, TROCODE_BACKEND_AGENT_ROLLOUT_PERCENT, TROCODE_BACKEND_AGENT_CANARY_USERS, runtime protocol version, encryption key, lease/heartbeat, retention, queue, compaction, model, and Playwright flags to config and .env.example.
  - Assign canary users by a stable HMAC hash of user ID; never use random per-request assignment.
  - Start at internal allowlist, then 1 percent, 5 percent, 25 percent, and 100 percent only when gates pass for the minimum sample.
  - Keep an immediate backend kill switch that routes new tasks to the local runtime. In-flight backend runs remain inspectable/cancellable; do not silently duplicate them locally.
  - Document deployment, key rotation, lease inspection, stuck-run recovery, privacy retention, canary queries, rollback, and incident response.
  - Update architecture/security/lifecycle/cost docs to reflect backend task content and encrypted operational state.
  - After one stable packaged release, remove Codex app-server runtime selection and stale TROCODE_CODEX_PATH guidance if it is no longer a supported product path.
  - Remove the local SDK Runner and public Responses proxy only in a separate cleanup change after rollback criteria expire.
- **MIRROR**: cost guard observe/enforce plus kill-switch rollout style.
- **IMPORTS**: Existing HMAC utility or node:crypto.
- **GOTCHA**:
  - Rollback affects new runs only.
  - Encryption-key rotation needs dual-read/single-write key versions until old TTL state expires.
  - Do not claim 100 percent rollout from benchmark results alone; require real canary evidence.
- **VALIDATE**:
  - Config parser tests for every flag and unsafe combination.
  - Canary assignment determinism and kill-switch tests.
  - Clean-machine packaged macOS and Windows permission, restart, reconnect, approval, and sign-out checks.

---

## Delivery Gates

### Gate 1: Truthful local completion

Tasks 1-2. Ship v7 outcome contracts and verified Chrome launch in the current local runtime. This immediately eliminates the highest-confidence false-completion paths before distributed architecture work.

Exit:

- required criteria prevent completion;
- Chrome launch cannot be confirmed without a visible Chrome surface;
- all existing local checks and packaging pass.

### Gate 2: Durable backend foundation

Tasks 3-4. Land database schema, leases, encryption, durable session, compaction, budgeted transport, and backend Runner behind a disabled flag.

Exit:

- backend can run a fully fake remote-tool task through completion;
- API restart reconstructs the session;
- no screenshot bytes are persisted;
- all provider calls remain budgeted.

### Gate 3: Reconnectable desktop execution

Tasks 5-7. Connect the desktop worker, approvals, steering, and fault recovery.

Exit:

- desktop restart and API restart recover the same run;
- zero duplicate consequential actions across the fault matrix;
- stale workers cannot publish;
- disconnect does not produce false completion.

### Gate 4: Higher-fidelity perception

Tasks 8-9. Add adaptive crops and guarded Playwright after semantic CUA.

Exit:

- small-text and DOM verification improve on benchmark fixtures;
- no browser-profile or screenshot persistence regression;
- accessibility/vision fallback remains functional.

### Gate 5: Quality, latency, and cost optimization

Task 10. Enable route selection, safe retry, caching telemetry, and backpressure.

Exit:

- model routes outperform one-model baseline on cost per verified success;
- no safety or false-completion regression;
- queue and provider failures degrade honestly.

### Gate 6: Measured rollout

Tasks 11-12. Ship evals, canary, rollback, and operations.

Exit:

- canary meets all acceptance thresholds;
- kill switch and new-run rollback are exercised;
- privacy/security docs match actual data flow;
- npm run check and npm run package pass from a clean install.

---

## Testing Strategy

### Unit tests

- Contract parsing, legacy repair, criterion digest, verifier policy, and completion predicate.
- Every run and invocation transition, including invalid transitions.
- Encryption, authenticated metadata, key version, tamper failure, and TTL cleanup.
- Model routing, price calculation, context multiplier, retry classification, breaker, and queue limits.
- Screenshot overview/crop policy and coordinate transforms.
- Playwright target binding and strict-locator errors.
- Application launch verification.

### Repository and service tests

- Idempotent submit under concurrency.
- One lease claim among multiple workers.
- Lease expiry and stale owner rejection.
- Monotonic event sequence with concurrent append attempts.
- Exactly-once executing grant.
- completeVerified transaction with pending/failed/unknown criteria.
- User ownership on every task/worker route.
- Session compaction clear-and-replace transaction.

### Integration tests

- Real HTTP server with memory repositories and fake OpenAI/desktop providers.
- SSE first-event delivery, replay, slow subscriber, reconnect, and session revocation.
- Backend Runner through multiple remote tool calls.
- Clarification and approval resume the same run.
- Cancellation while queued, sampling, waiting for worker, waiting for approval, and after execution grant.

### Fault-injection tests

Inject a crash or connection loss at:

1. before provider dispatch;
2. after provider dispatch before headers;
3. after first stream event;
4. after tool invocation commit;
5. after command delivery;
6. after executing grant;
7. after local effect before result POST;
8. after result commit before SDK continuation;
9. during session persistence;
10. during compaction replacement;
11. after all criteria pass before completion commit.

For each fixture, assert final state, retry behavior, event order, evidence, budget disposition, and duplicate action count.

### Packaged/manual matrix

- macOS and Windows clean install.
- Accessibility/Screen Recording denied, granted, then revoked.
- Chrome absent, installed, already running, multiple windows, and closed mid-task.
- Desktop sleep/wake and network offline/online.
- Railway restart while working.
- TroCode quit/reopen while awaiting worker, input, and approval.
- Browser authorization denied and Playwright fallback.
- Workspace selection changed or removed.
- Sign-out immediately revokes worker and task streams.

---

## Acceptance Criteria

### Correctness and reliability

- 100 percent of new tasks have a v7 outcome contract.
- 0 tasks enter completed with a required pending, failed, or unknown criterion.
- False-completion rate is at most 1 percent on the benchmark and no worse than 50 percent of the current baseline.
- Verified completion rate improves by at least 20 relative percent over the current baseline on multi-step desktop/workspace scenarios.
- Duplicate consequential action count is exactly 0 across all automated fault fixtures.
- At least 95 percent of recoverable API/desktop disconnect fixtures resume without user resubmission.
- An executing consequential action with a lost result always becomes unknown/blocked, never retried or confirmed.

### Performance

- p50 backend event delivery after commit is at most 300 ms and p95 at most 1000 ms in the target Railway region.
- A desktop reconnect replays pending events and becomes ready within 5 seconds at p95 on a healthy network.
- Semantic browser or DOM routes attach screenshots on no more than 25 percent of supported benchmark operations.
- Adaptive crops improve small-text criterion success without increasing median image tokens by more than 25 percent.
- Model routing reduces cost per verified success by at least 15 percent versus always-Terra at equal or better verified completion.

### Security and privacy

- No provider key reaches Electron or renderer.
- No raw tool invocation, CUA handle, CDP endpoint, cookie, local path, command, screenshot, or encrypted session item reaches the renderer.
- No screenshot bytes, raw command output, raw tool arguments, URLs, selectors, typed text, or reasoning enter analytics.
- Every sensitive operational payload is encrypted at rest and TTL-deleted.
- Missing encryption configuration prevents backend runtime startup.
- Every endpoint enforces opaque-session authentication, membership, ownership, size limits, and content type.
- Browser profile attachment remains exact, one-use authorized, and disabled by default.

### Rollout

- CI reliability benchmark passes all hard gates.
- Internal canary has at least 100 representative tasks with zero duplicate consequential actions.
- Each external rollout stage has a predeclared minimum sample and rollback threshold.
- The backend kill switch is tested before 1 percent rollout.
- Local runtime remains available for new-run rollback for one packaged release.

---

## Validation Commands

Run in dependency order during implementation:

~~~bash
npm --prefix services/api test
npm run test
npm run lint
npm run typecheck
npm run agent:benchmark -- --baseline test/fixtures/agent-reliability-baseline.json --candidate .artifacts/agent-reliability-candidate.json
npm run check
npm run package
~~~

Add agent:benchmark to package.json when Task 11 lands. Do not require real provider credentials for default CI. Live OpenAI/CUA canaries are opt-in, sanitized, and run only in a controlled environment.

---

## Decision Register

| Decision | Chosen approach | Rejected alternative |
|---|---|---|
| Agent runtime | TroCode backend Agents SDK with TroCode API key | Hosting Codex app-server or requiring customer Codex accounts |
| Local execution | Reconnectable Electron DesktopToolWorker | Running CUA, shell, or filesystem tools in Railway |
| Transport | Durable PostgreSQL outbox plus authenticated SSE/POST | Socket-only state requiring sticky routing |
| Completion | Required outcome criteria plus independent evidence | Same-agent prose review or navigation-as-success |
| Browser | CUA semantics, then authorized Playwright/CDP, then vision | Screenshot clicking first or silent profile attachment |
| Images | Bounded overview plus on-demand original crop | Always-downscaled only or always-full-original |
| Persistence | Encrypted TTL operational state plus sanitized durable events | No recovery state or persisted screenshot trajectories |
| In-flight SDK state | Serialized RunState at every remote-tool interruption plus Session after completed turns | Assuming Session alone checkpoints an active tool call |
| Model choice | Pure host policy across Luna/Terra/Sol | One fixed model or model self-escalation |
| Retry | Pre-event inference retry only; no ambiguous action retry | Generic automatic retries |
| Rollout | Stable user canary and new-run kill switch | Immediate full cutover |

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Backend ownership increases privacy surface | High | Explicit privacy change, AES-GCM, TTL, store false, prohibited payload filtering, no screenshot persistence |
| Distributed tool callback can become ambiguous | High | Durable invocation state, one-time executing grant, local dedupe, unknown block for consequences |
| Agents SDK session behavior changes across versions | High | Exact pinned version, protocol/session contract tests, upgrade both packages together |
| Compaction drops necessary state | High | Built-in compaction session, canonical replacement, criterion/evidence state stored outside model history |
| Playwright profile attachment leaks scope | High | One-use authorization, exact target binding, noDefaults, no raw DOM/cookies, feature flag off |
| Model routing reduces quality to save cost | High | Route policy never changes safety gates; compare cost per verified success and canary against baseline |
| Long open SSE streams exhaust resources | Medium | No held transaction, bounded buffers, heartbeat, reconnect, per-user/global stream caps |
| Railway horizontal workers race | High | SKIP LOCKED lease, compare-and-set renewals, monotonic event sequence, stale-owner rejection |
| Original images increase tokens and latency | Medium | Overview first, bounded crop, per-task pixel/token budget, telemetry |
| Legacy/local and hosted runtimes diverge | Medium | Shared protocol fixtures, local fallback only for rollback window, staged cleanup |

Top risk: safely resuming after a local side effect when the desktop loses connectivity before committing its result. The plan deliberately favors truthful unknown/blocked status over automatic recovery for consequential actions.

---

## Confidence

**Confidence: 8/10**

The repository already contains the hard parts of local safety: schema-validated IPC, a host-owned tool registry, exact approvals, task-scoped CUA sessions, semantic browser routing, fresh observations, unknown-result suppression, authenticated hosted sessions, budget reservations, transactional repositories, worker leases, SSE streaming tests, and content-free analytics.

The remaining uncertainty is distributed failure behavior at the boundary between a local non-idempotent side effect and a backend commit. No architecture can make arbitrary GUI actions exactly once across a network partition. This plan handles that limit correctly by making executing a one-time grant and converting lost consequential results to unknown rather than guessing or replaying.

---

## Definition of Done

- All twelve tasks and six gates are complete.
- New tasks use backend Agents SDK ownership by default for the enabled cohort.
- The desktop can disconnect and reconnect without losing safe progress.
- Every completed task has a passed current-revision outcome contract.
- Chrome launch, browser DOM, filesystem effects, and CUA actions have deterministic or explicit semantic evidence.
- No consequential action is duplicated by recovery.
- Luna/Terra/Sol routing and image detail are host-selected and benchmarked.
- Traces, evals, canary, privacy retention, operations, and rollback are documented and tested.
- npm run check and npm run package pass.
