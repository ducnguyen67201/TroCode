# Architecture

## Decision

TroCode uses Electron Forge, React, TypeScript, the OpenAI Agents SDK, a Codex
app-server Workspace adapter, and trusted local brokers. A runtime receives only
the capabilities selected by the host. Electron main owns internal tool IDs,
parsers, policy metadata, adapters, cancellation, and budgets.

```mermaid
flowchart LR
    UI["Sandboxed React renderer"] -->|"Narrow DesktopApi"| PRELOAD["Validated preload"]
    PRELOAD -->|"Authenticated IPC"| MAIN["Electron main"]
    MAIN --> RUNTIME["Task runtime v5 supervisor"]
    RUNTIME --> FACTORY{"Host-selected profile"}
    FACTORY -->|"Everyday"| AGENT["OpenAI Agents SDK Runner + bounded Session"]
    FACTORY -->|"Workspace + trusted root"| CODEX["Codex app-server thread/turn"]
    CODEX -->|"Bounded JSONL events"| ACTIVITY["Normalized activity"]
    CODEX -->|"workspaceWrite; network off"| WORKSPACE["Selected canonical root"]
    AGENT -->|"SSE + request UUID + opaque session"| API["Railway API"]
    API --> BUDGET["BudgetService"]
    BUDGET --> USAGE["Reservation + usage ledger"]
    API --> OPENAI["OpenAI Responses + Realtime"]
    API --> ELEVEN["Optional ElevenLabs TTS"]
    MAIN -->|"One-time trocode-audio ticket"| PRELOAD
    API --> SESSIONS["PostgreSQL sessions"]
    AGENT -->|"Assistant candidate"| REVIEW["One completion checkpoint when contextual"]
    REVIEW -->|"Complete"| DONE["Task complete"]
    REVIEW -->|"More work"| AGENT
    AGENT -->|"Function calls"| ROUTER["Trusted tool broker"]
    ROUTER --> POLICY["Concrete-action policy"]
    POLICY --> ADAPTERS["Browser, CUA, guidance, interaction adapters"]
    ADAPTERS -->|"Tool output + evidence"| AGENT
```

## Assistant-or-tool loop

A new request creates a host-owned `TaskContract` v5 containing the original
request, explicit runtime kind, execution profile, autonomy preference, optional
trusted workspace identity, fixed exact-approval policy, and resource ceilings.
It contains no model-authored authority. Everyday maps only to OpenAI Agents.
Workspace maps only to Codex after the main-process directory picker
canonicalizes and records the selected root.

One Agents SDK `Runner` owns the repeated model/tool loop and a bounded in-memory
`Session` receives the user message plus tool specs currently installed by the
registry. `tool_choice` is `auto`, parallel calls are disabled, storage is off,
and both SDK and HTTP retries are disabled. Each function call is schema-parsed,
normalized to a host-owned internal tool identity, policy-checked, executed once,
and returned through the SDK tool callback. The context filter keeps at most one
current screenshot and removes older image bytes before the next sample.

Workspace mode launches the exact supported Codex CLI as `app-server` over
bounded stdio JSONL with an app-scoped `CODEX_HOME`. Availability requires an
exact version match and a successful app-scoped `codex login status`; TroCode
never reads or rewrites the user's normal Codex configuration. Threads use the selected
canonical root, `workspaceWrite`, `approvalPolicy: 'on-request'` (the current
0.146.0 protocol spelling), and network disabled. The adapter validates request
IDs and thread/turn scope, maps safe summaries into the shared activity stream,
drops reasoning and command payloads, forwards exact approvals and user input
through the task interaction broker, and never restarts or replays a turn whose
completion is unknown.

A self-contained assistant message with no tool or visible-context dependency
ends immediately. If a task refers to visible context or requires
outcome-critical tool verification, the first assistant candidate stays private and triggers one
trusted GPT completion checkpoint in the same session. GPT must compare every
requested outcome with the accumulated evidence and either call the next tool or
return the final answer. This is a completion invariant, not a capability router:
it grants no tool, scope, or approval.

Text-only work never creates a CUA session or a synthetic screenshot. Desktop
observation starts CUA lazily. Coordinate actions must reference the latest
observation ID, are mapped from normalized image coordinates, execute once, and
return a fresh screenshot before another model sample.

