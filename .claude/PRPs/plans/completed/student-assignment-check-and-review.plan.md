# Plan: Student Assignment Check and Teacher Review

## Summary

Give students a global keyboard shortcut to check their assignment while staying in VS Code, Scratch, or their current work app. Present feedback and explicit review handoff in Tro’s floating companion; opening or focusing Tro’s main window must not be required during practice. Keep the existing server-owned assignment lifecycle and add a structured, evidence-grounded check inside the read-only Coach path. A successful AI request means the check finished; only the existing teacher review action marks the assignment completed.

This is an implementation plan, not an implementation. No classroom resources, settings, or student data were changed while preparing it.

## User Story

As a student, I want to press a shortcut while practising in VS Code, Scratch, or another app, receive Tro’s feedback beside my work, and explicitly send for teacher review from that floating panel, so that I can stay in my work app and my progress is recorded without Tro guessing that I am finished.

As a teacher, I want to distinguish starting work, requesting a check, submitting for review, and confirmed completion.

## Problem → Solution

The UI already has Start working, Check my work, Ready, and submission controls. Starts and review transitions already reach PostgreSQL. However, Check launches general Coach: its ordinary prompt receives only limited Activity metadata, has no reference-search or filesystem tools, and has no structured check result. Workspace selection is deliberately removed from Coach execution authority. Consequently, the current Check button cannot reliably check the entire published rubric against the available work.

Add a main-owned global Check shortcut, bounded context preparation outside the model, a dedicated check response shape, and a floating result card. Main-window controls are optional secondary surfaces; the primary practice loop works with the main window hidden. Preserve Coach's lack of mutation tools. Use the existing explicit Ready/Submit/teacher Review routes to register the student's handoff and teacher-confirmed completion.

## Metadata

- **Complexity:** Large; deliver as three ordered milestones below.
- **Source PRD:** N/A
- **PRD Phase:** Standalone
- **Repository:** `/Users/ducng/Desktop/workspace/TroCode`
- **Baseline inspected:** `53191a8`, September 5, 2026. Other work may move line numbers; the named symbols below identify each implementation point.
- **Estimated scope:** 45–50 files including tests and documentation; 10 tasks.
- **Existing unrelated artifact:** `.claude/PRPs/plans/agents-sdk-skill-architecture.plan.md`; preserve it.
- **Navigation supplement:** The requested `docs/CODEX-NAVIGATION-GUIDE.md` is absent in this checkout. Root `AGENTS.md` and `docs/knowledge-spaces.md` were read.
- **Confidence:** 8/10. The lifecycle and model transport exist; accurate evidence coverage and cancellation across UI/runtime boundaries are the main integration risks.

## Product Decisions

1. **Start working** keeps its existing operation, available through the floating assignment panel as well as the optional main-window control. Its successful Work Session creation records `started_at` and changes an assigned Attempt to `in_progress`. Opening an assignment or opening VS Code alone does not record a practice start.
2. **Check my work** is primarily a global keyboard shortcut: proposed default `CommandOrControl+Alt+K` (⌘⌥K on macOS, Ctrl+Alt+K on Windows). Tro must already be running, signed in, and bound to the student’s current assignment. The shortcut is an explicit, optional student action. It captures context at that time. It does not continuously watch the student or execute their program.
3. A check reports each published criterion as **Looks met**, **Needs work**, or **Could not verify**. These are AI suggestions, not grades or official criterion completion.
4. **Send for teacher review** is explicit and remains available even if a check is incomplete or unavailable. No AI pass is required to contact the teacher.
5. If the Activity requires files, this action invokes the existing main-owned file picker and upload services, with the reviewed file list displayed in the floating panel before a separate Submit files action. Otherwise it uses the existing Ready transition. It never silently uploads the project folder or screenshot.
6. The teacher uses the existing **Complete** or **Return** action. Do not reinterpret `requiresFacilitatorConfirmation` as authorization for the model to complete work.
7. Default teacher visibility remains operational facts. Check findings and captured code/screens are private to the student's local check; this feature does not add model findings to the hosted evidence table.
8. The first milestone preserves existing Start working runtime behavior; its floating action calls the same main service without opening the main window. Separating self-directed practice from agent-assisted work is a different feature; do not create a second practice/session lifecycle here.

## UX Design

### Before

```text
Start working   I need help   Check my work
                               └─ ordinary Coach reply/walkthrough

I'm ready for review           Previous work: 1 Work Session(s)
                               Guidance: guided · after_attempt
```

### After

```text
VS Code / Scratch stays in the foreground
Student presses ⌘⌥K / Ctrl+Alt+K

Tro floating panel:
  Assignment: Move the sprite
  Checking your current work…  [Stop]

Checked at 13:47 · VS Code window · visible content only
  Looks met          Uses a loop               [evidence reference]
  Needs work         Handles empty input       [brief explanation]
  Could not verify   Produces the required output
                     Run it yourself and show the output, then recheck.

[Check again]   [Keep working]   [Send for teacher review]

After explicit handoff: Waiting for teacher review
After teacher confirmation: Completed
After teacher returns it: Continue working
```

For a Workspace Activity, replace the evidence caption with “Saved files in [folder] · checked [relative paths]”. Show omitted/unreadable files and a reminder that unsaved editor changes are not included. An imported PDF is reference material, not proof of the student's work.

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Global Check shortcut | No assignment-check shortcut | Checks the main-owned active assignment without opening Tro’s main window | Capture target before showing the panel; unavailable shortcut has floating-button fallback |
| Start working | Starts a Work Session and task in main UI | Same operation accessible from the floating assignment panel | No main-window navigation; no attendance screen watcher |
| Assignment Check | Generic Coach request | Dedicated structured check using assignment + work evidence + pinned references | Still read-only |
| Sticky classroom Check | Separate generic launch; redirects workspace Activities to classwork | Optional secondary entry to the same check service | Floating shortcut prompts for any missing folder using a native dialog, not classwork navigation |
| Result | Ordinary conversation text | Floating criterion rows, evidence coverage, timestamp, next action; main UI may mirror | No numeric grade or automatic readiness; editor retains focus |
| Ready control | “I'm ready for review” | “Send for teacher review” | Same server transition when files are not required |
| File-required handoff | Main-window upload section | Native picker → floating file preview → explicit Submit files | Reuse upload service and limits; main window stays hidden |
| Teacher dashboard | Session counts and broad status | Start time plus most recent Check lifecycle, separately from Attempt status | A completed check is labelled “Check finished” |
| Failed check | Can resemble a failed work launch | “Check unavailable”/“Check interrupted”; assignment remains in progress | No false failed assignment |
| Older result | No typed coverage information | “Earlier check” and timestamp; recheck is available | No claim of live freshness |

## Lifecycle and Data Flow

```text
Student Start working
  AttemptLaunchPage.launch('work')
  → DesktopApi submitTask → TaskApplicationService.submitOrdinary
  → ActivityContextService.create → POST /v1/attempts/:id/work-sessions
  → server records started_at / in_progress / work_session_created

Student presses global Check shortcut (or floating Check button)
  → main resolves exact active assignment and registers source app/window
  → same task application service, activityIntent='check'
  → no mainWindow.show(), focus(), or open_task action
  → main verifies Attempt, immutable version, workspace selection if required
  → creates Work Session with purpose='check'
  → Coach captures fresh screen OR reads bounded saved workspace files
  → main retrieves bounded pinned reference passages
  → authenticated existing Responses transport, tools=[]
  → schema + evidence-reference validation + deterministic result aggregation
  → TaskSnapshot.workCheck → encrypted local history + floating result UI
  → existing Work Session operational state update

Student Send for teacher review
  → no-files Activity: existing Ready API → ready_for_review
  → files-required Activity: existing submission preview + commit → submitted

Teacher Complete / Return
  → existing facilitator-authorized Review API
  → completed / in_progress
```

