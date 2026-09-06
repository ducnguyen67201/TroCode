# Frontend and codebase refactoring plan

Audit baseline: `cd9cdc2`, 2026-09-06. Status: frontend implementation complete locally; final CI/live acceptance pending.
Native/backend batch 9 remains a follow-up, not completed work.

Make each module understandable on its own, with clear ownership of state,
effects, and rendering. Start with the desktop and admin frontends, then apply
the same discipline to shared contracts, Electron, and backend hotspots. Preserve
observable behavior throughout. File length is a guardrail, not the design method.

## Baseline and scope

The frontend inventory covers `src/renderer/**`, `src/renderer.tsx`,
`src/index.css`, the screen-recording renderer entry, and `apps/admin/src/**`.
It contains 83 production TS/TSX/JS/CSS files and 36,138 physical lines, excluding
tests. Thirteen files exceed 500 lines; five exceed 1,000.

| File | Lines | Responsibility split |
| --- | ---: | --- |
| `src/index.css` | 12,995 | Base/tokens, shell, task UI, settings sections, classroom surfaces, overlays, responsive rules |
| `src/renderer/App.tsx` | 3,603 | Shell, entry gates, task session, voice coordination, classroom selection, preferences, account and runtime status |
| `apps/admin/src/styles.css` | 1,771 | Base, dashboard shell, users, usage, access codes, dialogs |
| `src/renderer/app-language.ts` | 1,298 | Translation lookup/interpolation and domain dictionaries |
| `src/renderer/SettingsPage.tsx` | 1,054 | Dialog/navigation, six settings sections, connector flow |
| `src/renderer/use-push-to-talk.ts` | 903 | React lifecycle, shortcut ownership, voice turn execution, diagnostics |
| `src/renderer/FacilitatorRunPage.tsx` | 877 | Dashboard loading, run controls, directive composition, student review |
| `src/renderer/OrganizationPage.tsx` | 804 | Profile/banner editing, member pagination/actions, capacity summary |
| `src/renderer/CompanionCustomizationCard.tsx` | 690 | Image selection/preview, generation form, candidate/saved gallery |
| `src/renderer/SpaceDetailPage.tsx` | 659 | Tab composition, materials, activities, sessions, roster/groups |
| `src/renderer/voice-segmentation.ts` | 637 | Segmenter, PCM/WAV encoding, ordered transcript assembly, upload queue |
| `src/renderer/AttemptLaunchPage.tsx` | 634 | Attempt loading, launch controls, workspace/submission selection, review state |
| `apps/admin/src/pages/UsersPage.tsx` | 506 | Filters, paginated loading, user rows, role updates |

Audit every frontend file, including smaller modules, for mixed responsibilities,
duplicate logic, test-only exports, and misplaced dependencies. Leave cohesive
small modules alone. Include tests in the organization work; large test files
should divide by behavior rather than arbitrary line ranges.

The referenced `docs/CODEX-NAVIGATION-GUIDE.md` is absent from this checkout.
This plan uses the source, root `AGENTS.md`, build configuration, and
`docs/testing/ci-workflow.md` as evidence.

## Design and size rules

- Aim for 150–300 lines per component or hook, and smaller pure helpers where
  appropriate. New or fully migrated handwritten frontend modules should be at
  most 500 physical lines. Do not compress formatting to meet the limit.
- No handwritten frontend production file should remain above 1,000 lines when
  the frontend phase ends. A cohesive exception between 500 and 1,000 requires a
  named owner and rationale; exceptions are explicit paths, never broad globs.
- Count CSS and translation dictionaries too. Split them by surface or domain;
  keep generated/vendor content separately identified. Report test sizes
  separately so test extraction does not inflate production improvement metrics.
- A component owns one recognizable UI responsibility. A hook owns one lifecycle
  or resource. Pure projection, sorting, validation, and transition logic stays
  outside React. Keep tightly coupled state transitions together.
- Feature modules contain their components, hooks, pure models, styles, and tests.
  Shared UI is limited to genuinely reused presentation. Avoid catch-all
  `utils.ts`, global bags of setters, and a replacement 2,000-line `useApp` hook.
- Pass narrow, typed values and actions between features. Use context only for
  stable values needed throughout a subtree; do not introduce a global state
  library just to shorten files.
- The app composition layer may connect features. Feature internals never import
  the app shell; shared UI never imports features. Cross-feature orchestration
  uses explicit contracts, not imports of private hook internals.
- Preserve `DesktopApi`, Zod parsing, sandboxing, IPC channel names, and wire
  payloads. Renderer code must not import Electron main-process implementations,
  Node APIs, raw IPC, or CUA. Keep the admin HTTP boundary independent.

