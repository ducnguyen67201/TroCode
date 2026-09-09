# Implementation report: classroom desktop teaching

Status: local coding and source review completed; CI and native acceptance pending. The plan remains active and has not been archived as complete.

Branch: `codex/classroom-desktop-teaching`

Worktree: `/Users/ducng/Desktop/workspace/TroCode-desktop-teaching`

Base revision: `787dcf88fd1cddeeb150d5e52001019f3af16ead`

## Result

The teacher selects a class original and edits the section, language, navigation preference and teaching request. Preparation happens automatically; one Send to class action confirms the exact digest. Each student downloads the authorized pinned original, verifies its SHA-256 and size, opens it externally and verifies the window before teaching. Already-open material and a local-file/window picker provide alternate and recovery paths.

V3 teaching uses the existing SDK agent with five restricted tools for observation, navigation, presentation, demonstration and round completion. The companion presents speech/captions/pointers. Continue explaining stays on the same step with fresh evidence and history. Local navigation consent is separate from automatic lesson receipt. Pause/Stop also accept an older revision of the same lesson, so rapid progress updates cannot prevent cancellation.

Native demonstrations support creating and typing into an empty Untitled VS Code scratch tab after verification and explicit control consent. Existing work is preserved. General computer tools, terminal execution, saving and submission are excluded. Legacy v1/v2 plans retain their route and canonical digest behavior.

## Plan status

| Task | Coding / evidence status |
|---|---|
| 1. Acceptance environment and delivery baseline | Isolated worktree and known staging readiness recorded. Actual two-device delivery and cause of the historical Not received result remain pending. |
| 2. V3 contracts and corpus | Coded; shared TS/Rust positive/negative fixtures added. |
| 3. Version negotiation and delivery | Coded; negotiated capability is published before processing, including version changes. |
| 4. External material binding | Coded; native identity stays in main, opaque selections expire, semantic and screenshot-only evidence supported. |
| 5. Teaching agent and presentation | Coded; constrained catalogue, serialized host checks, speech/pointers and explicit disposition. |
| 6. Student controls | Coded; file/window picker, separate control consent, same-step continuation, v3 internal-panel removal. |
| 7. Original material authorization | Coded; student/lesson/source authorization before short-lived ticket issuance. |
| 8. Download and native opening | Coded; streaming bound, hash/size checks, safe file names, durable open receipt and bounded wait. |
| 9. Scoped navigation | Coded; bound-window scroll/page/zoom, semantic document focus and verified Find field. |
| 10. Lifecycle and follow-ups | Coded; cumulative budgets, child identity durability, native cancellation and fresh continuation. |
| 11. Teacher inline editing | Coded; debounce/generation guards, stale draft cancellation and one Send. |
| 12. Receipts and progress | Existing progress and receipt reconciliation retained; compact sent display and version-update guidance. |
| 13. Teacher tools and documentation | Coded; teacher tool defaults describe v3; desktop workflow/support notes added. |
| 14. Native demonstrations | Coded for verified VS Code and empty scratch buffers; OS acceptance remains pending. |
| 15. Regression coverage and review | Tests added/updated; source review and whitespace check completed. CI execution pending. |
| 16. Two-device acceptance and rollout | Pending. No deployment, merge or classroom broadcast was performed. |

## Validation

| Check | Result |
|---|---|
| Source-level diff review | Completed; reviewed ownership, IPC, versioning, unknown effects, cache preservation, cancellation and stale pointers. |
| `git diff --check` | Passed. |
| Rust formatting | Applied to changed Rust files only. |
| `npm audit --json` | Ran before commit: 7 existing dependency findings (1 high, 6 moderate). Dependency manifests and lockfile are unchanged by this feature. |
| TypeScript typecheck / lint / tests | Pending CI; not run locally under the repository's CI-first instructions. |
| Rust contracts / PostgreSQL integration tests | Pending CI. The integration suite is ignored without its disposable database environment. |
| Native macOS / Windows packaging | Pending CI. |
| Actual teacher/student delivery, external viewers, voice and control | Pending on both OS clients and the updated shared backend. |

No test pass, packaging success, deployed capability, delivery fix or certified viewer support is claimed.

## Regression coverage written

