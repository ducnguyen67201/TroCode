# Implementation Report: Seamless OpenAI Agent Runtime

## Summary

TroCode now uses a provider-neutral streaming runtime boundary with two concrete
adapters: the OpenAI Agents SDK for everyday assistant and desktop work, and
Codex app-server over local stdio JSONL for explicitly selected workspace work.
The SDK or app-server owns its native model/tool continuation while TroCode
remains the trusted host for tool execution, approvals, workspace scope,
limits, cancellation, telemetry, and unknown-outcome handling.

The renderer now presents live draft text, phase changes, tool activity, plans,
and exact interaction requests instead of a synthetic percentage or manually
created step sequence. Balanced autonomy allows routine reversible actions and
pauses at consequential boundaries; Strict preserves approval-first behavior.
The previous Responses gateway, fallback planner, inference session, and model
routing architecture have been removed rather than retained as a rollback path.

## Tasks Completed

| Area | Status | Result |
|---|---|---|
| Runtime protocol and versions | Complete | Exact `@openai/agents`, `openai`, `zod`, and Codex 0.146.0 protocol bindings are checked for drift. |
| Host contracts | Complete | v5 task contracts make runtime, execution profile, autonomy, limits, and resolved workspace host-owned while preserving historical task parsing. |
| Runtime boundary | Complete | Shared streaming event, interaction, cancellation, steering, resume, and usage contracts drive both adapters. |
| OpenAI Agents SDK | Complete | Native streaming runs, SDK sessions, custom bounded history, dynamic tool approval, interruption resume, and no model retry loop are implemented. |
| Hosted OpenAI relay | Complete | Bounded SSE relay reserves and settles usage, propagates cancellation/backpressure, and marks ambiguous delivery as unknown without retry. |
| Safety and execution brokers | Complete | Exact approval digests, observation freshness, routine-action autonomy, sensitive-action escalation, limits, and unknown-outcome suppression remain host enforced. |
| Codex app-server | Complete | Exact binary discovery, isolated app home, auth readiness, handshake, thread start/resume, turn streaming, approvals, input, steering, interrupt, and fail-closed protocol handling are implemented. |
| Workspace scope | Complete | Trusted folder selection returns an opaque ID; the host revalidates the canonical directory and confines workspace writes to that root with networking disabled. |
| Renderer experience | Complete | Everyday/Workspace profiles, Balanced/Strict policy, live drafts, activity, plans, setup guidance, approvals, input, steering, and Stop are wired end to end. |
| Privacy and analytics | Complete | Telemetry contains bounded categorical/count/timing data only; model content, command output, diffs, reasoning, paths, and secrets are excluded. |
| Legacy cleanup | Complete | The manual Responses loop, planner/fallback stack, inference session, old model catalog, and superseded tests were deleted; production has no legacy runtime switch. |
| Documentation | Complete | README and architecture, security, conversational, computer-use, inference-cost, and testing docs describe the new runtime. |

## Architecture Delivered

```text
Renderer
  -> narrow DesktopApi / parsed IPC
  -> TaskApplicationService (host selects runtime, policy, limits, workspace)
  -> AgentRuntimeFactory
       -> OpenAIAgentsRuntime -> Agents SDK -> hosted streaming relay
       -> CodexAppServerRuntime -> isolated local Codex app-server
  -> ToolExecutionBroker / TaskInteractionBroker
  -> existing trusted tools, exact approval policy, lifecycle, and analytics
```

Neither adapter receives raw Electron IPC or approval authority. CUA remains an
execution capability rather than a goal or permission source. Model-generated
arguments, app-server events, persisted contracts, and IPC payloads are parsed
at their boundaries.

## Safety Behavior

- Balanced mode auto-runs routine reversible in-scope click, drag, type,
  keypress, and scroll actions when no sensitive cue is present.
- Send, submit, purchase, delete, credential, permission, external disclosure,
  and scope-expanding actions pause at the exact requested boundary.
