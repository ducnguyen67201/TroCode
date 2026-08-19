# CUA Semantic Fast Path Implementation Report

## Outcome

Implemented the approved CUA semantic fast-path plan on
`codex/cua-semantic-fast-path`. TroCode still uses one OpenAI Agents SDK
harness, registry, policy evaluator, exact approval path, dispatcher, task
session, and verification loop. The change adds structured browser/native
window context and opaque element actions before the existing screenshot and
coordinate fallback.

The feature is always attempted when the pinned CUA runtime advertises the
complete required capability groups. Unsupported or ambiguous surfaces retain
the deterministic desktop-vision fallback; there is no rollout environment
flag or parallel runtime path.

## Delivered

- Pinned `@trycua/cua-driver` to exact version `0.19.3` and guarded driver
  version `0.19.3`, contract `0.6.0`, tool-list schema `1`, plus capability
  inventory at initialization.
- Added bounded Zod contracts for window, accessibility, browser, semantic
  observation, element, command, and action-outcome data.
- Added a deterministic route ladder: browser semantics, window accessibility,
  window-scoped vision, then the existing desktop vision path.
- Added task/latest-observation-scoped public references. Raw window/tab IDs,
  browser refs, accessibility tokens, and snapshots stay in Electron main and
  are cleared on replacement, task end, disconnect, or shutdown.
- Added exact semantic approval revalidation. A held target is rebound only
  after the same surface yields one unique semantic match; otherwise the action
  is `not_executed` and the grant is discarded.
- Added a one-use, default-deny CUA authorization host for explicit existing
  browser-profile preparation. It validates the public session, expiry, and
  exact bounded resource predicate without logging the resource.
- Added strict `observe_surface`, `control_surface`, and
  `prepare_browser_access` model tools to the existing registry. The legacy
  desktop tools remain available for fallback.
- Extended the existing monotonic risk classifier to semantic controls. Visible
  labels/roles/values/application identity can only raise risk, and TroCode's
  own approval UI remains denied.
- Added content-free local/analytics performance events and
  `npm run cua:report -- --baseline <log> --candidate <log>`. The parser rejects
  non-allowlisted fields and enforces the planned latency, screenshot, desktop
  fallback, and confirmed-rate gates.
- Documented the route, trust, lifecycle, fallback, limitations, automatic routing,
  and repeatable real-application benchmark procedure.

## Automated validation

| Check | Result |
|---|---|
| Supported agent/CUA version check | PASS |
| ESLint | PASS |
| TypeScript `tsc --noEmit` | PASS |
| Desktop Vitest suite | PASS — 91 files, 593 tests |
| Node script tests | PASS — 8 tests, including the new CUA report tests |
| Hosted API tests | PASS — 56 tests |
| Focused final CUA suites | PASS — 2 files, 20 tests |
| Native Auto-scope probe | PASS — window scope; `list_windows` succeeded |
| Electron Forge production package | PASS — macOS arm64 |
| `git diff --check` | PASS |

The first consolidated `npm run check` stopped on three import-order/type-import
lint findings. Those findings were corrected, then the failed lint check and
the not-yet-run type/test gates were run successfully. After the final
monotonic-clock adjustment, lint, typecheck, focused CUA tests, package, and
diff checks were rerun successfully.

## Deviations and remaining release evidence

- No browser or VS Code extension was added. The installed CUA semantic and
  accessibility surfaces are used first; incomplete editor/canvas state falls
  back as planned.
- The report measures content-free CUA operation latency because adding task or
  surface identifiers would create reconstructable private traces. The matched
  scenario protocol supplies the end-to-end release comparison externally.
- This implementation environment verified the packaged macOS arm64 build but
  did not execute authenticated real-application benchmarks or a Windows
  package. Before production release, collect at least 20 matched
  runs per documented scenario and complete the packaged Windows subset in
  `docs/testing/cua-semantic-fast-path.tdd.md`.
- No `forge.config.ts` change was required: the existing native staging path
  packaged the configured driver successfully.

## Files of interest

- `src/main/cua/cua-surface-router.ts`
- `src/main/cua/cua-surface-reference-store.ts`
- `src/main/cua/cua-authorization-broker.ts`
- `src/main/agent/cua-semantic-agent-tools.ts`
- `src/main/agent/execution-coordinator.ts`
- `scripts/cua-fast-path-report.mjs`
- `docs/testing/cua-semantic-fast-path.tdd.md`
