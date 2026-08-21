# Implementation Report: User-Instruction Intent Authorization

## Result

Implemented the PRP on `codex/verified-durable-agent-runtime`. Tro can now treat an authenticated user's instruction as bounded authorization for explicitly requested, reversible work while retaining exact approval for communications and other hard-confirm effects.

This removes the repeated-approval failure mode without turning Computer Use into an authority source. The host still normalizes every operation to a closed typed effect, enforces Workspace and task scope, re-observes after execution, verifies the outcome, and blocks an unknown consequential result instead of retrying it.

## Delivered

- Contract v8 with a closed action-effect vocabulary, bounded intent grants, authority revision, digest, protocol v2 fields, and legacy v2-v7 execution compatibility.
- Pure deterministic intent compilers in desktop and backend runtimes with a shared parity fixture and fail-closed disabled result.
- Monotonic effect normalization across direct applications, CUA semantic actions, coordinate Computer Use, Workspace files, and Workspace commands. Model-supplied metadata can raise risk but cannot lower host-derived risk.
- Policy separation between authorization source, approval requirement, and consequential retry behavior.
- Balanced-mode instruction authority for matching private resource creation/update and bounded Workspace work; Strict mode and the complete hard-confirm set remain intact.
- One shared runtime tool registry through TaskRuntime, the coordinator, Workspace Agents SDK tools, and the hosted desktop worker. This fixes the reported “runtime tool operation is unavailable” approval path.
- A bounded Workspace command policy, root/symlink protections, effect-aware SDK tools, and deterministic post-action verification.
- Durable hosted authority persistence, privacy-safe event metadata, protocol compatibility checks, migration 015 constraints, steering revisions, and desktop authority synchronization.
- Kill-switch behavior that grants no new authority after disablement while preserving existing in-flight authority so rollback does not corrupt a task.
- User-facing authorization status, privacy-safe analytics, reliability benchmark scenarios, configuration, architecture, security, operations, and lifecycle documentation.

## Reliability fixes found during implementation

- Coordinate CUA now requires a typed semantic effect and attendee metadata instead of relying on a broad physical `submit` label.
- Proposed effects are monotonically merged with host-declared consequence, so a model cannot label a destructive or external action as safe.
- The hosted desktop worker now lists tools with the current goal, task, and observation context; Workspace tools are no longer accidentally hidden at execution time.
- Steering now synchronizes the backend-owned outcome and authorization revision into the desktop runtime before another action can dispatch.
- Task-event authorization metadata is schema-closed and cross-field validated; analytics can receive only fixed enums and counts.
- Workspace intent compilation avoids a redundant generic `update_resource/workspace_file` grant and relies on the narrower Workspace write/command grants.

## Validation

Passed:

- `npm run check`
  - runtime dependency/version check: passed
  - ESLint: passed
  - TypeScript: passed
  - desktop/shared Vitest suites: passed
  - Node script and reliability benchmark suites: passed
  - API tests: 121 passed, 1 optional PostgreSQL integration test skipped because `TEST_DATABASE_URL` was not configured
- `npm run package`: passed for Electron arm64/darwin using the production Doppler configuration
- root `npm audit`: 0 vulnerabilities
- API `npm audit`: 0 vulnerabilities
- `git diff --check`: passed
- secret scan for the pasted Railway password/host/URL: no repository matches

Detailed coverage and release-only checks are recorded in `docs/testing/user-instruction-intent-authorization.tdd.md`.

## Deliberate rollout boundaries and deviations

- The branch is one commit behind `origin/main`. Main was fetched and inspected, but it was not merged/rebased into this large dirty worktree because the overlapping uncommitted durable-runtime implementation made that unsafe. No user work was stashed or overwritten.
- Fail-closed contract v8 with an empty grant set is used when intent authorization is disabled for a new task. This preserves protocol shape without silently restoring broad authority.
- The deterministic compiler is the only authority compiler. No model-based compiler was added, so generated model content cannot create grants.
- The guarded Playwright/CDP adapter remains implemented but unadvertised until Tro receives a narrow exact-target CDP authorization grant from its browser runtime.
- No live Railway connection, migration, deployment, external calendar mutation, Windows package test, or production canary was performed. These require release-environment credentials or external side effects and remain rollout gates.
- No commit, push, PR merge, or production configuration change was made.

## Security note

The Railway PostgreSQL URL pasted into the conversation was not used, logged, or committed. Rotate that credential before deployment because it has already been disclosed outside the secret manager.
