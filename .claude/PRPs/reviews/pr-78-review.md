# PR #78 code review

Reviewed 2026-09-08. Initial head: fe2269458bb613fd8124423aa3f5a2efc046465d.
Branch: codex/classroom-context-readiness → main.
Decision: COMMENT; findings addressed, final revision CI and two-machine acceptance pending.

## Findings and corrections

- HIGH — `src/main/application/classroom-lesson-task.ts:33`: packing objective, instruction and question into the task request can exceed the 8,000-character admission/Coach limit for valid lessons. Use mode plus question/instruction for the request and retain the full reviewed step in typed lesson context. The agent branch retains its demonstration context. Regression tests cover maximum-length instructions/objectives, long questions and JSON-escaped content without truncating the current instruction or question.
- HIGH — `src/main/presentation/observe-coach-screen.ts:10`: retaining the source-material window for check children covers the student's editor during observation. Exclude check children from material-window retention. A regression verifies checks request normal window hiding while source explanations retain the window.
- MEDIUM — `src/renderer/features/classroom/ClassroomLessonMaterialPanel.tsx:28`: viewport intersection alone acknowledges material covered by a Settings dialog. Hit-test the visible center before acknowledgement and keep waiting when another DOM element covers it. This checks DOM occlusion, not arbitrary operating-system windows. Regression covers covered material becoming visible.

No critical findings identified. The separate Ponytail review removes duplicated request packing (nine production lines).

## Validation

All three failures were reproduced before correction. The focused diagnostic run passes 29 tests across task admission, observation routing and material readiness. Full local verification was not run, following repository CI-first guidance. The original revision passed hosted source/Rust/CodeQL checks; those results do not validate these corrections. Final revision CI is tracked on the PR.

`npm audit` reports three existing moderate transitive advisories and no high/critical findings. Dependency files are unchanged. Two-machine staging acceptance remains required for native visibility, consent restoration and actual lesson/help/check behavior.

## Scope reviewed

Reviewed the PR's desktop composition and observation lifecycle, task/Coach context, lesson session/controller/runner/policy/store, IPC and shared schemas, renderer workspace/material controls, associated regression tests, source-size baseline and execution documentation. No API service, SQL migration, dependency or event-delivery changes are included.