Never map a model `complete` decision or a Work Session `completed` state to Attempt `completed`. Do not write check suggestions into `priorProgress.completedCriterionIds`.

## Mandatory Reading and Unified Discovery

All paths below are relative to the repository root. Line references are from discovery; use the named symbols if nearby work shifts them.

| Priority / Category | File:lines / symbol | Pattern and reason |
|---|---|---|
| P0 architecture | `AGENTS.md:1-30` | Sandboxed renderer, narrow DesktopApi, schemas at boundaries, pure policy, no unknown invocation replay; required checks |
| P0 lifecycle | `docs/knowledge-spaces.md:55-125` | Canonical Attempt/Work Session/submission/evidence model and explicit teacher visibility |
| P0 entry | `src/renderer/AttemptLaunchPage.tsx:114-153,190-255,480-596` | Launch, Check, submission, and Ready handlers |
| P0 entry | `src/renderer/ClassroomSessionBar.tsx:58-118` | Sticky Help/Check/Ready and workspace redirect |
| P0 orchestration | `src/main/application/task-application-service.ts:85-248`, `submitOrdinary` | Authoritative Attempt lookup; resolves trusted folder; removes workspace authority for Coach; initial runtime dispatch |
| P0 routing | `src/main/application/task-request-router.ts:25-57` | Explicit Coach routing precedes workspace routing; `requiresVisibleContext` currently does not request screen context for workspace Coach |
| P0 context | `src/main/knowledge/activity-context-service.ts`, `create` | Creates server Work Session and compact immutable Activity context |
| P0 model | `src/main/coach/coach-runtime.ts:26-67,117-215,580-658`, `coachResponseRequest` | Injected runtime dependencies, no mutation tools, authenticated/accounted model calls, unknown-result handling |
| P0 contracts | `src/main/coach/coach-contracts.ts:32-106` | Strict model union and runtime-start schema |
| P0 contracts | `src/shared/contracts.ts:163-203,565-625,976-1065,1288-1320` | Activity, snapshot, Attempt, dashboard, and review schemas |
| P0 registration | `services/api/src/http/knowledge.rs:1521-1660`, `create_work_session`, `update_work_session` | Idempotent creation, Attempt start, operational events; updates currently lack purpose in payload |
| P0 completion | `services/api/src/classroom/assessment.rs:10-192` | Locked, facilitator-authorized Ready/Complete/Return transitions; required-file guard |
| P1 composition | `src/index.ts:308-347,495-553,621-643,760-805` | Progress subscriptions, Coach wiring, TaskApplicationService wiring, hide-Tro observation guard |
| P1 screen | `src/main/cua/cua-surface-router.ts`, `observeAccessibility`, `observeBrowser`; `src/main/cua/cua-service.ts`, `observeCurrentSurface`, `observe` | Semantic observations where available, screenshots fallback, bounded content; CUA is evidence only |
| P1 workspace | `src/main/workspace/workspace-selection-service.ts:49-104` | Opaque trusted selection resolves to canonical workspace identity |
| P1 filesystem | `src/main/agent/workspace-device-adapters.ts:264-349`, `WorkspaceEditor.readTextFile` | Checks root containment, regular file, symbolic links and 5 MiB text limit; use read method only |
| P1 source selection | `src/main/knowledge/file-selection-service.ts:10-52,112-154` | Supported text extensions, excluded directories, limits; mirror for bounded file discovery |
| P1 references | `src/main/knowledge/knowledge-space-client.ts:109-147,533-563`; `services/api/src/knowledge/service.rs:692-730` | Attempt-scoped ready pinned references, six results, 12,000 total characters |
| P1 task state | `src/main/agent/task-runtime.ts:43-113,159-196,249-259` | Parse → immutable snapshot update → task-update event |
| P1 persistence | `src/main/agent-runtime/encrypted-agent-state-store.ts:83-115,179-230` | Per-owner encrypted history and sequential writes |
| P1 registration | `src/main/knowledge/activity-progress-reporter.ts:1-64` | Maps task lifecycle to Work Session lifecycle; currently suppresses reporting errors |
| P1 dashboard | `services/api/src/classroom/dashboard.rs:87-151,213-234`; `services/api/src/classroom/contracts.rs:319-336` | Latest session query, status projection; currently any latest failed session becomes launch_failed |
| P1 renderer data | `src/renderer/App.tsx:157-170,1037 onward,3055-3130`; `src/renderer/KnowledgeHubPage.tsx:15-67` | Local snapshot cache, sticky session bar, props into Attempt page |
| P1 teacher UI | `src/renderer/FacilitatorRunPage.tsx:88-132,270-292,650-780` | Snapshot/delta polling, explicit review, participant table |
| P2 IPC | `src/main/ipc/register-ipc.ts:930-950`; `src/preload.ts:504-520` | Existing Ready/Review boundary; reuse without granting model access |
| P2 tests | `src/main/application/task-application-service.test.ts:20-83`; `src/main/coach/coach-runtime.test.ts:1-100` | Dependency injection, vi.fn, representative Activity fixtures |
| P2 tests | `src/renderer/ClassroomBroadcastPreview.test.tsx:1 onward` | happy-dom, React createRoot/act, stub DesktopApi, explicit user click assertions |
| P2 tests | `services/api/tests/classroom_e2e.rs:27-28,177-198,260-360,650-660` | Ignored PostgreSQL integration tests and safe local disposable database guard |
| P2 configuration | `package.json`, `vitest.config.mts`, `services/api/BUILD.bazel` | Node >=24.12, Vitest 4/node default, React 19, Zod 4, Rust/Bazel test pipeline |
| P2 logging | `src/index.ts:514-517`; `src/main/coach/coach-runtime.ts:135-142` | Existing component-prefixed operational errors/status timing; do not log captured content |

### Current invariants and gotchas

- `TaskApplicationService` deliberately keeps Coach `executionProfile='everyday'` and `workspace=null`. Do not undo that to give Check filesystem or terminal tools. A separate main-owned reader can accept the already-resolved folder and return bounded evidence.
- `Check` from both existing controls is `requestedMode='coach'`, `screenContext='auto'`. Simply enabling Workspace mode or changing UI labels does not fix the prompt/context gap.
- Ordinary Coach sends little Activity metadata. Full assignment context is currently specially assembled for classroom explanations. Reuse the assignment fields for checks, but do not change the classroom explanation protocol or budgets accidentally.
- The Coach JSON response has both a strict normalized union and a raw nullable-field schema. Update both and `coachDecisionJsonSchema`/`normalizeRawDecision`; changing only TypeScript types is insufficient.
- `prepareDesktopObservation` hides Tro surfaces. Without it, clicking Check can capture Tro's own window rather than the student's app.
- Current-screen observations are partial. Scratch canvas scripts, off-screen code, and PDF pages can be absent even when some accessibility text exists. Absence of an error is not proof that a criterion passed.
- `create_work_session` already records Attempt start and uses `(attempt_id, client_id)` plus an advisory lock. Do not introduce another start table or count window-open events as practice.
- `ready_attempt` rejects no-files Ready when submissions are required. Preserve that branch in both buttons and API tests.
- Hosted prior progress currently derives `passed` criterion IDs from evidence. This plan never inserts check findings there; do not allow those IDs alone to satisfy a fresh check.
- Existing Work Session PATCH does not enforce monotonic terminal transitions. Concurrent active/completed reporting must be ordered and stale updates guarded for reliable Check registration.

## External Documentation

No external research needed — feature uses established internal patterns. No new SDK, VS Code extension API, Scratch parser, OCR library, or model provider is introduced. Reuse the installed model and authenticated Responses transport; no model-version recommendation is part of this plan.

## Patterns to Mirror

### NAMING_CONVENTION

Source: `src/main/knowledge/activity-progress-reporter.ts:6-9`

