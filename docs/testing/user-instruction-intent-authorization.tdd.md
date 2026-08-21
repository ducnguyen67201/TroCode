# User-Instruction Intent Authorization: TDD Evidence

## Scope and invariant

This change treats an authenticated user's original request and later steering text as bounded authority for the reversible, in-scope effects they explicitly request. It does not let model output, webpages, screenshots, tool results, or generated plans grant authority.

The invariant under test is:

> A trusted user instruction may authorize only a matching typed effect within the existing task and Workspace boundaries. Hard-confirm effects, ambiguous effects, scope expansion, and unknown consequential outcomes remain approval-gated or blocked.

## Automated acceptance matrix

| Behavior | Test coverage and result |
|---|---|
| Contract v8 accepts bounded instruction grants and rejects invalid, duplicate, hard-confirm, or effect-free external grants | Shared contract and task-contract suites pass. |
| The desktop and backend deterministic compilers produce the same bounded grants and digest | Shared parity fixture runs in both Vitest and the API Node test suite and passes. |
| A requested private calendar event with no attendees can use instruction authority | Intent-policy and CUA semantic/coordinate tests pass without an exact approval. |
| Adding an attendee becomes `send_communication` and requires one exact approval | CUA semantic and policy tests pass; illegal communication metadata is rejected. |
| Workspace create/update/move work stays bound to the selected root | Workspace adapters, selection, symlink, and policy suites pass. |
| Workspace commands bypass UI only through the bounded safe-command policy | Inspection/test/lint/typecheck/build cases pass; install, network, privilege, destructive, publish, deploy, push, redirection, encoded-shell, and escape cases do not receive automatic authority. |
| Delete/archive, unexpected overwrite, publish, deploy, merge, money/trade, credentials, OS permission, install, sensitive transfer, scope expansion, and unknown effects cannot consume an instruction grant | Table-driven policy and action-effect suites pass. |
| Strict mode still confirms mutations and side effects | Policy regression suite passes. |
| Exact approvals stay digest-bound, expiring, one-use, and revalidated | Approval and execution-coordinator suites pass. |
| Approval requirement is independent from consequential retry handling | Policy, coordinator, backend invocation, and recovery suites pass. |
| A lost result for a consequential instruction-authorized action is blocked and not retried | Durable backend and coordinator recovery suites pass. |
| Steering increments authority revision; stale proposals fail closed; desktop authority synchronizes from the backend | Task runtime, application service, and backend service suites pass. |
| Rollback/kill-switch retains already-issued authority but creates no new grant | Runtime and backend rollout-policy tests pass. |
| Hosted protocol v2, migration 015, and incompatible-client handling fail closed | API protocol, repository, runtime, HTTP controller, and migration suites pass. |
| Authorization analytics contain only closed enums and counts | Analytics schemas and negative tests reject private payload fields. |
| Shared registry identity reaches TaskRuntime, coordinator, and hosted desktop worker | Registry and hosted Workspace execution regression tests pass. |
| Reliability scenarios have no hard-confirm bypass, false completion, or duplicate consequential action | `agent-reliability-benchmark` tests pass inside the repository check. |

## Consolidated validation evidence

Run on 2026-08-21 from the current branch:

- `npm run check` — passed.
  - agent runtime version check passed.
  - ESLint passed.
  - TypeScript `--noEmit` passed.
  - Vitest desktop/shared suites passed.
  - Node script and reliability benchmark suites passed.
  - API suite: 121 passed, 1 skipped, 0 failed. The skip is the optional live PostgreSQL integration test because `TEST_DATABASE_URL` was not configured.
- `npm run package` — passed for Electron `arm64/darwin` using the production Doppler configuration.
- root `npm audit` — 0 vulnerabilities.
- API `npm audit` — 0 vulnerabilities.
- `git diff --check` — passed.
- repository scan for the pasted Railway password, hostname, and PostgreSQL URL pattern — no matches.

## Manual and deployment acceptance still required

The automated and packaged-build gates are complete. These environment-dependent checks were not claimed from this development run:

- a live packaged calendar create and invitation against the user's calendar;
- a live packaged Workspace edit/test trace;
- Windows packaged execution and OS permission revoke/regrant;
- applying migration 015 to Railway and exercising restart/reconnect recovery;
- production PostHog payload inspection;
- a controlled backend canary meeting its sample-size, false-completion, duplicate-effect, and approval-rate thresholds.

Those checks belong to the release/canary environment because they mutate external state or require platform credentials and integrations. The feature remains fail-closed and controlled by its backend kill switch and cohort settings until those gates pass.

## Security note

The Railway database credential pasted into the conversation was not used, stored, or written to fixtures, logs, reports, or analytics. It must be rotated before this branch is deployed because it has been disclosed outside the secret manager.
