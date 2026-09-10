# Lesson execution through the shared agent loop

Status: implementation in progress; acceptance and CI are pending.
Date: 2026-09-10. Source baseline: `4c37567`.

## Implementation status

Working branch: `codex/shared-lesson-agent`. Source changes and regression tests
are ready for the first CI cycle. No hosted checks or live cross-device acceptance
have run for this revision. The user has authorized the PR and merge after completion and passing checks.

Implemented in the working tree:

- Versioned context before observation, bounded resource retrieval, untrusted
  source labeling, resource kind/version checks and explicit continuation offsets.
- Shared task execution for desktop and legacy web lessons. Resource preparation
  performs no UI actions; journaled `lesson_open` returns an OS receipt without
  claiming document verification.
- Deleted chooser recipes, opening/polling loops, browser-only completion tools,
  navigation/demonstration recipes and their obsolete wiring and policy state.
- Shared observation/control with current authority, consent and evidence checks.
  Verification failures return observations; stale window bindings can recover.
  Presentation checks visual changes separately from shared CUA fingerprints.
- Durable same-step task reuse, fresh authority, retained SDK history, explicit
  history flushing, measured model accounting and conservative unknown handling.
- Version-2 resource records with read-only legacy decoding. Missing journals and
  unresolved actions block continuation; restoration revokes control consent.
- Mode-specific completion and presentation-receipt revocation checks. Embedded
  reading and assessment remain explicit product paths, not external UI fallbacks.

Validation recorded: source diff review and `git diff --check`. The already-running
webpack watcher reported no TypeScript errors after corrections; that is not CI
verification. Regression tests have been added but have not been executed in CI.

Required next: pass full final-revision CI; exercise the
native chooser, demonstration scope, restart and two-device acceptance matrix.
Staging readiness reported database/status `ok`, but deployed revision/migration
identity and the separate teacher profile remain unconfirmed. Do not claim the
reported chooser incident is resolved until its native acceptance case passes.

## Decision and intended outcome

Tro supplies the goal, trusted context, capabilities, authorization, durable
state, and evidence requirements. The existing agent loop decides how to use
available tools to accomplish the goal. CUA executes and observes; it does not
own lesson goals or grant authority.

A teacher broadcasts a material and instruction. On the student device, the
same agent task opens the material, handles ordinary application UI, verifies
the material, and explains it. An app chooser is an observation to reason about,
not a prerequisite that a separate hardcoded controller must solve first.

Reuse the existing Agents SDK runtime. Do not introduce an opening agent,
application-specific planner, second model loop, or a generic workflow framework.
Keep useful direct operations such as downloading and opening a known resource;
agent ownership does not mean accomplishing every operation through clicks.

## Findings from the current implementation

| Boundary | Current behavior | Required change |
|---|---|---|
| `classroom-lesson-controller.ts` | Calls `runner.prepare` before claiming/running a child | Prepare resources without requiring UI success; admit the task before UI work |
| `classroom-lesson-step-runner.ts` | Separate opening CUA session, then teaching session | One task authority and durable execution context across opening and teaching |
| `application/classroom-lesson-task.ts` | Rejects agent tasks for `open`; prompts assume visible material | Admit opening objectives and provide context before observation |
| `classroom-lesson-opening-service.ts` | Eight observation attempts and chooser-specific clicks | Remove its UI decision loop after shared-loop replacement |
| `classroom-material-chooser-policy.ts` | Host/title/viewer/button regular expressions | Remove application chooser recipes |
| `classroom-lesson-tool-policy.ts` | Desktop allowlist excludes general computer tools | Expose shared tools under explicit execution grants |
| `classroom-desktop-teaching-tools.ts` | Navigation shortcuts and VS Code scratch recipes | Retain presentation/completion; move UI decisions to the model |
| `classroom-lesson-surface-service.ts` | Rejects unverified windows before teaching observation succeeds | Separate observation from binding a window as verified lesson content |
| `services/agent-runtime/src/agent-graph.ts` | Shared SDK Agent, Runner, persisted session and compaction | Reuse; extend only where shared execution needs it |

