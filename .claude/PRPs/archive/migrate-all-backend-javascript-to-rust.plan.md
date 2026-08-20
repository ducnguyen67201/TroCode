# Plan: Migrate All Backend JavaScript to Rust

## Summary

Replace both privileged JavaScript/TypeScript backends with Rust: the hosted Node API/knowledge worker and the Electron main/preload runtime. Keep the React renderer, but move its trusted host from Electron to Tauri 2 and preserve the current HTTP, command, lifecycle, approval, privacy, and database contracts throughout a staged strangler migration.

Use SeaORM 2.0 as the single PostgreSQL connection and CRUD layer. Keep concurrency-sensitive budget, idempotency, rate-limit, lease, and full-text-search statements as explicit parameterized SQL executed through SeaORM transactions; do not create a second SQLx pool.

## User Story

As a Tro operator, I want every production backend and privileged desktop capability implemented in Rust, so that the hosted service and native app have a safer, more predictable foundation for later scaling without breaking installed clients or weakening Tro's approval boundaries.

## Problem → Solution

The repository currently has two backends: a Node 24 hosted service (`services/api`, 5,388 production lines) and an Electron main/preload backend (`src/index.ts`, `src/main/**`, and `src/preload.ts`, roughly 20,358 privileged production lines). PR #9 also added Knowledge Spaces, S3 uploads, ingestion leases, full-text search, Activities, Runs, Attempts, and a separate worker. → Introduce a Rust workspace, replace the hosted service behind its existing wire contract, then replace Electron with a Tauri 2 Rust host behind the existing renderer-facing `DesktopApi` shape, and remove the legacy runtime only after parity gates pass.

## Metadata

- **Complexity**: XL
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 120-170 created/updated/deleted across staged pull requests
- **Baseline commit**: `b5d025b52f93e40426b100c9bdf5b335b58ae247`
- **Merged scope**: PR #9 plus `830b6f9 feat(insight): remove cost insight`
- **Current verification baseline**: `npm run check` passes (96 Vitest files, 662 tests; hosted API 68 passed and 1 PostgreSQL integration suite skipped without `TEST_DATABASE_URL`); `npm run package` passes
- **End state**: no Node/Electron process in production, no `.mjs` hosted service/worker/admin runtime, React/TypeScript retained only for the unprivileged renderer and frontend build/test tooling

---

## UX Design

### Before

```text
React renderer
  -> Zod preload / Electron IPC
  -> Electron main (TypeScript)
       -> OpenAI Agents SDK (TypeScript)
       -> CUA Node/UniFFI binding
       -> shell/filesystem/auth/secrets/windows/update/voice
       -> Node hosted API
            -> raw pg
            -> OpenAI / ElevenLabs / S3
       -> separate Node knowledge worker
```

### After