- Shared Rust/TypeScript v3 corpus: default original opening, current-screen mode, missing/null/legacy surfaces, bad navigation, native-field injection and whitespace rejection, while retaining old digests.
- Backend integration: v2/v3 feed intersection and cursor, v3 device requirement, valid claim, unpinned/archived original and wrong account denial. The test fixture has no object store; full signed-download acceptance remains pending.
- File service: safe formats/names, integrity failure before open, durable dispatch before native opening, visible-file reuse, changed-cache preservation and no replay of unknown opens.
- Surface service: native identity retention, changed/unreadable windows, visual fingerprint changes, opaque one-use revision/expiry-bound selections.
- Tool service: strict function schemas, restricted catalogue, refreshed evidence delivered to the SDK, mandatory observed presentation/finish, consent enforcement, fresh observation after mutation, revocation, unknown outcomes and preservation of existing work.
- SDK admission: long/escaped questions fit the 8,000-character turn limit; full reviewed steps, guidance policy, source context and history are supplied by the observation tool.
- Lifecycle: same-step continuation, cumulative model reservations and stale-revision Pause.
- Teacher UI: late preparation cannot replace the current draft or send a stale digest; unknown send retains reconciliation.
- IPC and persistence: raw native path/PID injection rejected; native file record remains separately owner-scoped and encrypted.

## Design adjustments

- Reviewed lesson context travels in the authorized observation tool response instead of the SDK turn request, preserving the existing 8,000-character protocol limit without truncating teacher instructions.
- V3 native demonstrations may reserve up to eight turns, rather than four, because creating a scratch tab, observing it, typing, observing and presenting need separate turns. The existing eight-model-per-step cap remains. Full reservation can leave no follow-up model budget on that step.
- Original cached files are retained; modified files are never overwritten. Automatic eviction was omitted because a native app can keep a file open across Tro restarts. Incomplete downloads are removed.
- Native navigation uses verified window APIs for scroll/page/zoom and observed semantic targets for focus/Find. Arbitrary coordinate clicks are not added; unsupported actions hand navigation back to the student.
- A separate effective-surface wrapper was unnecessary: v3 requires an explicit surface in the shared contract; legacy behavior branches on the plan version.
- Workspace Activities retain their trusted-workspace requirement. Native teaching/demonstration uses current-surface or no-launch Activities and does not grant workspace authority.
- Small claim/report/surface-listing helpers were extracted to keep existing large source files within the repository's non-increasing size limits.

## Files

45 tracked files updated; 16 local files created, including the plan and this report. No dependencies or SQL migrations changed. The table excludes this report.