The observed Windows incident reached `waiting_for_document`, made observation
calls without clicks, and ended `surface_unverified` before a child task existed.
The actual observed window metadata was not logged. Wrong window selection versus
unrecognized chooser metadata remains unproven; do not represent this refactor as
proof of a particular CUA defect.

## Scope and abstraction boundary

Implement the complete open-to-teach path for desktop lessons first. Preserve
teacher plans, activity identity, student ownership, teaching modes, and existing
consent semantics. Shared runtime changes must remain useful outside classroom
tasks; classroom concepts belong in a context adapter and product tools.

The host remains responsible for:

- Validating teacher plans, membership, ownership, expiry and student consent.
- Downloading and verifying resources, resolving opaque resource handles.
- Enforcing tool permissions, validating arguments and serializing mutations.
- Recording action effects, cancellation, budgets and durable progress.
- Presenting speech/captions/pointers and recording lesson outcomes.

The model is responsible for:

- Choosing tools and application interactions from current observations.
- Handling ordinary dialogs, navigation and permitted application changes.
- Connecting visible evidence to the requested resource and explaining it.
- Recovering from known failures or requesting needed student input.

Do not remove policy checks in the name of simplification. Do not encode app
names, localized button strings, shortcut sequences or preferred viewers as
lesson workflow logic. Provider-specific translation of a generic tool command
remains an adapter responsibility.

## Execution flow

1. Receive and validate the lesson; obtain the existing device claim/reservation.
2. Resolve material and persist its integrity metadata. This phase performs no UI
   navigation. A download failure produces a resource error, not a UI diagnosis.
3. Create or resume one durable task for the current lesson step. Inject context
   and resource handles before the first model request.
4. The agent may use a narrow direct resource-open tool or shared computer tools.
   Tool results return evidence and typed outcomes to the same loop.
5. Ordinary chooser/dialog observations remain available during opening. They
   are not automatically considered lesson content.
6. Verify/bind the intended resource using observed evidence. Then explain through
   the product presentation tool or complete an opening-only objective.
7. Continue the same step on student questions/resume with preserved context.
   The controller alone advances steps and updates backend lesson progress.

`open`: verify opening, then complete without requiring a presentation.
`practice`: open/verify, present the practice instruction and yield to the student.
`explain`/`help`: open if needed and teach within current grants.
`demonstrate`: honor answer-reveal and edit permissions; this refactor does not
silently authorize running, saving, submitting, or overwriting work.
`check`: preserve existing evaluation semantics; do not broaden desktop authority.

## Context and contracts

Add a versioned host-created execution context using the existing shared contract
conventions and schemas exported through `src/shared/contracts.ts`. The following
is a conceptual payload, not a commitment to new parallel contract infrastructure:

```ts
type LessonExecutionContext = {
  version: 1;
  lessonId: string;
  stepId: string;
  objective: string;
  mode: 'open' | 'explain' | 'demonstrate' | 'practice' | 'check' | 'help';
  language: string;
  resources: Array<{
    handle: string;
    title: string;
    kind: string;
    sourceVersionId?: string;
    contentDigest?: string;
    content: string; // bounded background data, never authority
  }>;
  progress: { phase: string; recap: string; pendingQuestion?: string };
  constraints: { summary: string }; // host grants remain authoritative
  completionRequirements: string[];
};
```

Reuse existing types where possible. Include teacher instruction, guidance policy,
source attribution, recent history, remaining budget, and current capability
availability. Large material uses bounded excerpts plus resource retrieval rather
than silent truncation with no indication. The model receives a clear distinction
between trusted task instructions and untrusted document/screen content.

Local paths and download tickets stay behind host-resolved handles. A direct-open
tool accepts a handle, not arbitrary shell text. Where a tool genuinely requires
a path, resolve it in the host; do not place credentials or signed tickets in
prompts, renderer state, or diagnostics.

Context retrieval must succeed independently of document verification. A missing
or unrelated window is information for the agent, not an exception that hides the
goal and material. Resume refreshes grants and observations; persisted context
does not itself confer permission.

