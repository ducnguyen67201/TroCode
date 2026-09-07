# PRP: Unify classroom teaching around lesson execution

## Goal

Remove the legacy classroom-direction, broadcast, and guidance surfaces and make
**Teach a lesson** the single teacher-to-student execution path. A teacher should
be able to enter one short request such as “show section 1 of
01-python-bai-hoc.md and explain it in Vietnamese,” review a compact preview, and
broadcast it once. Tro resolves the current class/session and published
material, opens it on consenting student devices, explains it in Tro, and only
performs computer-use demonstrations when the reviewed plan explicitly contains
one.

This fixes the current failure mode where a request sent from the old
`ClassroomDirective`/broadcast path appears as a passive link or message and
never starts lesson execution. Links, source text, assignment instructions,
explanations, demonstrations, practice, help, and checks must all use the lesson
contract and lesson feed.

## Complexity and scope

- **Complexity:** XL. Coordinated TypeScript/Electron and Rust API cleanup across
  roughly 50–70 files, with compatibility tests and rollout work.
- **User story:** In an open class, a teacher states what students should see or
  learn, sees the exact resolved material and phases, and confirms one safe
  lesson. Students receive that lesson, see material opened automatically when
  allowed, and can continue, ask for help, or check work without clicking a
  broadcast link.
- **Out of scope:** arbitrary autonomous desktop control, replaying teacher
  coordinates, silent typing into student work, auto-submit/grade, replacing CUA
  policy, changing classroom roles, changing the URL allowlist, or deleting
  immutable SQL migrations/data.

## Current state and evidence

Two authoring paths are active:

1. `src/renderer/FacilitatorRunPage.tsx:43-59,199-235,341-362` owns
   `directiveKind`, instruction/url/criteria state, calls
   `window.tro.createClassroomDirective`, and renders both
   `ClassroomLessonComposer` and `DirectiveComposer`.
2. `src/renderer/features/classroom/DirectiveComposer.tsx:63-235` is the old
   “Current class direction” surface. It offers Message/Open a link, previews a
   directive, and tells the teacher to use Teach a lesson for guided execution.
   Its broadcast cannot start the lesson controller or CUA runner.

The lesson implementation already supplies the safety boundary:

- `src/shared/classroom-lesson-contracts.ts:23-180` strictly validates modes,
  assignment/source/web resources, limits, digests and receipts.
- `src/main/knowledge/classroom-lesson-draft-service.ts:32-123` validates live
  context, persists owner-scoped drafts, serializes confirmation and reconciles
  uncertain commits.
- `src/main/knowledge/classroom-lesson-composition.ts:16-83` composes client,
  drafts, controller, feed and runner and emits `[classroom:lesson]` state.
- `src/main/knowledge/classroom-lesson-controller.ts:93-206` owns consent,
  pending/live state, explicit start/next/question/check/pause/stop and revisions.
- `src/main/knowledge/classroom-lesson-step-runner.ts:19-37` separates material
  opening, read-only explanation and policy-gated browser demonstration.
- `src/shared/classroom-lesson-desktop-api.ts:31-66`,
  `src/classroom-lesson-preload.ts:17-47`, and
  `src/main/ipc/register-classroom-lesson-ipc.ts:18-79` provide the narrow typed
  IPC boundary.
- `services/api/src/http/classroom_lessons.rs:32-204` and
  `services/api/src/classroom/lessons.rs:23-221` provide context, commit, feed,
  start, resource and progress endpoints with idempotent receipts.

The old path is still exposed through:

- `src/shared/contracts.ts:115-177,1170-1236,2393-2641` directive contracts.
- `src/shared/desktop-api.ts:240-243,389-407` and `src/preload.ts:433-501`
  directive IPC.
- `src/shared/classroom-broadcast-contracts.ts` and
  `src/shared/classroom-desktop-api.ts:9-60` broadcast draft/feed/open APIs.
- `src/main/knowledge/classroom-broadcast-draft-service.ts`,
  `classroom-broadcast-service.ts`, `classroom-directive-service.ts`, and
  `classroom-guidance-coordinator.ts` duplicate delivery/open/explanation
  lifecycle logic.
- `src/main/knowledge/knowledge-space-client.ts:352-379,519-594` old client
  methods; `src/main/application/task-application-service.ts:29,49,304` old
  explanation submission; `src/index.ts:105-108,316-350,664-681` old service
  composition; `src/main/ipc/register-ipc.ts:87,103-1182` old registration.