| File | Change | Current lines |
|---|---|---|
| `.claude/PRPs/plans/classroom-desktop-teaching.plan.md` | Created | 673 |
| `docs/classroom-desktop-teaching.md` | Created | 44 |
| `docs/classroom-lesson-execution.md` | Updated | 164 |
| `scripts/source-size-baseline.json` | Updated | 27 |
| `services/api/src/classroom/lesson_contracts.rs` | Updated | 299 |
| `services/api/src/classroom/lesson_delivery.rs` | Updated | 338 |
| `services/api/src/classroom/lesson_files.rs` | Created | 54 |
| `services/api/src/classroom/lesson_resources.rs` | Updated | 131 |
| `services/api/src/classroom/lessons.rs` | Updated | 222 |
| `services/api/src/classroom/mod.rs` | Updated | 24 |
| `services/api/src/http/classroom_lessons.rs` | Updated | 251 |
| `services/api/tests/classroom_lesson.rs` | Updated | 730 |
| `services/api/tests/fixtures/classroom-lesson-contracts.json` | Updated | 698 |
| `src/classroom-lesson-preload.ts` | Updated | 51 |
| `src/index.ts` | Updated | 3259 |
| `src/main/agent-runtime/local-tool-result.test.ts` | Created | 12 |
| `src/main/agent-runtime/local-tool-result.ts` | Updated | 37 |
| `src/main/application/classroom-lesson-task.ts` | Updated | 163 |
| `src/main/application/task-application-service.test.ts` | Updated | 503 |
| `src/main/coach/coach-runtime.ts` | Updated | 836 |
| `src/main/cua/cua-service.ts` | Updated | 1540 |
| `src/main/cua/cua-surface-router.test.ts` | Updated | 212 |
| `src/main/cua/cua-surface-router.ts` | Updated | 891 |
| `src/main/cua/cua-visible-application-surfaces.ts` | Created | 10 |
| `src/main/ipc/register-classroom-lesson-ipc.test.ts` | Updated | 76 |
| `src/main/ipc/register-classroom-lesson-ipc.ts` | Updated | 87 |
| `src/main/knowledge/classroom-desktop-teaching-tools.test.ts` | Created | 103 |
| `src/main/knowledge/classroom-desktop-teaching-tools.ts` | Created | 190 |
| `src/main/knowledge/classroom-desktop-teaching.fixture.ts` | Created | 24 |
| `src/main/knowledge/classroom-lesson-agent-tools.ts` | Updated | 143 |
| `src/main/knowledge/classroom-lesson-child.ts` | Created | 28 |
| `src/main/knowledge/classroom-lesson-client.test.ts` | Updated | 46 |
| `src/main/knowledge/classroom-lesson-client.ts` | Updated | 148 |
| `src/main/knowledge/classroom-lesson-companion.ts` | Updated | 17 |
| `src/main/knowledge/classroom-lesson-composition.ts` | Updated | 112 |
| `src/main/knowledge/classroom-lesson-controller.test.ts` | Updated | 243 |
| `src/main/knowledge/classroom-lesson-controller.ts` | Updated | 500 |
| `src/main/knowledge/classroom-lesson-feed-service.ts` | Updated | 90 |
| `src/main/knowledge/classroom-lesson-material-policy.ts` | Created | 25 |
| `src/main/knowledge/classroom-lesson-material-service.test.ts` | Created | 83 |
| `src/main/knowledge/classroom-lesson-material-service.ts` | Created | 154 |
| `src/main/knowledge/classroom-lesson-policy.ts` | Updated | 119 |
| `src/main/knowledge/classroom-lesson-state-store.test.ts` | Updated | 97 |
| `src/main/knowledge/classroom-lesson-state-store.ts` | Updated | 114 |
| `src/main/knowledge/classroom-lesson-step-runner.ts` | Updated | 292 |
| `src/main/knowledge/classroom-lesson-surface-service.test.ts` | Created | 65 |
| `src/main/knowledge/classroom-lesson-surface-service.ts` | Created | 98 |
| `src/main/knowledge/classroom-lesson-tool-policy.ts` | Updated | 220 |
| `src/main/presentation/observe-coach-screen.ts` | Updated | 19 |
| `src/renderer/CompanionResponseCard.tsx` | Updated | 225 |
| `src/renderer/features/classroom/ClassroomLessonComposer.test.tsx` | Updated | 125 |
| `src/renderer/features/classroom/ClassroomLessonComposer.tsx` | Updated | 94 |
| `src/renderer/features/classroom/ClassroomLessonDesktopControls.tsx` | Created | 30 |
| `src/renderer/features/classroom/ClassroomLessonPanel.tsx` | Updated | 156 |
| `src/renderer/features/classroom/ClassroomLessonPreview.tsx` | Updated | 163 |
| `src/shared/classroom-lesson-contracts.ts` | Updated | 398 |
| `src/shared/classroom-lesson-desktop-api.ts` | Updated | 79 |
| `src/shared/classroom-teaching-request.test.ts` | Updated | 61 |
| `src/shared/classroom-teaching-request.ts` | Updated | 86 |
| `src/shared/contracts.ts` | Updated | 2667 |

## Next steps

1. User authorized PR creation. Push the branch, open a draft PR and run the repository's applicable CI gates on that revision.
2. Fix CI findings together and rerun applicable gates as prescribed by the repository.
3. After separately authorized staging rollout, run the documented Python Foundations teacher/student acceptance on the same backend and record both client revisions, receipts and native outcomes.
4. Archive the plan only after the remaining acceptance criteria have been met.

Suggested PR title: **Teach classroom material in student desktop applications**

Suggested PR description: Classroom lessons currently display source material in Tro and require a separate teacher preview action. This change adds a version-negotiated desktop teaching flow that downloads and opens pinned originals externally, verifies the student's material window, and uses a constrained agent for explanation and permitted navigation. Teachers edit an inline summary and send once; students retain local control, same-step follow-ups and recovery controls. Regression coverage is included; CI and macOS/Windows teacher/student acceptance are pending.
