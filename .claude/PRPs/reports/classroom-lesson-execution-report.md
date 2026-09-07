# Implementation report: Classroom lesson execution

## Status

The local implementation is ready for its first CI review on `codex/classroom-lesson-execution`, based on
`68abf99` (main's classroom sidebar update). The plan remains in `plans/`.
Do not treat this report as a completed release or physical acceptance result.
No push, PR, merge, deployment, Doppler change or running-app replacement has been
performed for this implementation.

The local change connects immutable teacher lesson preparation/confirmation,
versioned API delivery and claims, encrypted student parent state, material
opening, read-only Coach children, bounded browser demonstrations, student
controls, criterion feedback and teacher progress. New joins disclose automatic
lessons; initial/recovered sessions do not silently launch a demonstration.

## Assessment vs plan

| Metric | Planned | Local result |
|---|---|---|
| Complexity | XL | XL; shared contracts, Rust API, native execution and two desktop roles |
| Changed paths | Approximately 95 | 108: 67 new paths and 41 modified paths, including plan/report/docs |
| Confidence | Subject to integration verification | Source reviewed; compiler, runtime and device behavior unverified |

## Task accounting

| Plan task | Local implementation | Remaining verification |
|---|---|---|
| 1 Baseline/prerequisites | Rebased onto main sidebar update; shared test API readiness returned `status: ok`; fixture/config implemented | Authenticated deployed capability, account roles and both desktop builds |
| 2 Contracts/policies | Strict TS/Rust plans, digest corpus, lifecycle/mode/tool policy and bounds | CI |
| 3 API/schema | Append-only migration 037, four tables, authenticated lesson/claim/report/material/progress routes | PostgreSQL CI and upgrade test |
| 4 HTTP/IPC/preload | Typed authenticated client, owner checks and narrow sender-authorized IPC | CI |
| 5 Teacher preparation | Durable exact preview, stale draft invalidation, commit deduplication and lookup reconciliation | CI and teacher UI |
| 6 Composer | Teach a lesson, materials, modes, examples, exact preview and subsequent lesson preparation | CI and real class selection |
| 7 Feed/readiness | Initial/live distinction, receipt, cancellation, device/build heartbeat and actionable connection error | CI and mixed builds |
| 8 Durable parent | Encrypted journals, existing device reservation, restart/unknown handling, no ordinary SDK restore | CI and crash/restart exercise |
| 9 Materials | Exact Chrome target verification; assignment/source renderer acknowledgement and source pagination | CI and native platforms |
| 10 Coaching | Bounded read-only explanation/help/check, student-controlled practice and criterion feedback | CI and model/native acceptance |
| 11 Demonstration | Existing SDK executor with narrowed tools, per-effect authority, serial dispatch, revocation tombstones and completion evidence | CI and real browser effects |
| 12 Student controls | Sidebar and floating parent card; Pause/Stop/Next/help/check; join disclosure; child Stop routing | CI, focus and native cancellation |
| 13 Progress | Counts, paginated roster, step, reason, consent/build/heartbeat, criterion outcomes | CI and large roster |
| 14 Composition | Main/preload wiring, cleanup, task admission failure cleanup and old broadcast isolation | CI and regressions |
| 15 Regression coverage | Added contract/policy/client/draft/store/feed/controller/runner/Coach/IPC/renderer/PostgreSQL cases | Not executed yet |
| 16 Two-machine acceptance | Detailed repeatable runbook prepared | **Pending**; neither running desktop was changed |
| 17 Docs/review/rollout | Architecture/limits/recovery, source review and rollout documentation written | CI, approved rollout and acceptance |

## Architecture choices and deviations

- Reuse TaskApplicationService's reservation and extract its busy predicate, rather
  than create a parallel device lock. Each child retains immutable v11 authority.
- Reuse one CoachRuntime run per current lesson explanation/help/check. The parent
  owns Next; the existing legacy explanation loop remains isolated.
- Add a main-only `classroomLessonId` journal marker to stop ordinary SDK checkpoint
  restoration from replaying an interrupted lesson child.
- Demonstrations require semantic Chrome controls. Raw coordinate fallback and
  arbitrary native apps are excluded because the selected exercise cannot be
  reliably enforced there. Existing student input is never cleared automatically.
- Demonstrations currently require `answerReveal: allowed`; `after_attempt` stays
  read-only because teacher commit cannot establish each student's prior effort.
- SDK children reserve at most six model turns, retaining two within the same
  step's eight-request budget for read-only follow-up. Reservations are not
  refunded. Main reauthorizes before each tool/effect; no per-model-round SDK
  protocol handshake was added. Coach reauthorizes before observation/model/cues.
- Composer uses one selected material for its steps; the shared protocol and Ask
  Tro preparation support multiple reviewed resources. Source display pages are
  bounded; Coach receives bounded extracted text rather than the original layout.
- The test editor returns explicitly simulated output. Real Python editor behavior
  remains a separate required acceptance test.
- Existing large composition modules were reduced through small cohesive helpers;
  source-size exemptions may decrease but may not increase.

## Validation evidence

- Rust and newly added TS/TSX/CSS were formatted; changed import blocks organized.
- Final source review covered execution admission, tool scope/revocation, unknown
  outcomes, teacher preview, native browser opening and existing runtime wiring.
  `git diff --check` reported no whitespace errors. A changed-source line inventory
  found no size-limit increases or oversized new production modules. These are
  source checks, not compiler or runtime validation.
- Review corrections include explicit installed-Chrome URL launching, classification
  of pre-input refusals, cancellation routing without recursive cancellation, exact
  preview objectives/material/criteria, and insufficient-evidence feedback when a
  model supplies no visible locator.
- Existing 1,076 Vietnamese translations were compared and preserved before adding
  three new messages and updating the dictionary fingerprint.
- The stage `/readyz` read returned `status: ok`. `/v1/capabilities` requires a
  signed-in session; the unauthenticated response does not establish lesson support.
- No local typecheck, lint suite, tests, package build or PostgreSQL mutation has
  run. The repository's CI-first rule assigns those gates to CI after an authorized
  push. New tests are coverage written, not passing-test evidence.
- A required PostgreSQL `classroom_lesson_test` target is registered in Bazel and
  CI. It covers teacher/student authority, duplicate commits/claims, one-device
  ownership, child identity, monotonic reports and teacher stop. Existing migration
  upgrade expectations advance to 037 without editing published SQL.

## Remaining release gates

1. Obtain authorization for a push/PR; run the applicable final-revision CI checks,
   fix reported failures together, and rerun only failed gates where appropriate.
2. Deploy the test API/client revision under the existing external-action approval
   rules and run both fixture and real-editor acceptance on separate accounts.
3. Attach observed results before marking the full plan complete or merging.
