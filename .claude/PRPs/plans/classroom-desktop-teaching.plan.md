# Plan: Classroom teaching through the student's desktop

## Summary

Make the student's external application the teaching surface. For an uploaded class material, the default flow is to download its original file onto the student's computer, open it in the appropriate external application, verify that it is visible, and explain it through computer use. Material already open on the student's computer remains an alternate mode. Retain the existing lesson delivery, ownership, cancellation, and progress machinery.

Simplify teacher interaction to an editable instruction and compact summary followed by one **Send to class** action. Sending changes the panel into live student progress rather than retaining a repeated, read-only preview.

## User Story

As a teacher, I want to send a teaching goal that Tro carries out on each student's actual computer, so students learn in the app where their document or work is open.

As a student, I want Tro to explain the visible material, follow the page I am on, and help navigate when requested, so I can learn without transferring my work into Tro's own viewer.

## Problem → Solution

Registered material → internal text panel → mostly single-round Coach explanation → external app selected on the student's device → observe, explain, optionally navigate, observe again, answer questions, and hand back control.

## Metadata

- **Complexity:** XL; implement as four dependent increments, not one unreviewable rewrite.
- **Source PRD:** N/A; this conversation supplies the product requirements.
- **PRD Phase:** Standalone, all increments pending.
- **Baseline:** `main`, `787dcf88fd1cddeeb150d5e52001019f3af16ead`, inspected September 9, 2026.
- **Estimated files:** Approximately 65–80 including colocated regression tests; the concrete surface inventory is below.
- **Tasks:** 16, grouped into four increments.
- **Implementation status:** Plan only. No feature implementation, deployment, broadcast, or acceptance test was performed while preparing this document.
- **Confidence:** 7/10 for the complete program; external app behavior requires real macOS/Windows acceptance. The current-screen increment is substantially more predictable than automatic file opening or editor demonstrations.

## Product decisions

1. **Default for selected class material: download and open externally.** Teacher selects an uploaded source; each student's client obtains the authorized original file, downloads a verified local copy, opens it through the OS file association, verifies the external window, and begins teaching. Reuse a verified cached copy and an already-verified window where possible. Do not require the student to download it manually or display extracted text inside Tro as the primary teaching surface.
2. Support both requests discussed with the user: explain each student's current material, and explain a named class material students open themselves. Named material adds a relevance check; it does not force an internal viewer.
3. **Material already open** is an alternate teacher choice for student-owned files or current-screen help. It avoids downloads and binds the student's actual window. A local-only file is selected on the student's machine if it cannot be identified from an already-open window. A filename is not permission to search the whole computer. Web resources open their approved URL rather than being downloaded as local documents.
4. **Observe**, **navigate**, and **demonstrate** are different execution permissions. Explaining a PDF can include document navigation when selected; it must not silently become editing the student's assignment.
5. File-format-independent means **readable visible content**, not universal parsing, whole-file access, or guaranteed control in every application. Use vision when semantic text is unavailable. Unsupported or unreadable surfaces produce an actionable wait state.
6. Reuse current consent for observations within its existing scope. Navigation and demonstrations must be covered by a separately recorded student choice for the lesson; existing automatic-explanation consent must not silently gain new control authority. No repeated approval per scroll within that choice. Stop/pause always remains available.
7. Initial support and release acceptance are macOS and Windows. Linux parity is outside this change. Native app demonstrations begin with VS Code and existing approved browser exercises; document navigation includes PDF viewers and browsers. Other apps remain observation-capable when readable and receive an explicit unsupported-action response where needed.

## UX Design

### Before

```text
Teacher: request → Preview lesson → long repeated summary → Broadcast lesson
Student: receive → Tro displays extracted material → Coach explains
Teacher: same summary + technical student IDs/build strings + Stop
```

### After