```ts
export class ActivityProgressReporter {
  private readonly sessions = new Map<string, { workSessionId: string; lastSentAt: number }>();
```

Use kebab-case service/policy filenames, PascalCase classes/types, and camelCase fields. Put pure check aggregation in `work-check-policy.ts`, side effects in `work-check-context-service.ts`.

### ERROR_HANDLING

Source: `src/renderer/AttemptLaunchPage.tsx`, `uploadSubmission` catch block:

```ts
setError(
  cause instanceof Error
    ? cause.message
    : t('Could not submit those files.'),
);
```

Source: `src/main/coach/coach-runtime.ts`, Responses fetch failure:

```ts
throw new CoachModelError(
  'The Coach model outcome is unknown. This request will not be repeated.',
  true,
);
```

Surface bounded errors; never convert a timeout, denial, or unparsable result into a successful check. Do not automatically repeat a dispatched model call.

### LOGGING_PATTERN

Source: `src/index.ts:514-517`

```ts
void cuaService.endTaskSession(taskId).catch((error: unknown) => {
  console.error('[coach] CUA session cleanup failed.', error);
});
```

Keep component-prefixed operational diagnostics. Only log check IDs, phase, timing, and safe error codes; no code snippets, PDF contents, screenshots, raw model payloads, or absolute student paths.

### REPOSITORY_PATTERN

Source: `services/api/src/classroom/assessment.rs:100-107`

```rust
query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
    .bind(format!("review:{attempt_id}:{}", input.client_id))
    .execute(&mut *transaction)
    .await?;
```

Keep PostgreSQL transaction/row-lock authority, bound query arguments, and server-owned transitions. No new database is needed.

### SERVICE_PATTERN

Source: `src/main/knowledge/knowledge-space-client.ts:457-465`

```ts
return this.request(
  `/v1/attempts/${attemptId}/ready`,
  this.json('POST', { clientId }),
  KnowledgeAttemptTransitionSchema,
);
```

Source: `src/main/agent/task-runtime.ts:256-258`

```ts
const next = TaskSnapshotSchema.parse({ ...snapshot, updatedAt: timestamp, lastEvent: event });
```

Use existing DesktopApi/task updates and parsed server clients. No raw IPC/CUA exposure and no extra renderer network client.

### TEST_STRUCTURE

Source: `src/main/application/task-application-service.test.ts:20-48`

```ts
const coachRuntime = {
  cancel: vi.fn(),
  shutdown: vi.fn(async () => undefined),
  start: vi.fn(async (_input: unknown) => { void _input; }),
};
```

Use injected CUA, readers, model decisions, clock, and server client. Tests must assert denied side effects as well as output: Check cannot call ready, submit, review, write, shell, click, or type.

## Strategic Design

### Approach

Extend the existing Coach runtime with a dedicated Check branch rather than using a tool-enabled general agent. Main owns evidence collection; the model only evaluates a bounded packet and returns criterion feedback. Store the sanitized typed result in the existing encrypted TaskSnapshot history. Add operational metadata to the existing dashboard response using current database columns.

### Alternatives considered

- **Automatically finish when the screen looks correct:** rejected because partial evidence and AI uncertainty cannot authorize the student's handoff or teacher confirmation.
- **One click that checks and submits:** rejected for this iteration; it would hide whether the student has reviewed the feedback and what files would be uploaded.
- **Route Check through the writable workspace agent:** rejected; code edits, execution, and submission are unnecessary authority for checking.
- **VS Code extension or Scratch project parser first:** deferred. They can improve coverage later, but are unnecessary to deliver truthful screen/saved-file checks now.
- **Separate assessment database or start lifecycle:** rejected; existing Attempts, Work Sessions, and explicit review actions already represent these events.

### Context packet and bounds

Create `WorkCheckContextService` in main. It receives a binding registered by `TaskApplicationService`: task ID, authoritative Activity, and an optional trusted workspace identity. Never trust an absolute root supplied by the renderer/model.

The prepared packet contains:

- The published Activity title, objective, instructions, criteria, guidance policy, and immutable version ID.
- For `current_surface`: one fresh observation captured through the existing Tro-window hide guard, with semantic text and screenshot when available. Include surface identity and capture time. If no useful work context is available, return an incomplete-context result rather than substituting stale evidence.
- For `workspace`: read-only saved text files from the selected root. Deterministic bounded discovery: maximum depth 10, 200 entries considered, 20 eligible files, 20,000 characters per file, 100,000 file characters total. Mirror the text/code extension allowlist and directory exclusions in `file-selection-service.ts`; skip hidden entries and symbolic links. Do not decode PDFs or `.sb3` as text. Use `WorkspaceEditor.readTextFile`; stat before reading to apply the existing 5 MiB file ceiling before allocation. Compare size/mtime around the read; a changing file is omitted and listed as unavailable. Stop discovery as soon as a bound is met and mark coverage partial, not “no more files”.
- For `none`: no implicit screen or filesystem access. Unless concrete student work is supplied by a future explicit input, explain that the current work could not be verified.
- Up to one bounded `searchKnowledge(attemptId, {query, limit: 6})` call, using a deterministic <=1,000-character query built from the objective and rubric. Respect the existing 12,000-character response limit. Search failures or truncation are disclosed. Reference passages establish requirements, not proof of student output.
- Structured evidence IDs generated by main (`screen-1`, `file-1`, `reference-1` etc.), capture timestamps, file hashes, relative names, and explicit omission flags. Model citations must refer only to these IDs.

These are new centralized policy constants, not scattered magic numbers. Inject smaller limits in tests. No automatic scrolling, tab switching, file edits, program execution, or background recapture is part of a check.

### Result contract and policy

Add schemas to `src/shared/contracts.ts` (or define in new `src/shared/work-check-contracts.ts` and re-export through contracts without a circular import):

```ts
// Design sketch; implementation uses strict Zod schemas at every boundary.
type CriterionCheck = {
  criterionId: string;
  outcome: 'looks_met' | 'needs_work' | 'not_verified';
  explanation: string;
  evidenceIds: string[];
};
type WorkCheckReport = {
  checkId: string;
  taskId: string;
  attemptId: string;
  activityVersionId: string;
  checkedAt: string;
  overall: 'looks_ready' | 'needs_work' | 'incomplete_context';
  criteria: CriterionCheck[];
  summary: string;
  coverage: { kind: 'screen' | 'saved_files' | 'none'; partial: boolean; notes: string[] };
  evidence: Array<{ id: string; kind: 'screen' | 'file' | 'reference'; label: string; capturedAt: string; fingerprint: string | null }>;
};
type WorkCheckProjection = {
  phase: 'checking' | 'checked' | 'failed' | 'cancelled' | 'unknown';
  report: WorkCheckReport | null;
  message: string | null;
};
```

Bounds: <=40 criteria, <=600 chars explanation per criterion, <=8 evidence IDs per criterion, <=1,200-char summary, <=27 evidence descriptors, <=20 coverage notes of <=240 chars. No screenshots or file contents in the persisted report. Labels contain app/title or relative paths only; cap at 255 chars. Host IDs/timestamps are attached after validating the model response, not generated by the model.

Add optional/default-null `workCheck` to `TaskSnapshotSchema` for old-history compatibility. Add optional/default-null `workSessionSync` (`pending | synced | unknown`) if reporting status is exposed in the card. Maintain snapshot-to-task/Attempt binding validation.

Pure `work-check-policy.ts` must:

1. Validate criterion IDs against the published definition; reject duplicates, unknown criteria, and invalid citations. Fill omitted published criteria with `not_verified`.
2. Never accept `looks_met`/`needs_work` without a citation to actual student-work evidence. A reference passage alone is insufficient.
3. Compute overall deterministically: any `needs_work` → `needs_work`; otherwise any unverified criterion, absent criteria, omitted required context, or partial coverage → `incomplete_context`; otherwise → `looks_ready`.
4. Treat no criteria as “No checklist was provided”; do not infer and publish a pass.
5. Return check feedback only. No Attempt transitions, official criterion passes, or model-driven calls to Ready/Submit/Review.