- `src/renderer/app/AppWorkspace.tsx:16-18,202-235` old student/teacher
  preview, explanation and session panels.
- `services/api/src/classroom/mod.rs:1-23`,
  `services/api/src/http/classroom.rs:52-172,323-369`, and old Rust services,
  fixtures and e2e tests.

Current docs describe the split as intentional
(`docs/classroom-lesson-execution.md:1-6`,
`docs/knowledge-spaces.md:141-186`); the decision and two-machine test must
change with the code.

## Design

### One teaching command

Replace the two teacher surfaces with one “Teach the class” composer. It accepts
natural-language text plus the current space/session/run binding. A main-process
teaching intent adapter resolves that text against authoritative `LessonContext`:

- a named published source (for example `01-python-bai-hoc.md`) becomes a
  `source_text` resource;
- “assignment instructions” becomes the assignment resource;
- an explicit HTTPS URL becomes a validated `web` resource;
- “explain/show/read/walk through” becomes one or more `explain` steps;
- “demonstrate/do it on their computers” creates a `demonstrate` step only for
  an allowed browser exercise, with an explicit example and expected result;
- “let students try/practice/check/help” maps to the existing practice/check
  phases and in-lesson controls.

The adapter returns a strict lesson plan and resolution notes. Ambiguous
material, missing/unsafe URL, unsupported Workspace target, restricted answer
reveal, or an unrecognized action blocks preview with a typed correction; it
never invents a source, URL, criterion or CUA action.

The existing draft service remains the send gate. The compact preview shows
audience/session, resolved material, ordered phases, whether CUA will run, and
the student-control handoff. Confirming commits one lesson receipt.

### Execution semantics

- `source_text` is displayed in Tro with section/chunk locators; it is not a fake
  browser link.
- `web` opens installed Chrome through the existing native argument vector, then
  verifies the actual browser surface.
- `explain` uses read-only CoachRuntime and optional grounded pointing; it never
  clicks or types.
- `demonstrate` uses the existing narrowed LocalAgentRuntime only after a fresh
  observation, with serialized actions and existing-work protection.
- `practice` returns control to the student; help/check stay inside the lesson.
- Teacher progress shows receipt, step, reason, build and heartbeat separately
  from proof of student execution.

### Compatibility

Ship API and both desktop clients as one coordinated release. Remove old UI,
IPC, client, service, tool and route handling together. Keep migrations 034–036
and their tables/data unchanged for auditability and upgrade compatibility.
Old client/API combinations receive an actionable
`classroom_flow_requires_update`/lesson-capability error; they never fall back
to a passive link. Do not reinterpret historical broadcasts as lessons or add a
down-migration.

## Implementation tasks

### 1. Define the teaching authoring contract

**Files:** `src/shared/classroom-lesson-contracts.ts`,
`src/shared/classroom-lesson-desktop-api.ts`, `src/shared/knowledge-capabilities.ts`,
`src/main/knowledge/classroom-lesson-policy.ts`, and a new
`src/shared/classroom-teaching-contracts.ts` if a separate file is preferred.

**ACTION:** Add the smallest strict request/response contract for the one-box
teaching command and make `classroomLessons.contractVersion: 1` authoritative.

**IMPLEMENT:** Define `ClassroomTeachingRequest` (binding, teacher text,
language, optional explicit material reference, client request ID) and
`ClassroomTeachingResolution` (status, canonical lesson plan, resolved material,
phase notes, warnings, confirmation flag). Bound all fields with lesson limits.
Keep the lesson plan schema/version as the only delivery contract.

**MIRROR:** Copy strict Zod/discriminated-union patterns from
`classroom-lesson-contracts.ts:112-180,235-242`.

**IMPORTS:** Reuse `LessonBindingSchema`, `ClassroomLessonPlanSchema`,
`LessonContextSchema`, `LessonModeSchema` and URL/UUID validators.

**GOTCHA:** Natural-language input cannot be a commit payload. “Show” defaults
to explain; CUA requires explicit demonstrate intent and a valid browser plan.

**VALIDATE:** Schema tests cover all statuses, resource kinds, malformed URLs,
oversized text, missing bindings and stable plan digests.

### 2. Resolve intent and prepare an existing lesson draft

**Files:** new
`src/main/knowledge/classroom-teaching-intent-service.ts`,
`classroom-lesson-draft-service.ts`, `classroom-lesson-client.ts`,
`classroom-lesson-policy.ts`, `classroom-lesson-agent-tools.ts`.

