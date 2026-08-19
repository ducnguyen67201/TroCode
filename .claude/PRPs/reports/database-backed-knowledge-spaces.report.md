# Implementation Report: Database-Backed Knowledge Spaces

## Outcome

Implemented the Knowledge Spaces PRP behind the disabled-by-default
`TROCODE_KNOWLEDGE_SPACES_ENABLED` capability flag.

TroCode now has a neutral reusable delivery model:

- **Space** for durable knowledge, people, Groups, and Activities in any field.
- **Activity Version → Run → Assignment → Attempt → Work Session** for live,
  asynchronous, and hybrid delivery without education-specific domain branches.
- Reviewed file/folder uploads through opaque Electron-main selections, private
  checksum-bound object storage, bounded asynchronous extraction, and scoped
  PostgreSQL full-text retrieval.
- TaskContract v6 Activity context resolved by trusted main from an Attempt ID;
  renderer/model input cannot author policy, rubric, knowledge, or insight scope.
- Workspace launch, starter materialization, and one fresh current-surface CUA
  observation. The existing semantic CUA work remains compatible and the current
  screenshot observation remains the fallback.
- Explicit help and submission actions plus facilitator dashboards based on
  operational state and provenance-labeled evidence, never inferred mastery,
  grades, screen streaming, or automatic local-file upload.

No manifest or Firebase authority was added. PostgreSQL remains canonical and
the existing Agents SDK/CUA approval harness remains the execution boundary.

## Main implementation surfaces

- Hosted domain and HTTP API: `services/api/src/knowledge-space-*.mjs`,
  `activity-*.mjs`, `insight-service.mjs`, and migrations 007-009.
- Content pipeline: private S3 tickets/HEAD verification, ingestion leasing,
  bounded text/PDF extraction, chunk indexing, and Attempt-scoped search.
- Desktop trust boundary: `src/main/knowledge/`, exact preload/IPC contracts,
  opaque native file selection, upload concurrency of three, and starter staging.
- Agent integration: TaskContract v6, Activity prompt envelope, dynamic
  `knowledge.search` and policy-gated `activity.signal`, plus current-surface
  observation routing without granting CUA authority to Activity data.
- Renderer: Spaces, Library uploads, Activity editor, Groups/invites, Runs,
  Assigned Activities, Attempt launch/help/submission, and facilitator dashboard.
- Operations: feature flag, plan quotas/rate limits, worker/load scripts,
  deployment/privacy/retention documentation, and Activity eval fixtures.

## Security and reliability properties

- Renderer remains sandboxed; no raw IPC, access token, local canonical path,
  object key, checksum, or signed URL crosses the public desktop API.
- Repository queries bind authenticated user plus Space/Attempt scope. Cross-Space
  Activity versions, Sources, Groups, invites, and Run participants fail closed.
- Publish, Run creation, uploads, Work Sessions, help, evidence, and submission
  paths use bounded contracts and idempotency/reconciliation behavior.
- Source extraction is capped at 25 MiB input, 500 PDF pages, 2,000,000
  characters, and 5,000 chunks; uploaded content is never executed.
- Participant search is limited to ready Source Versions pinned to that exact
  Attempt. Normal tasks receive neither Activity tools nor Activity context.

## Verification

Passed:

- `npm --prefix services/api test` — 64 passed, 1 environment-gated PostgreSQL
  integration fixture skipped.
- `npm run typecheck`.
- `npm run lint` with no warnings after the final focused cleanup.
- `npm run test` — 95 Vitest files / 652 tests, 8 Node script tests, and the API
  suite passed.
- `npm run check` — runtime-version guard, lint, typecheck, and all tests passed.
- `npm run package` — Electron Forge packaged the macOS arm64 application.
- `npm --prefix services/api run knowledge:worker-smoke`.
- `npm --prefix services/api run knowledge:load-report` — deterministic 200- and
  500-participant projection fixtures completed.
- `git diff --check`.
- Root and API dependency installation/audits reported zero vulnerabilities.

Environment-gated follow-up:

- `npm --prefix services/api run test:integration` is present and skipped safely
  because `TEST_DATABASE_URL` was not configured.
- The database portion of `knowledge:load-report` likewise reports a skip until a
  disposable `TEST_DATABASE_URL` is supplied.
- Production rollout still requires the documented private S3-compatible bucket,
  worker service, retention choices, backup/restore drill, and feature-flag cohort.

## Preserved concurrent work

The pre-existing CUA semantic-fast-path plan and implementation files were
preserved and reconciled. Knowledge Spaces uses their normalized observation
route when available but does not replace or broaden the CUA harness.