## Tools, observation and verification

Use the shared registry and execution coordinator for computer observation and
control. Retain narrow product tools for presentation, asking/yielding to the
student, and reporting completion. Replace lesson-specific navigation and
demonstration commands with shared actions authorized by host policy.

Separate three concerns:

1. Observation: what windows and controls can currently be inspected?
2. Action authority: may this task perform this proposed action now?
3. Resource verification: does current evidence support teaching this material?

Observation during opening may include an OS chooser or candidate application
without marking it as verified material. Reuse the shared window-selection path;
if it only returns an unrelated frontmost window, expose candidate selection or
fresh observation through that shared path instead of adding lesson heuristics.

Resource verification combines host-known resource identity with fresh observed
window/document evidence. A model declaration alone cannot mark success. A title
substring alone is also insufficient as a universal document identity rule.
Prefer direct identity evidence when available; otherwise require referenced
visible evidence and explicit student selection when identity remains ambiguous.
The host validates freshness, resource handle and binding consistency; the model
interprets visible content. Document this limitation rather than claiming semantic
identity can always be proven deterministically.

Presentation must reference current evidence. Preserve pointer-coordinate and
window-movement checks. Completion records verified opening and, for teaching
modes, a successful presentation and recap. Do not impose presentation on `open`.

Student navigation permission is not permission for arbitrary filesystem or app
changes. Enforce scope at dispatch and recheck revocation. Keep restrictions on
existing work, installation, default-association changes and submission. If the
shared policy cannot enforce a proposed action, return a typed denial or request
student help; do not regain permissiveness by matching a button caption.

## Durable loop, effects and recovery

Reuse existing encrypted sessions, task runtime, coordinator and lesson store.
Keep a durable step-to-task mapping; do not create a new child for each UI phase
or resume. A new teacher step may have a new task with the previous recap.

Journal every mutation before dispatch and persist the result before continuing.
Preserve `confirmed`, known failure/not-executed, denied, and unknown outcomes.
On restart, a dispatch without a terminal result is unknown. Never replay it.
Persisted `opened` means the OS call returned successfully, not that the document
is visible; keep effect completion separate from resource verification.

- Known recoverable failure: return diagnostics and a fresh observation to the loop.
- Missing consent/unavailable capability: yield with an actionable reason.
- Unknown effect: retain an unresolved record and enter the existing unknown
  state; do not automatically resume mutation. Resolution requires an explicit,
  verified reconciliation path. A timeout is not evidence that nothing happened.
- Cancellation/expiry/revocation: stop dispatch, cancel presentation, persist state
  and release ownership only according to the existing lifecycle contract.

Use shared task budgets rather than a bespoke eight-poll opening loop. Account
for actual model/tool consumption across opening, teaching and resumed turns.
Review the current four-turn teaching-round cap and up-front model reservation:
opening now consumes model turns and must not silently exhaust explanation.
Select bounded defaults from measured acceptance runs; preserve hard overall
limits and a visible budget-exhausted outcome.

## Compatibility and migration

Inspect backend plan validation, client capability negotiation, state schemas and
all persisted lesson/task mappings before implementation. The source baseline
registers lesson migration `037_classroom_lessons.sql` in `services/api/src/db.rs`.
This is a repository baseline, not confirmation of the deployed staging schema.

Prefer a client execution refactor without changing teacher plan semantics. If
supporting `open` child admission or durable task mappings requires backend changes,
version the relevant contracts and capability negotiation explicitly. New clients
must not reinterpret an old consent as a broader grant. Unsupported combinations
must fail clearly before executing a broadcast.

Add versioned local-state upgrade coverage. Preserve legacy unknown effects.
Completed lessons remain completed. Paused legacy lessons may migrate only with
fresh authorization and no uncertain effects; otherwise require an explicit new
lesson. Do not replay an old opening during migration.

Published SQL migrations remain immutable. If SQL is needed, append and register
a migration and test upgrade/restart from the existing history, including the
repository's alternate-history handling. Never assume fresh-schema tests prove
deployment compatibility.