Suggested desktop layout, created incrementally as each responsibility moves:

```text
src/renderer/
  app/                     App, AppShell, navigation, entry-gate composition
  features/
    tasks/                 task session, composer, conversation, activity views
    voice/                 capture lifecycle, routing, shortcuts, audio helpers
    settings/              dialog, sections, connectors, preferences
    account/               membership, organization, usage presentation
    classroom/             class selection, sessions, broadcasts, student attempts
    knowledge/             spaces, materials, activity editing
    companion/             customization, companion/buddy/voice-island surfaces
  ui/                      proven shared presentation components
  i18n/                    translate, locale helpers, domain dictionaries
  styles/                  global base and ordered stylesheet composition
```

These are ownership boundaries, not a requirement for empty folders or an
`index.ts` in every directory. Preserve existing import paths temporarily only
where doing so makes an incremental migration safer; remove compatibility
re-exports once their consumers have moved.

## Separate cleanup from refactoring

The refactor-clean skill requires cleanup before structural refactoring and
verification before deletion. Apply that within each bounded surface; do not
make the entire program wait for a perfect repository-wide dead-code result.

No Knip, depcheck, or ts-prune executable was found in this checkout during the
audit. Static relative-import inspection and repository text searches found one
candidate: `src/renderer/companion-state.ts` exports `getCompanionState`, whose
observed consumers are its own tests. This is a SAFE-tier candidate for further
verification, not a confirmed deletion. Test-only references do not establish
runtime use or prove that removing behavior is safe.

Before deletion, check the full repository import graph, dynamic imports,
string-based references, entry configuration, and any external consumers. If
introducing Knip, configure Electron entries/preloads, both renderer entries,
admin Vite, SDK process entry, and the audio worklet; pin the tool and review
dependency changes. Treat analysis output as candidates rather than instructions.

- SAFE candidates: internal helpers with no production consumers after review.
- CAUTION: components, CSS selectors, translation messages, dynamically loaded
  modules. Verify runtime paths, computed class names, fallbacks, and precedence.
- DANGER: entrypoints, preload, schemas, public contracts, and build configuration.
  Preserve until consumer and compatibility analysis establishes a safe change.

Use isolated cleanup revisions. Establish a passing applicable baseline, delete
one confirmed item, then validate before the next deletion. The repository's
explicit CI-first instructions override the skill's repeated full local-suite
recipe: use hosted CI for applicable checks, with local checks only for focused
diagnosis. If baseline/CI evidence is unavailable, leave deletions pending.
Revert only the offending scoped change; never blanket-reset unrelated work.

## Ordered implementation batches

Each numbered batch is a reviewable milestone, not necessarily one PR. Split
large batches into the named ownership units below. Keep mechanical moves,
behavior corrections, and dead-code deletions in separate revisions. Finish
implementation, regression changes, and source review before the first CI run.

### 1. Establish the baseline and prevent growth

Add a reproducible inventory and a ratcheting size check for tracked source files.
Initially record existing oversized files and prohibit growth or new oversized
files. Ratchet each exception down as it is migrated; never regenerate a larger
baseline automatically. Renames must not reset the limit. Introduce dependency
boundary checking with existing ESLint tooling where feasible.

Capture representative desktop/admin screens and interaction baselines. Add a
real React lifecycle harness for risky App/voice extraction before moving their
effects. The current voice tests mock React hooks, and root coverage reporting
currently includes only `src/main/agent/**/*.ts`; neither establishes frontend
rerender or unmount coverage. Extend coverage scope to migrated behavior modules
and set thresholds from measured results, without claiming an existing baseline.

### 2. Partition styles while preserving cascade

First separate the desktop stylesheet into ordered, contiguous sections at
complete CSS rule boundaries. Keep `src/index.css` as a small ordered import
entry, and keep the current import timing of `classroom-broadcast.css` intact.
Do not regroup noncontiguous selectors or consolidate overrides in this pass.
Break large domains into named sub-surfaces so a 13,000-line stylesheet does not
become several 2,000-line stylesheets.

Use rule/declaration-order comparison of the expanded CSS and visual acceptance
to establish equivalence. Preserve media-query order, keyframes, SVG fragment
references, platform selectors, specificity, and reduced-motion behavior. Existing
tests in `CursorBuddy.test.ts`, `VoiceModeControl.test.tsx`, and
`guidance-target-marker.test.ts` read `src/index.css` directly; update them to
inspect the composed styles without weakening the semantic assertions.

After the mechanical split is verified, move styles toward feature ownership
and consolidate proven duplicates in separate changes. Preserve loading order
through explicit style composition until dependencies are understood. Do the
admin stylesheet in its own batch. A CSS Modules conversion is not necessary
for this program.