Grounded guidance is deliberately paced. Main presents one visible target,
issues a bounded narration handle, dispatches and records the guidance tool
once, then waits for both the minimum dwell and a terminal playback report
before sampling the model again. Back/forward replay uses bounded in-memory
presentation history and never replays the tool call, CUA dispatch, progress, or
task message.

ElevenLabs bytes remain outside the sandboxed renderer. Main issues an
ephemeral `trocode-audio://speech/<UUID>` descriptor; Electron's private
protocol consumes the ticket once and streams a bounded MP3 response. The
renderer can report only fixed playback phases/reasons through validated IPC.
Provider credentials, response bodies, and raw errors never cross that bridge.

## Trust boundaries

- The renderer has no Node integration, raw IPC, CUA handle, API key, OAuth
  token, model response, screenshot bytes, or generic call-tool method.
- Preload and main parse every boundary with shared Zod contracts.
- The renderer receives opaque workspace selection IDs and display names, never
  a filesystem picker or arbitrary path authority.
- Playback reports are accepted only from the current guidance window's main
  frame. Private audio URLs contain only a random ticket ID and expire quickly.
- The registry, not GPT, supplies internal tool ID and operation.
- Policy checks only a concrete normalized action: installed operation, public
  HTTPS target, and the fixed host consequence list. Routine click, drag, text,
  keypress, and scroll actions continue automatically. Login, send, submit,
  upload, download, delete, purchase, install, command, and file-write
  consequences require exact user approval.
- Exact approvals bind target, payload, command, coordinates, observation ID,
  and observation fingerprint. A changed screen invalidates a held desktop
  approval.
- Unknown action outcomes are returned with a fresh observation. An unknown
  approved consequence blocks and cleans up the task; safe unknowns retain an
  exact digest that cannot be dispatched again.

## Readiness and permissions

Readiness is split into agent, voice, and desktop concerns. Authenticated users
with a configured model provider can use the text workspace without microphone,
Accessibility, or Screen Recording access. Push-to-talk requests microphone
access when invoked. A desktop observation that lacks OS permission pauses with
a typed Connect computer choice; only the user's click can initiate permission
onboarding or open System Settings.

## Hosted identity and provider access

Google OAuth and nonce verification remain in Electron main. In a production
build, the verified Google ID token is also sent once to the fixed
`TROCODE_API_BASE_URL`. The API independently verifies Google's RS256
signature, issuer, audience, timestamps, and verified-email claim, then returns
a random `tro_live_…` device credential. TroCode stores that credential with
Electron `safeStorage`; the API stores only its HMAC-SHA256 digest in
PostgreSQL. It is an opaque, revocable session—not a Tro JWT.

Responses, Realtime, and optional ElevenLabs requests use the opaque session
over HTTPS. Provider credentials exist only in Railway's runtime environment.
The API authenticates every provider request, applies IP/user rate limits,
restricts models to the configured allowlist, bounds request and response sizes,
streams Responses SSE without buffering, settles usage from the completed event,
and never stores Responses input or output. Native desktop policy and exact
action approvals remain in Electron main; the API does not grant computer-use
authority.

## Persistence and analytics

PostgreSQL stores validated snapshots and lifecycle events. Persisted v1-v4
contracts remain readable as legacy history but cannot resume through the new
runtime; new tasks emit v5 contracts and tool-call progress. Only minimal Codex
thread/version/workspace continuity metadata may be persisted. Screenshots,
partial deltas, command output, raw tool arguments, approval state, and reasoning
never enter task history.

Analytics receives allowlisted counts and identifiers such as contract version,
runtime kind, execution profile, autonomy mode, time to first text delta, phase,
tool ID, operation, and transcript character count. It does not receive task
text, voice transcript text, screenshots, URLs, recipients, file paths, command
text, approval descriptions, or tool arguments.

## Native execution and packaging

CUA stays in Electron main under the signed application identity that owns
macOS Accessibility and Screen Recording grants. Packaged builds keep the CUA
dependency island under `app.asar.unpacked/cua-runtime` so platform libraries
resolve from a real filesystem. Each macOS or Windows release must be built on
its matching target.

The local PostgreSQL task-history adapter remains a development foundation. The
hosted PostgreSQL database stores users, revocable device-session digests, cost
reservations, and sanitized immutable usage events. It does not receive task
history, prompts, model outputs, screenshots, or desktop action payloads.