```text
Teacher: Teaching request
         Material: [Selected class file ▾] [or Students' current window]
         Section: [first section]  Language: [Vietnamese]
         Navigation: [Students navigate ▾]
         compact editable summary → [Send to class]

Student: authorized original download → open in external app → verify visible
         Tro explains visible content
         [Next / Ask / Pause / Stop] in a small companion
         optional authorized navigation → fresh observation → next explanation

Teacher: Sent → Received → Waiting for material / Explaining / Paused / Finished
         [Stop lesson] [Teach another section] [Details]
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Teacher editor | Free text with keyword-based material inference | Editable material, section, language, mode, and navigation summary alongside the instruction | Inferred values are visible; explicit edits take precedence |
| Preview | Separate button and repeated objective/instruction | Summary updates inline; one Send to class button | Preparation and digest validation still happen internally |
| Student material | Tro panel must be visible | Selected class file downloads and opens externally; current window is an alternate mode | Keep legacy panel only for old plans and explicitly selected reference viewing |
| Student readiness | Internal DOM acknowledgement | External-window identity plus readable evidence and relevance | Ambiguity asks the student to choose/show the material |
| Explanation | Can fall back to supplied text when capture fails | Screen teaching waits for actual evidence | Reference-only explanation is an explicit separate choice, never a silent success |
| Navigation | Teacher explanation cannot act | Authorized bounded scroll, page, find, and focus operations | Re-observe after every action |
| Follow-up | Starts another child, re-prepares material | Same bound external surface and bounded recent history; fresh screen | No unnecessary re-opening |
| Progress | Generic not_received and raw statuses | Human-readable status and next step; technical details collapsed | A failed receipt is not a rendering failure |
| Sent state | Full preview remains | Compact lesson heading and live progress | Receipt reconciliation stays available for uncertain sends |

## Codebase discovery and mandatory reading

Paths are relative to `/Users/ducng/Desktop/workspace/TroCode`. Line references describe the inspected baseline; `all` means the complete module. These references are also the implementation navigation index.

| Priority / Category | File:Lines | Pattern / relevance |
|---|---|---|
| P0 / Instructions | `AGENTS.md:all`, `docs/testing/ci-workflow.md:all` | Pure policy, narrow IPC, immutable migrations, CI-first verification |
| P0 / Entry | `src/renderer/features/classroom/ClassroomLessonComposer.tsx:1-108` | Context fetch, request invalidation, prepare, sent state |
| P0 / Planning | `src/shared/classroom-teaching-request.ts:1-85` | Pure keyword/resource resolver; currently defaults to assignment resource |
| P0 / Wire types | `src/shared/classroom-lesson-contracts.ts:1-170` | Zod strict plan/resource/step types and v1/v2 refinements |
| P0 / Local types | `src/shared/classroom-lesson-contracts.ts:all` | Feed/device views, reports, history, encrypted local-state schemas |
| P0 / Rust types | `services/api/src/classroom/lesson_contracts.rs:1-140` | Serde strict mirror; UTF-16 length checks; browser-only demonstrations |
| P0 / Compatibility | `services/api/src/http/classroom_lessons.rs:40-135` | Query negotiation and filtering with original maxSequence retained |
| P0 / Data flow | `src/main/knowledge/classroom-lesson-controller.ts:all` | Ownership, resume, durable effects, child admission, limits, report queue |
| P0 / Preparation | `src/main/knowledge/classroom-lesson-step-runner.ts:57-133` | Non-web internal material ACK; Chrome navigation readiness |
| P0 / Execution | `src/main/application/classroom-lesson-task.ts:28-124` | Coach for explain/help/check; SDK agent only for demonstrate |
| P0 / Policies | `src/main/knowledge/classroom-lesson-tool-policy.ts:all` | Allowed tools, fresh observation, post-action verification, uncertain outcomes |
| P0 / Observation | `src/main/presentation/observe-coach-screen.ts:8-17` | PR #78 keeps internal material visible for explanation/help |
| P0 / Wiring | `src/index.ts:480-605`, `src/index.ts:679-685` | Coordinator, observation guard, Coach, SDK tool interception, lesson composition |
| P1 / Coach | `src/main/coach/coach-runtime.ts:125-245`, `:250-480`, `:670-750` | Single-round lesson path; existing multi-round explanation/pointer revalidation pattern; model input |
| P1 / Coach types | `src/main/coach/coach-contracts.ts:all`, `src/main/coach/lesson-coach-response.ts:all` | Pointer schema, response bounds, material fallback, evidence-based checks |
| P1 / Tool boundaries | `src/main/agent/runtime-tool-registry.ts:180-275`, `:950-1040` | Stale observation checks and filtering at list and resolve time |
| P1 / Execution adapter | `src/main/agent/execution-coordinator.ts:1-280` | Single-dispatch trusted adapter for semantic and desktop actions |
| P1 / SDK lifecycle | `src/main/agent-runtime/agent-runtime-adapter.ts:all`, `services/agent-runtime/src/local-runtime-server.ts:200-285`, `services/agent-runtime/src/user-openai-client.ts:all` | LocalAgentRuntime; frozen tools, maxTurns, model diagnostics, pending-tool resume |
| P1 / Semantic tools | `src/main/agent/cua-semantic-agent-tools.ts:330-485` | observe_context, surface controls, browser preparation |
| P1 / Window binding | `src/main/cua/cua-window-selection.ts:all`, `src/main/cua/cua-surface-reference-store.ts:all` | PID/window identity, external candidates, opaque references |
| P1 / Surface routing | `src/main/cua/cua-surface-router.ts:all`, `src/main/cua/cua-service.ts:all` | Browser/window semantics and vision fallback, driver/session lifecycle |
| P1 / Observation types | `src/main/agent/execution-contracts.ts:67-106` | Public surface descriptor lacks native window identity; do not trust title alone |
| P1 / Presentation | `src/main/presentation/desktop-observation-guard.ts:all`, `src/main/companion/cursor-buddy-controller.ts:all` | Serialized capture leases and existing speech/pointer presenter |
| P1 / IPC | `src/shared/classroom-lesson-desktop-api.ts:all`, `src/classroom-lesson-preload.ts:all`, `src/main/ipc/register-classroom-lesson-ipc.ts:23-95` | Validate requests, authorize main handlers, validate responses |
| P1 / Durable state | `src/main/knowledge/classroom-lesson-state-store.ts:1-115` | Account-scoped encrypted storage, serialized atomic writes |
| P1 / Sending | `src/main/knowledge/classroom-lesson-draft-service.ts:all` | Exact digest/revision confirmation and receipt lookup, not blind retry |
| P1 / Feed | `src/main/knowledge/classroom-lesson-client.ts:20-100`, `src/main/knowledge/classroom-lesson-feed-service.ts:all` | Version negotiation, 3–5 second polling, 10 second device heartbeat |
| P1 / Backend ownership | `services/api/src/classroom/lessons.rs:all`, `services/api/src/classroom/lesson_delivery.rs:all` | Teacher context, pinned sources, transaction claims, device version validation |
| P1 / Resources | `services/api/src/classroom/lesson_resources.rs:all` | Per-attempt material authorization and progress query |
| P1 / Downloads | `services/api/src/http/knowledge.rs:1273-1300`, `services/api/src/knowledge/object_store.rs:90-112` | Existing starter-file tickets and 120-second GetTicket; no reference-file equivalent yet |
| P1 / Native files | `src/main/knowledge/activity-workspace-preparation-service.ts:all`, `src/main/application/desktop-application-launcher.ts:all` | Download hashes/path validation and openPath error handling; launcher currently Chrome-only |
| P1 / SQL | `services/api/migrations/037_classroom_lessons.sql:all`, `services/api/src/db.rs:188-225` | JSONB plans/capabilities; fixed status/reason constraints; migration registration and upgrade history |
| P1 / UI | `src/renderer/features/classroom/ClassroomLessonPreview.tsx:all`, `ClassroomLessonProgress.tsx:all`, `ClassroomLessonPanel.tsx:all` in same directory | Current preview, polling progress, student controls |
| P1 / Companion | `src/main/knowledge/classroom-lesson-companion.ts:all`, `src/renderer/CompanionResponseCard.tsx:175-183`, `src/shared/contracts.ts:1937`, `src/index.ts:2068-2070` | Lesson companion card, shared actions and dispatch; existing Next advances the step |
| P1 / Tests | `src/main/knowledge/classroom-lesson-step-runner.test.ts:1-90`, `src/renderer/features/classroom/ClassroomLessonComposer.test.tsx:1-75` | Injected fakes, Vitest, happy-dom React act, fixture reuse |
| P1 / Contract corpus | `services/api/tests/fixtures/classroom-lesson-contracts.json:all`, `src/shared/classroom-lesson-contracts.test.ts:all`, `services/api/tests/classroom_lesson.rs:all`, `services/api/tests/http_compat.rs:all` | Shared TS/Rust validation, PostgreSQL and version compatibility |
| P2 / Acceptance | `docs/testing/shared-test-environment.md:1-115`, `scripts/test-app.mts:all`, `scripts/test-app-config.mts:all` | Shared staging, isolated Tro Test profile, build revision |
| P2 / Build | `package.json:all`, `.github/workflows/ci.yml:all`, `services/api/BUILD.bazel:45-100`, `scripts/source-size-baseline.json:all` | CI routing, native checks, source-size ratchet |

`docs/CODEX-NAVIGATION-GUIDE.md` is referenced by the supplied supplement but does not exist in this checkout. The table above supplies the relevant navigation; do not create an unrelated guide as part of implementation.

### Five end-to-end traces

1. **Teacher entry:** Composer → `planFromRequest` → preload `lessons.prepare` → authorized IPC → draft service validates plan/context, computes digest, encrypts draft → confirm → client POST → Rust `commit_lesson`, source locks and idempotent receipt.
2. **Delivery:** session active attempt → feed GET with supported plan version → controller.receive → initial snapshot vs live admission → durable start ID → receipt/start/lookup → fetch material → runner.prepare → step claim → submit child. The current screenshot's `not_received` happens before material preparation; don't classify it as a blank-window error.
3. **Execution:** lesson child → route Coach or SDK → observation guard → CUA → model → presenter or tool dispatcher → fresh evidence → runner.terminal → controller transition/report. v3 will use the SDK teaching loop for external explanation/navigation/demonstration while legacy and check routes retain their existing behavior.
4. **State:** controller owns logical lifecycle and budgets; encrypted store owns persistence; tool policy owns transient dispatch authorization; CUA owns native/session references; backend owns lesson and step claims. Surface binding must not move authority into the model or renderer.
5. **Contracts:** Zod at renderer/preload/main/model boundaries; Serde at API boundary; canonical digest covers exactly the sent plan. The server is an authenticated model proxy for Coach requests rather than the owner of the local Coach decision schema. New SDK lesson tools still pass existing hosted tool-snapshot validation.

## External Documentation

| Topic | Source | Key takeaway |
|---|---|---|
| Open files externally | [Electron shell](https://www.electronjs.org/docs/latest/api/shell#shellopenpathpath) | Main calls openPath for the OS file association; an empty returned string means the launch request succeeded, not that visible material was verified |
| Local file selection | [Electron dialog](https://www.electronjs.org/docs/latest/api/dialog#dialogshowopendialogwindow-options) | Async native picker returns cancellation and selected paths; keep native paths in main |

KEY_INSIGHT: External file opening can reuse Electron; no new automation library is required.
APPLIES_TO: Native material service and composition wiring.
GOTCHA: Renderer is sandboxed; expose resource-scoped methods, not shell or arbitrary openPath. Missing file associations and closed parent windows need explicit handling.

KEY_INSIGHT: The installed CUA wrapper already routes browser, native-window, and desktop-vision observations.
APPLIES_TO: External surface resolver and teaching tools.
GOTCHA: A valid screenshot is not proof of the intended document. Revalidate process/window identity and content relevance. Verify methods against the installed package/types; don't invent driver calls or upgrade CUA to implement this plan.

Dependencies remain React 19, Zod 4, Electron 43.4.0, `@trycua/cua-driver` 0.19.3, the existing local Agents SDK service, Rust/SQLx, and the existing S3 object-store adapter as declared at baseline. These are repository versions, not recommendations to upgrade them.

## Patterns to Mirror

### NAMING_CONVENTION / SERVICE_PATTERN

Source: `src/main/knowledge/classroom-lesson-errors.ts:4-11` (actual code).

```ts
export class LessonBlockedError extends Error {
  constructor(
    readonly reason: LessonReason,
    message: string,
  ) {
    super(message);
    this.name = 'LessonBlockedError';
  }
}
```

Use kebab-case main/shared modules, PascalCase service and schema names, camelCase methods, PascalCase TSX components, and colocated `.test.ts`/`.test.tsx` files. Main services accept narrow injected dependencies, as `ClassroomLessonStepRunner` does.

### ERROR_HANDLING

Source: `src/main/knowledge/classroom-lesson-errors.ts:3`:

```ts
/** Only throw before an effect has been dispatched. Unknown native outcomes use the normal error path. */
```

Missing material/permission/ambiguous surface maps to a resumable blocked state only before effects. A timeout after dispatch maps to unknown. `KnowledgeSpaceRequestError` preserves API status/code; display a bounded user message and never replay an uncertain effect.

### LOGGING_PATTERN

Source: `src/main/knowledge/classroom-lesson-composition.ts:74-80` (excerpt):

```ts
console.info('[classroom:lesson] state', {
  lessonId: state.envelope.lessonId,
  stepId: state.envelope.plan.steps[state.stepIndex]?.id,
  childTaskId: state.child?.taskId,
  status: state.status,
  phase: state.phase,
  reason: state.reasonCode,
```

Log phase transitions, route class, counts, timings and stable IDs. Keep screenshots, question text, local paths, document contents, and signed download URLs out of diagnostic logs and teacher progress.

### REPOSITORY_PATTERN

Source: `src/main/knowledge/classroom-lesson-state-store.ts:44-49`:

```ts
saveLesson(state: LessonLocalState) {
  return this.save(state.ownerId, 'lessons', state.envelope.lessonId, LessonLocalStateSchema.parse(state));
}
async readConsent(owner: string, anchor: string): Promise<boolean | null> {
  const saved = await this.read(owner, 'preferences', anchor, z.object({ enabled: z.boolean() }).strict());
  return saved?.enabled ?? null;
}
```

Mirror encryption, owner isolation and serialized atomic writes for native surface/material binding records. Native handles never become reusable authority after restart.

### IPC_PATTERN

Source: `src/main/ipc/register-classroom-lesson-ipc.ts:39-45`:

```ts
handle(ch.prepare, (raw) => {
  const i = I.LessonPrepareInputSchema.parse(raw);
  return features!.drafts.prepare(i.binding, i.plan);
});
handle(ch.confirm, (raw) => {
  const i = I.LessonConfirmInputSchema.parse(raw);
  return features!.drafts.confirm(i.draftId, i.revision, i.digest);
});
```

The surrounding handler authorizes the sender before executing work. Parse outbound views too. New renderer inputs carry opaque tokens, lesson ID and expected revision, never arbitrary native handles or filesystem paths.

### TEST_STRUCTURE

Source: `src/renderer/features/classroom/ClassroomLessonComposer.test.tsx:1-16` (excerpt):

```tsx
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
```

```tsx
// @vitest-environment happy-dom

describe('teacher lesson entry point', () => {
  it('shows the reviewed objective, material and published criteria before sending', async () => {
    const f = lessonFixture();
```

Restore `window.tro`, unmount roots, remove DOM fixtures in `finally`; use fake timers only where polling/debounce behavior is under test. Unit tests inject CUA, time, cipher, filesystem fetch and presenter dependencies. Native acceptance must not be replaced by mocked screenshots.

## Architecture

### Wire contract: lesson plan v3

Keep the envelope `contractVersion: 1`. Add plan version 3 without changing the meaning or digest of versions 1/2.

- Add resource `{ id, kind: 'current_screen', title }`, valid only in v3. Existing source_text remains the identity for a pinned original/reference; it does not mandate internal rendering.
- Add `surface` to each v3 step, required for v3 and forbidden in v1/v2:
  `{ kind: 'current_window' | 'resource_app', navigation: 'student' | 'tro' }`.
- Selected source_text/web defaults to resource_app. Explicit current-window steps may reference current_screen, assignment, source_text or web; in that alternate mode source_text/web supplies a relevance hint and does not force a launch. An explicit teacher choice overrides the legacy parser's fallback.
- resource_app requires source_text or web. Assignment/current_screen has no original file to open and must be rejected for resource_app and open mode.
- For v3, demonstrate may use current_window or resource_app, with the existing explicit demonstration example and answerReveal policy. Retain the browser-only refinement for v1/v2.
- Do not add local path, process ID, window ID, signed URL, credentials or tool commands to the teacher-authored plan.
- Add pure `effectiveLessonSurface(plan, step)` and validation helpers; legacy plans return the existing internal/web behavior. Keep optional v3 fields absent when serializing legacy plans. In Rust use `default` plus `skip_serializing_if = "Option::is_none"` for the new optional field, then enforce version-specific presence. Do not deserialize/re-serialize an old plan into a different canonical digest.

Negotiate `maxPlanVersion=3` in new clients. Server responses must advertise **min(requested, server-supported)** so strict v2 clients do not receive `maxPlanVersion: 3`. Requests without the parameter retain legacy shape. Feed filtering keeps the original maxSequence. Device capability version is the intersection of client/server support, never just whatever the server reports. Validate v3 starts against the current device version as well as filtering the feed; direct API calls must not bypass negotiation.

No SQL migration is planned: plans and capabilities are JSONB and existing statuses/reasons cover this work. Use local phases such as Choosing material, Opening, Looking, Explaining, Waiting for student, and existing reasons (`resource_unavailable`, `surface_unverified`, `permission_required`, `unsupported`). Do not insert new enum strings into the constrained SQL columns. If implementation finds a schema requirement, append a new migration after the then-current latest version and register it in db.rs; never edit 037 or earlier.

### Native surface and file ownership

Create `ClassroomLessonSurfaceService` in main. It selects an external window using existing CUA candidates and binds an opaque surface token to owner/lesson/step/task generation plus native process/window identity. Title and URL are hints; they are not authority. Resolve from a fresh external observation, retain the identified surface through the step, and invalidate on close, process replacement, unrelated document/tab change, sign-out, or restart.

Native identity is currently retained internally by CuaSurfaceReferenceStore, not exposed by SurfaceDescriptor. Add a narrow main-only accessor/observation method for bound surfaces in CuaService/Router; do not extend teacher-visible JSON with native IDs. If the driver cannot establish an unambiguous external target, ask the student to show/select it. Selecting a new target invalidates old element refs and pending model output.

Use a separate encrypted main-only binding record through ClassroomLessonStateStore. Never place raw path/native binding in LessonLocalState, because its entire parsed view is sent to the renderer. Expose a sanitized surface view: display label, selection state, whether navigation is allowed, and opaque expiring choice tokens.

For `source_text + resource_app`, add a lesson-authorized original-file descriptor route. Authorization must reuse active attempt/session/lesson ownership and pinned-source checks from lesson_material. A helper in the classroom service obtains `{sourceVersionId, name, mediaType, byteSize, sha256, objectKey}`; the HTTP route uses `state.knowledge.object_store` to issue the GetTicket and removes objectKey from its response. Never reuse the starter endpoint by broadening its role checks.

The main-only material service downloads into an owner-specific cache keyed by sourceVersionId/hash, checks streamed byte limits (25 MiB ceiling, consistent with current object-store bounds), exact length and SHA-256, then opens via an injected Electron openPath. Persist the dispatch marker before opening and verify a relevant visible external window afterward. A completed download can be retried if necessary; an uncertain native open must not be blindly repeated. Cache paths and download tickets never reach model tool arguments or renderer. Delete partial downloads immediately; clean inactive cached material after seven days, without removing files still in use or any user original. Use regular data/document formats for automatic open (PDF, plain text/Markdown, PNG/JPEG, DOCX/PPTX/XLSX); executable, shortcut, script, macro-enabled, HTML/SVG and unknown associations remain student-opened for this release. Observation of an already-open format remains separate from automatic-opening support.

For a local-only document, show the native picker on a student action and bind the selected file; don't accept a teacher-supplied absolute path. openPath success is only a launch receipt. If the app/file association fails, show “Open the material yourself, then choose Use this window.”

### Teaching execution loop

Use the existing LocalAgentRuntime for v3 explain/help/demonstrate. Do not turn every lesson into an unrestricted general-purpose task and do not add a second model call merely to narrate the agent's result. Supply lesson context, current question, reference chunks and bounded history separately from the compact task request, retaining the 8,000-character admission fix.

Add narrow SDK lesson tools under `classroom.teaching-*`:

| Tool | Input responsibility | Trusted behavior |
|---|---|---|
| observe | Bound lesson/task; optional region request | Observe the selected external surface with Tro hidden; register observation/fingerprint and consume budget |
| navigate | Latest observation ID; typed scroll/page/find/focus request with semantic ref or bounded vision target | Check student navigation choice, surface identity and fresh evidence; dispatch once through existing coordinator/CUA; require re-observation |
| present | Latest observation ID/fingerprint; bounded speech and optional visual target | Re-observe before pointing; reuse CursorBuddyController; show text/speak without a pointer if a target cannot be established |
| demonstrate | Latest observation ID and typed edit/run operation within approved scratch context | Enforce answerReveal, demo mode, selected editor surface, no overwrite of pre-existing student work; dispatch and re-observe |
| finish | Latest evidence identity and bounded recap/outcome | Complete only the explanation/example, not assignment grading/submission |

Implement tool definitions and trusted adapters separately from the pure decision policy. Filter definitions AND calls at resolve/dispatch time using the existing registry and policy hooks. Do not allow raw `cua.*`, arbitrary shell/filesystem tools, or broad desktop.control simply because the task has a lesson scope. The lesson adapters can call existing trusted CUA execution internals after validation; they are not a second CUA implementation.

Navigation: permit scroll within the bound document, verified next/previous-page and zoom controls, document find text, and focus of the already-bound window. Find text is a bounded field-specific action, not generic typing. PageDown/Up are dispatched only to a confirmed document viewport. A vision action must lie within freshly measured target-window bounds and visible evidence, with valid coordinate mapping; if app/control semantics are ambiguous, let the student navigate. Re-observe and re-plan instead of guessing.

Demonstration: keep existing browser exercise support and add an explicit student-selected VS Code scratch editor. Record the initial editor state; new example text can occupy a verified empty scratch buffer or tool-owned example region. Running code needs a reviewed example and an independently allowed run control/context. No generic terminal command execution is introduced. Existing student work, submission controls and grading remain outside demonstration authority.

The loop is observe → decide → present or one action → observe → decide, bounded by LESSON_LIMITS. Preserve per-step totals across Next/question/resume. Mirror the current controller's conservative **upfront model-slot reservation**: reserve the child allowance durably, pass that exact allowance as SDK maxTurns, and never exceed the remaining per-step/lesson balance. For v3 choose up to four slots per child, limited by the remaining step balance; allow a final shorter child when fewer remain. Keep legacy limits unchanged. Model-request events may record actual use for diagnostics but cannot authorize requests after the fact; reserved slots are not automatically refunded after interruption or uncertain completion. Do not label reserved slots as an exact count of successful model calls.

Continuation is explicit and does not leave an SDK turn blocked while waiting for a student. A teaching child ends through finish with `{ disposition: 'continue' | 'step_finished', recap }`; the controller records a small validated local `teachingProgress` value with that disposition and round index, then enters waiting_for_student. Add local-only `continue_explanation` to LessonContinueSchema: it launches another child for the **same** plan step with fresh evidence/history and remaining budgets. Existing `next` continues to advance the plan step, so it must never be used to refresh the current page. The UI labels these actions “Continue explanation” and “Next lesson step” as applicable. Question/help uses the same surface and does not advance the step. Add the companion action/schema mappings where needed, rather than mapping every non-stop action to next. Abort/restart invalidates native bindings and pending outputs, not the cumulative round/budget history.

Pause/Stop cancels native actions, pending model output and speech, releases task/CUA leases, and prevents further dispatch. Never auto-replay uncertain actions or model requests.

For current-screen explanations, failed/missing capture cannot silently become a successful source-text explanation. Legacy Coach behavior remains unchanged. A student may explicitly request a reference-only explanation, clearly labeled, through the existing non-screen path; it is not evidence that desktop teaching passed.

## Files to Change

Each row covers a bounded ownership surface. Existing colocated tests listed here or in Mandatory Reading must be updated together with their production modules. New tests should verify behavior, not mirror implementation.

| File / group | Action | Justification |
|---|---|---|
| `src/shared/classroom-lesson-contracts.ts`, `.test.ts` | UPDATE | v3 fields, resources, refinements, sanitized surface view, same-step continuation and local teachingProgress |
| `src/shared/classroom-lesson-desktop-api.ts`, `src/classroom-lesson-preload.ts` | UPDATE | Revision-bound surface selection/native picker/navigation-choice methods |
| `src/shared/classroom-teaching-request.ts`, `.test.ts` | UPDATE | Explicit teaching options and pure compilation |
| `src/shared/classroom-lesson-surface.ts`, `.test.ts` | CREATE | Effective target/version/mode semantics |
| `services/api/src/classroom/lesson_contracts.rs`, `lessons.rs`, `lesson_delivery.rs`, `lesson_resources.rs` | UPDATE | v3 validation, claims, source descriptors, progress compatibility |
| `services/api/src/http/classroom_lessons.rs` | UPDATE | Negotiation and original-file ticket route |
| `services/api/tests/fixtures/classroom-lesson-contracts.json`, `services/api/tests/classroom_lesson.rs`, `services/api/tests/http_compat.rs` | UPDATE | Cross-language corpus, ownership, mixed versions, file access |
| `src/main/knowledge/classroom-lesson-client.ts`, `.test.ts` | UPDATE | v3 request negotiation and original descriptor |
| `src/main/knowledge/classroom-lesson-surface-service.ts`, `.test.ts` | CREATE | Main-only external binding/readiness/selection |
| `src/main/knowledge/classroom-lesson-material-service.ts`, `.test.ts` | CREATE | Original download/cache/native open/local picker |
| `src/main/knowledge/classroom-lesson-surface-policy.ts`, `.test.ts` | CREATE | Pure read/navigation/demo operation rules |
| `src/main/knowledge/classroom-teaching-tools.ts`, `.test.ts` | CREATE | Narrow SDK tools and adapters; split adapter file if size ratchet requires |
| `src/main/knowledge/classroom-teaching-context.ts`, `.test.ts` | CREATE | Prompt/context builder, bounds, evidence labels |
| `src/main/knowledge/classroom-lesson-tool-policy.ts`, `.test.ts` | UPDATE | Discriminated legacy/desktop scopes and dispatch effects |
| `src/main/knowledge/classroom-lesson-controller.ts`, `.test.ts` | UPDATE | Surface preparation, persistent budgets, loop/continuation state |
| `src/main/knowledge/classroom-lesson-step-runner.ts`, `.test.ts` | UPDATE | v3 native readiness and execution; legacy branches retained |
| `src/main/knowledge/classroom-lesson-policy.ts`, `.test.ts`, `classroom-lesson.fixture.ts` | UPDATE | New context rules and valid v3 fixtures |
| `src/main/knowledge/classroom-lesson-state-store.ts`, `.test.ts` | UPDATE | Separate owner-scoped bindings and control choice persistence |
| `src/main/knowledge/classroom-lesson-feed-service.ts`, `.test.ts` | UPDATE | Readiness telemetry and receipt-before-execution invariants |
| `src/main/knowledge/classroom-lesson-draft-service.ts`, `.test.ts` | UPDATE | Inline revision-safe preparation and stale-response tests |
| `src/main/knowledge/classroom-lesson-composition.ts` | UPDATE | Inject native services and presenter; structured phase logs |
| `src/main/knowledge/classroom-lesson-agent-tools.ts` | UPDATE | Teacher assistant descriptions/schema availability for v3 |
| `src/main/application/classroom-lesson-task.ts`, `task-application-service.test.ts` | UPDATE | Route v3 teaching through scoped SDK with compact request |
| `src/main/agent/runtime-tool-registry.ts`, `.test.ts` | UPDATE | Typed desktop lesson scope, freeze/resolve enforcement |
| `src/main/cua/cua-service.ts`, `.test.ts`, `cua-surface-router.ts`, `.test.ts`, `cua-surface-reference-store.ts`, `.test.ts` | UPDATE | Narrow bound-window APIs and identity-safe vision fallback |
| `src/main/presentation/observe-coach-screen.ts`, `.test.ts` | UPDATE | Keep internal panel only for legacy material lessons |
| `src/main/companion/cursor-buddy-controller.ts`, `.test.ts` | UPDATE if required by presenter integration | Make existing presentation awaitable/cancellable through narrow adapter; preserve normal Coach behavior |
| `src/main/ipc/register-classroom-lesson-ipc.ts`, `.test.ts` | UPDATE | Native selection and student navigation controls |
| `src/index.ts` | UPDATE | Composition only; move substantial implementation to new modules |
| `src/renderer/features/classroom/ClassroomLessonComposer.tsx`, `.test.tsx`, `ClassroomLessonPreview.tsx` | UPDATE | Inline summary/edit/send, legacy draft recovery |
| `src/renderer/features/classroom/ClassroomLessonProgress.tsx`, new `.test.tsx` | UPDATE/CREATE | Clear phases, receipt errors, collapsed technical detail |
| `src/renderer/features/classroom/ClassroomLessonPanel.tsx`, `ClassroomLessonMaterialPanel.tsx`, existing `.test.tsx` | UPDATE | Desktop controls and no automatic internal material for v3 |
| `src/renderer/features/classroom/ClassroomLessonSurfacePicker.tsx`, `.test.tsx` | CREATE | Opaque window selection and Use this window/Open file actions |
| `src/main/knowledge/classroom-lesson-companion.ts`, `.test.ts`, `src/shared/contracts.ts` | UPDATE | Small next/question/pause/stop surface states; validated companion action for same-step continuation |
| `src/renderer/CompanionResponseCard.tsx`, new `CompanionResponseCard.test.tsx` | UPDATE/CREATE | Render Continue explanation vs Next lesson step and safe question/pause/stop actions |
| `src/renderer/classroom-lesson.css` | UPDATE | Compact responsive form/progress/selection UI |
| `docs/classroom-lesson-execution.md`, `docs/testing/shared-test-environment.md` | UPDATE | New mode, compatibility, concrete native acceptance evidence |

Also verify existing `desktop-observation-guard.test.ts`, `coach-runtime.test.ts`, `execution-coordinator.test.ts`, `cua-window-selection.test.ts`, and runtime adapter tests in CI. Add modifications only when behavior changes there. No dependency/package-lock or migration changes are currently required. Keep source-size ratchets; extract modules rather than raising limits to accommodate the feature.

## Alternatives Considered / NOT Building

- Do not just hide Tro or remove material ACK: that leaves the resource/route contracts wrong and can cause a blank or unrelated screenshot to be explained.
- Do not route all modes through the unrestricted agent: explain/navigation/demo need different effect authority and budget accounting.
- Do not replace all Coach flows: v1/v2 and criterion-check behavior stay compatible; reuse its presenter and grounding pattern.
- Do not make native app support depend on document parsers. Original upload support and visible screen support are separate capabilities.
- No CUA/Agents SDK replacement, generic plugin platform, universal application launcher, whole-disk search, universal document ingestion, new grading/submission behavior, or SSE transport migration.
- No claim of support for controlling every app/file format. The certified matrix below defines release behavior.
- No auto-retry or re-broadcast to hide the current not_received symptom. Diagnose delivery before accepting the new teaching flow.
- The unrelated `.claude/PRPs/plans/agents-sdk-skill-architecture.plan.md` is user work and must not be edited, committed incidentally, or removed.

## Step-by-Step Tasks

### Increment A — External teaching foundation (Tasks 1–6)

This increment establishes observation, binding and explanation against an already-open file as an engineering checkpoint. It is not the default product experience or a sufficient release of the user's requested download → open → explain flow. Increment B is required before that flow is offered as complete.

### Task 1: Establish the acceptance environment and delivery baseline
- **ACTION:** Record baseline revisions, staging readiness and a minimal teacher/student delivery result before editing.
- **IMPLEMENT:** Use `npm run start:test` on separate teacher/student machines and accounts against the documented shared API. Confirm current session, active attempt, device heartbeat and receipt for a newly authorized test broadcast. Record whether not_received is transport/version/session mismatch; only inspect sanitized logs. Create a feature branch `codex/classroom-desktop-teaching` when implementation begins.
- **MIRROR:** shared-test-environment.md; feed generation/cursor pattern.
- **IMPORTS:** None; environment and evidence task.
- **GOTCHA:** /readyz proves readiness, not revision or delivery. UI showed a stopped historical lesson and later not_received; neither establishes the cause. No remote deployment or broadcast is implied by executing this plan without the relevant user authorization.
- **VALIDATE:** Evidence records shared API, two account roles, both build revisions, current session/attempt, heartbeat, receipt result. If device access is unavailable, mark acceptance pending and proceed with implementation; do not invent evidence or mark overall complete.

### Task 2: Define v3 and backward-compatible contract corpus
- **ACTION:** Update shared/Rust schemas, pure effective-surface helper and fixtures.
- **IMPLEMENT:** Apply the v3 design exactly; reject new fields in v1/v2 and missing fields in v3. Keep plan byte limit, whitespace/UTF-16 bounds, resource membership, mode/example relationship, origin/source validation and exact digest. Add acceptance/rejection corpus cases to the shared JSON fixture.
- **MIRROR:** existing Zod superRefine and Serde validate; lessonDigest canonicalization.
- **IMPORTS:** `zod`, `./classroom-lesson-contracts` from the new shared helper; Rust existing LessonResource/LessonStep definitions.
- **GOTCHA:** Optional Serde fields must not appear as null in old canonical plans. current_screen must not accidentally enable an unpinned source or resource_app without an original.
- **VALIDATE:** CI TS and Rust corpus agree; stored legacy digest round-trips unchanged; all mode/surface/version combinations covered.

### Task 3: Negotiate v3 server/client support and preserve delivery
- **ACTION:** Update HTTP negotiation, client, device validation and start checks.
- **IMPLEMENT:** Advertise intersection of requested/server support; retain legacy response shapes; filter unsupported plans without stalling cursor. Device version 3 accepted. Direct start requests verify required version and existing ownership. resource current_screen material response contains empty text/chunks with valid identity and must not query invented source IDs.
- **MIRROR:** existing v2 maxPlanVersion handling and transactional start/lookup.
- **IMPORTS:** `LessonContextSchema`, `LessonFeedSchema`, `LessonMaterialSchema` in client; existing Rust JSON/plan helpers.
- **GOTCHA:** Advertising 3 to an old strict v2 client breaks decoding even if feed items were filtered. Restarting the API is required after server changes; updating desktops alone is insufficient.
- **VALIDATE:** HTTP compatibility tests for v1/v2/v3 and old-server/new-client; no silent downgrade of a requested v3 plan; existing DB upgrade/restart fixture passes.

### Task 4: Bind and verify the student's external material window
- **ACTION:** Create surface service/policy and narrow CUA binding methods.
- **IMPLEMENT:** Select frontmost external candidate after hiding Tro; retain native identity in main-only store. Relevance checks use requested title/section and visible evidence; current_screen accepts the selected readable material without pretending to know its whole file. Expose short-lived opaque selection tokens when ambiguous. Deny cross-task/stale tokens. Revalidate on each observation and reject Tro-owned windows or unrelated document changes.
- **MIRROR:** externalWindowCandidates/selectExternalWindow, CuaSurfaceReferenceStore, DesktopObservationGuard.
- **IMPORTS:** `CuaService` from `../cua/cua-service`, `LessonBlockedError` from `./classroom-lesson-errors`, native binding types from existing CUA modules; keep shared view types separate.
- **GOTCHA:** SurfaceDescriptor has no authoritative PID/window ID. Add main-only access rather than relying on titles or leaking native IDs through LessonView. A valid screenshot with unreadable text is not ready.
- **VALIDATE:** Unit tests for PDF-like vision window, native semantics, wrong file, ambiguous windows, no screen permission, multi-monitor scaling, process reuse, window closed/replaced, and student switching apps mid-decision.

### Task 5: Add the bounded screen teaching loop and speech/pointers
- **ACTION:** Create teaching context/tools and route v3 explain/help through existing SDK runtime.
- **IMPLEMENT:** First deliver observe/present/finish with no navigation actions. Required initial tool observes selected surface. Presenter validates latest fingerprint/coordinate space immediately before pointing. Reuse CursorBuddyController for speech and pointer output without a second Coach model call. Carry actual question + last four exchanges; preserve full reviewed step separately. Finish each bounded child with its disposition and wait for continue_explanation/question between rounds rather than spinning or keeping a blocked SDK tool open. Keep total model/observation limits across resumes.
- **MIRROR:** LocalAgentRuntime tool lifecycle; Coach runExplanation's fresh-evidence presentation; existing compact task admission.
- **IMPORTS:** `RuntimeToolDefinition` and adapters from `../agent/runtime-tool-registry` / `runtime-tool-dispatcher`; `LessonExecutionScope` from lesson policy; presenter injected from composition; `LESSON_LIMITS` from shared contracts.
- **GOTCHA:** Controller currently reserves one model slot for non-demonstrate child runs. Update the v3 allowance and SDK maxTurns together using upfront reservations; do not double-charge diagnostic events. Existing next advances the plan step and cannot mean re-observe this page. No source-text fallback counts as a successful screen explanation.
- **VALIDATE:** Fake SDK turn invokes observe→present→finish, Next observes again, stale pointer output is discarded, actual long help questions survive, cancellation stops speech/turns, absent observation blocks. CI confirms legacy Coach/check remains functional.

### Task 6: Wire student controls and remove v3 internal material takeover
- **ACTION:** Add safe IPC for target choice and student continuation, plus small desktop-teaching UI.
- **IMPLEMENT:** `listSurfaces`, `selectSurface`, `chooseLocalMaterial`, and `setNavigationConsent` accept lessonId/expectedRevision plus opaque token or boolean where appropriate. File picker returns sanitized view only. Hide/avoid internal material panel for v3 external lessons. Surface selection, Next, Ask, Pause and Stop use the same controller revision. Restore windows only when still appropriate after observation; keep lesson controls usable without bringing the main window over the document.
- **MIRROR:** existing authorized IPC/preload parsing and lessonCompanionCard.
- **IMPORTS:** shared desktop API schemas in preload/main; surface service through ClassroomLessonFeatures; React hooks in new picker.
- **GOTCHA:** Whole LessonLocalState is renderer-visible; do not put local paths there. Preserve old material ACK behavior for legacy lessons. Restart revalidates a surface rather than replaying the previous open/click.
- **VALIDATE:** UI/IPC tests reject forged/stale selection, show actionable wait states, preserve opt-out and owner isolation. First real acceptance: explain open Python Markdown and PDF on two machines without Tro's material panel.

### Increment B — Open and navigate material externally (Tasks 7–10)

### Task 7: Add authorized original-material descriptors
- **ACTION:** Add GET `/v1/attempts/:anchor/session-lessons/:lesson/resources/:resource/file`.
- **IMPLEMENT:** Reuse lesson_material authorization and source pin checks. Only a source_text resource can yield an original. Return sourceVersionId, safe display filename, mediaType, byteSize, sha256 and GetTicket. Classroom helper returns metadata internally; HTTP layer signs using existing object store. Recheck active access on each request and never disclose raw object keys.
- **MIRROR:** lesson_resources source locks and knowledge.rs starter_files tickets.
- **IMPORTS:** Rust existing query/Row/Uuid/ApiError; `state.knowledge.object_store`; TS new strict descriptor schema consumed by ClassroomLessonClient.
- **GOTCHA:** A student is authorized through the lesson/attempt and pinned source, not by being a general class owner. Another student's arbitrary source ID must fail. Expired signed tickets are read retries, not native action retries.
- **VALIDATE:** PostgreSQL/HTTP cases for correct student, other account/class, archived/unpinned source, revoked access, expired/stopped lesson, unavailable object store. Descriptor exposes neither object key nor unrelated source metadata.

### Task 8: Download/open native material with verified results
- **ACTION:** Implement main-only material service and cache.
- **IMPLEMENT:** Use streamed size/hash validation, owner cache, partial-file cleanup, regular-file checks and injected openPath. Limit automatic file formats as specified; do not execute code, enable macros or change file associations. Local picker supports student-owned originals without copying or editing them. Mark open dispatch durably before calling OS; verify relevant window/content after launch and bind it. A known failed open offers student-open fallback.
- **MIRROR:** ActivityWorkspacePreparationService atomic staging/hash checks; launcher openPath returned-error handling; state-store atomic encrypted metadata.
- **IMPORTS:** `node:crypto`, `node:fs/promises`, `node:path`; injected `openPath`, `showOpenDialog`, `fetch`; no Electron functions in renderer.
- **GOTCHA:** File association can open the wrong app or a blank window; launch success alone cannot advance to explaining. Cache hash does not prove that the app currently displays that file.
- **VALIDATE:** Hash/size mismatch, traversal, duplicate filenames, ticket expiry, canceled picker, app unavailable, symlink substitution, stop during download/open, restart with dispatch unknown, duplicate open prevention. Native PDF/Markdown opening acceptance on both OSes.

### Task 9: Add scoped document navigation
- **ACTION:** Implement navigate tool adapter and pure operation validation.
- **IMPLEMENT:** Allow one authorized scroll/page/zoom/find/focus action on the bound surface; verify semantic ref or coordinate target against fresh observation. Use existing coordinator/CUA internals and record dispatch/result. Require observe after each action before presenting or another mutation. Navigation disabled means model can ask student to scroll but cannot dispatch it. Changing window target requires a new validated binding.
- **MIRROR:** tool policy dirty/uncertain/freshness guards; runtime registry normalization; CUA semantic refs and coordinate mapping.
- **IMPORTS:** `SurfaceCommand`, `DesktopCommand` types from execution-contracts; new pure surface policy and existing coordinator through dependency injection.
- **GOTCHA:** Find-field typing is scoped to a verified find control; allowing generic typing would leak editing authority. Do not whitelist every keypress, browser link or raw cua tool.
- **VALIDATE:** Page-turn/scroll→observe→point behavior, read-only mode denial, stale focus/ref, wrong app, hidden modal, coordinate scaling, partial/unknown dispatch, and Stop between validation and effect.

### Task 10: Integrate external preparation with lifecycle and follow-ups
- **ACTION:** Update controller/runner preparation and effect handling for all v3 modes.
- **IMPLEMENT:** current_window obtains surface directly; resource_app resolves/opens once; check/practice/help reuse correct work/material target without re-opening on every child. Reauthorize before each round/action; consume preparation observations too. Preserve history without treating it as proof. Stop/session end revokes policies and ends observation/presentation. Native uncertain outcomes stay unknown across restart.
- **MIRROR:** current receipt/startStep lookup, transition(), persist(), runner cancellation.
- **IMPORTS:** effectiveLessonSurface helper; injected surface/material services; existing LessonBlockedError/LESSON_LIMITS.
- **GOTCHA:** Existing controller marks all preparation dispatching before runner.prepare. Split read-only readiness from actual external effects so a canceled observation is not confused with an uncertain click, and vice versa.
- **VALIDATE:** Lifecycle tests for Next/question without duplicate open, expired lesson, opt-out, busy device, session ended during action, restart before/after dispatch and competing child runs.

### Increment C — Editable teacher send flow and useful progress (Tasks 11–13)

### Task 11: Replace the separate preview button with inline editing
- **ACTION:** Update Composer and pure request compiler.
- **IMPLEMENT:** Default selected class source/web to resource_app (download/open externally for source files). Offer Students' current window as an alternate material choice, and Allow students to open it themselves for a named material when desired. Include section, language and navigation edits. Retain original free text. Generate concise summary without repeating objective/instruction. Prepare draft after debounced edits with generation token; enable Send only when current displayed content matches current prepared digest/revision. Editing invalidates pending preparation; stale async responses cannot replace current selection. Missing/ambiguous sources show inline errors, never guessed local paths.
- **MIRROR:** Composer invalidate()/prepare() and draft service context/digest validation.
- **IMPORTS:** pure compiler/options schema from shared; lesson desktop API only for prepare/cancel/confirm.
- **GOTCHA:** Debounced prepare must not send; clicking Send must not silently regenerate a different lesson. Model/voice prepared plans still need the same editable review before explicit Send.
- **VALIDATE:** React tests for no send on type, changed fields in exact committed plan, async race, double-click, keyboard submission, ambiguous file, old server, and successful sent-state transition.

### Task 12: Present receipt and actionable progress
- **ACTION:** Simplify Preview/Sent view and progress details.
- **IMPLEMENT:** After sent, show one lesson heading plus progress; collapse plan details. Distinguish no receipt, stale connection, old version, waiting for material, blocked permission, running, paused, unknown and finished using existing status/reason/device data. Show local fine-grained phases only on the student. Keep Stop and Teach another section. Unknown sends expose Check send status using existing reconcile; do not create another client ID automatically. Preserve raw build/device detail in a collapsed diagnostics disclosure.
- **MIRROR:** ClassroomLessonProgress poll cleanup and receipt reconciliation.
- **IMPORTS:** existing LessonProgress/LessonDraft; pure display mapping helper if needed.
- **GOTCHA:** Server progress currently reports coarse status/reason only. Derive labels from those fields and the known plan mode; do not claim the teacher can see a precise page/utterance. Use surface_unverified/resource_unavailable for material readiness, permission_required for permission, and unsupported plus device-version comparison for update guidance. No new report fields or database enum changes are needed.
- **VALIDATE:** Render each real server status; disconnected student never appears as explaining; absent receipt offers meaningful next action, not automatic resend. Observe polling cleanup on unmount/lesson change.

### Task 13: Align teacher assistant tools, defaults and documentation
- **ACTION:** Update lesson tool descriptions, schema context and authoring guidance.
- **IMPLEMENT:** Remove assertions that every Explain opens internal material and every Demonstrate requires a browser in v3 descriptions. Version-gate supported modes. Keep teacher control of recipient session and actual send. Document download/open as the selected-class-material default, current-window as an alternate mode, native opening formats, control choices and per-student delivery interpretation.
- **MIRROR:** lessonToolDefinitions/lessonToolAdapters and existing bound teacher context.
- **IMPORTS:** shared effective-surface/version helpers and schemas.
- **GOTCHA:** Teacher assistant tools and manual Composer must compile the same semantics; stale prompt rules must not push generated plans back to legacy internal panels.
- **VALIDATE:** Tool-schema snapshots and compiler tests cover equivalent voice/text/form requests. User-facing copy is English/Vietnamese and avoids protocol details outside diagnostics.

### Increment D — Desktop demonstrations and final acceptance (Tasks 14–16)

### Task 14: Extend demonstrations to supported native editor contexts
- **ACTION:** Enable v3 demo operations for VS Code scratch work while preserving browser examples.
- **IMPLEMENT:** Require explicit demo example, answerReveal=allowed and student control choice. Bind a selected verified empty scratch editor/new example region. Permit bounded example input and a verified run action only when that app surface supports it. Track tool-owned content; existing student work cannot be overwritten or treated as demonstrated success. Observe the result before finishing and return control for practice.
- **MIRROR:** current ownedValues/existing_work protection and complete_lesson_step evidence checks; use existing registry/coordinator rather than shell execution.
- **IMPORTS:** pure surface policy and teaching tools; existing lesson demonstration fields.
- **GOTCHA:** A native editor may not expose its existing value reliably. In that case decline editing and ask the student to open a blank scratch editor; do not infer emptiness from a screenshot alone when the buffer may have offscreen work.
- **VALIDATE:** VS Code empty editor success, nonempty editor denied, unknown value denied, restricted answers denied, no grading/submission, Stop during typing, observed result required, browser demo regression.

### Task 15: Finish regression coverage and source review before CI
- **ACTION:** Complete regression matrix, docs and a source-level diff review.
- **IMPLEMENT:** Review all route/version/policy changes together; verify no raw IPC/CUA exposure, old digest mutation, unbounded loop or retry of unknown effects. Retain source-size ratchets. Prepare one implementation increment completely before its first CI cycle; batch known fixes. Record focused diagnostics only if a specific failure needs reproduction.
- **MIRROR:** AGENTS.md CI-first guidance and shared contract corpus.
- **IMPORTS:** Existing Vitest/happy-dom and Rust integration fixtures.
- **GOTCHA:** Do not run full local verification or package builds as routine gates. Native launch for acceptance is distinct from a full local test suite.
- **VALIDATE:** Authorized final revision passes applicable CI checks; report pending where CI cannot run. Review remaining diffs after fixes without broad redundant local cycles.

### Task 16: Two-machine acceptance and staged rollout
- **ACTION:** Exercise the matrix below and record concrete evidence per increment.
- **IMPLEMENT:** Roll out server support before new clients, then both teacher/student builds from the same accepted revision. Run the Python class scenarios on macOS and Windows. Record teacher send receipt, student received/ready/explain timeline, app surface, visible page, question response, cancellation and revisions. Do not declare the overall feature complete at Increment A.
- **MIRROR:** shared staging profile and documented cross-machine acceptance.
- **IMPORTS:** None; native acceptance and release evidence.
- **GOTCHA:** Packaging or CI success cannot prove PDF visibility, TCC permissions, pointer positioning, file association, real-model interpretation or two-machine delivery. Deployment/merge require separate existing or explicit authorization.
- **VALIDATE:** All acceptance criteria below and final-revision CI pass. If a native app row fails, fix it or explicitly narrow the advertised supported matrix before release; never claim universal support.

## Testing Strategy

### Unit and integration matrix

| Test | Input | Expected output | Edge? |
|---|---|---|---|
| v3 current material | current_screen/current_window, no source text | Valid plan; external readiness; no internal panel | No |
| Named source already open | source_text/current_window | Source used as context; no forced download/open | No |
| Old plan replay | v1/v2 saved plan/digest | Identical serialized payload/digest; legacy behavior | Yes |
| Version mismatch | v2 client vs v3 server/lesson | Old-safe response; cursor advances; update message | Yes |
| Unknown server capability | New client, response lacks maxPlanVersion | No v3 commit; actionable server-update state | Yes |
| Direct unsupported start | Device v2 requests v3 lesson | Rejected by server | Yes |
| Wrong visible file | Requested Python material, unrelated browser | Wait for relevant material; no invented explanation | Yes |
| Unreadable screenshot | Tiny text/blank/protected viewer | Ask to zoom/open; no fabricated detail | Yes |
| App/window changes | Model output uses old fingerprint | Discard pointer/action and observe again | Yes |
| File ticket authorization | Other student's class resource | Not found/forbidden without metadata leakage | Yes |
| Native download | Oversize/hash mismatch/redirect | Abort and remove partial data; no launch | Yes |
| Unknown launch/action | Timeout after dispatch; restart | Unknown; observe/reconcile; no repeated launch/action | Yes |
| Navigation disallowed | Scroll tool without student choice | No native effect; ask student to navigate | Yes |
| Navigation permitted | PageDown on bound document | One action then new observation | No |
| Long question | Maximum accepted instruction/question | Question retained; compact request stays admissible | Yes |
| Concurrent preparations | Older prepare resolves after edit | Old result ignored; cannot send obsolete draft | Yes |
| Duplicate Send | Double click/network timeout | One client ID; receipt lookup, no duplicate lesson | Yes |
| No receipt | Connected/version-ready student absent delivery | Accurate not_received state; no fake success | Yes |
| Teacher Stop | Pending speech/model/native effect | No subsequent dispatch; cancellation/unknown reported accurately | Yes |
| Existing work | Demonstrate into populated editor | existing_work; no overwritten student work | Yes |
| Budgets/resume | Multiple questions/Next/restart | Cumulative bounded model/action/observation counts | Yes |

### Edge Cases Checklist

- [ ] Empty input and ambiguous or absent material names.
- [ ] Maximum UTF-16 input and 65,536-byte plan size; escaped JSON.
- [ ] Strict TS/Rust validation and legacy serialization.
- [ ] Concurrent drafts, duplicate sends, two devices claiming one student lesson.
- [ ] Network failure before and after dispatch; expired file ticket vs unknown native outcome.
- [ ] Permission denied, blank/protected/occluded material and missing file association.
- [ ] Mixed DPI, multiple monitors, moved/resized/minimized window and switched app/tab.
- [ ] Student opt-out, new control choice, sign-out, room ended, stale owner binding.
- [ ] Translated copy, keyboard operation and responsive layout.
- [ ] Untrusted document instructions cannot expand tools or authorize an effect.

## Validation Commands

The repository's CI-first policy takes precedence over generic PRP command templates. The commands below identify hosted gates; do not run them all locally before committing. This plan itself requires no app tests because it changes only documentation.

### Static/source checks — CI source job

```bash
npm run check:source
npm run check:renderer
```

EXPECT: SDK checks, lint, typecheck, TS regressions, renderer bundle and missing-asset regression all pass.

### Focused diagnostic checks — only to reproduce a concrete failure

```bash
npx vitest run src/shared/classroom-lesson-contracts.test.ts src/main/knowledge/classroom-lesson-step-runner.test.ts src/renderer/features/classroom/ClassroomLessonComposer.test.tsx
```

EXPECT: Reproduced failure has a regression and passes after correction; no automatic expansion into a full local suite.

### Full backend and database checks — CI rust-backend job

```bash
npm run api:fmt
npm run api:audit
npm run bazel:check
bazel test --config=ci --local_test_jobs=1 --test_env=TEST_DATABASE_URL --test_arg=--ignored --test_arg=--test-threads=1 //services/api:postgres_compat_test //services/api:classroom_lesson_test
bazel test --config=ci --test_env=TEST_DATABASE_URL --test_arg=rust_router_preserves_backend_contracts_across_major_route_families --test_arg=--ignored --test_arg=--test-threads=1 //services/api:http_compat_test
```

Run in the workflow-provided disposable PostgreSQL environment and retain its exact test environment/arguments. The ignored Rust integration test requires TEST_DATABASE_URL; an ignored/skipped test is not a pass. Include the existing upgrade/restart tests and schema-history preflight. Existing 037 migration remains unchanged.

### Native packaging — CI verify jobs

```bash
npm run package:ci
```

EXPECT: macOS and Windows native regression tests and packaging pass on the final revision. This is the workflow's packaging command, not an instruction to launch a standalone local packaging cycle.

### Native acceptance launch

```bash
npm run start:test
```

Use on both machines with Doppler `tro-app/stg`, separate accounts and the same backend. It builds the runtime and launches the actual Electron app; a browser-only localhost test cannot establish desktop behavior. Do not use a stale packaged app from out/ as acceptance evidence.

### CI observation

After an authorized push, use one `gh pr checks <number> --watch` watcher. Inspect detailed logs on failure and fix reported failures together. The required `verify (macos-latest)` and `verify (windows-latest)` checks, plus applicable source/Rust/CodeQL checks, must pass at the final head before an authorized merge.

## Manual Validation / Acceptance Criteria

Use **Python Foundations — Sample Class**, Session 1, activity **Python cơ bản: Tạo lời chào cá nhân**, and the ready source `01-python-bai-hoc.md`. The companion exercise source is `02-python-bai-tap.md`. These names were observed in the app; current room codes and enrollment must be re-read at test time.

- [ ] Record staging API capability version, deployed revision where available, teacher/student revisions and signed-in roles. API is `https://api-test-test-d2da.up.railway.app`; credentials stay in Doppler.
- [ ] Teacher/student share the current live session; a new broadcast receives a real student receipt. Investigate not_received before attributing failure to external rendering.
- [ ] Student opens Markdown externally. Teacher sends “Explain the first section in Vietnamese. Explain one code example, then pause for questions.” Tro identifies the external material and explains it without opening its own panel.
- [ ] Repeat with a PDF in macOS Preview and a Windows PDF viewer, using no registered source for the current_screen case. Explain only the visible page.
- [ ] Repeat with a browser document, slide/image viewer and VS Code. A readable unsupported-action app may still be explained; it must not claim navigation support.
- [ ] Named class source + student-opened file uses reference context while verifying relevance, and does not download/reopen unnecessarily.
- [ ] Ask “Why does this line use print?” Tro uses the newly observed line plus history; it does not merely repeat a cached answer.
- [ ] Student scrolls manually; Next observes the new page. Old pointers do not remain fixed to stale positions.
- [ ] With navigation enabled, Tro turns/scrolls the document, observes the result and explains visible content. Turning navigation off prevents further actions without stopping read-only help.
- [ ] Selecting a class file and sending an explanation downloads its pinned original onto the student's computer and opens it externally by default, without a separate manual student download. Verify file contents/readability, not just OS launch success. A verified cached copy is reused on a repeat lesson; uncertain opens are not replayed. Ambiguous association offers a usable student-open fallback.
- [ ] Tro waits for missing/blank/locked/unreadable material and recovers after the student fixes it. No text fallback is misreported as successful screen teaching.
- [ ] Teacher uses one Send action after inline edits. The recipient/material/language/section shown before sending exactly match the recorded plan; sent state displays progress without duplicate preview text.
- [ ] Pause/Stop works during explanation, navigation and demonstration; no background continuation after the session ends.
- [ ] VS Code scratch demonstration produces the reviewed example and returns control. Existing student work remains intact, and example success does not mark the assignment completed.
- [ ] Restart preserves explicit opt-outs/history but revalidates native bindings. Unknown computer actions are not replayed.
- [ ] Mixed versions remain functional; old students receive a clear update requirement for v3 rather than silently missing a lesson with no explanation.
- [ ] Final revision passes applicable CI, both-OS native acceptance is recorded, and docs state the actual certified support matrix.

## Completion Checklist

- [ ] All four increments and sixteen tasks completed; Increment A alone is not the full feature.
- [ ] Naming, dependency injection, strict schemas and error semantics follow existing patterns.
- [ ] Pure goal/surface/action policy remains separate from CUA execution and model text.
- [ ] Renderer remains sandboxed with narrow DesktopApi methods.
- [ ] No original migrations changed and no silent wire/digest incompatibility.
- [ ] No broad new tool authority or uncontrolled retry of unknown native/model outcomes.
- [ ] Logs/progress exclude private document content, signed URLs and local paths.
- [ ] Code/tests/docs complete before each initial CI cycle; final-head results recorded.
- [ ] Two-machine tests cover real model, permissions, native windows, pointers and control handoff.
- [ ] Unrelated user files are untouched; no deployment/merge implied by plan execution.

### Plan preparation checks

- [x] Existing explicit path references checked against the checkout; missing paths are marked CREATE, except the documented absent navigation guide.
- [x] Sixteen tasks each specify ACTION, IMPLEMENT, MIRROR, IMPORTS, GOTCHA and VALIDATE.
- [x] Actual code excerpts checked against source, including strict IPC, state storage and logging patterns.
- [x] Same-step continuation distinguished from existing next-step behavior.
- [x] Budget design uses the existing durable reservation/maxTurns mechanism rather than an unimplemented pre-model callback.
- [x] CI commands include the ignored-integration flags; native acceptance remains a separate gate.
- [x] Markdown checked for trailing whitespace; planning changed no application code.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Wrong window/file appears relevant by title | Medium | High | Main-only native identity, content relevance, ambiguity handling, fresh binding |
| v3 advert breaks strict v2 parser or old digest | High without tests | High | Negotiated response version, skip absent fields, shared corpus and stored-plan round-trip tests |
| Vision-only navigation acts on unrelated control | Medium | High | Bound window/coordinates, operation-specific checks, no blind generic clicking |
| Pointer appears on stale content or different display | Medium | Medium | Fresh fingerprint/coordinate revalidation before presentation |
| Existing automatic consent gains edit authority | Medium | High | Separate local control choice; mode-specific host policy |
| File association launches wrong/unsupported app | Medium | Medium | Verify visible content; student-open fallback; explicit certified matrix |
| Source download grants broader classroom access | Low with tests | High | Existing lesson/attempt ownership and pinned-role checks; short-lived tickets |
| Current delivery failure masks successful implementation | Medium | High | Receipt/heartbeat baseline and exact build checks before material acceptance |
| New loop overruns limits or resumes uncertain actions | Medium | High | Existing durable claims/effects, upfront child-slot reservations, cumulative limits, cancellation regression |
| XL feature ships half-done under one label | High without staged acceptance | Medium | Four independent acceptance increments; no universal support claim |

## Notes and next step

No new dependency or underlying CUA API is required for the first increment. External file opening uses documented Electron main-process APIs; automatic navigation and native editor demonstration need certification with the installed CUA runtime. The exact supported apps are acceptance outcomes, not inferred from successful unit tests.

Implement with `prp-implement .claude/PRPs/plans/classroom-desktop-teaching.plan.md` when requested. Start with Tasks 1–6, keeping the later increments and full acceptance criteria visible. Planning does not authorize a push, merge, deployment, or broadcast to students.

## Implementation checkpoint — 2026-09-09

Local coding and regression coverage are written on `codex/classroom-desktop-teaching` in the isolated desktop-teaching worktree. Source review and whitespace checking are complete. See `../reports/classroom-desktop-teaching-report.md` for implementation details and deviations. Tasks 1 and 16 still require two-device delivery/native evidence; all CI verification is pending an authorized push. This plan is intentionally not archived or marked overall complete.