**ACTION:** Resolve a short request against live context and persist the same
owner-scoped draft used by lessons today.

**IMPLEMENT:** Add a pure verb/material normalizer and an injected authoritative
context resolver. Add `prepareTeaching` that returns resolution plus draft and
delegates persistence/digest/owner/expiry to `ClassroomLessonDraftService`.
Ambiguous or unsupported requests return typed resolution without a sendable
draft. Any model-assisted wording extraction must emit the strict schema and
cannot authorize CUA or commit.

**MIRROR:** Preserve draft serialization/reconciliation in
`classroom-lesson-draft-service.ts:32-123` and server context validation in
`services/api/src/classroom/lessons.rs:175-221`.

**IMPORTS:** Use `ClassroomLessonClient.context`, `LessonContextSchema`,
`lessonDigest`, `validateLessonContext` and `KnowledgeSpaceRequestError`.

**GOTCHA:** Match only published pinned sources in the current activity; validate
URL origins; never call CUA from the adapter.

**VALIDATE:** Test source/assignment/web resolution, English/Vietnamese wording,
explain versus demonstrate, ambiguity, restricted reveal, invalid origins,
unsupported launch targets and account changes.

### 3. Replace the teacher UI with one compact composer

**Files:** `src/renderer/features/classroom/ClassroomLessonComposer.tsx`,
`ClassroomLessonPreview.tsx`, `src/renderer/FacilitatorRunPage.tsx`,
`src/renderer/features/classroom/DirectiveComposer.tsx` (delete), classroom CSS
and i18n dictionaries.

**ACTION:** Make lesson authoring the only visible teacher flow.

**IMPLEMENT:** Remove directive state and `window.tro.createClassroomDirective`
from `FacilitatorRunPage`. Replace the long default step builder with one
textarea, examples, a single Prepare preview action, and a compact resolution
card. Keep advanced step edits collapsed. Reuse the existing exact preview,
digest/revision/expiry confirmation and receipt reconciliation. Preview must say
whether material opens automatically and whether computer use will run.

**MIRROR:** Follow the lifecycle/error handling in
`ClassroomLessonPreview.tsx:43-136`.

**IMPORTS:** Use the teaching desktop API, `AppLanguage`, current teacher
selection, `LessonDraft`, `ClassroomTeachingResolution` and translation helpers.

**GOTCHA:** Do not recreate Message/Open a link under another label. A URL field
appears only when the request resolves to web material. Preparation never sends
or opens anything.

**VALIDATE:** Renderer tests cover empty/ambiguous input, source/web summary,
explain/demonstrate badge, stale/expired/unknown receipts, Vietnamese copy and
absence of all legacy labels.

### 4. Add typed teaching IPC and remove old renderer APIs

**Files:** `src/shared/classroom-lesson-desktop-api.ts`,
`src/classroom-lesson-preload.ts`, `src/classroom-preload.ts`,
`src/shared/desktop-api.ts`, `src/preload.ts`,
`src/main/ipc/register-classroom-lesson-ipc.ts` and tests.

**ACTION:** Expose teaching preparation through the authorized lesson IPC and
remove directive/broadcast/guidance IPC.

**IMPLEMENT:** Add parse-checked channels for teaching preparation, draft
retrieval, confirmation and reconciliation. Remove
`createClassroomDirective`, open/dismiss directive, broadcast draft/notice,
open-assignment/open-link and guidance methods from `DesktopApi`. Preserve
unrelated room, roster, dashboard, assignment and attempt-help APIs.

**MIRROR:** Match the authorization/`handle` pattern in
`register-classroom-lesson-ipc.ts:18-79` and preload subscription validation in
`classroom-lesson-preload.ts:8-47`.

**IMPORTS:** Use the new request/resolution schemas, `LessonDraftSchema`,
`LessonContinueSchema` and `LESSON_CHANNELS`.

**GOTCHA:** Keep channels narrow; missing lesson features return the actionable
update error. Never expose raw Electron IPC or CUA.

**VALIDATE:** IPC tests assert sender authorization, strict parsing, missing
feature errors, listener cleanup and that old channels are not registered.

### 5. Remove old main composition, client methods and tool lane

**Files:** `src/index.ts`, `src/main/ipc/register-ipc.ts`,
`src/main/application/task-application-service.ts`,
`src/main/knowledge/knowledge-space-client.ts`,
`src/main/knowledge/classroom-agent-tools.ts`,
`src/main/agent-runtime/local-agent-state.ts`,
the old `classroom-broadcast-*`, `classroom-directive-*` and
`classroom-guidance-*` services/tests/fixtures.

