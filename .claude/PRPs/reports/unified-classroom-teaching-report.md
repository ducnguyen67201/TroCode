# Implementation Report: Unified classroom teaching

## Summary

Implemented the first coherent slice of the unified classroom teaching flow:

- Replaced the teacher's side-by-side lesson/direction experience with one
  **Teach the class** composer.
- Added a short request-to-lesson-plan resolver for assignment instructions,
  published source material, approved web URLs, explain, demonstrate, practice,
  and check wording.
- Removed the legacy `DirectiveComposer` teacher surface.
- Removed the student broadcast preview and legacy explanation panel from the
  active workspace.
- Removed link settings and passive directive rendering from `ClassroomSessionBar`;
  it now shows current lesson context and retains classroom help/check/navigation.
- Updated classroom lesson and knowledge-space documentation to describe the
  unified flow.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | XL | M for this slice; backend retirement remains |
| Confidence | High for UI behavior, pending CI | Moderate until dependencies/CI run |
| Files changed | 50–70 | 14 source/docs files plus plan/report |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | One-box teacher composer | Complete | Natural-language request replaces mode/link form. |
| 2 | Renderer legacy surface removal | Complete | Directive composer and passive student cards removed from active UI. |
| 3 | Lesson documentation | Complete | Unified source/web/execution flow documented. |
| 4 | Typed main-process intent adapter | Deferred | Current resolver lives in the composer; move it behind lesson IPC in the next slice. |
| 5 | Legacy IPC/client/Rust removal | Deferred | Old APIs remain for coordinated compatibility until the server/client rollout is ready. |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static analysis | Pass | `npm run typecheck` and `npm run lint -- --no-fix` pass after installing root and agent-runtime dependencies. |
| Unit tests | Pass | `npx vitest run src/renderer/features/classroom/ClassroomLessonComposer.test.tsx` — 2 tests passed. |
| Build | Pending | Not run; CI owns the full packaging/build gate. |
| Integration | Pending | Requires CI/shared staging deployment. |
| Edge cases | Source-reviewed | URL allowlist, explicit demonstration, source selection and legacy-link absence are covered in code paths; automated execution pending. |

## Files Changed

| File | Action |
|---|---|
| `src/renderer/features/classroom/ClassroomLessonComposer.tsx` | UPDATED — compact request composer and resolver |
| `src/renderer/features/classroom/ClassroomLessonComposer.test.tsx` | UPDATED — one-box UI expectations |
| `src/renderer/FacilitatorRunPage.tsx` | UPDATED — removed legacy directive state and renderer |
| `src/renderer/ClassSessionsPanel.tsx` | UPDATED — removed obsolete facilitator origin prop |
| `src/renderer/ClassroomSessionBar.tsx` | UPDATED — removed passive directives/link settings |
| `src/renderer/app/AppWorkspace.tsx` | UPDATED — removed legacy student panels |
| `src/renderer/features/classroom/DirectiveComposer.tsx` | DELETED |
| `src/renderer/ClassroomBroadcastPreview.tsx` and test | DELETED |
| `src/renderer/ClassroomExplanationPanel.tsx` and test | DELETED |
| `docs/classroom-lesson-execution.md` | UPDATED |
| `docs/knowledge-spaces.md` | UPDATED |
| `docs/frontend-source-inventory.md` | UPDATED — removed deleted classroom surfaces |

## Deviations from Plan

1. The plan called for a main-process teaching intent service and new typed IPC.
   This revision keeps the resolver local to `ClassroomLessonComposer` so the
   user-facing confusion is removed without changing the existing lesson wire
   contract. Moving it behind IPC is the next implementation slice.
2. Legacy backend, preload and client services remain compiled for compatibility;
   only their active renderer entry points were removed. Removing them requires a
   coordinated API/client deployment and migration inventory update.
3. The plan's full two-machine acceptance could not run because dependencies are
   absent from this worktree.

## Issues Encountered

- Initial checks were blocked until the separate `services/agent-runtime`
  dependencies were installed. The consolidated typecheck, lint and focused
  composer test now pass.

## Next Steps

- Install dependencies and run the focused composer/renderer tests and typecheck.
- Move `planFromRequest` into a main-process `ClassroomTeachingIntentService`
  exposed by lesson IPC.
- Remove legacy broadcast/directive/guidance client and Rust paths in a
  coordinated API/client release, then run CI and shared two-machine acceptance.