```text
React renderer (same product UX, still sandboxed)
  -> typed Tauri invoke/events, validated on both sides
  -> Tauri Rust host
       -> Rust Responses tool loop
       -> CUA Rust SDK/C ABI or supported embedded Rust daemon
       -> bounded shell/filesystem/auth/secrets/windows/update/voice
       -> Axum Rust API
            -> SeaORM-owned PostgreSQL pool
            -> SeaORM CRUD + explicit transactional SQL
            -> OpenAI / ElevenLabs / S3
       -> separate Rust knowledge worker
       -> separate Rust migration/admin binaries
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Main window, companion, voice island, guidance overlays | Electron `BrowserWindow` | Tauri `WebviewWindow`/native window APIs | Pixel/behavior parity is required before Electron removal. |
| Renderer API | `window.tro` supplied by preload | `window.tro` compatibility adapter backed by Tauri `invoke` and channels/events | Keep component call sites stable during migration. |
| Task execution | TypeScript OpenAI Agents SDK runner | Rust Responses API loop | Same tool schemas, serial tool calls, bounded context, no automatic retries. |
| Approval | Electron main owns exact-action approval | Rust host owns exact-action approval | Renderer/model never gains approval authority. |
| Hosted endpoints | Node `http` handler | Axum routes and middleware | Installed Electron clients must remain compatible during rollout. |
| Knowledge upload/worker | Node streams, AWS JS SDK, PDF.js | Rust streaming, AWS Rust SDK, bounded `lopdf` extraction | Preserve checksum reconciliation and lease semantics. |
| Secret storage | Electron `safeStorage` | Tauri Stronghold backed by OS-protected key material | Migrate existing encrypted values only if they can be decrypted in an authenticated Electron bridge release. |
| Updates/releases | Electron Forge/Squirrel/ZIP/MSIX | Tauri updater/bundler | Signing identities and customer-visible product identity must not change. |

---

## Scope Definition

### “Everything backend” means

1. Replace `services/api/src/**/*.mjs`, its worker, migrations runner, and operational/admin scripts with Rust binaries.
2. Replace `src/index.ts`, `src/preload.ts`, and all production modules under `src/main/**` with Rust/Tauri commands, state, services, and native integrations.
3. Replace runtime reliance on `@openai/agents`, `openai`, `pg`, `posthog-node`, `ws`, `@trycua/cua-driver`'s TypeScript package, Node child processes, and Electron APIs.
4. Preserve the React renderer and its AudioWorklet. TypeScript used only in the sandboxed renderer, frontend tests, and build configuration is not backend runtime.
5. Replace backend/admin scripts such as access-code issuance, membership issuance, knowledge smoke/load reporting, and runtime compatibility checks with `tro-admin`/`xtask` Rust subcommands.

### Target architecture decisions

| Decision | Choice | Reason |
|---|---|---|
| Hosted HTTP | Axum 0.8 + Tokio + tower/tower-http | Typed state/extractors, streaming, middleware, graceful shutdown. |
| Persistence | SeaORM 2.0.2 + sea-orm-migration 2.0.2 | One async pool, CRUD entities, transaction API, raw SQL escape hatch, migration ledger. |
| Critical SQL | SeaORM `DatabaseTransaction` + `raw_sql!`/`Statement` | Preserve advisory locks, `FOR UPDATE`, `SKIP LOCKED`, CTE ranking, and idempotent upserts exactly. |
| Provider HTTP | reqwest 0.13 with rustls | Direct control over timeouts, body limits, SSE, cancellation, and zero automatic retries. |
| Desktop shell | Tauri 2.11.x | Rust process owns native authority; React renderer remains unprivileged. |
| Secrets | Tauri Stronghold plus platform protection | Replaces Electron `safeStorage`; never expose tokens to the renderer. |
| Agent runtime | First-party Rust loop over the existing Responses proxy | OpenAI has no official Rust Agents SDK; an unofficial SDK is not acceptable for the core authority loop. |
| CUA | Preferred direct safe Rust SDK/versioned C ABI; supported embedded daemon fallback | CUA is already Rust internally. The integration must retain the signed app's TCC responsibility chain. |
| Object storage | `aws-sdk-s3` 1.142.x | Presigned PUT/GET and HEAD/checksum support without a JS sidecar. |
| PDF extraction | `lopdf` 0.44.x using bounded decompression APIs | Pure Rust and exposes decompression-bomb-safe extraction. Reject encrypted/scanned/oversized PDFs as today. |
| Errors/logs | `thiserror` domain errors + Axum `IntoResponse`; `tracing` JSON | Preserve generic public errors and sanitized structured telemetry. |
| Tests | Rust unit/property tests, Testcontainers/PostgreSQL integration, contract/golden parity, existing renderer tests | Behavior parity is a release gate, not an assumption. |

### Scaling model

Rust is not itself the scaling plan. The target API must be stateless; migrations run as a singleton job; database pool size is bounded per replica; budget/idempotency state remains authoritative in PostgreSQL; ingestion uses lease-based workers; provider dispatch uncertainty is reconciled and never blindly retried; S3 stores bytes; and load/latency/error metrics gate replica increases. Add Redis only after measurements prove PostgreSQL rate-limit rows or fan-out are a bottleneck.

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `AGENTS.md` | all | Repository invariants and required verification. |
| P0 | `docs/architecture.md` | 1-212 | Current runtime, trust, provider, persistence, and packaging contracts. |
| P0 | `docs/security.md` | 1-170 | Non-negotiable renderer, approval, secret, privacy, and uncertain-outcome rules. |
| P0 | `src/shared/contracts.ts` | 1-1499 | Runtime validation and all cross-boundary domain contracts. |
| P0 | `src/shared/desktop-api.ts` | 73-250 | Existing renderer command/event surface to preserve through the Tauri adapter. |
| P0 | `src/main/agent/execution-coordinator.ts` | 835-1888 | Full model/tool/approval/observation/cleanup lifecycle. |
| P0 | `src/main/agent/policy.ts` | 17-178 | Pure allow/deny/approval decisions and public-target validation. |
| P0 | `src/main/agent/openai-agents-runtime.ts` | 43-464 | Agent instructions, tool schema bridge, streaming, bounded session, approval interruptions. |
| P0 | `services/api/src/usage-repository.mjs` | 30-560 | Spend locks, idempotency, uncertain dispatch, settlement, and sanitized usage ledger. |
| P0 | `services/api/src/server.mjs` | 1-905 | Exact public API, limits, auth, security headers, streaming, provider handling. |
| P0 | `services/api/migrations/001_hosted_sessions.sql` through `010_knowledge_activities.sql` | all | Existing 30-table production schema and constraints; do not redesign during port. |
| P1 | `docs/knowledge-spaces.md` | 1-40 | PR #9 data, upload, privacy, worker, deployment, and rollback behavior. |
| P1 | `services/api/src/knowledge-ingestion-job-repository.mjs` | 1-49 | Lease claim with `FOR UPDATE SKIP LOCKED` and retry backoff. |
| P1 | `services/api/src/knowledge-search-service.mjs` | 1-46 | Attempt-scoped authorization, PostgreSQL ranking, and output caps. |
| P1 | `src/main/cua/cua-service.ts` | 37-940 | CUA loading, permission/TCC lifecycle, semantic routing, observation, and metrics. |
| P1 | `src/main/agent/workspace-agent-tools.ts` | 30-510 | Bounded shell/patch behavior and root/symlink checks. |
| P1 | `src/main/knowledge/activity-workspace-preparation-service.ts` | 10-112 | Safe starter download, checksum, staging, atomic rename, and cleanup. |
| P1 | `src/main/knowledge/knowledge-upload-service.ts` | 11-102 | Streaming upload and HEAD reconciliation after unknown PUT admission. |
| P1 | `src/index.ts` | 176-245, 1890-2037, 2430-2510 | Composition root, windows, IPC registration, startup, and shutdown. |
| P1 | `.github/workflows/ci.yml` | 1-30 | Existing macOS/Windows check/package release gate. |
| P2 | `services/api/test/server.test.mjs` | 323-1030 | Wire behavior and streaming compatibility cases. |
| P2 | `services/api/test/knowledge-content-pipeline.test.mjs` | 1-104 | Extraction/upload/worker concurrency expectations. |
| P2 | `services/api/test/usage-repository.test.mjs` | 1-232 | Critical SQL behavior tests to port before changing implementation. |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| SeaORM connection/pool | https://www.sea-ql.org/SeaORM/docs/install-and-config/connection/ | `DatabaseConnection` owns the SQLx pool; configure max/min/acquire/idle/lifetime values once. |
| SeaORM transactions | https://www.sea-ql.org/SeaORM/docs/advanced-query/transaction/ | Use transaction closures/manual transactions so locks and state transitions commit atomically. |
| SeaORM raw SQL | https://www.sea-ql.org/SeaORM/docs/basic-crud/raw-sql/ | SeaORM 2 supports `raw_sql!`, `query_*_raw`, and `execute_raw`; use these for the existing complex PostgreSQL statements. |
| SeaORM migrations | https://www.sea-ql.org/SeaORM/docs/migration/setting-up-migration/ | Use a tracked migration table; import the existing SQL baseline, then add forward-only Rust migrations. |
| SeaORM schema-first flow | https://www.sea-ql.org/SeaORM/docs/migration/writing-migration/ | Keep PostgreSQL schema/migrations authoritative and generate entities from it. |
| Axum | https://docs.rs/axum/0.8.9/axum/ | Axum integrates with Tokio/hyper/tower and supports typed shared state. |
| Axum middleware | https://docs.rs/axum/0.8.9/axum/middleware/ | Apply security, tracing, timeout, and body-limit layers with explicit ordering. |
| Axum SSE | https://docs.rs/axum/0.8.9/axum/response/sse/ | Streaming support exists, but the Responses proxy must preserve upstream bytes/events and backpressure. |
| Tauri commands/channels | https://v2.tauri.app/develop/calling-rust/ | Commands serialize through serde; channels are appropriate for ordered streaming events. |
| Tauri security/capabilities | https://v2.tauri.app/security/ | Use deny-by-default capabilities per window; frontend code remains outside the trusted computing base. |
| Tauri CSP | https://v2.tauri.app/security/csp/ | Recreate the production CSP without development localhost allowances. |
| Tauri Stronghold | https://v2.tauri.app/plugin/stronghold/ | Store device credentials and activation material outside frontend-accessible state. |
| Tauri updater/distribution | https://v2.tauri.app/plugin/updater/ and https://v2.tauri.app/distribute/ | Updater artifacts/signatures and per-platform packaging replace Electron Forge. |
| OpenAI Agents SDK | https://openai.github.io/openai-agents-js/ | Documents the current JS runner being replaced and its concepts that parity tests must cover. |
| OpenAI “own loop” guidance | https://openai.github.io/openai-agents-python/agents/ | OpenAI directs custom loops to the Responses API; implement this rather than adopting an unofficial Rust Agents SDK. |
| Official OpenAI SDK list | https://github.com/openai/openai-openapi | No official Rust SDK is listed; use direct, typed reqwest calls against the existing proxy. |
| CUA integration surfaces | https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md | CUA's Python/TS packages share a Rust runtime; a safe Rust SDK/versioned C ABI and supported embedded host path exist. |
| CUA Rust workspace | https://github.com/trycua/cua/blob/main/libs/cua-driver/rust/README.md | Platform crates are selected by target OS and headless/GUI test matrices are separate. |
| AWS S3 presigning | https://docs.rs/aws-sdk-s3/latest/aws_sdk_s3/presigning/ | Presigned operations expose method, URI, and required headers; preserve exact expiration/header contracts. |
| Bounded PDF extraction | https://docs.rs/lopdf/0.44.0/lopdf/struct.Document.html | Use `extract_text_with_limit`/bounded page content for untrusted uploads. |

---

## Patterns to Mirror

These are behavioral patterns to port, not JavaScript syntax to reproduce.

### NAMING_CONVENTION

```ts
// SOURCE: src/shared/desktop-api.ts:73-143
export const IPC_CHANNELS = {
  cancelTask: 'task:cancel',
  decideApproval: 'task:decide-approval',
  getKnowledgeCapabilities: 'knowledge:capabilities',
  createKnowledgeSpace: 'knowledge:spaces:create',
  requestKnowledgeAttemptHelp: 'knowledge:attempt:help',
} as const;
```

Use domain-first Rust modules and serde `camelCase` payload fields, while keeping existing command/channel strings or an explicit compatibility mapping. Rust types use `UpperCamelCase`; modules/functions use `snake_case`; HTTP JSON and renderer contracts remain `camelCase`.

### ERROR_HANDLING

```js
// SOURCE: services/api/src/http-primitives.mjs:1-25
export class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message); this.status = status; this.code = code;
  }
}

export async function readJson(request, maxBytes = 1_000_000) {
  if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json.', 'invalid_content_type');
  }
  // ... bounded read ...
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Request body must be valid JSON.', 'invalid_json'); }
}
```

Create `ApiError { status, code, public_message, source }`, implement `IntoResponse`, log only the sanitized code/request ID, and never serialize provider/database/internal error strings. Tauri commands return a bounded `CommandError { code, message }` and never raw anyhow/debug output.

### LOGGING_PATTERN

```js
// SOURCE: services/api/src/openai-transcription-service.mjs:284-298
console.info(JSON.stringify({
  audioDurationMs: Math.round(wav.durationMs),
  billedSeconds,
  byteCount: audio.byteLength,
  durationMs,
  event: 'voice.segment.completed',
  lane: 'transcription',
  microUsd: actualMicroUsd,
  model: TRANSCRIPTION_MODEL,
  requestId: input.requestId,
  taskId: input.body.utteranceId,
  usageSource,
}));
```

Use `tracing` JSON fields with the same allowlist. Never log prompts, outputs, transcripts, screenshots, file paths, URLs, tokens, signed object URLs, object keys, raw tool arguments, or command text.

### REPOSITORY_PATTERN

```js
// SOURCE: services/api/src/usage-repository.mjs:35-61,134-139
const client = await this.pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    input.userId,
  ]);
  // ... duplicate lookup and state transition ...
  await client.query('COMMIT');
  return { kind: 'duplicate', reservation: normalizeReservation(duplicate.rows[0]) };
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

Port transaction boundaries and result variants literally. In Rust, the repository accepts `&DatabaseConnection` or `&DatabaseTransaction`, calls the advisory lock first, uses bound values, and returns a domain enum such as `ReserveOutcome`; do not flatten these paths into generic CRUD.

### LEASE_PATTERN

```js
// SOURCE: services/api/src/knowledge-ingestion-job-repository.mjs:9-20
WITH candidate AS (
  SELECT jobs.id FROM knowledge_ingestion_jobs jobs
  WHERE ((jobs.state IN ('queued','retry') AND jobs.available_at <= NOW())
     OR (jobs.state='leased' AND jobs.lease_expires_at < NOW()))
  AND jobs.attempt_count < 12
  ORDER BY jobs.available_at, jobs.created_at
  FOR UPDATE SKIP LOCKED LIMIT 1
)
UPDATE knowledge_ingestion_jobs jobs SET state='leased', lease_owner=$1,
  lease_expires_at=NOW()+($2 * INTERVAL '1 millisecond'),
  attempt_count=attempt_count+1, updated_at=NOW()
FROM candidate WHERE jobs.id=candidate.id
RETURNING jobs.id,jobs.source_version_id,jobs.attempt_count,jobs.lease_expires_at
```

Keep this as explicit PostgreSQL SQL within one transaction. Multiple Rust worker replicas must never finalize the same version twice.

### SERVICE_PATTERN

```js
// SOURCE: services/api/src/knowledge-ingestion-worker.mjs:9-27
async runOnce() {
  const job = await this.jobRepository.claim({ leaseMs: 120_000, workerId: this.workerId });
  if (!job) return false;
  try {
    const source = await this.jobRepository.source(job.id, this.workerId);
    if (!source) return true;
    const object = await this.objectStore.get(source.objectKey);
    const buffer = await readBoundedBody(object.body, source.byteSize);
    if (!verifySha256(buffer, source.sha256)) throw /* permanent typed error */;
    const extracted = source.mediaType === 'application/pdf' ? await extractPdf(buffer) : extractText(buffer);
    await this.sourceRepository.replaceChunks(/* bounded chunks */);
  } catch (error) {
    // permanent failure or bounded exponential retry
  }
  return true;
}
```

Keep orchestration dependent on repository/object-store traits so unit tests can supply deterministic fakes. Blocking PDF work runs in `spawn_blocking` behind a concurrency semaphore.

### POLICY_PATTERN

```ts
// SOURCE: src/main/agent/policy.ts:105-178
export function evaluateAction(goal, proposedAction, toolRegistry) {
  GoalSpecSchema.parse(goal);
  const action = ProposedActionSchema.parse(proposedAction);
  if (!toolRegistry.supports(action)) return { status: 'denied', /* ... */ };
  if (!isTargetAdmissible(action)) return { status: 'denied', /* ... */ };
  if (isTroApprovalUiAction(action)) return { status: 'denied', terminal: true, /* ... */ };
  const risk = classifyActionRisk(goal, action);
  if (risk.level === 'sensitive') return { status: 'needs_approval', /* ... */ };
  return { status: 'allowed', nextActions: ['Execute once, then observe and verify the result.'] };
}
```

Port policy/lifecycle functions as pure Rust with table-driven tests before porting any dispatcher. CUA and model code may propose/execute only through these functions.

### TEST_STRUCTURE

```js
// SOURCE: services/api/test/usage-repository.test.mjs:6-84
test('response reservations lock and validate the API-owned agent turn', async () => {
  const statements = [];
  const client = { query: async (sql, parameters = []) => { /* deterministic rows */ } };
  const repository = new PostgresUsageRepository({ connect: async () => client });
  const result = await repository.reserve(/* bounded input */);
  assert.equal(result.kind, 'reserved');
  assert.match(turnLock.sql, /FOR UPDATE/u);
  assert.match(insert.sql, /agent_turn_id/u);
});
```

Rust unit tests assert domain outcomes; PostgreSQL integration tests assert actual locks/idempotency/constraints. Contract tests send identical fixtures to Node and Rust during the strangler period and compare status, headers, sanitized JSON, and stream event order.

---

## Files to Change

| File or directory | Action | Justification |
|---|---|---|
| `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` | CREATE | Pinned Rust 1.95 workspace and centralized dependency versions/lints. |
| `.cargo/config.toml`, `deny.toml` | CREATE | Reproducible build settings and dependency/license/advisory policy. |
| `crates/tro-contracts/**` | CREATE | Serde/schemars types, limits, public error envelopes, golden fixtures. |
| `crates/tro-domain/**` | CREATE | Pure task lifecycle, policy, budget math, plan catalog, Activity lifecycle. |
| `crates/tro-persistence/**` | CREATE | SeaORM entities and repositories for all 30 current tables. |
| `crates/tro-migration/**` | CREATE | Imported 001-010 baseline and tracked forward migrations. |
| `crates/tro-providers/**` | CREATE | OpenAI Responses/transcription and ElevenLabs clients with bounded streaming. |
| `crates/tro-knowledge/**` | CREATE | Knowledge policies, S3 store, extraction, chunking, search, upload, worker orchestration. |
| `crates/tro-agent/**` | CREATE | Responses tool loop, bounded session, registry, dispatcher interfaces, approvals. |
| `crates/tro-cua/**` | CREATE | CUA Rust/C ABI/embedded host adapter and semantic contract conversion. |
| `crates/tro-desktop-core/**` | CREATE | Auth, membership, workspace, history, voice, analytics, presentation, task services. |
| `apps/tro-api/**` | CREATE | Axum server composition root and graceful shutdown. |
| `apps/tro-worker/**` | CREATE | Independently deployable ingestion worker. |
| `apps/tro-migrate/**` | CREATE | Singleton migration binary/job. |
| `apps/tro-admin/**` | CREATE | Access-code, membership, load-report, worker-smoke, and maintenance commands. |
| `src-tauri/**` | CREATE | Tauri app, commands/events, capabilities, windows, Stronghold, updater, bundling. |
| `src/renderer/backend.ts` | CREATE | Stable `DesktopApi` compatibility adapter over Tauri invoke/channels. |
| `src/preload.ts` | UPDATE then DELETE | First proxy to sidecar for transition if needed; removed at Tauri cutover. |
| `src/shared/contracts.ts` | UPDATE | Keep renderer runtime validation; add golden contract version/fixture hooks. |
| `src/shared/desktop-api.ts` | UPDATE | Keep user-facing interface, replace Electron channel implementation details. |
| `services/api/migrations/*.sql` | MOVE | Preserve exact baseline SQL under `crates/tro-migration/sql/` before legacy deletion. |
| `services/api/src/**`, `services/api/test/**`, `services/api/scripts/**` | DELETE at API cutover | Rust API/worker/admin binaries own all behavior. |
| `services/api/package*.json`, `services/api/railway.json` | DELETE/UPDATE | Railway builds and starts Rust binaries, not Node 24. |
| `src/index.ts`, `src/main/**` | DELETE at desktop cutover | Tauri/Rust owns all privileged behavior. |
| `forge.config.ts`, `webpack.main.config.ts`, Electron-only build files | DELETE/UPDATE | Remove Electron main/preload packaging; retain a frontend bundler for React. |
| `package.json`, `package-lock.json` | UPDATE | Remove backend/Electron packages and retain only renderer/build/test dependencies. |
| `.github/workflows/ci.yml` | UPDATE | Add Rust fmt/clippy/test/audit and Tauri macOS/Windows packaging. |
| `.github/workflows/*release*.yml`, `macos-build.yml`, `windows-build.yml`, `microsoft-store.yml` | UPDATE | Tauri artifacts, signing, notarization, updater signatures, store packages. |
| `docs/architecture.md`, `docs/security.md`, `docs/knowledge-spaces.md` | UPDATE | Rust/Tauri topology, operations, rollback, permissions, and deployment. |
| `docs/adr/0001-rust-backend-boundaries.md` | CREATE | Lock decisions and explicit non-goals before implementation. |
| `docs/migration/rust-parity-matrix.md` | CREATE | Endpoint/command/event/storage/release parity owner and status. |
| `docs/runbooks/rust-api-cutover.md`, `rust-desktop-cutover.md` | CREATE | Canary, rollback, data, signing, and support procedures. |

## NOT Building

- A rewrite of the React UI, CSS, AudioWorklet, or renderer state management.
- A microservice split of the hosted API; start with a modular monolith plus separate worker/migration binaries.
- A database redesign, vector database, embeddings pipeline, Redis cache, Kafka, or new queue service before load evidence requires one.
- New product features, new Knowledge Space semantics, new pricing, or new approval behavior during the port.
- An unofficial Rust OpenAI Agents SDK in the trusted execution path.
- Direct raw `cua-driver serve` spawning on macOS; that is unsupported for stable TCC attribution.
- Automatic retry after a provider, upload, shell, file, or desktop action has an unknown result.
- Removal of all JavaScript from the repository. Frontend TypeScript/JavaScript remains; production backend JavaScript does not.
- Running migrations automatically in every API replica after the Rust cutover.

---

## Migration Sequence and Release Gates

```text
Gate 0: Freeze and characterize contracts
  -> Gate 1: Rust workspace/domain/persistence compiles beside legacy
  -> Gate 2: Rust API/worker passes differential + DB + load tests
  -> Gate 3: Canary Rust API, then 100%; keep instant Node rollback
  -> Gate 4: CUA/Tauri feasibility and signed-app permission spike passes
  -> Gate 5: Tauri host passes command/event/approval/native parity
  -> Gate 6: Tauri beta cohort, then stable; keep last Electron release available
  -> Gate 7: Delete legacy backend JS and enforce “no backend JS” CI rule
```

Never combine hosted cutover, database redesign, and desktop-shell cutover in one release. Every gate must have an independently deployable rollback.

---

## Step-by-Step Tasks

### Task 1: Freeze the behavioral baseline and write the parity matrix

- **ACTION**: Create the ADR, migration inventory, and executable golden fixtures before adding Rust behavior.
- **IMPLEMENT**: Inventory every hosted route, method, request/response schema, body/stream limit, status/error code, security header, log event, database transition, `DesktopApi` method/event, native window, global shortcut, secret file, and admin script. Export sanitized HTTP fixtures from existing Node tests and JSON contract fixtures from Zod. Record the baseline commit and test counts from this plan.
- **MIRROR**: `docs/architecture.md:38-155`, `src/shared/desktop-api.ts:73-250`, and `services/api/test/server.test.mjs:323-1030`.
- **IMPORTS**: No Rust imports; documentation plus fixture generation in the existing test harness.
- **GOTCHA**: Do not record provider keys, access tokens, signed S3 URLs, prompts, transcripts, file paths, or model output in fixtures.
- **VALIDATE**: `npm run check`; golden fixture generation is deterministic (`git diff --exit-code` after a second run); every row in `docs/migration/rust-parity-matrix.md` has an owner and test/gate.

### Task 2: Bootstrap the pinned Rust workspace and CI

- **ACTION**: Add the workspace skeleton and make Rust checks mandatory while legacy behavior remains unchanged.
- **IMPLEMENT**: Pin Rust 1.95.0. Add workspace members listed under Files to Change; centralize `tokio 1.53`, `axum 0.8.9`, `sea-orm 2.0.2`, `reqwest 0.13.4` with rustls, serde, schemars, thiserror, tracing, uuid, time, hmac/sha2, aws-sdk-s3, and lopdf. Set workspace lints to deny unsafe code by default, warnings in CI, `unwrap_used`/`expect_used` in production modules, and accidental blocking in async paths. Add fmt, clippy, nextest/test, `cargo audit`, and `cargo deny` jobs on Linux plus desktop builds on macOS/Windows.
- **MIRROR**: `.github/workflows/ci.yml:11-30` and CUA's pinned toolchain/fmt/test pattern in its Rust workspace documentation.
- **IMPORTS**: Workspace dependencies only; no domain implementation.
- **GOTCHA**: Tauri/CUA platform dependencies must be target-specific so Linux API builds do not link macOS/Windows desktop crates.
- **VALIDATE**: `cargo fmt --all -- --check`; `cargo clippy --workspace --all-targets --all-features -- -D warnings`; `cargo nextest run --workspace`; existing `npm run check` remains green.

### Task 3: Port contracts, constants, lifecycle, and policy as pure Rust

- **ACTION**: Implement `tro-contracts` and `tro-domain` with no I/O dependencies.
- **IMPLEMENT**: Port task contract v1-v6 reading behavior, v6 writing, tool/action types, public API request/response types, Knowledge limits, plan catalog, integer micro-USD math, Activity lifecycle, target admissibility, risk classification, completion policy, approval digest inputs, and state transitions. Use serde `deny_unknown_fields` on request types where Zod uses `.strict()`, explicit max-length/range validators, and `#[serde(rename_all = "camelCase")]`. Generate JSON Schemas and run fixture parity against Zod.
- **MIRROR**: `src/shared/contracts.ts:318-330,605-802,1192-1337`, `src/main/agent/policy.ts:105-178`, `services/api/src/knowledge-space-contracts.mjs:3-193`, and `services/api/src/activity-lifecycle.mjs`.
- **IMPORTS**: `serde`, `serde_json`, `schemars`, `thiserror`, `uuid`, `time`, `sha2`, `hmac`; no Axum, SeaORM, Tauri, or reqwest.
- **GOTCHA**: JavaScript safe integers and Rust integer types differ. Money/counts use checked `i64`/`u64`, serialize compatibly, and reject overflow rather than truncate. Preserve exact enum strings and generic public messages.
- **VALIDATE**: Unit/property tests cover all existing JS domain cases; every golden JSON fixture parses in both Zod and Rust and normalizes to byte-equivalent canonical JSON.

### Task 4: Baseline the current PostgreSQL schema with SeaORM migrations

- **ACTION**: Move the ten SQL files unchanged into `tro-migration`, add a migration ledger, and generate entities.
- **IMPLEMENT**: Create migrations `m000001`-`m000010` that `include_str!` the exact existing SQL and execute it through SeaORM. Use a named `tro_schema_migrations` table. On an existing database, run all idempotent baseline SQL once and record it; on an empty database, produce the same 30 tables, 24 indexes, constraints, defaults, and triggers/functions. Add a singleton `tro-migrate` binary that takes a PostgreSQL advisory lock before `Migrator::up`; API and worker only check schema compatibility/readiness and never migrate. Generate and commit SeaORM entities from the resulting PostgreSQL schema.
- **MIRROR**: `services/api/src/migrate.mjs:3-17`, `services/api/test/migrate.test.mjs:6-27`, and all `services/api/migrations/*.sql`.
- **IMPORTS**: `sea_orm`, `sea_orm_migration`, `tokio`, `tracing`.
- **GOTCHA**: Test the baseline against both empty and already-populated snapshots. Do not mark a migration applied before every statement succeeds. Do not add down migrations that destroy production data; rollback is application rollback plus forward repair.
- **VALIDATE**: Empty DB schema fingerprint equals Node-created schema; populated snapshot row counts/checksums survive; two concurrent migrators result in one migrator and one clean wait/exit; rerun is a no-op.

### Task 5: Port repositories with SeaORM CRUD and explicit critical SQL

- **ACTION**: Implement repositories for all current domains without changing schemas or transaction semantics.
- **IMPLEMENT**: Use SeaORM entities for users, sessions, access codes/redemptions, ordinary Space/group/member/invite/source/activity reads and writes. Use explicit parameterized SQL through the same `DatabaseConnection`/`DatabaseTransaction` for: per-user `pg_advisory_xact_lock`; access-code `FOR UPDATE`; rate-limit upsert; agent-turn idempotency/provider-call cap; reservation reserve/dispatch/settle/release/uncertain transitions; ingestion `SKIP LOCKED` leases; dashboard event projection; and `ts_rank_cd` search. Model result branches as enums, not nullable maps. Configure pool max/min/acquire/idle/lifetime from validated config.
- **MIRROR**: REPOSITORY_PATTERN, LEASE_PATTERN, `services/api/src/access-code-repository.mjs`, `rate-limit-repository.mjs`, `usage-repository.mjs`, and Knowledge repositories.
- **IMPORTS**: `sea_orm::{DatabaseConnection, DatabaseTransaction, TransactionTrait, ConnectionTrait, Statement, FromQueryResult}`, entities from `tro-persistence`, domain result enums.
- **GOTCHA**: Do not mix a standalone SQLx pool with SeaORM. Do not replace `FOR UPDATE`, advisory locks, conflict targets, or `SKIP LOCKED` with read-then-write application logic. Keep database timestamps authoritative.
- **VALIDATE**: Unit tests port every JS repository branch; Testcontainers tests prove concurrent reservations cannot cross caps, duplicate request IDs are idempotent, access codes cannot over-redeem, two workers cannot claim/finalize one job, and attempt search cannot cross user boundaries.

### Task 6: Port hosted identity, rate limits, plans, and budget services

- **ACTION**: Implement service-layer behavior on top of the Rust repositories.
- **IMPLEMENT**: Port Google RS256/JWKS verification with issuer/audience/nonce/email checks, opaque `tro_live_` session issuance/HMAC digest/rotation/revocation, access-plan resolution, plan-owned RPM/knowledge quotas, agent turns, budget estimate/authorization/snapshot, stale reservation cleanup, and sanitized settlement. Put time, UUID, and provider interfaces behind injectable traits.
- **MIRROR**: `services/api/src/google-token-verifier.mjs`, `session-repository.mjs`, `plan-catalog.mjs`, `agent-turn-service.mjs`, and `budget-service.mjs`.
- **IMPORTS**: `jsonwebtoken` or a narrowly selected JOSE crate after a compatibility spike, `reqwest`, `hmac`, `sha2`, `rand`, domain and persistence crates.
- **GOTCHA**: The Tro device token remains opaque and is not converted to a JWT. Never accept client-provided price, usage, quota, settlement status, or plan authority.
- **VALIDATE**: Golden tests match Node status/body semantics; invalid signature/issuer/audience/nonce/expiry/email cases fail closed; rotation invalidates the old credential; budget concurrency integration tests pass.

### Task 7: Port OpenAI/ElevenLabs provider proxies with exact uncertainty semantics

- **ACTION**: Implement provider clients and service orchestration before exposing Axum routes.
- **IMPLEMENT**: Build reqwest clients with explicit connect/header/overall timeouts, bounded request/response bodies, rustls, no middleware retries, and cancellation. Port Responses JSON/SSE proxying, usage parsing, transcription WAV validation/multipart upload, realtime call admission, and ElevenLabs MP3 streaming. Call `mark_dispatched` immediately before provider admission; release only on confirmed pre-inference rejection; mark uncertain on connection/response ambiguity; never retry ambiguous calls.
- **MIRROR**: `services/api/src/openai-responses-service.mjs`, `openai-transcription-service.mjs:30-307`, and `server.mjs:232-259,780-840`.
- **IMPORTS**: `reqwest`, `futures`, `tokio_util`, `bytes`, `http`, `mime`, `tro-domain`, `tro-persistence`.
- **GOTCHA**: Do not parse/re-encode SSE in a way that changes event order or buffers the complete response. Bound both declared and actual bytes. Cancellation after dispatch is an uncertain outcome unless a provider response proves otherwise.
- **VALIDATE**: Fake-provider tests cover first-byte streaming before upstream completion, disconnect/backpressure, oversized/invalid response, completed usage, and every release-versus-uncertain branch; differential tests match current Node headers/status/body.

### Task 8: Port Knowledge Spaces, S3 upload, extraction, search, and worker

- **ACTION**: Include all PR #9 backend behavior in Rust before API cutover.
- **IMPLEMENT**: Port schemas/policies/services/controllers, immutable Activity versions, Runs/assignments/Attempts/Work Sessions/evidence/help/dashboard, presigned upload/download, HEAD size/media/checksum reconciliation, bounded text/PDF extraction, chunking/search-vector writes, and retry/lease worker. Use `aws-sdk-s3`; use `lopdf::Document::extract_text_with_limit` in `spawn_blocking`; cap object bytes/pages/extracted characters/chunks; reject encrypted and scanned-only PDFs with existing codes. Worker polls with cancellation-aware backoff and a bounded extraction semaphore.
- **MIRROR**: `docs/knowledge-spaces.md`, SERVICE_PATTERN, `s3-object-store.mjs`, `knowledge-extractors.mjs`, `knowledge-search-service.mjs`, and `activity-service.mjs`.
- **IMPORTS**: `aws-config`, `aws-sdk-s3`, `base64`, `sha2`, `lopdf`, `tokio`, `tro-contracts`, `tro-persistence`.
- **GOTCHA**: Signed URLs/object keys never cross to renderer code except the exact short-lived URL fields already returned to trusted desktop orchestration. No bucket listing. `spawn_blocking` still needs concurrency and memory bounds. Preserve `simple` PostgreSQL text-search configuration for parity.
- **VALIDATE**: Port content-pipeline/domain/controller tests; use disposable PostgreSQL and S3-compatible storage for full upload→HEAD→lease→extract→search flow; prove corrupt/oversized/encrypted/scanned PDFs fail permanently and do not retry forever.

### Task 9: Compose the Axum API, compatibility harness, and Railway deployment

- **ACTION**: Expose the complete existing API from `tro-api` and deploy it beside Node.
- **IMPLEMENT**: Build nested routers with typed state, per-route body limits, auth/access middleware, origin rejection, security headers, request IDs, timeouts, and graceful drain. Preserve `/healthz`, readiness, every `/v1/**` method/path, content type, status, `Retry-After`, `Location`, transcription version header, and streaming behavior. Add Rust API/worker/migrator Railway configs and minimal release images. Run migrations as a separate deploy/predeploy job.
- **MIRROR**: `services/api/src/main.mjs:30-145`, `server.mjs`, `knowledge-space-http-controller.mjs`, and `services/api/railway.json`.
- **IMPORTS**: `axum`, `tower`, `tower-http`, `tokio`, `http-body-util`, application crates.
- **GOTCHA**: Tower layer order changes observable behavior. Body limits must run before JSON extraction, security headers must cover errors, and readiness must fail on incompatible schema. API replicas must not each run migrations.
- **VALIDATE**: Differential harness runs every golden request against Node and Rust; PostgreSQL integration and provider streaming tests pass; load test meets or improves the Node p95/error baseline at equal database pool size; health/readiness work during drain.

### Task 10: Canary and cut over the hosted API/worker

- **ACTION**: Shift production traffic independently of the desktop rewrite.
- **IMPLEMENT**: Deploy Rust against a production-like clone, then a no-user/shadow environment, then a small canary cohort or weighted route. Compare status/error/latency, reservation state, rate-limit counts, worker lease/failure rates, DB pool saturation, S3 errors, and sanitized logs. Stop Node worker before starting multiple Rust workers. Promote to 100%, keep the Node image/config rollback-ready for one stable release window, then delete Node API code only after the window.
- **MIRROR**: `docs/knowledge-spaces.md:34-40` rollback order and current Railway health behavior.
- **IMPORTS**: Deployment configuration only.
- **GOTCHA**: Do not mirror paid provider requests or mutating writes. Shadow only safe reads or compare recorded fixtures offline. Rolling back the app must not roll back schema destructively.
- **VALIDATE**: Canary SLOs hold for 24-72 hours; no reservation/usage divergence; no duplicate job finalization; rollback drill succeeds; installed Electron client completes auth, task, voice, budget, and Knowledge flows against Rust.

### Task 11: Prove the Tauri/CUA/signing boundary before porting desktop logic

- **ACTION**: Build a signed minimal Tauri spike that validates the highest-risk native assumptions.
- **IMPLEMENT**: Create main plus overlay windows; deny navigation/new windows; configure per-window Tauri capabilities/CSP; register global shortcuts; test tray/background lifecycle; query/request microphone, Accessibility, and Screen Recording; connect CUA in the same responsible application chain. Preferred integration is the safe Rust SDK/versioned C ABI. If that is not consumable as a supported release artifact, use CUA's `EmbeddedCuaDriverHost` path to a private Rust daemon. Record the exact CUA version/git revision, API, artifacts, licensing, and platform test matrix in the ADR.
- **MIRROR**: `src/index.ts:1906-2037,2136-2405`, `src/main/cua/cua-service.ts`, and the CUA integration documentation.
- **IMPORTS**: `tauri`, target-specific Tauri plugins, `tro-cua`, supported CUA Rust/C ABI artifacts.
- **GOTCHA**: This is a hard gate. Do not proceed with a raw sidecar that loses macOS TCC attribution, changes signed bundle identity, or cannot reproduce semantic/coordinate observation contracts on macOS and Windows.
- **VALIDATE**: Signed macOS arm64/x64 and Windows x64 spikes retain permissions across restart/update, capture/act through CUA, render overlays without focus theft, and pass a clean-machine permission matrix.

### Task 12: Implement the Rust Responses agent loop and trusted task runtime

- **ACTION**: Replace the TypeScript Agents SDK with a first-party Rust loop while keeping behavior and authority boundaries.
- **IMPLEMENT**: Port system instructions, bounded session/context filtering, tool registry/spec serialization, serial tool calls (`parallel_tool_calls=false`), `tool_choice=auto`, `store=false`, text delta streaming, steering injection, max turns/tool calls/deadline, completion checkpoint, approvals, denial continuation, cancellation, and final output validation. Port goal machine, task runtime, execution coordinator, observation lifecycle, exact approval digest/revalidation, unknown-outcome blocking, activity tools, and guidance pacing. Provider access still goes through the Rust hosted API using the opaque device session.
- **MIRROR**: `openai-agents-runtime.ts:43-190,385-464`, `task-runtime.ts`, `execution-coordinator.ts:835-1888`, and `bounded-agent-session.ts`.
- **IMPORTS**: `reqwest`, `eventsource-stream` or an audited minimal SSE decoder, `serde_json`, `tokio`, `tro-contracts`, `tro-domain`, `tro-cua`.
- **GOTCHA**: No official Rust Agents SDK exists. Treat unknown response event variants as bounded protocol errors, not silently ignored authority. Do not use `previous_response_id` if it implies provider storage contrary to `store=false`; maintain the bounded local input transcript. A model tool call is a proposal, never approval or proof of execution.
- **VALIDATE**: Port all policy, goal, runtime, coordinator, approval-loop, completion, context-window, and agent eval tests. Golden mocked event streams produce identical tool calls/text/phase transitions. Consequential unknown outcomes terminate without retry.

### Task 13: Port workspace, auth, local storage, Knowledge desktop orchestration, voice, and analytics

- **ACTION**: Implement every non-window service currently under `src/main/**` in `tro-desktop-core`.
- **IMPLEMENT**: Port Google PKCE/loopback auth, hosted session refresh/revoke, offline membership verification, preferences, optional PostgreSQL task history/migrations, usage client, Knowledge client/file selection/upload/starter preparation/progress, workspace selection/opaque IDs, root-confined patching, approved shell execution with allowlisted environment, voice WAV/provider client, audio ducking, narration tickets, update state, single instance, and PostHog-compatible allowlisted events via direct HTTP if retained. Use traits for filesystem/process/network/clock/secret/native adapters.
- **MIRROR**: `src/main/auth/**`, `membership/**`, `history/**`, `knowledge/**`, `workspace-agent-tools.ts`, `voice/**`, and `analytics/**`.
- **IMPORTS**: `tauri-plugin-stronghold`, `reqwest`, `tokio::process`, `cap-std` or rigorously reviewed canonical path helpers, `ed25519-dalek`, desktop/domain crates.
- **GOTCHA**: An approved shell remains not OS-sandboxed and the UI must say so. Patch operations must remain root/symlink confined. Unknown upload admission must reconcile with HEAD before completion. Existing Electron-encrypted secrets cannot be read directly by Tauri; ship an authenticated one-time bridge release or require sign-in again and document the choice.
- **VALIDATE**: Port each existing service test; add symlink/race/path/property cases; confirm child processes receive no provider/Tro/database/analytics secrets; prove starter staging cleanup and atomic rename; analytics payload snapshot contains only allowed fields.

### Task 14: Build the Tauri command/event bridge and native presentation shell

- **ACTION**: Replace preload/IPC and Electron composition with Tauri commands, channels/events, managed state, and windows.
- **IMPLEMENT**: Register one typed command per `DesktopApi` mutation/query; validate the invoking window label and payload; expose a renderer compatibility object whose methods call Tauri `invoke`; use channels/events for task/activity/update/voice/companion streams; never expose generic invoke/tool/CUA/filesystem handles. Recreate main, companion, voice island, guidance target/guidance, control indicator, and screen-registration behavior; tray, menu, global shortcuts, background lifecycle, one-time private audio delivery, and navigation denial. Split `src/index.ts` composition into small Rust setup modules.
- **MIRROR**: `src/preload.ts:86-704`, `src/main/ipc/register-ipc.ts`, `src/shared/desktop-api.ts:145-250`, and current sandboxed `BrowserWindow` options.
- **IMPORTS**: `tauri`, selected official plugins, `serde`, desktop/application crates.
- **GOTCHA**: Tauri capabilities are not a replacement for host policy. Companion/auxiliary windows get only the commands they need. Reject commands from the wrong window/webview. Do not send tokens, paths, screenshots, raw CUA references, provider responses, or generic error sources to the renderer.
- **VALIDATE**: Contract suite invokes every method with valid/invalid payload and wrong-window origin; event order/unsubscribe behavior matches preload; renderer Vitest suite passes against mocked compatibility adapter; manual multi-display/overlay/permission tests pass.

### Task 15: Migrate packaging, updates, signing, and release pipelines

- **ACTION**: Produce installable Tauri artifacts under the existing Tro identity.
- **IMPLEMENT**: Move renderer build to a Tauri-compatible frontend build (Vite is acceptable), configure product/bundle IDs, icons, entitlements, updater endpoints/public keys, macOS signing/notarization/universal or separate architecture artifacts, Windows signing/MSIX/store packaging, and release checksums. Replace Electron Forge/Squirrel updater logic and workflows. Preserve customer update continuity where technically supported; otherwise publish a final Electron bridge release that installs/migrates to the Tauri channel and document the one-time transition.
- **MIRROR**: `forge.config.ts`, `.github/workflows/release.yml`, platform workflows, `docs/MICROSOFT-STORE-RELEASE.md`, and current `AppUpdateService` behavior.
- **IMPORTS**: Tauri bundler/updater/action; frontend build dependencies only.
- **GOTCHA**: Bundle ID, signing certificate, update signature format, artifact naming, and TCC identity affect real users. Validate update paths from the last two stable Electron releases, not only clean installs.
- **VALIDATE**: `cargo tauri build` on macOS arm64/x64 and Windows x64; signature/notarization/store validation; clean install, upgrade, rollback/support path, permissions persistence, and auto-update smoke tests.

### Task 16: Cut over desktop, replace admin scripts, and delete backend JavaScript

- **ACTION**: Release Tauri gradually, then remove the legacy privileged runtime and enforce the end state.
- **IMPLEMENT**: Run internal/beta cohorts with crash, task completion, provider, approval, CUA, permission, voice, Knowledge, and update telemetry. Keep the final Electron release downloadable during rollback window. Replace access-code/membership/knowledge/runtime report scripts with `tro-admin` subcommands and update runbooks. After stable criteria, delete Electron main/preload, `src/main/**`, Node API/worker, backend packages/configs, and obsolete tests. Add CI script that fails if production files appear under `services/api/**/*.mjs`, `src/main/**/*.ts`, `src/index.ts`, or `src/preload.ts`, or if banned backend packages return.
- **MIRROR**: Current script CLI outputs and all release runbooks.
- **IMPORTS**: `clap` for `tro-admin`; CI shell only for enforcement.
- **GOTCHA**: Do not delete the compatibility fixtures/parity matrix with the legacy code; keep them as regression assets. Do not revoke or overwrite the last recoverable signed Electron artifacts.
- **VALIDATE**: Stable cohort SLOs hold for the agreed window; rollback drill succeeds; `rg` finds no production backend JS/TS or banned packages; full Rust/frontend checks and signed packages pass.

### Task 17: Prove scale and operational readiness

- **ACTION**: Establish measurable capacity and failure behavior before increasing replicas.
- **IMPLEMENT**: Add a Rust load driver or reproducible external harness for auth-light safe endpoints, rate-limit contention, budget reservations, SSE concurrency, 200/500-row dashboards, assignment/start/search, S3 upload admission, and worker throughput. Record p50/p95/p99, throughput, CPU/RSS, DB connections/wait, lock wait, provider first-byte, queue age, lease reclaim, and error/uncertain rates. Define autoscaling inputs, pool budget per replica, graceful drain period, and alert thresholds.
- **MIRROR**: `services/api/scripts/knowledge-load-report.mjs`, current server timeouts, and `docs/knowledge-spaces.md:40`.
- **IMPORTS**: Prefer a Rust `tro-admin load` subcommand; metrics via `tracing`/OpenTelemetry-compatible exporter selected during deployment implementation.
- **GOTCHA**: Never load-test paid provider calls or production user data. A faster HTTP benchmark is invalid if DB correctness, first-byte streaming, or memory bounds regress.
- **VALIDATE**: Capacity report checks into `docs/migration/`; API survives abrupt client disconnects and graceful termination; worker reclaims expired leases; replica/pool formula stays within database connection limit.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Contract parity | Every checked-in JSON fixture | Rust and Zod accept/reject and normalize identically | Yes |
| Pure policy | Supported/unsupported/sensitive/private/Tro-approval actions | Same allow/deny/approval/terminal decision | Yes |
| Budget arithmetic | Minimum, limits, maximum safe integer, overflow | Exact integer micro-USD or typed rejection | Yes |
| Reservation transitions | reserved/settled/released/uncertain duplicates | Same idempotent domain outcome | Yes |
| Activity lifecycle | Every allowed/disallowed state pair | Fail-closed transition result | Yes |
| Agent loop | Text, tool, approval, denial, steering, unknown event streams | Same ordered callbacks and final phase | Yes |
| Body/WAV parsing | Empty, malformed, claimed-size mismatch, maximum valid | Bounded success or generic typed error | Yes |
| Path confinement | relative, absolute, `..`, symlink, case collision, race | Only trusted-root operations succeed | Yes |
| Upload reconciliation | confirmed/unknown PUT plus matching/mismatching HEAD | Complete only after exact HEAD match | Yes |
| PDF extraction | valid, encrypted, scanned, bomb, page/character limit | Bounded pages or permanent typed failure | Yes |

### Integration and Differential Tests

| Area | Required proof |
|---|---|
| PostgreSQL | Empty baseline, populated baseline, concurrent reservation, access-code capacity, rate upsert, lease claim/reclaim, search authorization. |
| HTTP | Node-vs-Rust status, headers, JSON, content type, `Retry-After`, `Location`, security headers, and stream ordering. |
| Providers | Local fake OpenAI/ElevenLabs endpoints; no paid network calls in CI. |
| S3 | Disposable S3-compatible service; presign, PUT, HEAD/checksum, GET, worker flow. |
| Desktop commands | Valid/invalid payloads and wrong-window calls for every command; event sequencing/unsubscribe. |
| Native | Signed macOS/Windows clean-machine permission, CUA, shortcut, overlay, tray, update, and shutdown matrix. |
| Upgrade | Last two Electron releases to Tauri, existing auth/membership/preferences/history behavior, rollback/support path. |

### Edge Cases Checklist

- [ ] Empty input/body/query/file selection
- [ ] Maximum body, audio, upload, folder, source, page, chunk, context, command, patch, and output sizes
- [ ] Invalid enum/UUID/datetime/unknown JSON fields
- [ ] JavaScript-number/Rust-integer boundary and overflow
- [ ] Concurrent access code redemption, rate consumption, reservation, settlement, invite redemption, run assignment, and worker claim
- [ ] Database disconnect before/after commit and pool exhaustion
- [ ] Provider connection failure before dispatch, ambiguous admission, invalid/oversized body, stream disconnect, cancellation
- [ ] S3 PUT unknown admission and HEAD mismatch
- [ ] Lease expiry, worker crash, duplicate finalization, permanent extraction error
- [ ] Permission denied/revoked while running; clean machine and restart
- [ ] Symlink/path traversal/case collision/rename failure/partial starter download
- [ ] Screen/semantic target changes after approval
- [ ] Consequential action returns unknown and is never retried
- [ ] Wrong Tauri window invokes privileged command
- [ ] Update signature failure, interrupted update, previous Electron version upgrade

---

## Validation Commands

### Static Analysis

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo deny check
npm run lint
npm run typecheck
```