### 3. Extract translations and Settings sections

Keep the translation API stable. Split Vietnamese dictionaries into domains
such as common, tasks, settings, account, and classroom. Preserve current lookup
precedence: the main dictionary wins before the classroom dictionary, then the
original message is returned. Verify all original key/value pairs, duplicate-key
handling, locale behavior, and interpolation with multiple replacements.

Split Settings into a dialog/navigation owner and General, Voice, Companion,
Connections, Account, and About sections. Extract `ConnectedApplicationsCard`
with its connection/polling lifecycle. Preserve focus trapping/restoration,
Escape behavior, settings draft persistence, and keeping the active workspace
mounted while Settings is open. Migrate companion image selection, local preview,
generation form, and gallery as a separate unit.

### 4. Extract App presentation

Move the existing `NavigationIcon`, `ComputerConnection`, `LiveTaskRail`,
`TerminalOutcome`, `ActivityList`, `Conversation`, and `PendingInteractionCard`
into their owning features with explicit props. Extract the sidebar, main view
composition, and task composer. Keep App's state and subscriptions in place for
this step so rendering changes can be reviewed independently of lifecycle moves.

### 5. Divide App state ownership, one lifecycle at a time

App currently contains 65 lexical `useState` calls, 25 `useRef` calls, and 21
effects. Move each state group together with its actions, request-generation
guards, subscriptions, and cleanup:

1. Preferences, updates, workspace selection, permissions, membership,
   organization, and companion customization: separate hooks per resource.
2. Task session: snapshot/event reconciliation, history hydration, streamed
   activity, submit/steer/cancel, auto-start deduplication, and composer focus.
3. Classroom selection: capabilities, class lists, teacher selection persistence,
   and stable task/voice destination bindings.
4. Voice coordination: draft snapshots, destination selection, transcript
   application, mode-save serialization, terminal outcomes, and audio ducking.

Keep domain request lifetimes stable across navigation and gate changes. A task
session owns task subscriptions exactly once; voice destination ownership is
captured at turn start. Preserve pending-interaction priority, stale-response
guards, finalizing turns, and one-time submission. Never retry an invocation
merely because completion is unknown.

The resulting App should mostly compose gates, shell, features, and typed
actions, ideally under 300 lines. Do not move every state field into a single
controller to reach that target. Split this batch into several reviewed PRs.

### 6. Refactor voice internals

Keep `usePushToTalk` as the React adapter. Separate the turn executor/resource
owner, shortcut subscription logic, diagnostics, and pure policy helpers. Keep
abort controllers, capture cleanup, turn IDs, finalization, and end notification
under one explicit owner rather than scattered hooks with shared mutable refs.

Split `voice-segmentation.ts` into the segmenter, sample normalization/WAV encoder,
transcript assembler, and upload queue. Preserve their existing contracts and
ordered behavior. If moving capture code, update and verify
`new URL('./voice-capture-processor.worklet.js', import.meta.url)` and its bundled
asset resolution. Do not combine extraction with changes to audio algorithms.

### 7. Divide classroom, knowledge, and organization pages

Use separate review units for facilitator dashboard/run controls/directive
composer/review; space tabs and roster/groups; student attempt loading/actions/
submission; and organization profile/banner/membership management. Retain the
existing smaller components and pure policies where they already have clear
ownership. Share query or mutation helpers only when the lifetimes and error
semantics actually match.

Add interaction coverage for stale responses, session switching, teacher/student
visibility, failed mutations, retries, and pagination. Existing render tests do
not alone prove the safety of extracting effects or async actions.

### 8. Finish admin and the remaining frontend audit

Preserve the existing `api/`, `pages/`, `components/`, and `hooks/` separation.
Extract Users filters/table/row actions and a paginated users resource hook.
Preserve debouncing, latest-request-wins behavior, role-save feedback, session
expiry, and page-mounted state. Add page interaction tests: current admin tests
cover contracts and formatters, not these flows.

Finish reviewing every remaining desktop/admin source file, remove verified
temporary re-exports, and enforce the final size/dependency policy. A coherent
300-line file does not require restructuring just because this is a broad audit.

### 9. Extend the program across the rest of the codebase

These production hotspots exceed 1,000 lines outside the frontend. They need
separate design/compatibility reviews; the responsibility boundaries below are
provisional, based on inventory and integration inspection rather than a full
backend audit.