## Implementation plan

Each phase includes regression tests and source review. Do not leave two permanent
desktop opening implementations. Use separate reviewable revisions where useful;
incomplete phases must not replace the active production path.

### 1. Establish contracts and acceptance environment

- Trace child admission/backend validation for every lesson mode, current state
  upgrades, tool grants, runtime resume and effect-journal ownership.
- Record client commits, CUA/model versions, common backend revision and migration
  baseline. Establish separate teacher and student profiles on two devices.
- Use `npm run start:test` / `npm run package:test` with Doppler `tro-app/stg`.
  The current launcher asserts `https://api-test-test-d2da.up.railway.app`.
- Add the context/grant/evidence contract design and compatibility tests. Inventory
  any CUA capability gaps using real observations, not guessed Windows metadata.

Exit: a concrete contract map and reproducible cross-device test environment.
Teacher identity and deployed backend revision remain to be recorded; the earlier
successful readiness check alone does not establish these prerequisites.

### 2. Separate resource preparation from opening

- Refactor material service to resolve/cache resources and expose handles.
- Adapt step admission so preparation no longer waits for document UI.
- Supply complete bounded context before the first model call.
- Preserve download integrity, ownership, resource cache and legacy effect records.

Exit: a task can start with the material closed and knows what to open and explain.

### 3. Run opening and teaching through shared tools

- Admit `open` objectives and reuse the existing SDK runtime/task session.
- Register direct resource-open plus shared observation/control under scoped grants.
- Split window observation from resource verification; return actionable tool
  outcomes for unsupported/ambiguous screens.
- Retain presentation and completion tools; remove UI recipes from teaching tools.
- Update prompts to express objectives, constraints and evidence requirements.

Exit: an unfamiliar chooser can be handled through model tool calls without
adding viewer names or localized labels to lesson code.

### 4. Complete lifecycle and compatibility

- Persist the task mapping across student questions and resumes.
- Integrate action journaling, cancellation, unknown effects, permission changes,
  budget accounting and backend progress receipts with the shared coordinator.
- Add required local-state/backend upgrades and mixed-client behavior.
- Validate all modes, especially opening-only completion and practice handoff.

Exit: restart/resume cannot duplicate mutations, broaden consent, or advance a
lesson merely because an OS open call returned.

### 5. Remove obsolete paths and document the boundary

- Delete chooser policy and opening loop once all callers use the shared path.
- Delete recipe-based navigation/demonstration branches and their recipe tests;
  replace them with behavioral and authority regression tests.
- Remove obsolete dependency wiring from composition and runner.
- Audit legacy browser/coach paths: retain only needed compatibility/product
  differences, route supported UI work through shared execution, and record any
  remaining compatibility path with an explicit removal condition.
- Update architecture documentation and test instructions. Do not delete CUA
  adapters, verification, lifecycle code or presentation just because they are
  deterministic.

Exit: one desktop execution path, no hidden chooser fallback, and no unreferenced
lesson-specific UI helpers or duplicate mutation journals.

### 6. Validate and roll out

- Finish implementation, tests and source diff review before the first CI cycle.
- Use existing client capability/version mechanisms for controlled staging
  activation; do not invent a permanent second execution framework.
- Run acceptance on staging, then require final-revision CI before merge.
- Rollback selects the prior supported client for new lessons only. Preserve
  unknown/in-flight journals; never silently replay them through the old path.

## Mandatory cleanup inventory

Cleanup is part of delivery, not a later optional refactor. The new path is not
complete while the old desktop executor can still be selected by a flag, fallback,
stale import, tool registration, or resumed record. Perform deletions after their
replacement behavior and migration are implemented, not before.

### Delete outright after replacement