**ACTION:** Leave one classroom authoring and one execution pipeline.

**IMPLEMENT:** Remove old service construction/injection and broadcast IPC
registration. Delete old client endpoint methods and
`submitClassroomExplanation`; route help/explanation/check work through lesson
children. Replace `prepare_classroom_broadcast` tool registration with the
teaching adapter/lesson prepare path. Retain generic task reservation and room
dashboard behavior.

**MIRROR:** Preserve `classroom-lesson-composition.ts:30-83`, including device
reservation, controller authorization, feed and structured logs.

**IMPORTS:** Keep only lesson types required by child tasks and existing generic
task APIs.

**GOTCHA:** Search imports before deleting `classroom-guidance-policy`; the lesson
step runner currently reuses observation policy helpers. Do not remove room,
roster, attempt, Help or Review code.

**VALIDATE:** TypeScript boundaries contain no old class names/methods/tool IDs;
voice/text classroom requests create lesson drafts, not legacy notices.

### 6. Make the student surface lesson-only

**Files:** `src/renderer/app/AppWorkspace.tsx`,
`ClassroomBroadcastPreview.tsx` (delete),
`ClassroomExplanationPanel.tsx` (delete or migrate generic help only),
`ClassroomSessionBar.tsx`, `classroom-session-view.ts`,
`features/classroom/ClassroomLessonPanel.tsx`,
`ClassroomLessonDraftPanel.tsx`, `classroom-lesson.css`.

**ACTION:** Students see lesson/material state instead of passive-link cards.

**IMPLEMENT:** Remove old preview/explanation mounts at
`AppWorkspace.tsx:202-235`. Fold useful session navigation into the lesson panel.
Show Opening material, Explaining, Demonstrating, Your turn, Help, Check and
Finished with one phase-appropriate action. Render source text in Tro with
locators; render verified web-open state for browser resources. Keep Start lesson
for restored/backlogged/busy/opted-out cases required by controller policy.

**MIRROR:** Use `LessonView` change subscriptions and existing pause/resume/stop,
ask-help and check controls.

**IMPORTS:** Use `LessonView`, `LessonMaterial`, `LessonContinueSchema` and app
language.

**GOTCHA:** Do not auto-start reconnect backlog or busy devices. Do not claim
material opened before acknowledgement. Existing student work must remain intact
when a demonstration is blocked.

**VALIDATE:** Renderer tests cover fresh/restored delivery, opt-out, busy device,
source pages, verified web surface, help returning to practice, check feedback,
stop cleanup and zero legacy-link buttons.

### 7. Remove old Rust teaching routes and services

**Files:** `services/api/src/classroom/mod.rs`,
`broadcasts.rs`, `directives.rs`, `guidance.rs`,
`service.rs`, `policy.rs`, `contracts.rs`,
`services/api/src/http/classroom.rs`,
`http/classroom_lessons.rs`, `lessons.rs`,
`lesson_delivery.rs`, `lesson_resources.rs`, and capability handlers.

**ACTION:** Lesson endpoints become the only classroom teaching delivery
contract.

**IMPLEMENT:** Remove old broadcasts, session-broadcasts, directive
list/claim, guidance start/report/resolve/summary branches from
`http/classroom.rs:52-172,323-369`. Keep room codes, join/current session,
roster/dashboard, ready/help/review/leave and lesson routes. Remove old module
exports/service methods. Advertise only `classroomLessons.contractVersion: 1`.
Old routes return a typed no-mutation update/404 response during rollout.

**MIRROR:** Follow the route matcher in
`services/api/src/http/classroom_lessons.rs:32-204` and authority checks in
`services/api/src/classroom/lessons.rs:23-64,127-173`.

**IMPORTS:** Reuse shared room helpers, `ApiError`, JSON response, UUID/query
parsing and lesson types.

**GOTCHA:** Preserve class sessions, attempts, room codes, dashboard events and
generic Help/Review. Ensure lesson queries do not require guidance tables.

**VALIDATE:** Rust tests assert lesson JSON remains exact, old teaching routes
mutate nothing, room routes remain reachable, and capabilities omit
`classroomBroadcasts`/`classroomGuidance`.

### 8. Keep migrations immutable and update inventories