| File | Lines | Follow-up boundary |
| --- | ---: | --- |
| `src/index.ts` | 3,271 | Application composition, window setup, service wiring, shutdown |
| `src/shared/contracts.ts` | 2,719 | Domain schema modules with stable public exports |
| `services/api/src/http/knowledge.rs` | 1,781 | Sources, activities, sessions, attempts and related route groups |
| `src/main/cua/cua-service.ts` | 1,542 | Driver lifecycle, surface access, execution/reporting |
| `src/main/ipc/register-ipc.ts` | 1,268 | Domain registration functions preserving validation and authorization |
| `src/preload.ts` | 1,181 | Narrow domain bridge builders under the existing DesktopApi |
| `services/api/src/http/core.rs` | 1,062 | Cohesive HTTP route groups |
| `src/main/agent/runtime-tool-registry.ts` | 1,044 | Domain tool definitions with unchanged registry contracts |

Inventory the 500–1,000-line backend/native modules and oversized test suites too.
Review schema import cycles and TS/Rust compatibility before shared-contract
splits. Move schemas without changing payloads or parsing behavior; use a small
compatibility export module as needed. Keep IPC authorization and parsing at the
boundary. Published SQL migrations remain immutable; structural refactoring
should require no migrations. Any discovered schema behavior change becomes a
separate change with upgrade-path coverage.

## Verification and acceptance

Use CI according to `docs/testing/ci-workflow.md`: renderer TS/TSX/CSS and root
CSS changes use shared source checks and renderer bundling; admin production,
main/preload/shared, build/tooling, and unknown paths use full verification.
`src/renderer.tsx` and JS worklet changes also fall outside the reduced renderer
path rule. Keep frontend-only changes separate from tooling/native work so
review and CI scope remain clear. All applicable checks must pass on the final
PR revision, including the required `verify (macos-latest)` and
`verify (windows-latest)` gates. Use one CI watcher per revision.

Required behavior evidence for the affected batches:

- Tasks: history/live-event reconciliation, duplicate/out-of-order events,
  auto-start once, steering, pending interactions, focused Escape cancellation,
  and unmount/resubscription without duplicate listeners or actions.
- Voice: real rerenders and StrictMode cleanup, local/global release ownership,
  permission latency, cancellation and late segments, ordered final transcript,
  one commit/end notification, classroom switching mid-turn, and audio restoration.
- Settings/account: active task preservation, keyboard navigation and focus,
  settings drafts, connector polling cleanup, entry-gate refresh races, membership
  and organizer visibility.
- Classroom/admin: teacher/student permissions, session changes, submission and
  review actions, latest-request wins, pagination, mutation failure, session expiry.
- Styles: desktop main window, all six auxiliary modes in `src/renderer.tsx`,
  screen-recording registration, admin, narrow windows, Windows-specific styling,
  keyboard focus, reduced motion, and forced-colors behavior where applicable.

Live classroom acceptance uses the shared test API and separate teacher/student
accounts described in `docs/testing/shared-test-environment.md`. Before starting
that batch, verify account availability, deployed API revision/compatibility,
readiness, migration baseline, and OS microphone/screen permissions. The document
currently specifies `npm run start:test`; packaged Finder-launch OAuth is a known
limitation recorded there. These prerequisites were inspected in documentation,
not verified against the live environment during this audit.

Definition of done for the frontend phase:

- All 83 original production files have a recorded audit disposition; newly
  extracted files have explicit ownership. All 13 oversized hotspots are resolved
  or have justified, bounded exceptions under the policy above.
- No handwritten frontend production file exceeds 1,000 lines. New/migrated files
  meet the 500-line ceiling unless explicitly approved as cohesive exceptions.
- App is composition-focused; subscriptions and async state have one clear owner.
  No new feature cycles or renderer-to-main/Node dependencies exist.
- Translation content/fallbacks and CSS cascade are preserved. UI and behavioral
  acceptance evidence accompanies the affected changes.
- Verified dead code is removed in isolated revisions; uncertain candidates remain
  documented. No dependency or export is deleted solely because of a text search.
- The final revision passes applicable CI and the size/dependency guardrails.
  If acceptance cannot run, its status stays pending rather than being called done.

## Current implementation result

Frontend production implementation is complete locally on `codex/frontend-refactor`.
All 13 original hotspots are below 500 physical lines; App is 472 lines and the
largest frontend module is 494. The original 83-file audit and all new module
owners are recorded in `docs/frontend-source-inventory.md`; working conventions
are in `docs/frontend-architecture.md`.

Batches 1–8 have code and automated regression coverage. Size/import-cycle rules,
CSS expansion hashes, translation preservation and lifecycle tests are in place.
The implementation report is
`.claude/PRPs/reports/frontend-refactoring-plan-report.md`.

The program remains open for final hosted CI, platform/visual acceptance, the
shared teacher/student environment checks, and the provisional native/backend
batch 9. No cleanup deletions, dependency removals, IPC/schema changes, push, PR,
merge or deployment were performed. This plan is not archived as fully complete.
