# Implementation Report: Student Assignment Check and Teacher Review

## Summary

Implemented the shortcut-first assignment check and explicit review handoff on
`codex/classroom-migration-compatibility`. Students can use ⌘⌥K / Ctrl+Alt+K while
working in another app. The floating panel shows bounded, criterion-based
feedback and separate teacher-review actions. Accepted Work Sessions register
starts and check execution; only the existing teacher review completes work.
No code execution, full PDF extraction, or Scratch archive reader was added.

## Assessment vs reality

| Metric | Plan | Actual |
|---|---|---|
| Complexity | Large | Large; shared contracts, main/runtime, renderer, Rust API |
| Confidence | 8/10 | Strong automated and native macOS evidence; live-model and Windows acceptance remain unverified |
| Files | 45–50 | 44 source/test/documentation files, excluding PRP artifacts |

## Tasks

| # | Task | Implementation |
|---|---|---|
| 1 | Strict contracts and deterministic policy | Complete: host-owned IDs, validated citations, omitted criteria unverified, advisory aggregation |
| 2 | Bounded evidence | Complete: selected saved files, one visible capture, optional bounded reference search, omission disclosure |
| 3 | Read-only routing | Complete: Check stays Coach even when fast Coach is disabled or Agent is requested |
| 4 | Shortcut and floating controller | Complete: scoped registration, debounce, stale-binding checks, native folder/file selection, no number-key takeover |
| 5 | Dedicated Coach check | Complete: one structured request, no tools, cancellation and unavailable-context outcomes |
| 6 | Private persistence and feedback | Complete: bounded typed reports, owner-scoped encrypted history, shared feedback component |
| 7 | Explicit review and start | Complete: review is a gesture; file preview precedes upload; confirmed review permits checks again after teacher Return |
| 8 | Operational reporting | Complete: startedAt/lastCheck, purpose-aware dashboard, queued PATCH calls, server row lock and terminal guards |
| 9 | Regression/integration coverage | Complete: 41 added JavaScript test cases, Rust dashboard test and expanded classroom lifecycle assertions |
| 10 | Documentation/package/native validation | Documentation and package complete; native macOS smoke passed with synthetic server/model. Remaining live-app acceptance scope is listed below. |

## Validation

The initial consolidated `npm run check` stopped at import ordering. Those issues
were fixed, then only the failed and not-yet-executed stages were run. Subsequent
focused checks cover defects found during UI review; earlier successful Rust and
SDK checks were not needlessly repeated.

| Check | Result |
|---|---|
| SDK lint/typecheck/tests | Pass, 24 tests |
| Admin production build | Pass |
| Runtime compatibility and Rust-only architecture check | Pass |
| Repository lint and TypeScript | Pass after import ordering, duplicate property, and test fixture type fixes |
| Rust formatting and Clippy | Pass |
| Cargo audit | Exit success; three pre-existing allowed warnings: ttf-parser unmaintained, lru unsound advisory, chacha20 yanked |
| Full Vitest suite | Pass, 148 files / 941 tests at the consolidated pass |
| Later regressions | Four additional cases passed; focused controller, encrypted history, contracts and renderer suites passed after fixes |
| Rust suite | Pass, 88 non-ignored tests; unrelated database tests retain their existing ignored status |
| PostgreSQL classroom integration | Pass, both ignored classroom tests explicitly run against a disposable local PostgreSQL 17 database; container removed afterward |
| Bazel tests and build/Clippy | Pass |
| Electron macOS arm64 package | Pass; final ASAR verified to contain the updated panel, shortcut, typed model check and guarded review actions. |
| Whitespace/diff check | Pass |

The new encrypted-history fixture initially used another task's messages; the
binding schema correctly rejected it. The fixture was corrected and that suite
passed. No production validation was weakened.

### Native smoke evidence

A disposable Electron process loaded the production controller, shortcut module,
feedback React component and CSS against synthetic assignment/server/model data.
macOS System Events pressed **⌘⌥K twice** and typed **1234** while the synthetic
editor was foreground. The real global shortcut registered; exactly one check
ran; the editor retained focus; the main window remained hidden; typing reached
the editor. A 420×360 native panel rendered with scrollable feedback and visible
review controls. The process exited and unregistered its shortcut.

- [Native panel screenshot](student-assignment-check-and-review-evidence/native-panel.png)
- [Native smoke measurements](student-assignment-check-and-review-evidence/native-smoke.json)