**Files:** `services/api/src/db.rs`, migrations 034–037,
`services/api/tests/contract_corpus.rs`, `postgres_compat.rs`,
`tests/fixtures/route_inventory.json`, `schema_inventory.json`.

**ACTION:** Remove runtime dependence on old tables without breaking databases.

**IMPLEMENT:** Do not edit/delete migrations 034–037 or checksums. Leave old
tables/data for audit/history and update inventories to describe only live
routes/contracts. Add a forward-only retirement migration only if a concrete
database need appears; prefer no migration for this cleanup. Document that old
rows are never replayed as lessons.

**MIRROR:** Preserve migration adoption/checksum handling in
`services/api/src/db.rs:138-223,249-289` and corpus assertions in
`contract_corpus.rs:130-173`/`postgres_compat.rs:103-220`.

**IMPORTS:** Existing SQLx migration helpers only.

**GOTCHA:** Never down-migrate or make SQLx skip historical migrations.

**VALIDATE:** Run ordering/checksum tests on empty databases and databases
stopped at 034/035/036; assert old tables remain and 037 applies once.

### 9. Replace legacy tests with lesson intent/e2e coverage

**Files:** Remove/rewrite old broadcast/directive/guidance IPC, service,
renderer and contract tests; add intent, composer, panel, controller, runner and
client tests; update `services/api/tests/classroom_e2e.rs`,
`classroom_access.rs`, `http_compat.rs`, `contract_corpus.rs` and fixtures.

**ACTION:** Test the user flow and safety boundaries, not deleted implementation
details.

**IMPLEMENT:** Add a deterministic scenario: teacher request resolves
`01-python-bai-hoc.md`, preview persists, confirm creates one receipt, student
feed receives it, material is acknowledged, explain has no input, explicit
demonstrate is gated, practice returns control, help stays in-lesson, check
reports criteria and finish releases the reservation. Add negative cases for
legacy calls, ambiguity, invalid URL, restricted demo, duplicate IDs, lost
responses, stale revisions and two-device claims.

**MIRROR:** Reuse lesson state-machine/fixture patterns and CI target
`//services/api:classroom_lesson_test`.

**IMPORTS:** Historical broadcast fixtures may seed old rows only; they are not a
live delivery fixture.

**GOTCHA:** Assert receipt, material acknowledgement, child progress and teacher
heartbeat separately. A send receipt is not proof of execution.

**VALIDATE:** Run focused Vitest/Rust tests while iterating; final verification
is the repository CI routing for backend/native changes.

### 10. Update docs, rollout and observability

**Files:** `docs/classroom-lesson-execution.md`,
`docs/knowledge-spaces.md`, `docs/testing/shared-test-environment.md`,
`docs/testing/ci-workflow.md`, `docs/frontend-source-inventory.md`, and any
computer-use lifecycle page mentioning the old classroom adapter.

**ACTION:** Make documentation describe one simple teaching flow.

**IMPLEMENT:** Replace the split-flow text with prompt examples, compact preview,
source-text versus web semantics, consent/material-opening behavior, explicit
demonstration gate, help/check behavior and actionable old-client errors. Update
the two-machine test to begin with the one-box request and collect material
acknowledgement, verified browser surface, no input during explain, real CUA only
during demonstrate, practice handoff, help/check and teacher progress. Preserve
the warning that the browser fixture is not a Python interpreter.

**MIRROR:** Preserve `[classroom:lesson]` fields from
`classroom-lesson-composition.ts:63-81` and operational rules in
`docs/classroom-lesson-execution.md:64-110`.

**IMPORTS:** Link the existing shared staging setup and CI route names.

**GOTCHA:** Logs contain sanitized lesson/step/task IDs and status/reason only,
never student work, screenshots, secrets or raw URLs with credentials.

**VALIDATE:** Documentation search finds no active instruction to use
`DirectiveComposer`, `prepare_classroom_broadcast`, `classroomBroadcasts` or
`classroomGuidance` for a new class.

### 11. Ship and run the two-machine acceptance gate

**ACTION:** Release API and both desktop clients as one classroom-compatible
revision.

**IMPLEMENT:** Apply the existing lesson migration if needed, deploy API,
verify `classroomLessons.contractVersion: 1`, update/restart both desktops, and
use separate teacher/student accounts on shared staging. Verify old combinations
show the update error rather than a passive link.

**MIRROR:** Follow the ordering in
`docs/testing/shared-test-environment.md:186-213`: API/migration, both clients,
then restart.