| Item | Required cleanup |
|---|---|
| `src/main/knowledge/classroom-material-chooser-policy.ts` | Delete chooser host/title patterns, viewer map, translated control matching and `ChooserAction` |
| `src/main/knowledge/classroom-lesson-opening-service.ts` | Delete the separate polling/click loop and its private retry/deduplication decisions |
| `src/main/knowledge/classroom-lesson-opening-service.test.ts` | Replace with shared-loop behavioral tests; preserve no-default-change, no-replay and denied-action coverage without preserving recipes |
| Opening-service wiring | Remove imports, constructor options, `opening.complete` calls and composition instances; no compatibility shim that executes the old loop |
| `lesson_navigate` / `lesson_demonstrate` recipes | Remove schemas, registry definitions, adapters, switch branches, shortcut generation and VS Code/Untitled-specific interaction rules after shared actions cover authorized behavior |
| Legacy opening prompt assumptions | Remove the `open` admission rejection and instructions requiring material to be already open; remove prompts directing models to deleted tool names |
| Temporary rollout selection | Remove desktop old/new execution switches before final delivery; rollback uses a prior client release, not a permanent alternate engine |

### Refactor in place; do not duplicate

| Existing component | Final responsibility and code to remove |
|---|---|
| `classroom-lesson-controller.ts` | Keep lesson lifecycle and progress; remove mandatory UI preparation before agent admission and phase-specific child creation |
| `classroom-lesson-step-runner.ts` | Keep thin task coordination; remove separate opening session, fixed opening polls and duplicated action orchestration |
| `application/classroom-lesson-task.ts` | Build context and admit/resume the shared task; remove desktop-specific UI instructions and unnecessary new-task-per-round behavior |
| `classroom-lesson-material-service.ts` | Retain validated resource resolution/cache; move opening into a registered direct tool and remove `finishOpening` plus private UI dispatch tracking |
| `classroom-lesson-surface-service.ts` | Retain binding/evidence functionality where needed; remove chooser recognition and the requirement that observation itself proves lesson readiness |
| `classroom-desktop-teaching-tools.ts` | Retain product presentation/completion; source context from a pre-observation context adapter; remove UI decision logic and duplicate mutation queues/journals already owned by the coordinator |
| `classroom-lesson-tool-policy.ts` | Replace desktop five-tool restriction with scoped shared grants; preserve authorization and outcome checks; remove browser interaction recipes when their supported path migrates |
| `classroom-lesson-composition.ts` | Compose a context adapter, product capabilities and shared execution; remove redundant services and constructor plumbing |
| Shared tool registry/adapters | Exactly one registration and dispatch path per surviving tool; remove unused imports, schemas, model names and availability exceptions |

Do not create `opening-v2`, `smart-chooser`, per-app drivers, or a parallel
`lesson-agent-runtime`. Prefer changing existing interfaces and deleting their
old implementations. Extract a shared abstraction only where responsibilities
are clear; do not replace a small deletion with a general framework.

### Remove obsolete contracts end to end

The older material acknowledgement path currently spans:

- `classroom-lesson-step-runner.ts`: `materialAck`, `acknowledge`, timeout handling.
- `src/shared/classroom-lesson-desktop-api.ts`: channel and `materialAck` method.
- `src/main/ipc/register-classroom-lesson-ipc.ts`: handler registration.
- `src/renderer/features/classroom/ClassroomLessonMaterialPanel.tsx`: caller.
- Related schemas, preload bridge wiring, fixtures and tests.

This path also serves older plans. First determine whether the renderer material
viewer remains a supported product feature. If it remains, keep its display
behavior and make any necessary acknowledgement a narrow presentation receipt;
it must not remain a second desktop opening executor. If it is obsolete, remove
the whole chain in one revision. Never remove only the main handler and leave a
renderer caller or advertised DesktopApi method.

Apply the same caller-to-schema audit to removed tools, phase fields, model budget
reservations and old resume methods. Do not remove user controls for stop, consent,
manual selection or help solely because automatic recovery improves.

### State and migration cleanup

- Separate cached material identity from action execution state. The current
  `NativeMaterialRecordSchema` combines path/digest with opening status; migrate
  legacy dispatch information into the authoritative effect journal before
  deleting duplicate writers.