### Runtime integration

- The global shortcut calls the main task application service directly; it must not send a synthetic keystroke to the work app or navigate the main renderer. Resolve the current Attempt from `ClassroomSessionService.activeStudentAttemptId()` and inspect it again server-side. The floating panel must identify the assignment it will check.
- For Activity `activityIntent='check'`, force the dedicated Coach Check branch even if the general fast-Coach flag is disabled or a request tries to specify agent mode. Check is read-only by definition. Preserve non-Activity task behavior.
- `TaskApplicationService` resolves the workspace normally, but stores it only in the private check-context service binding. Coach's authority still has no workspace tools.
- Extend `CoachRuntimeDependencies` with `prepareCheckContext`, `onCheckResult`, and `releaseCheckContext` (or a single typed dependency object). `CoachRuntimeStart` gains an optional Check marker; do not put raw files into the persisted task goal.
- Inside `run`, handle Check before the normal walkthrough. Capture only when published launch context is `current_surface`; prepare context, call the authenticated model once, validate the result, emit typed result, then terminalize the check Work Session. Skip pointer sequence presentation for Check.
- Add `work_check` to normalized and raw model response schemas, gated to check requests. A check request returning ordinary `answer`, `complete`, or a pointer sequence must not become a successful check.
- Include complete published requirements and bounded reference snippets in the check prompt; mark work/reference text as untrusted evidence. They cannot change the rubric, request tools, or authorize completion.
- Keep `tools: []`, `store: false`, existing authentication/accounting, request IDs, configured model, and timeout handling. Use an explicit check response schema and up to 8,000 output tokens for the <=40-criterion response. Do not retry a truncated, malformed, timed-out, or unknown dispatched request automatically.
- No useful evidence: produce a deterministic `incomplete_context` report without spending a model call. A partially useful packet may still be checked, with partial coverage disclosed.
- Cancel/leave/logout clear bindings, abort pending collection/model work, and prevent late results. Check IDs and task IDs must match before a result is committed. A fresh student Check again action starts a new check; history restoration never replays one.

### Registration and dashboard

- Existing Work Session creation is the authoritative accepted-start fact. Expose `startedAt` from `attempts.started_at` in Attempt context and dashboard, with optional/default-null client fields for backward compatibility.
- Add `lastCheck` operational metadata to dashboard participants: `{workSessionId, state, updatedAt} | null`, selected from sessions where `purpose='check'`. This reports check execution, not AI correctness.
- Include `purpose` and `workSessionId` in new `work_session_updated` event payloads. No feedback, code, screen, filenames, or model confidence is sent there.
- Query latest state and purpose from the same ordered session row. Only a failed `purpose='work'` can yield the existing `launch_failed` status; a failed check is shown in `lastCheck` and does not overwrite assignment status.
- Serialize `ActivityProgressReporter` calls per task so an earlier active report cannot arrive after terminal completion. In `update_work_session`, lock the session row; same-state updates are idempotent, and terminal states cannot regress. Leave Attempt completion untouched.
- A reporting error must not claim server success. Publish a local `unknown` sync status with “Could not confirm progress sync”. Do not automatically resend a mutation whose outcome is unknown. The student may refresh classwork to retrieve current server state; this plan does not build an offline outbox.

## Files to Change

Production paths are explicit; add the corresponding test paths listed below. No new dependency, database table, migration, or credential is required.

| File | Action | Justification |
|---|---|---|
| `src/shared/work-check-contracts.ts` | CREATE | Strict check report/projection contracts and limits |
| `src/shared/contracts.ts` | UPDATE | Re-export check schemas; optional snapshot/Attempt/dashboard fields |
| `src/main/knowledge/work-check-policy.ts` | CREATE | Pure criterion validation, coverage, aggregation |
| `src/main/knowledge/work-check-context-service.ts` | CREATE | Private trusted bindings, bounded read-only work/reference collection |
| `src/main/application/task-request-router.ts` | UPDATE | Enforce read-only Activity Check routing |
| `src/main/application/task-application-service.ts` | UPDATE | Bind trusted check context; Check marker; cleanup and no general-agent bypass |
| `src/main/coach/coach-contracts.ts` | UPDATE | Check runtime input and typed model result |
| `src/main/coach/coach-runtime.ts` | UPDATE | Dedicated Check branch, response schemas, validation, prompt, lifecycle |
| `src/main/agent/task-runtime.ts` | UPDATE | Immutable typed result/sync updates and binding guards |
| `src/main/knowledge/activity-progress-reporter.ts` | UPDATE | Ordered lifecycle reports and observable sync failures |
| `src/index.ts` | UPDATE | Context service injection, observation guard, result/sync callbacks |
| `src/renderer/WorkCheckResultCard.tsx` | CREATE | Accessible private feedback and coverage card |
| `src/renderer/work-check-view.ts` | CREATE | Pure latest-result selection and state labels |
| `src/renderer/App.tsx` | UPDATE | Pass local result snapshots to classwork; show card for active check |
| `src/renderer/KnowledgeHubPage.tsx` | UPDATE | Pass matching Attempt check projection to launch page |
| `src/renderer/AttemptLaunchPage.tsx` | UPDATE | Check card, start time, recheck and unified review handoff |
| `src/renderer/ClassroomSessionBar.tsx` | UPDATE | Same Check intent as secondary main-window control; consistent review labels |
| `src/renderer/FacilitatorRunPage.tsx` | UPDATE | Start and check operational status, without AI assessment disclosure |
| `src/renderer/app-language.ts` | UPDATE | English/Vietnamese student-facing terms |
| `src/index.css` | UPDATE | Existing card/button tokens, responsive and visible focus styles |
| `services/api/src/http/knowledge.rs` | UPDATE | Attempt startedAt, work-session purpose events, monotonic terminal updates |
| `services/api/src/classroom/contracts.rs` | UPDATE | Additive dashboard startedAt/lastCheck fields |
| `services/api/src/classroom/dashboard.rs` | UPDATE | Query/check-purpose-aware operational projection |
| `docs/knowledge-spaces.md` | UPDATE | Describe student checking, coverage and review boundaries |

Tests to create/update: `src/shared/contracts.test.ts`, `src/main/knowledge/work-check-policy.test.ts` (new), `src/main/knowledge/work-check-context-service.test.ts` (new), `src/main/application/task-request-router.test.ts`, `src/main/application/task-application-service.test.ts`, `src/main/coach/coach-runtime.test.ts`, `src/main/agent/task-runtime.test.ts`, `src/main/agent-runtime/encrypted-agent-state-store.test.ts`, `src/main/knowledge/activity-progress-reporter.test.ts`, `src/renderer/WorkCheckResultCard.test.tsx` (new), `src/renderer/work-check-view.test.ts` (new), `src/renderer/AttemptLaunchPage.test.tsx` (new), and `services/api/tests/classroom_e2e.rs`. Extend inline tests in `dashboard.rs`. Add a focused sticky-bar test if its handler behavior changes beyond labels. Existing companion preload/IPC channels are extended with strictly typed check actions; no generic IPC or raw CUA function is introduced.

## Shortcut and Floating-Panel Implementation

This is the primary interaction, following the user’s clarification. Main-window screenshots and buttons alone do not satisfy this plan.

### Shortcut behavior