- Strict mode requests approval for desktop mutations.
- Approvals bind the serialized requested action or permission, expire after
  one use, and are invalidated by changed observations or scope.
- Missing post-action evidence yields an unknown outcome and blocks exact
  redispatch; consequential actions are never retried when completion is
  uncertain.
- Codex receives an environment allowlist, an isolated `CODEX_HOME`, one trusted
  workspace root, workspace-write sandboxing, and network access disabled.

## Validation Results

| Check | Result |
|---|---|
| Runtime version drift check | Pass |
| Codex 0.146.0 protocol manifest generation/check | Pass |
| ESLint | Pass |
| TypeScript (`tsc --noEmit`) | Pass |
| Vitest | Pass — 78 files, 421 tests |
| Script tests | Pass — 6 tests |
| Hosted API tests | Pass — 30 tests |
| Electron Forge package | Pass — arm64 macOS package produced |
| Diff whitespace check | Pass |

The validation covers SDK streaming compatibility, approval interruption and
same-state resume, bounded sessions and events, first-delta/tool/approval/outcome
analytics, malformed and oversized Codex frames, fragmented JSONL, duplicate or
unknown IDs, pending caps, process exit, permission and workspace scope, secret
rejection, resume/version mismatch, steering, cancellation, and crash handling.

## Deviations from Plan

- Codex 0.146.0 exposes `on-request` as the approval-policy protocol value, not
  the plan's stale `unlessTrusted` spelling. The adapter uses `on-request`; the
  host still makes the exact approval decision, so the intended safety behavior
  is unchanged.
- At the user's explicit cleanup direction, the legacy runtime and rollback
  switch were removed in this implementation instead of being retained for one
  release. Historical persisted task contracts remain readable.
- Codex is discovered as an exact local installation and uses app-scoped login
  state; it is not bundled. The Workspace profile is hidden with precise setup
  guidance when the binary version or app-scoped authentication is unavailable.

## External Acceptance Note

A live paid Codex edit/task was not dispatched because this worktree did not
have app-scoped Codex authentication configured and such a run would invoke an
external paid model. The adapter was instead verified through generated exact
protocol bindings, fake-process integration coverage, unit tests, and the
packaged application. Once authenticated, the remaining manual acceptance is a
single real workspace task confirming thread continuity and a visible edit.

## Principal Files

| File/group | Purpose |
|---|---|
| `src/main/agent/agent-runtime.ts` | Provider-neutral runtime and normalized event protocol. |
| `src/main/agent/openai-agents-runtime.ts` | OpenAI Agents SDK streaming adapter. |
| `src/main/agent/openai-client-factory.ts` | Hosted/local OpenAI clients with stable task identity and fresh request IDs. |
| `src/main/agent/bounded-agent-session.ts` | Bounded SDK conversation state. |
| `src/main/agent/tool-execution-broker.ts` | Trusted tool execution and policy boundary. |
| `src/main/agent/task-interaction-broker.ts` | Exact approval and user-input interruption handling. |
| `src/main/agent/action-risk-classifier.ts` | Pure Balanced/Strict consequence classification. |
| `src/main/codex/` | Codex discovery, isolated environment, JSONL client, protocol bindings, event adapter, workspace service, and runtime. |
| `services/api/src/openai-responses-service.mjs` | Bounded hosted SSE relay and usage settlement. |
| `src/shared/contracts.ts`, `src/shared/desktop-api.ts` | v5 persistence, activity, preferences, and narrow IPC contracts. |
| `src/renderer/App.tsx`, `src/renderer/agent-activity-projection.ts` | Runtime selection and Codex-style live activity UI. |
| `scripts/check-agent-runtime-versions.mjs` | Exact SDK and schema dependency enforcement. |
| `scripts/generate-codex-app-server-types.mjs` | Exact installed Codex protocol manifest generation. |

## Follow-up

- Authenticate the app-scoped Codex home and run one live workspace smoke test
  before release.
- Review the implementation diff and release documentation before merging.