- Keep a single authoritative owner for each mutation record. If lesson views
  mirror status, derive the mirror; do not maintain two independently writable
  truth sources.
- Version local-state upgrades and test them. Retain a read-only migration decoder
  for supported legacy records; it must never dispatch tools or reopen material.
- Remove old-state writers and runtime branches once migration is active. State
  adapters are acceptable compatibility code; alternate executors are not.
- Preserve unresolved effects and student data. No blanket deletion of userData,
  sessions, caches, lesson history or database rows as a migration strategy.
- Historical SQL migrations remain permanently immutable. Dead executable code
  can be deleted; historical migration files are not dead code.

### Explicit compatibility boundary

Current retained compatibility (source review; acceptance pending):

| Input | Execution and reason | Removal condition |
|---|---|---|
| Versions 1/2 web, non-check | Shared agent; no legacy browser executor or completion tool | No adapter needed once older plan versions are retired; reviewed plans are never rewritten locally |
| Versions 1/2 embedded open/practice | Tro material viewer and visibility acknowledgement; this is embedded reading, not external UI automation | Remove the acknowledgement contract and panel effect together if embedded reading support is retired or migrated |
| Versions 1/2 embedded explain/help | Existing coach with supplied material and history | Remove only when this product behavior is migrated to the shared lesson context and presentation path |
| Check, all versions | Existing assessment behavior, separate from external UI execution | Change only as part of an explicit assessment migration |
| Legacy prepared-resource records | Read-only decoder preserving uncertain opening state; new writes use version 2 | Remove when no supported client upgrade can carry these records; never erase unresolved outcomes |

The first row is now implemented. The embedded viewer and coach are retained
product behaviors, not fallback external executors. Their compatibility tests
must remain separate from external opening acceptance.

The remaining cleanup is a release requirement, not permission to keep the old
execution architecture indefinitely. The current working tree still contains:

| Remaining path | Required disposition before completion |
|---|---|
| Pre-v3 web preparation in `classroom-lesson-step-runner.ts` | Remove its separate CUA session, direct navigation and eight-attempt readiness loop by normalizing supported web objectives into shared execution. If semantics cannot be preserved, reject that version before any UI action with an explicit upgrade path. |
| Pre-v3 embedded material acknowledgement | This serves Tro's document panel, not an external app chooser. Decide whether embedded reading remains a supported product mode. If retained, isolate it to that mode and test that v3 cannot emit or wait for `materialAck`; otherwise remove the panel effect, DesktopApi method, preload bridge, IPC registration, schema and runner acknowledgement together. |
| Browser-specific policy branches | Migrate supported actions to shared grants before deleting old app/control matching and duplicate state. Preserve origin and assessment constraints as product authorization, not browser recipes. |
| `inspectOpening` and persistent surface bindings | Refactor as evidence verification independent of opening. Fresh observations must remain accessible when binding fails; a stale binding must not trap the agent in an old window. Test document/window changes. |
| Truncated context | Complete bounded retrieval through resource handles; a truncation flag alone is not enough for an agent to access the rest of the material. |
| Legacy local-state readers | Retain only versioned, read-only decoding needed to preserve history and unknown outcomes. Remove legacy writers and all dispatch behavior from migration. |

For each row, implementation review must record the final disposition and its
regression evidence. An unresolved row blocks the claim of full cleanup. In
particular, deleting the named chooser service does not prove that all old UI
orchestration has been removed.

Enforce the boundary in behavior tests: all supported external material modes
enter shared task admission before UI actions; renderer acknowledgements cannot
complete desktop opening; legacy migration cannot dispatch; unknown effects
cannot reopen material; resumed steps reuse the task and shared journal. Add a
small source-boundary check for removed imports/tool registrations, but do not
substitute name searches for these behavioral tests.

Inventory schema versions 1/2, browser demonstration, and coach/check routes during
phase 1. For each, record one outcome: normalize into shared execution, retain a
distinct non-UI product behavior, or reject unsupported versions before dispatch.
Do not silently route an old plan to the removed chooser executor.