EXPECT: Zero formatting, lint, type, advisory, license, or forbidden dependency errors.

### Unit Tests

```bash
cargo nextest run --workspace
npm run test
```

EXPECT: All Rust and retained renderer tests pass.

### Full Test Suite

```bash
npm run check
cargo test --workspace --doc
```

EXPECT: No regressions; current JS checks remain mandatory until each legacy slice is deleted.

### Database Validation

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" cargo nextest run -p tro-persistence -p tro-migration -p tro-api --features integration
DATABASE_URL="$TEST_DATABASE_URL" cargo run -p tro-migrate -- up
DATABASE_URL="$TEST_DATABASE_URL" cargo run -p tro-migrate -- status
```

EXPECT: Baseline and forward migrations are recorded once; schema is compatible; concurrency tests pass. Use only a disposable database whose URL has been explicitly validated by the test harness.

### API Compatibility Validation

```bash
cargo run -p tro-admin -- contract compare --node-url "$NODE_API_URL" --rust-url "$RUST_API_URL" --fixtures tests/contracts/http
cargo run -p tro-admin -- load api --base-url "$RUST_API_URL" --profile safe-ci
```

EXPECT: Zero unexplained contract differences and no correctness/SLO regression. Fixtures must not invoke paid providers or production mutations.

### Desktop Build Validation

```bash
npm run build:renderer
cargo tauri build
```

EXPECT: Signed/release-configured platform package builds on its native CI runner. During transition, the existing `npm run package` remains required for Electron releases.

### Backend-JavaScript Removal Gate

```bash
test ! -e src/index.ts
test ! -e src/preload.ts
test ! -d src/main
test ! -d services/api/src
! rg -n '(@openai/agents|posthog-node|electron|electron-forge|from .pg.|require\(.pg.)' package.json src services apps crates src-tauri
```

EXPECT: No production privileged/backend JavaScript entry point or banned backend dependency remains. Run only after Task 16.

### Manual Validation

- [ ] Sign in/out, rotate/revoke session, restart, and recover from expired session.
- [ ] Run text-only task without CUA permissions.
- [ ] Run visible-context task through semantic and screenshot fallbacks.
- [ ] Approve/deny exact actions; change the screen after approval; attempt Tro approval-loop control.
- [ ] Cancel with UI and Escape; quit during active work; restart.
- [ ] Run workspace shell/patch with path/symlink/secret checks.
- [ ] Record/transcribe voice, stream narration, duck/restore audio.
- [ ] Create Space/group/invite/source/activity/run/attempt; upload, ingest, search, submit, dashboard.
- [ ] Disconnect network/provider/S3/database at the documented boundary cases.
- [ ] Install/update signed macOS and Windows packages on clean machines and upgrades.
- [ ] Perform API and desktop rollback drills from the runbooks.

---

## Acceptance Criteria

- [ ] Rust API serves every current hosted route with compatibility tests proving method/status/header/body/stream parity.
- [ ] Rust worker covers all PR #9 Knowledge ingestion behavior and can run multiple replicas without duplicate finalization.
- [ ] SeaORM owns the only PostgreSQL pool; all 30 current tables are represented; critical SQL preserves locks and idempotency.
- [ ] Migrations run from a separate singleton Rust binary and are safe on empty and populated databases.
- [ ] Tauri/Rust owns every privileged desktop command, window, policy, approval, CUA, filesystem, shell, auth, secret, update, voice, history, analytics, and Knowledge operation.
- [ ] React renderer remains sandboxed and has no raw Tauri/CUA/filesystem/shell/provider/token authority.
- [ ] Exact approvals and unknown-outcome no-retry behavior are covered by Rust tests and native smoke tests.
- [ ] Installed Electron clients work against the Rust API during the rollout.
- [ ] Signed Tauri upgrades/clean installs pass macOS and Windows release matrices and preserve product identity/permissions where supported.
- [ ] Production contains no Node/Electron process and no backend `.mjs`/privileged `.ts` entry point.
- [ ] All validation commands appropriate to the completed phase pass.
- [ ] API and desktop rollback drills succeed before legacy artifacts are retired.

## Completion Checklist

- [ ] Code follows discovered domain/repository/service patterns.
- [ ] Public error handling matches current generic messages/codes and never leaks internals.
- [ ] Logs use structured allowlisted fields and exclude sensitive content.
- [ ] Tests preserve current behavior before deleting legacy tests.
- [ ] No hardcoded secrets, provider keys, URLs, plans, prices, or environment-specific credentials.
- [ ] Documentation, diagrams, runbooks, support notes, and release instructions are updated.
- [ ] No database/product redesign is smuggled into the port.
- [ ] Each cutover has observability, canary criteria, and a tested rollback.
- [ ] Plan remains self-contained and parity matrix resolves per-endpoint/per-command details.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CUA Rust artifacts/API are not stable or lose macOS TCC attribution under Tauri | Medium | Critical | Task 11 is a hard pre-port gate; use supported direct SDK/C ABI or embedded host only; keep Electron until signed clean-machine proof. |
| Custom Responses loop differs from Agents SDK | High | High | Golden event streams, agent eval parity, bounded state machine, staged desktop beta; no unofficial SDK shortcut. |
| Electron→Tauri changes update/signing/bundle identity | High | Critical | Preserve IDs/certificates where possible; test last two stable upgrades; ship bridge release and retain rollback artifact. |
| ORM rewrite weakens transaction/lock behavior | Medium | Critical | SeaORM CRUD only where appropriate; keep critical SQL explicit and integration-test real concurrency. |
| Existing migration runner has no ledger | High | High | Import exact idempotent baseline, add tracked migration table and singleton advisory-locked migrator; test populated snapshots. |
| PDF extraction behavior/quality differs from PDF.js | Medium | Medium | Fixed corpus differential tests, bounded lopdf APIs, reject unsupported scans/encryption, canary worker metrics. |
| Dual API versions mutate the same DB inconsistently | Medium | High | Differential tests offline; canary by cohort/traffic, never duplicate paid/mutating calls; shared idempotency keys. |
| Secret migration from Electron `safeStorage` is impossible in Tauri | Medium | Medium | Authenticated one-time Electron bridge release or explicit re-sign-in; never weaken encryption to migrate. |
| Rewriting ~26k backend lines creates a long-lived branch | High | High | Small mergeable vertical PRs, legacy and Rust coexist, parity matrix, feature flags, independent hosted/desktop cutovers. |
| Rust improves CPU but DB/provider remains bottleneck | High | Medium | Load metrics, pool budgeting, stateless replicas, worker leases, provider first-byte/error metrics; add infrastructure only from evidence. |
| Renderer contract drifts between Zod and serde | Medium | High | Golden fixtures, JSON Schema artifacts, contract version header, dual boundary validation. |
| Platform-specific voice/window/permission behavior regresses | Medium | High | Native macOS/Windows CI plus signed clean-machine matrix and beta cohort. |

## Notes

- PR #9 is included in this plan: Knowledge Spaces, Sources, S3, ingestion jobs, Activities, Runs, Attempts, Work Sessions, submissions, evidence, dashboard, and desktop orchestration are not deferred.
- The recommended ORM is SeaORM, but “using an ORM” does not mean translating every proven PostgreSQL statement into an ORM builder. The explicit SQL is part of Tro's correctness model.
- A temporary Rust sidecar behind Electron is acceptable only as a migration step. It does not satisfy the end state because Electron main/preload would still be a privileged JavaScript backend.
- Keep the hosted and desktop migrations independently releasable. The Rust hosted API should reach stable production before the Tauri desktop becomes the stable client.
- Re-estimate delivery after Tasks 1, 4, 9, and 11. Those gates expose the real contract, database, HTTP, and native integration risk.
- Suggested pull-request slices: baseline/ADR; workspace/domain; migrations/entities; critical repositories; hosted identity/budget; providers/Axum; Knowledge worker; API canary; Tauri/CUA spike; agent runtime; desktop services; command/windows; packaging; cutover/cleanup.

## Confidence

- **Plan completeness**: 9/10
- **Hosted Rust feasibility**: 9/10
- **SeaORM fit**: 9/10 with explicit SQL for critical paths
- **Full desktop Rust feasibility**: 7/10 until the signed Tauri/CUA gate proves published integration and TCC behavior
- **Main unknowns**: CUA Rust artifact consumption/support contract, updater continuity from current Electron artifacts, and PDF corpus parity
