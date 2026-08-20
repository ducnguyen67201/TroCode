# ADR 0001: Rust owns every privileged Tro runtime

- Status: accepted
- Date: 2026-08-20
- Baseline: `d61f38816543954f416baf979f4a3f5ffe55e0f6`

## Context

At the migration baseline, Tro had two privileged JavaScript runtimes: the
Railway Node API/worker and Electron main/preload on the desktop. The renderer
was already a sandboxed React application. Knowledge Spaces from PR #9 added
PostgreSQL, private object storage, and a lease-driven ingestion worker to the
hosted runtime.

## Decision

Rust owns all production authority:

- Axum/Tokio serve the existing hosted HTTP contract.
- SeaORM owns the only PostgreSQL pool. Ordinary CRUD uses entities; advisory
  locks, `FOR UPDATE`, `SKIP LOCKED`, idempotency, and ranked search remain
  explicit parameterized SQL executed through the same SeaORM transaction.
- Migrations run from a singleton Rust binary, never from API replicas.
- A separate Rust worker handles bounded extraction and lease reconciliation.
- Tauri 2 replaces Electron. Rust owns windows, commands, policy, approvals,
  CUA, filesystem/process access, authentication, secrets, voice, updates, and
  analytics.
- The Rust desktop agent uses a bounded first-party Responses API tool loop.
  It disables parallel tool calls and retries and treats unknown consequential
  outcomes as terminal.
- The React/TypeScript renderer remains unprivileged. Its `window.tro` adapter
  maps the existing `DesktopApi` onto typed Tauri commands and events.

The deployed system begins as a modular monolith with four binaries: `tro-api`,
`tro-worker`, `tro-migrate`, and `tro-admin`. The desktop is a fifth binary.
This avoids a premature service split while still allowing independent API and
worker scaling.

## Security invariants

1. Renderer windows receive only their allowlisted commands and events. They
   never receive raw Tauri invoke, CUA handles, filesystem paths, provider
   credentials, device credentials, signed object metadata, or internal errors.
2. All JSON, IPC-command, provider, database, and model boundaries are parsed
   into bounded Rust types.
3. The host, not the model, owns tool registration, workspace roots, budgets,
   consequence classification, approval digests, and lifecycle transitions.
4. CUA executes concrete actions but cannot define goals or approve work.
5. Provider and local actions are dispatched at most once. An ambiguous result
   is recorded as uncertain and is never automatically retried.
6. Logs contain allowlisted identifiers, counts, timings, and enum values only.
   They exclude content, transcripts, screenshots, URLs, paths, arguments,
   object keys, tokens, and signed URLs.
7. Production PostgreSQL and provider credentials exist only in backend process
   environment and never in desktop bundles or frontend code.

## Data and scaling boundaries

- PostgreSQL is authoritative for sessions, plans, rate limits, reservations,
  idempotency, Knowledge metadata, assignments, attempts, and worker leases.
- Private S3-compatible storage is authoritative for Source and submission
  bytes. PostgreSQL stores only bounded metadata and extracted chunks.
- API replicas are stateless and have a bounded pool configured per replica.
- Worker replicas coordinate with database leases and `SKIP LOCKED`.
- Redis, queues, embeddings, and a microservice split require measured evidence;
  they are not part of this migration.

## Native boundary gate

The desktop cutover is allowed only after a signed Tauri build demonstrates the
supported CUA Rust/C ABI or embedded-host path on clean macOS and Windows
machines. On macOS, the responsible signed application identity must retain
Accessibility and Screen Recording attribution. Raw `cua-driver serve` as an
unowned sidecar is not an accepted production design.

## Compatibility and rollback

- Installed Electron clients remain supported by exact hosted HTTP compatibility
  until the Tauri stable cohort completes.
- Hosted and desktop cutovers are separate releases.
- Database changes are forward-only and compatible during canary rollout.
- The last signed Node/Electron artifacts remain recoverable through the rollback
  window, although production source is removed after the final gate.
- Existing Electron `safeStorage` values are migrated only by an authenticated
  bridge release; otherwise users sign in again. Secrets are never downgraded to
  plaintext for migration.

## Consequences

The migration is larger than a direct server translation because it replaces
the native authority boundary and the agent loop. In return, production has no
Node/Electron process, one database pool abstraction, explicit concurrency
semantics, independently scalable worker capacity, and a smaller privileged
desktop surface.
