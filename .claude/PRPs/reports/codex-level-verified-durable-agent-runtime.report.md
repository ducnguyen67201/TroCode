# Implementation Report: Codex-Level Verified Durable Agent Runtime

## Result

Implemented the reliability-first TroCode runtime behind the backend-agent rollout controls. New enabled-cohort tasks use a backend-owned OpenAI Agents SDK supervisor, while Electron main remains the trusted local execution boundary for Workspace tools, CUA, approvals, browser state, and application launch.

The completion invariant is enforced in both hosted and rollback-local paths: a task cannot enter `completed` while any required current-revision outcome criterion is pending, failed, or unknown.

## Delivered

- Contract v7 outcome contracts, criterion results, evidence ledger, deterministic compiler, separate verifier, and hard completion gate.
- Accepted-versus-confirmed application launch semantics with fresh trusted Chrome-surface verification.
- Durable PostgreSQL runtime schema for runs, ordered events, encrypted session items, atomic staged compaction generations, checkpoints, tool invocations, criteria, evidence, and desktop worker sessions.
- AES-256-GCM operational-state encryption with authenticated metadata, key versions, key rotation support, TTL cleanup, and fail-closed configuration.
- Backend Agents SDK Runner using pinned `@openai/agents` 0.17.0 and `openai` 7.5.0, `store: false`, content-free tracing, serialized `RunState`, durable sessions, compaction, budgeted provider transport, safe pre-event retries, and circuit breaking.
- Authenticated task and desktop-worker HTTP/SSE protocols with ownership checks, replay, heartbeats, reconnect, stale-session replacement, and response-close cancellation.
- Reconnectable Electron `DesktopToolWorker` using the existing registry, policy, exact approval, Workspace, CUA, and deterministic verifier adapters.
- One-time execution grants and unknown-outcome handling. Sensitive desktop actions discovered by local normalization upgrade the durable invocation before dispatch; lost consequential results block and are never retried.
- Safe clarification recovery: a disconnected in-progress `task.interaction` is requeued because no external effect occurred, while other in-progress actions become unknown.
- Workspace filesystem and terminal adapters with relative-path binding, symlink-safe canonical-root checks, scrubbed environments, bounded output, and deterministic write verification.
- Adaptive image evidence with bounded overview pixels, in-memory originals, on-demand original-resolution crops, stale-observation invalidation, and no persisted screenshot bytes.
- Guarded `playwright-core` CDP adapter with exact page binding, strict locators, bounded output, and client-only disconnect cleanup.
- Host-owned Luna/Terra/Sol routing, explicit reasoning effort, Sol/long-context pricing, queue capacity controls, stable HMAC canaries, new-run kill switch, and rollback-local runtime retention.
- Accessible live outcome checklist using text plus status icons and `aria-live` announcements.
- Reliability benchmark/report script, deterministic scenario catalog, operations runbook, and architecture/security/privacy/cost documentation.

## Reliability fixes made during validation

- Session compaction now stages a new generation and atomically swaps it only after replacement items commit. A crash between clear and replacement preserves the old authoritative history.
- Evidence evaluation uses the newest matching trusted observation. A recoverable retry can pass after an earlier unknown, while a later contradiction still invalidates an earlier success.
- Workspace tools are advertised only for a current v7 Workspace authority, while hosted capability negotiation still uses the installed registry.
- macOS temporary-directory symlink aliases are resolved against the canonical Workspace root without weakening escape protection.
- Task and worker SSE streams are tied to the outgoing response lifecycle, not the already-completed incoming GET request.

## Validation

Passed:

- `npm run check`
  - ESLint: passed
  - TypeScript: passed
  - Vitest: 104 files, 700 tests passed
  - Node script/benchmark tests: 11 passed
  - API tests: 113 passed, 1 optional PostgreSQL integration test skipped because `TEST_DATABASE_URL` was not configured
- `npm run package`: passed for Electron arm64/darwin using the production Doppler configuration
- `npm audit --omit=dev`: 0 vulnerabilities
- `npm --prefix services/api audit --omit=dev`: 0 vulnerabilities
- `git diff --check`: passed
- Secret scan for the pasted Railway credential/host: no match in repository files

## Deliberate rollout boundaries

- The backend runtime remains controlled by `TROCODE_BACKEND_AGENT_ENABLED`, stable cohort configuration, and the rollout percentage. This change does not claim that a production canary has run or met sample-size thresholds.
- The Playwright/CDP adapter is implemented and tested but is not advertised to the model yet. The installed CUA `browser_prepare` result does not currently expose a narrow exact-target CDP endpoint to TroCode; enabling the lane without that grant would violate the one-use authorization boundary. CUA browser semantics and accessibility/vision remain active.
- The deterministic benchmark framework and scenario catalog are present, but a live candidate artifact with provider/CUA latency and cost measurements must be produced by the controlled canary environment before rollout increases.
- Clean packaged Windows execution, OS permission revoke/regrant, sleep/wake, and live Railway restart drills remain release/canary operations rather than claims from this macOS development run.
- The legacy local SDK runtime remains available for new-run rollback as required by the plan.

## Security note

The Railway PostgreSQL URL pasted in the conversation was not used, logged, or committed. Rotate that credential before deploying this branch because it has already been disclosed outside the secret manager.