This verifies native focus, shortcut registration, debounce, layout and typing.
It does **not** claim an authenticated model check was manually exercised in VS
Code/Scratch, that OS permission denial was manually toggled, or that Windows was
run. Those remain release acceptance checks. Cancellation, missing evidence,
policy, reference-only citations, upload preview and review ownership are covered
by automated tests and the real local PostgreSQL lifecycle test.

## Deviations

- The dedicated model response schema is separate from the ordinary Coach raw
  response schema. The normalized union includes `work_check`; authoritative
  `activity.purpose` selects the branch. This avoids changing existing walkthrough
  JSON requirements or adding a redundant persisted marker.
- Added host-owned criterion titles to reports for readable feedback rather than
  displaying internal IDs.
- Directory enumeration is bounded before sorting the discovered entries. An
  over-budget directory is explicitly partial; it does not claim globally sorted
  selection across entries that were never enumerated.
- Native synthetic smoke plus server integration replaces most manual acceptance
  steps for this implementation run. Live-model/Windows checks are not claimed.
- Tests are grouped by behavioral boundary; check contract compatibility has its
  own test file instead of expanding the large general contracts suite.
- The navigation supplement named in AGENTS.md is missing from this checkout;
  existing root guidance and knowledge-space docs were used.

## Files

| File | Change |
|---|---|
| `docs/knowledge-spaces.md` | Updated |
| `services/api/src/classroom/contracts.rs` | Updated |
| `services/api/src/classroom/dashboard.rs` | Updated |
| `services/api/src/http/knowledge.rs` | Updated |
| `services/api/tests/classroom_e2e.rs` | Updated |
| `src/index.css` | Updated |
| `src/index.ts` | Updated |
| `src/main/agent-runtime/encrypted-agent-state-store.test.ts` | Updated |
| `src/main/agent/task-runtime.test.ts` | Updated |
| `src/main/agent/task-runtime.ts` | Updated |
| `src/main/application/task-application-service.test.ts` | Updated |
| `src/main/application/task-application-service.ts` | Updated |
| `src/main/application/task-request-router.test.ts` | Updated |
| `src/main/application/task-request-router.ts` | Updated |
| `src/main/coach/coach-contracts.ts` | Updated |
| `src/main/coach/coach-runtime.test.ts` | Updated |
| `src/main/coach/coach-runtime.ts` | Updated |
| `src/main/companion/assignment-check-controller.test.ts` | Created |
| `src/main/companion/assignment-check-controller.ts` | Created |
| `src/main/companion/companion-response-controller.ts` | Updated |
| `src/main/companion/global-work-check-shortcut.test.ts` | Created |
| `src/main/companion/global-work-check-shortcut.ts` | Created |
| `src/main/knowledge/activity-progress-reporter.test.ts` | Updated |
| `src/main/knowledge/activity-progress-reporter.ts` | Updated |
| `src/main/knowledge/work-check-context-service.test.ts` | Created |
| `src/main/knowledge/work-check-context-service.ts` | Created |
| `src/main/knowledge/work-check-policy.test.ts` | Created |
| `src/main/knowledge/work-check-policy.ts` | Created |
| `src/main/knowledge/work-check.fixture.ts` | Created |
| `src/renderer/App.tsx` | Updated |
| `src/renderer/AttemptLaunchPage.test.tsx` | Created |
| `src/renderer/AttemptLaunchPage.tsx` | Updated |
| `src/renderer/ClassroomSessionBar.tsx` | Updated |
| `src/renderer/CompanionResponseCard.tsx` | Updated |
| `src/renderer/FacilitatorRunPage.tsx` | Updated |
| `src/renderer/KnowledgeHubPage.tsx` | Updated |
| `src/renderer/WorkCheckResultCard.test.tsx` | Created |
| `src/renderer/WorkCheckResultCard.tsx` | Created |
| `src/renderer/app-language.ts` | Updated |
| `src/renderer/work-check-view.test.ts` | Created |
| `src/renderer/work-check-view.ts` | Created |
| `src/shared/contracts.ts` | Updated |
| `src/shared/work-check-contracts.test.ts` | Created |
| `src/shared/work-check-contracts.ts` | Created |

## Plan archive

Implementation plan archived to `../plans/completed/student-assignment-check-and-review.plan.md`.
The release acceptance gaps below remain explicit; archiving does not claim those
manual scenarios were run.

## Remaining release validation

- Exercise the packaged app with a synthetic authenticated teacher/student class
  and the real model transport, including VS Code/Scratch capture and native
  file submission.
- Run the corresponding native shortcut/focus/permission cases on Windows.
- Review the change and create a PR when requested. No commit, push, or hosted
  classroom mutation was performed by this implementation task.