**IMPORTS:** Existing staging/Chrome permission/consent checklist.

**GOTCHA:** Preview, announcement or receipt alone is not acceptance. Unknown
native outcomes must be inspected, never replayed.

**VALIDATE:** Run:

1. Teacher requests “Explain section 1 of 01-python-bai-hoc.md in Vietnamese”;
   preview resolves source text and confirms one lesson.
2. Student sees material opened/acknowledged in Tro without clicking a link;
   explanation points to the section and does not type.
3. Teacher requests an explicit browser demonstration; preview shows expected
   result and CUA; student reaches it only with consent and permissions.
4. Student practices, asks a concrete help question, and returns to the same
   practice step with work unchanged.
5. Student checks and finishes; teacher sees criteria/reason/build/heartbeat and
   no submission or grade.
6. Repeat opt-out, busy, reconnect, stale receipt and two-device cases.

## Alternatives rejected

1. Keeping both UIs would preserve the exact ambiguity causing passive-link
   broadcasts.
2. Making the old directive feed auto-run CUA would lack immutable plans,
   material acknowledgement, child ownership and safe budgets.
3. Making the full step builder the default would contradict the requested
   simple teacher flow; advanced edits belong behind the compact review.
4. An unconstrained LLM must not plan/execute directly; it may normalize wording
   only into the strict adapter schema.
5. Dropping old SQL tables/migrations would break audit and upgrade history.

## Acceptance criteria

- One teacher composer exists; legacy Message/Open-a-link/current-direction
  controls and labels are gone.
- A short request resolves to a strict session/activity/material-bound lesson
  draft, compact exact preview and one explicit confirmation.
- Source text opens in Tro; approved web material opens and is verified in
  Chrome; students do not click a broadcast link.
- Explain never inputs; demonstrate is explicit, browser-only, policy/observation
  gated; practice/help/check use the same lesson and budgets.
- Old broadcast/directive/guidance UI, IPC, client, service, tool and route paths
  are removed or return an actionable update error.
- Migrations 034–037 are byte-for-byte unchanged; compatibility tests pass and
  historical rows are not replayed.
- Tests cover intent, schema/IPC, receipt/idempotency, ownership, CUA safety,
  student phases and legacy-path absence.
- Docs and the shared two-machine test describe the unified flow.
- CI passes on the final revision and the physical two-machine acceptance passes.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Client/API skew | Coordinated rollout, capability check and actionable update error. |
| Ambiguous material/intent | Authoritative context lookup and typed clarification before commit. |
| Accidental input | Explain default, explicit demo wording, allowlist, observations, budgets and existing-work guard. |
| Duplicate/unknown delivery | Existing digest/revision, receipt lookup, start ownership and controller revisions. |
| Removing shared room code | Import search; retain room, roster, attempts, Help, Review and dashboard APIs. |
| Database breakage | Immutable migrations, retained tables, adoption/checksum tests. |
| CUA permissions/unknown action | Surface blocked/unknown state; require Resume/Stop policy; never replay. |

## Verification commands

Use focused checks while implementing and the repository CI for the final
revision, following `docs/testing/ci-workflow.md` and repository guidance.

~~~bash
npm test -- --run src/shared/classroom-lesson-contracts.test.ts src/main/knowledge/classroom-teaching-intent-service.test.ts src/main/knowledge/classroom-lesson-controller.test.ts
npm test -- --run src/renderer/features/classroom/ClassroomLessonComposer.test.tsx src/renderer/features/classroom/ClassroomLessonPanel.test.tsx
bazel test //services/api:classroom_lesson_test //services/api:classroom_e2e_test //services/api:classroom_access_test
~~~

If labels differ in the current graph, use the exact labels in
`.github/workflows/ci.yml` and `docs/testing/ci-workflow.md`; do not claim a
full local pass when CI is unavailable.

## Completeness check

- [x] Requirements, passive-link failure and desired one-box UX are explicit.
- [x] Renderer, main, IPC, API, migration, test and documentation paths are
  traced with concrete file/line references.
- [x] Existing lesson schema/draft/controller/runner are reused.
- [x] Every task includes ACTION, IMPLEMENT, MIRROR, IMPORTS, GOTCHA and VALIDATE
  (the rollout task uses the same fields inline).
- [x] Testing, CI, two-machine acceptance, rollout order and failure cases are
  specified.
- [x] Alternatives, out-of-scope work, migration immutability and risks are
  recorded.
