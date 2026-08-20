# Architecture

Tro is a Rust modular monolith with independently scalable hosted processes and
a Tauri desktop host. React is outside the trusted computing base.

## Trust topology

```text
Untrusted / content-bearing                  Trusted authority

React renderer  -- invoke/events -->         Tauri Rust host
model output    -- tool proposals -->           policy + exact approvals
screen content  -- observations -->             CUA + workspace confinement
source files    -- bounded upload -->         Axum API
                                                    SeaORM/PostgreSQL
                                                    provider clients
                                                    private S3 tickets

PostgreSQL lease  -->                         Rust Knowledge worker
```

The renderer receives a fixed `window.tro` compatibility API implemented by
`src/renderer/backend.ts`. It cannot call arbitrary IPC, use Node APIs, access
credentials, open filesystem paths, run processes, or control CUA directly.
Tauri capabilities and command-side window checks restrict each window again.

## Hosted processes

`tro-api` is stateless. A single SeaORM `DatabaseConnection` owns each
process's bounded PostgreSQL pool. CRUD and projections use SeaORM; correctness-
critical advisory locks, row locks, rate-limit upserts, usage accounting,
idempotency, full-text search, and lease statements remain explicit bound SQL
through that same connection or transaction.

`tro-migrate` imports the existing SQL 001-012 baseline and records it in the
SeaORM migration ledger. It runs as a singleton pre-deploy job, never during API
replica startup.

The optional `/source/admin` page is static, untrusted browser code. Axum owns
its login session, same-origin enforcement, rate limit, user access changes,
session revocation, audit events, and access-code encryption. The raw admin
token and plaintext codes never enter PostgreSQL logs or audit metadata.

`tro-worker` claims ingestion jobs with `FOR UPDATE SKIP LOCKED`, downloads an
exact private object, rechecks byte size and SHA-256, performs bounded text/PDF
extraction, and commits chunks only while it still owns the lease. More workers
can be added without introducing a queue service.

## Desktop host

`tro-desktop` owns authentication, session refresh, preferences, membership,
windows, tray lifecycle, updates, voice, CUA, trusted workspace roots, task
state, and model/tool execution. The Responses loop is serial, bounded by time,
model-sample, tool-call, argument, output, and context limits, and has no
automatic retry after an uncertain provider or consequential action outcome.

The model can propose only registered Rust tools. Consequential proposals are
digested with their exact arguments and paused until the host receives a
matching, unexpired renderer decision. Visible content and model text can never
grant approval. Desktop actions require a fresh observation ID and fingerprint.

The first Tauri upgrade does not decrypt Electron `safeStorage`; users sign in
once in the Rust app. The resulting device session is encrypted in a Stronghold
snapshot whose random master key is held by the platform keyring. Device
sessions stay out of the renderer, restore on restart, and rotate proactively.
Preferences are stored as a mode-0600 JSON file in the Tauri config directory.
Task history is session-only in this release.

## Scaling

Scale API replicas for HTTP concurrency and workers for ingestion concurrency.
PostgreSQL remains authoritative for plans, rate limits, reservations,
idempotency, sessions, Knowledge metadata, and leases; S3 remains authoritative
for bytes. Pool limits must be budgeted across replicas. Redis, a message queue,
embeddings, or a service split should be introduced only after measurements
show a concrete bottleneck.

The accepted boundary decision is recorded in
[ADR 0001](adr/0001-rust-backend-boundaries.md).