- Create `src/main/companion/global-work-check-shortcut.ts` mirroring the injectable registry and disposer in `src/main/voice/global-voice-shortcut.ts:85-125`. Use `CommandOrControl+Alt+K`; this does not duplicate the inspected Tro voice defaults (`Command+\` / `Control+\`, Windows `Control+Alt+Space`). This is not a guarantee of availability in every OS/app configuration.
- Register through Electron’s existing `globalShortcut` after app readiness. Register only for a signed-in student with an eligible active assignment; unregister on logout, leaving the class, assignment/run ineligibility, and shutdown. The registration callback invokes a main service, independent of whether the main renderer is visible/focused.
- Check registration’s boolean result and catch exceptions. Never claim the key works if registration failed. Display “Check shortcut unavailable — use Tro’s Check button” in the floating companion. Custom remapping is deferred; no silent replacement of someone else’s registered shortcut.
- Debounce duplicate events and keep an in-flight latch until the check ends. Repeated shortcut events while collecting/checking show the existing progress panel; they cannot create extra Work Sessions or paid requests, and cannot cancel or replace unrelated work.
- Tro must already be running in the background. Initial sign-in/class enrollment/system permission setup is a precondition, not something the shortcut silently bypasses. The ongoing start/check/recheck/review practice loop does not open or focus the main window.
- On missing or stale assignment, show a floating status and refresh/choose from authorized active assignments. Never guess the assignment from the foreground app’s title or read an unrelated task. For this iteration, global Check is enabled only for the authoritative current classroom Attempt; general out-of-class shortcut checking is deferred.
- `activeStudentAttemptId()` currently does not exclude `ready_for_review`; inspect and reject that state consistently with locked student work controls. Do not create a check for ready/submitted/completed/withdrawn work until the teacher returns it.
- If a trusted folder is missing for a Workspace Activity, a floating Choose folder action calls `WorkspaceSelectionService.select()` through main, using a native dialog that does not reveal the main window. Store the opaque selection binding per owner/Attempt/version; never grant a different assignment its old folder automatically.

### Floating result and action boundary

- Reuse `CompanionResponseController` (`src/main/companion/companion-response-controller.ts`) and `showCompanionResponseCard` (`src/index.ts:1287-1328`), which already uses `guidanceWindow.showInactive()`. Capture/bind the underlying work app before any panel can take focus. Use the existing desktop observation guard to exclude Tro overlays from evidence.
- Extend `CompanionResponseCardSchema` with optional typed `workCheck` and an optional submission-preview projection containing only relative names/byte counts. Keep old response cards valid. Render `WorkCheckResultCard` inside `src/renderer/CompanionResponseCard.tsx`, reached through `src/renderer/GuidanceCallout.tsx`; adapt to the existing small callout dimensions with bounded scrolling/expand behavior that never launches the main window.
- Add only typed actions needed for this flow to `CompanionResponseActionSchema`: `start_assignment`, `check_again`, `choose_check_workspace`, `send_for_review`, `choose_submission_files`, and `confirm_submit_files`. Carry cardId/taskId only and resolve the associated trusted Attempt, folder and selection in main. For pre-check context/setup cards use a main-generated correlation UUID and a private card binding; do not create a fake model Work Session merely to display a setup notice.
- Refactor `handleCompanionResponseAction` in `src/index.ts:2073 onward` to delegate these actions to new `src/main/companion/assignment-check-controller.ts`. It revalidates current owner, card identity, Attempt, immutable version, server state, pending operations and any selected files immediately before mutation. No action may use `open_task`, `revealWindow(mainWindow)`, or main-page navigation.
- Use existing authenticated companion action IPC in `src/main/ipc/register-ipc.ts:1041-1047`, `src/shared/desktop-api.ts:473`, and `src/preload.ts:985` with schema validation. Do not expose main-window-only upload APIs wholesale to the overlay.
- No-files review calls `KnowledgeSpaceClient.readyAttempt`. Files-required review calls `FileSelectionService.select({role:'submission',selectionKind:'files'})`, shows its reviewed preview in the overlay, and only `confirm_submit_files` calls `KnowledgeUploadOrchestrator.submit(attemptId, selectionId)`. Keep the existing hash/change validation and unknown-outcome behavior. Cancelled native selection changes no server state.
- Check result cards must not install the existing global **bare 1–4** response-action shortcuts. Those would consume digits while a student types in VS Code/Scratch. In `activateGlobalCompanionResponseShortcuts`, skip numbered registration for Check cards and deactivate prior response shortcuts when a Check card takes over. Keep focused-panel keyboard navigation normal. The checking chord never submits; only an explicit review action does.
- Reuse `dismiss`, normal focus navigation, and an explicit Stop button. Do not globally capture ordinary letters, digits, Enter or Escape as check/submission actions while the work app is focused.

### Additional mandatory source patterns

| Source | Pattern |
|---|---|
| `src/main/voice/global-voice-shortcut.ts:9-12,85-125` | Current Tro accelerators, injectable registry, repeat guard, failed registration and unregister-only-owned behavior |
| `src/main/companion/global-numbered-choice-shortcuts.ts:35-91` | Scoped callbacks and cleanup; do not reuse bare-number accelerators for work-check cards |
| `src/main/knowledge/classroom-session-service.ts:20-41,75 onward` | Main-owned eligible Attempt and current state; revalidate ready status |
| `src/main/companion/companion-response-controller.ts:15-99` | Response projection, mode precedence and per-task suppression |
| `src/index.ts:1287-1328,2073 onward,2204-2305` | showInactive, typed action dispatch, response shortcut activation |
| `src/shared/contracts.ts:1977-2012` | Strict response and action schemas; require coordinated backward-compatible extension |
| `src/renderer/GuidanceCallout.tsx:258-276,432-438` | Existing companion action IPC and response rendering |
| `src/main/knowledge/knowledge-upload-service.ts:57-69` | Existing explicit submit service; preview and upload remain separate actions |

### Additional files for primary shortcut interaction

| File | Action | Justification |
|---|---|---|
| `src/main/companion/global-work-check-shortcut.ts` | CREATE | Testable registration/debounce/disposal of the check accelerator |
| `src/main/companion/assignment-check-controller.ts` | CREATE | Main-owned assignment/folder/card binding and overlay actions |
| `src/main/companion/companion-response-controller.ts` | UPDATE | Typed check results and setup/preview cards |
| `src/renderer/CompanionResponseCard.tsx` | UPDATE | Floating check content and actions, no main-window navigation |
| `src/renderer/GuidanceCallout.tsx` | UPDATE | Typed floating actions and bounded check layout |
| `src/shared/desktop-api.ts` | UPDATE | Typed companion API as needed, no generic authority |
| `src/preload.ts` | UPDATE | Validate extended companion response/action contracts |
| `src/main/ipc/register-ipc.ts` | UPDATE | Delegate authenticated typed companion actions |

Also extend the existing `src/index.ts`, `src/shared/contracts.ts`, `src/index.css`, language and documentation changes already listed. Add `global-work-check-shortcut.test.ts` and `assignment-check-controller.test.ts` beside the new main modules; extend `companion-response-controller.test.ts`, `global-numbered-choice-shortcuts.test.ts`, `src/renderer/companion-response-card-view.test.ts`, and IPC tests for stale/forged card actions.

## NOT Building

- Automatic assignment completion, grading, or inferred attention/productivity.
- Continuous screen recording, keystroke capture, automatic scrolling, or app manipulation.
- VS Code extension access to unsaved buffers; full Scratch `.sb3` parsing.
- OCR of scanned PDFs or guaranteed full-document visual understanding.
- Automatic execution of student code or test commands.
- Automatic submission of screenshots, project folders, or check findings to the teacher.
- New attendance/start database, replacement task runtime, or offline replay/outbox subsystem.

## Step-by-Step Tasks

### Milestone A — Define truthful checks and context

### Task 1: Define contracts and deterministic check policy

- **ACTION:** Add report/projection schemas and pure result normalization.
- **IMPLEMENT:** Use the result design above; centralize bounds; nullable-default snapshot extension; criterion/evidence ID validation; deterministic overall. Add backward-compatible `startedAt` and `lastCheck` response fields without changing existing state enums.
- **MIRROR:** `TaskSnapshotSchema` binding refinements and `CoachDecisionSchema.strict()`; existing pure `task-request-router.ts`.
- **IMPORTS:** `z` from `zod`; Activity types from `../../shared/contracts` in policy; shared check file must not import the contracts file it is re-exported through.
- **GOTCHA:** Never equate existing `completedCriterionIds` or a reference snippet with verified current student work. Zero criteria cannot mean all passed.
- **VALIDATE:** Unit cases in Testing Strategy; old snapshots and old dashboard responses parse unchanged.

### Task 2: Prepare bounded work and reference evidence

- **ACTION:** Create `WorkCheckContextService` with private `bind`, `prepare`, and `release` methods.
- **IMPLEMENT:** Inject a `Pick<KnowledgeSpaceClient, 'searchKnowledge'>`, file reader/discovery, and clock. Bind authoritative Activity and resolved workspace in main. Gather screen or saved-file evidence under declared limits, plus ready pinned reference excerpts. Generate evidence IDs and coverage notes. Drop raw packets after check completion/cancellation. Revalidate Attempt/version before publishing a late result.
- **MIRROR:** Trusted workspace selection, `WorkspaceEditor.readTextFile`, file selection exclusions, `createActivityToolAdapters` search handling.
- **IMPORTS:** `node:crypto` for hashes; `node:fs/promises` for bounded enumeration/stat; `node:path`; `WorkspaceEditor` from `../agent/workspace-device-adapters`; `DesktopObservation` from `../agent/execution-contracts`; shared check contracts; `KnowledgeSpaceClient` from `./knowledge-space-client`.
- **GOTCHA:** Reading a PDF viewer is partial screen evidence; imported PDF text is reference context. No `.sb3` or arbitrary binary text decoding. Any discovery/read cap or race must be visible, not silently ignored.
- **VALIDATE:** Temp-directory tests for exclusions, symlinks, path escapes, file changes, caps and cancellation; fake search returns pinned excerpts and exact truncation; no filesystem write or shell dependency exists.

### Task 3: Route Check without granting execution authority

- **ACTION:** Add an explicit Activity Check route and bind the selected workspace for reading only.
- **IMPLEMENT:** In `submitOrdinary`, after authoritative Attempt lookup and workspace resolution, mark Check and force Coach regardless of general fast-Coach flag. Create Work Session with `purpose='check'` through existing context service. Bind check evidence before starting Coach; clean up on every exception/finish/cancel. Start and Help retain existing behavior. Observe only current-screen checks; workspace checks use saved files.
- **MIRROR:** Existing classroom explanation `reserve/release` discipline and ordinary `submitOrdinary` cleanup.
- **IMPORTS:** WorkCheckContextService type from `../knowledge/work-check-context-service`; typed Check marker through `CoachRuntimeStart`.
- **GOTCHA:** Do not restore Coach workspace execution authority, expose root paths to renderer, or dispatch local agent tools for a check. A student text asking “fix it” with check intent must not convert Check into an edit task.
- **VALIDATE:** Task application tests verify exactly one accepted Work Session per launch; no local-agent dispatch; no workspace authority in Coach goal; disabled fast-Coach still gives safe Check; other modes unchanged.

### Milestone B — Execute and present the check

### Task 4: Wire the global shortcut and floating assignment controller

- **ACTION:** Implement the primary entry point while the student’s work app stays foreground.
- **IMPLEMENT:** Build the two main modules specified in Shortcut and Floating-Panel Implementation. Register the proposed accelerator using an injected registry/clock and exact disposer; route through the authoritative classroom Attempt and existing task application service. Capture the work target before showing feedback. Use showInactive and typed companion actions for folder selection, recheck and review, with no main-window reveal. Keep start registration tied to accepted Work Session creation, not shortcut registration or setup-card display.
- **MIRROR:** `registerGlobalVoiceModeToggleShortcut`, `CompanionResponseController`, current response-action validation and the desktop observation guard.
- **IMPORTS:** `globalShortcut` stays in the composition root; inject its registry into `./main/companion/global-work-check-shortcut`. Controller dependencies are narrow Picks of TaskApplicationService, ClassroomSessionService, KnowledgeSpaceClient, WorkspaceSelectionService, FileSelectionService and KnowledgeUploadOrchestrator; use shared response/action schemas.
- **GOTCHA:** Do not forward the key through a focused main renderer. Do not activate global bare-number shortcuts for Check cards. Ready is not an eligible state just because `activeStudentAttemptId()` returns it. New setup cards need trusted owner/Attempt binding without creating a paid task.
- **VALIDATE:** Hidden/minimized main-window test spies assert zero show/focus/navigation calls; correct current Attempt; a burst of shortcut events yields one task; occupied shortcut reports failure; cleanup unregisters only owned keys; no digit/Enter/Escape capture; forged/stale overlay action denied.

### Task 5: Implement dedicated read-only Coach checks

- **ACTION:** Extend runtime input/output and add a Check branch before ordinary walkthrough behavior.
- **IMPLEMENT:** Wire preparation and one fresh guarded observation when required; deterministic incomplete-context report when unusable; otherwise call existing authenticated transport once with full published rubric and evidence. Extend normalized/raw/JSON response schemas. Validate identifiers/evidence, compute overall in main, emit result, finish Work Session. Keep explanation branch unchanged. Clear service binding and observation session on all exits.
- **MIRROR:** Existing `run`, `CoachModelError`, `createAuthenticatedCoachDecisionClient`, and `prepareDesktopObservation`.
- **IMPORTS:** Shared check schema/types and `work-check-policy`; context service dependency types. Keep HTTP/auth imports and installed model unchanged.
- **GOTCHA:** The model must not provide host identifiers/timestamps or completion authorization. A model `complete` response in Check mode is invalid. No automatic re-request after network uncertainty or invalid response.
- **VALIDATE:** Fake model/CUA tests inspect complete request payload, `tools=[]`, one model call, no pointer actions, cancellation/timeout, missing evidence, wrong criterion IDs, and no calls to submission/review functions.

### Task 6: Persist local typed results and display one consistent card

- **ACTION:** Add immutable snapshot update methods and student result rendering.
- **IMPLEMENT:** `TaskRuntime.updateWorkCheck` validates task/Attempt/version before commit. Existing task-update subscriptions persist sanitized reports. Add pure `latestCheckForAttempt` helper that filters version and owner-scoped snapshots, sorts by check time, and never treats an older check as current after a new one starts. Pass the matching projection from App through KnowledgeHubPage to AttemptLaunchPage; also render for the active Check task. Render the same card primarily in the floating companion, with coverage text, criterion rows, recheck, Keep working, and explicit review handoff. Main classwork may mirror it but is not required. Do not expose Open task or Open classwork as a required step. Preserve old-history parsing.
- **MIRROR:** `updateCoachProgress`, encrypted snapshot persistence, App snapshot cache and `ClassroomBroadcastPreview` action handling.
- **IMPORTS:** Shared report/projection types; React hooks only where required; `translate` from `./app-language`; `WorkCheckResultCard`/`work-check-view` in renderer.
- **GOTCHA:** Store no raw screenshot/file packet. The card should show a timestamp and “Earlier check” rather than claim to detect edits while Tro is not observing. Recheck is a new explicit request. Do not generate a Ready call inside result-rendering effects.
- **VALIDATE:** Snapshot round-trip across restart and owner separation; late result after cancellation rejected; happy-dom click tests prove the model result alone never submits; old result hidden while new check runs; keyboard focus and non-color status labels.

### Task 7: Unify review handoff and visible registration

- **ACTION:** Make the student finish action clear while reusing existing mutations.
- **IMPLEMENT:** Label the finish action Send for teacher review. For no-files activities, call existing Ready only on click. For file-required activities, invoke the native picker and show the selection preview in the floating companion, then retain a separate explicit Submit files action backed by the existing upload service. The optional main-window section may keep its current behavior. Show Waiting for teacher review only after confirmed server response. Refresh authoritative Attempt context after launch/handoff and on classroom state updates so registered start/teacher return/completion appears in the floating panel without opening classwork. Keep review available without an AI pass, with an earlier check labelled advisory.
- **MIRROR:** `markReady`, `uploadSubmission`, `ClassroomSessionBar.launch`, teacher `review` in FacilitatorRunPage.
- **IMPORTS:** Existing `KnowledgeAttemptTransition` and `HostedAttemptContext`; no new mutation tool/API.
- **GOTCHA:** Submitted and ready Attempts already lock work controls in the renderer. Do not use a completed Check snapshot to unlock or complete them. Preserve existing run-state and insight-policy gates.
- **VALIDATE:** Student Ready versus required-file branch; no silent uploads; failed/unknown server response leaves state unconfirmed; teacher Return restores Continue working; teacher Complete ends assignment.

### Milestone C — Register operational checks correctly and verify end to end

### Task 8: Expose start/check facts and order session reports

- **ACTION:** Improve existing operational registration without storing check findings server-side.
- **IMPLEMENT:** Add `startedAt` to Attempt and participant JSON. Add `lastCheck` from the latest purpose=check row, stable ordered by updated_at/id. Include session purpose/ID in update events. Serialize progress reports per task, preserve terminal status, expose unknown sync status through existing snapshot updates. Add server row lock and terminal-regression guard to session PATCH. Dashboard failure projection uses latest session purpose; check failure does not become work launch failure. Render operational labels in teacher table; no new grading column.
- **MIRROR:** `assessment.rs` transactions, existing create session idempotency, dashboard snapshot/delta refresh, `ActivityProgressReporter` tests.
- **IMPORTS:** Existing `query`/`Row`/`ApiError` and timestamp serializers in Rust; shared snapshot schemas and reporter callback types in TypeScript.
- **GOTCHA:** Query latest state and purpose from the same row. Preserve participant/run access controls and event payload size. Do not call unknown PATCH again automatically. Default-null fields must not falsely claim a start on older servers.
- **VALIDATE:** Concurrent queued active/terminal reports stay ordered; repeated same terminal report produces no regression; stale active rejected/no-op without duplicate events; check failure leaves Attempt in progress; old responses parse; raw model content absent from API/event payloads.

### Task 9: Add lifecycle and integration coverage

- **ACTION:** Extend current Vitest and PostgreSQL tests for the complete student flow.
- **IMPLEMENT:** Cover accepted start, successful/partial/failed check, unchanged Attempt state after Check, Ready, required-file submission, facilitator Complete/Return, cross-account denial, closed Run, and unknown outcomes. Integration model/CUA responses are fakes; no paid model calls or remote students are involved.
- **MIRROR:** Existing classroom_e2e helpers and local `_test` database guard; renderer happy-dom click tests; injected runtime fixtures.
- **IMPORTS:** Existing test helpers, `vi`, `describe`, `it`, `expect`, `createRoot`, `act`; no testing framework addition.
- **GOTCHA:** PostgreSQL classroom tests are `#[ignore]`; ordinary npm test does not prove the integration flow ran. Execute them explicitly against a disposable local test database.
- **VALIDATE:** Commands below; assert exact Attempt state at every stage and ensure the check result remains local under both insight policies.

### Task 10: Document, package, and manually verify

- **ACTION:** Update user-facing docs and run required repository gates.
- **IMPLEMENT:** Document screen/file/reference differences and exact recording semantics. Verify macOS permission-denied and current-window scenarios in the packaged app, using small synthetic student projects. Confirm the teacher sees start/check/ready/completed as separate facts.
- **MIRROR:** `docs/knowledge-spaces.md` terminology and English/Vietnamese UI vocabulary.
- **IMPORTS:** None.
- **GOTCHA:** `npm run package` uses the existing Doppler `prd` configuration for packaging; it does not authorize publishing. Do not run `publish`, push, or deploy as part of this plan.
- **VALIDATE:** All required gates; no broken old histories, no raw evidence in teacher dashboard or diagnostics, no automatic completion.

## Testing Strategy

| Test | Input | Expected output | Edge case? |
|---|---|---|---|
| Global shortcut | Eligible assignment, main window hidden | One check; work app retains focus; floating result | No |
| Shortcut unavailable | Registry returns false | Visible floating fallback; no claimed active shortcut | Yes |
| Shortcut repeat | Repeated events while check in flight | No extra task/model calls | Yes |
| Typing beneath bubble | Digits/Enter in work app | No captured numeric shortcut or accidental review | Yes |
| Accepted start | Assigned Attempt, open Run, Start working | One created session; startedAt set; in_progress | No |
| Open only | Open assignment/app without Start | No new Work Session | Yes |
| Duplicate start | Same client ID twice | Existing session, no duplicate accepted-start event | Yes |
| All criteria evidenced | Each criterion looks_met with student evidence | Advisory looks_ready; Attempt still in_progress | No |
| Needs work | At least one evidenced failure | needs_work and concrete next step | No |
| Hidden Scratch script | Only one sprite visible | Missing criterion not_verified; partial coverage | Yes |
| VS Code visible only | Screen with partial source/output | References visible evidence only; no hidden-file claims | Yes |
| Saved workspace | Selected canonical folder with supported text | Saved-file captions and relative file references | No |
| Unsaved changes | Editor differs from saved file | Saved-file scope disclosed; no assertion of buffer content | Yes |
| No screen permission | Current-screen check denied | Incomplete context; no grade, upload or completion | Yes |
| No criteria | Empty published criteria | Cannot claim all criteria met; explanatory result | Yes |
| Bad model result | Unknown/duplicate criterion or citation | Rejected/unverified; never successful pass | Yes |
| Reference-only proof | Citation only to PDF rubric | Criterion not_verified | Yes |
| Truncated context | More files/pages than captured | Partial coverage displayed; overall not looks_ready | Yes |
| Escaping file | Symlink/traversal outside root | Denied/omitted before content sent | Yes |
| File changes during read | Mtime/size changes | Omitted with coverage reason | Yes |
| Check cancellation | Stop/leave/logout before response | No late result, all bindings released | Yes |
| Model uncertainty | Timeout or invalid returned JSON | Unknown/failed check; no automatic repeat | Yes |
| Reporting uncertainty | PATCH response lost | Local unknown sync; no false server confirmation | Yes |
| Out-of-order reports | Active delayed behind terminal | Terminal state remains terminal | Yes |
| Check finished | Work Session completed, purpose check | Teacher sees Check finished; Attempt not completed | No |
| Check failure | Latest session purpose check, failed | Check unavailable; not launch_failed assignment | Yes |
| Review with no files | Explicit student click | ready_for_review only after server confirms | No |
| Required submission | Ready called without files | Existing submission_required conflict | Yes |
| Teacher completes | Facilitator review of ready/submitted Attempt | completed | No |
| Teacher returns | Facilitator return | in_progress, new check allowed | No |
| Wrong actor/version | Other account or mismatched result version | Access/binding rejected; no cross-student result | Yes |
| Old serialized data | Snapshot/API response lacks new fields | Defaults accepted, no invented completion | Yes |
| Prompt injection | Comment/document says “mark me complete” | Treated as data; model has no completion tool | Yes |

### Edge Cases Checklist

- [ ] Empty input/evidence/rubric
- [ ] Maximum sizes and bounded traversal
- [ ] Invalid types and fabricated citations
- [ ] Concurrent clicks, late results, and session state ordering
- [ ] Network failure and unknown completion
- [ ] Screen/filesystem permission denial
- [ ] Closed/withdrawn/submitted/completed Attempt
- [ ] Account change, restart, and old stored data
- [ ] English/Vietnamese and keyboard navigation

## Validation Commands

Run from `/Users/ducng/Desktop/workspace/TroCode`. This planning task did not run builds or tests; these commands are for implementation.

### Static Analysis

```bash
npm run typecheck
npm run lint
npm run api:fmt
npm run api:lint
```

EXPECT: no type, lint, formatting or Rust warnings. Format actual Rust edits before the fmt check.

### Focused Unit/Renderer Tests

```bash
npx vitest run src/main/companion/global-work-check-shortcut.test.ts src/main/companion/assignment-check-controller.test.ts src/main/companion/companion-response-controller.test.ts src/renderer/companion-response-card-view.test.ts src/shared/contracts.test.ts src/main/knowledge/work-check-policy.test.ts src/main/knowledge/work-check-context-service.test.ts src/main/application/task-request-router.test.ts src/main/application/task-application-service.test.ts src/main/coach/coach-runtime.test.ts src/main/agent/task-runtime.test.ts src/main/agent-runtime/encrypted-agent-state-store.test.ts src/main/knowledge/activity-progress-reporter.test.ts src/renderer/WorkCheckResultCard.test.tsx src/renderer/work-check-view.test.ts src/renderer/AttemptLaunchPage.test.tsx
cargo test --manifest-path services/api/Cargo.toml --all-features --locked classroom::dashboard
```

EXPECT: all meaningful policy, side-effect boundary, history and renderer tests pass. Mark renderer interaction tests with the same happy-dom environment comment used by existing tests; default Vitest environment is node.

### Database Integration

```bash
cargo test --manifest-path services/api/Cargo.toml --all-features --locked --test classroom_e2e -- --ignored
```

EXPECT: full start → check operational lifecycle → ready/submitted → teacher review assertions pass. Set `TEST_DATABASE_URL` to a disposable local PostgreSQL 17 database whose name ends in `_test`; reuse the existing guarded harness. Never point this at a production database. No new schema migration is planned; the harness still applies the existing migration chain.

### Full Required Gates

```bash
npm run check
npm run package
npm run bazel:check
```

EXPECT: all required repository gates pass. `check` includes the full unit/Rust suites, SDK checks and audits; Bazel is required because Rust handlers/dashboard code change. If committing, also run `npm audit` as required by the contributor supplement and report findings accurately. Do not broaden unrelated fixes into this feature without a concrete need.

### Manual Desktop Validation

```bash
npm start
```

EXPECT: development app starts with the existing configured local services. This is an Electron flow; browser-only screenshots cannot prove permission, active-window capture, or folder authority works.

- [ ] Teacher prepares one Current screen Activity with three concrete criteria, and one Workspace Activity; use synthetic work only.
- [ ] Student opens assignment without starting: teacher does not receive a new practice start.
- [ ] Student starts: server start is visible once.
- [ ] With Tro running and its main window hidden/minimized, VS Code stays foreground: press ⌘⌥K / Ctrl+Alt+K. One check starts, captures that app and presents a floating result without opening/focusing Tro’s main window.
- [ ] Repeat/hold shortcut while checking: one task only. A registration conflict shows a floating fallback instead of silently failing.
- [ ] Type digits and Enter in VS Code with a result bubble visible: normal editor input works; no accidental submit.
- [ ] Complete recheck and review (including native file picker + floating preview when needed) without opening the main window.
- [ ] Scratch with one hidden script: Tro does not claim it checked hidden code.
- [ ] Screen permission denied: clear unavailable/incomplete-context result; manual review handoff still available.
- [ ] Workspace selected with saved/unsaved difference: card identifies saved file scope.
- [ ] PDF reference pinned and Ready: passages may support rubric explanation; no claim all unseen pages were read.
- [ ] Check finishes: student gets feedback, teacher sees operational check event, assignment is not complete.
- [ ] Student explicitly sends review; required files use existing preview and Submit flow.
- [ ] Teacher Return then Complete updates student state correctly.
- [ ] Cancel, restart, and simulated network uncertainty never repeat the model call or falsely submit.

## Acceptance Criteria

- [ ] A successful existing Start working action records and displays the server start; opening an app alone does not.
- [ ] The global shortcut and floating Check button are primary; any main-window Check controls use the same read-only service. The main window remains hidden throughout the practice check/recheck/review loop.
- [ ] The check includes published instructions and criteria plus bounded available work/reference evidence.
- [ ] Hidden/unreadable/omitted context is explicit; unsupported whole-project/document access is never claimed.
- [ ] Feedback is typed, cited to captured evidence, saved locally, and restorable without model replay.
- [ ] Check completion cannot call Ready, Submit, Review, or mutate official completion.
- [ ] Student explicitly sends for review; teacher explicitly completes or returns.
- [ ] Teacher sees only approved operational start/check/review facts by default.
- [ ] No late/cross-account/cross-version result can overwrite the current check.
- [ ] Type/lint/test/package/Bazel gates and ignored database integration suite pass.

## Completion Checklist

- [ ] Matches existing schema, service, error and encrypted-state conventions.
- [ ] Tests assert behavior and forbidden side effects, not implementation spelling.
- [ ] No raw CUA/IPC exposed to renderer and no new model execution tools.
- [ ] Limits centralized; complete coverage never inferred from truncation.
- [ ] Documentation and English/Vietnamese copy updated.
- [ ] No new dependency, credentials, migration, publication, or unrelated edits.
- [ ] Plan's three milestones finished in dependency order; no feature claimed complete after only UI changes.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Partial screen looks like full project knowledge | High | Misleading feedback | Visible scope, coverage flags, per-criterion evidence, not_verified outcome |
| Coach prompt ignores published requirements | Medium | Incorrect advice | Dedicated Check prompt plus payload assertions against exact Activity version |
| New reader accidentally grants writable authority | Low | Student work altered | Private main reader, tools=[], no workspace authority in Coach goal |
| Late model/report response overwrites newer state | Medium | Wrong registration/result | Task/check/version bindings, abort guards, serialized reports and terminal guards |
| Student sees task completion as assignment completion | High | Premature handoff | Separate Check finished / Waiting for review / Completed labels |
| Existing response/history compatibility | Medium | Older clients/history break | Optional additive fields, default null, schema round-trip tests |
| Model findings leak to teacher under default policy | Low | Unexpected disclosure | Local report only; hosted check metadata restricted to lifecycle |
| Unknown reporting outcome leaves dashboard stale | Medium | Delayed visibility | Explicit local sync uncertainty; no false confirmation or blind replay; documented refresh path |

## Notes and Implementation Readiness Audit

- This plan follows the recommended student-click check followed by explicit handoff. It does not require the student to achieve an AI pass before the teacher can review.
- The shortcut and no-main-window interaction reflect the user’s latest clarification. The proposed chord is not currently implemented.
- Planning evidence is repository code, not proof that the currently installed desktop build contains all inspected paths. Validate the packaged build manually.
- No external research or paid model calls were needed for planning.
- The absent navigation guide was not invented or substituted with external instructions.
- All ten tasks specify ACTION, IMPLEMENT, MIRROR, IMPORTS, GOTCHA and VALIDATE. Runtime, renderer, backend, policy, persistence and failure paths are named. Existing patterns are quoted from inspected source.
- Implementation may refresh shifted line numbers and coordinate with concurrent edits, but the intended behavior and integration points are fixed here.

Next step: `/prp-implement .claude/PRPs/plans/student-assignment-check-and-review.plan.md`


## Implementation record — September 5, 2026

All ten implementation tasks are coding-complete. Automated validation, isolated
PostgreSQL classroom integration, packaging, and native macOS shortcut/focus/typing
smoke checks passed. See
`../../reports/student-assignment-check-and-review-report.md` for evidence and
deviations. Live-model checks in VS Code/Scratch and Windows native acceptance
remain unverified release checks; the manual checklist above is not marked as
fully executed.