Every retained compatibility adapter must list its accepted versions, purpose,
tests and removal trigger. A separate coach used for evaluation is not necessarily
duplicate desktop execution. Remove obsolete UI policy implementations only after
their callers have migrated; preserve assessment and teacher-plan semantics.

### Cleanup acceptance gates

- Repository searches find no executable references to
  `ClassroomLessonOpeningService`, `materialChooserAction`, `isMaterialAppChooser`,
  or deleted model tool names. Historical documentation may name them explicitly.
- Registry/IPC contract tests confirm removed APIs are not advertised and all
  surviving APIs have an implementation. No renderer/preload references dangle.
- Integration traces show opening, recovery and teaching use the same task and
  shared dispatch path; no direct lesson-specific CUA mutation bypass remains.
- A real unfamiliar chooser succeeds without new app names, localized strings or
  application-specific branches in lesson code.
- Restart and legacy-state tests show a single journal owner and no replay.
- Dependencies, feature flags, fixtures, error copy, exports and documentation
  are searched for orphaned assumptions. Remove packages only if no other feature
  uses them; do not remove the shared CUA/SDK dependencies.
- Review the final diff against this inventory and list any retained compatibility
  adapter with its explicit reason. No unexplained deferred desktop cleanup.

The growth criterion is concrete: supporting another viewer should normally mean
better context or a shared capability improvement, not another lesson function.
New product requirements may justify tools, but those tools should express product
operations or reusable capabilities rather than application navigation recipes.

## Required validation

| Scenario | Required evidence |
|---|---|
| Windows Vietnamese `.md`, no default app | Agent observes chooser, selects an installed viewer once, verifies document and explains; no default association changed |
| Windows English and macOS | Same flow works without adding lesson-specific labels or app recipes |
| Already-open resource | Correct document reused without duplicate launch |
| Unrelated foreground window | Agent can observe/select candidates; unrelated content cannot satisfy completion |
| Slow launch / known opening failure | Fresh evidence and recovery through the loop, no blind repeated launch |
| Missing app or permission | Actionable student handoff, no false completion |
| Source text contains instructions | Treated as data; cannot expand grants or change the teacher goal |
| Student moves window or changes document | Re-observe before pointing/teaching; detect binding changes |
| Stop, revoke consent, expiry | No subsequent unauthorized action or presentation |
| Crash between dispatch and result | Unknown recorded; no automatic replay on restart/resume |
| Open/practice/explain/help/demonstrate/check | Mode-specific completion and constraints preserved |
| Student question/resume | Same step context, history and budget retained |
| Two devices / duplicate broadcast | Existing ownership/idempotency prevents duplicate execution |
| Legacy paused/completed/unknown state | Explicit compatible upgrade without replay or consent expansion |

Use deterministic fake-model traces for orchestration tests, including observations
whose chooser host is not on the old allowlist. These prove routing and policy,
not model competence. Capture real native observations and run live model tests
on both operating systems for actual acceptance. Redact private screen content.

Log correlated lesson/task/action IDs, phase, tool name, route, outcome, reason,
budget use and verification status. Window metadata and screenshots require an
opt-in diagnostic artifact; do not log document text or secrets by default.
Measure time to first explanation, model/tool counts and recovery failures.

Follow [the CI workflow](testing/ci-workflow.md). The implementation touches
main/shared/runtime code and requires full routing, including PostgreSQL integration
and native verification. Both `verify (macos-latest)` and
`verify (windows-latest)` must pass on the final revision. This implementation requires full verification. CI is pending until an authorized push;
this plan does not authorize pushing, opening a PR, merging or deployment.

## Definition of done

The student can receive a broadcast with a closed material, have the agent open
it and explain it in one shared execution flow, and resume safely after known
interruptions. No new app/chooser recipe is needed for the acceptance cases.
Context is available before observation; general tools are genuinely callable
within grants; completion is evidence-backed; unknown effects are never replayed.
Old desktop chooser/navigation loops are removed, compatibility is explicit,
and final CI plus real two-device acceptance evidence are recorded.
