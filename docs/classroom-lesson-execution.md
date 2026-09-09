# Classroom lesson execution

The v3 desktop flow is documented in [Teaching in student applications](classroom-desktop-teaching.md). It downloads and opens class originals externally, uses a scoped teaching agent, and offers one teacher Send action. The v1/v2 behavior below remains for legacy plans. V3 verification and native acceptance are pending; see the linked support notes.

Classroom teaching uses one **Teach the class** flow. The teacher describes what
students should see or do, reviews the resolved material and steps, and confirms
the lesson. Source text is shown in Tro; approved web material is opened and
verified in Chrome. A lesson may explain, demonstrate, practice, help, or check.
Ask Tro may prepare the same preview, but only the teacher can confirm it.

“Open google.com” resolves the bare host to HTTPS and produces an **Open** step.
It must still be an approved material origin. Opening finishes after the material
is verified; it does not create a Coach task or attach assignment criteria.
“Open google.com and explain it” produces **Explain**, which opens its material
before coaching. Unknown source filenames and missing link targets are rejected
instead of silently selecting the assignment. Explicit language requests override
the teacher's interface language.

The student companion retains the lesson card while child tasks run, with a
loading indicator through opening and explaining, and Pause/Stop controls.
Completion remains visible until dismissed. Repository test launches include
their Git revision in the device build shown in teacher progress.

Open uses plan schema version 2 inside the existing delivery envelope. Deploy the
API update, then update and restart teacher and student clients. Updated clients
negotiate `maxPlanVersion=2` on context/feed reads. Without that query the API
keeps the v1 response shape, filters v2 plans, and advances the original feed
cursor. Teachers cannot prepare v2 plans against older servers; progress marks
older student devices as needing an update. Existing explanation plans stay v1.
The plan is stored in the existing JSONB column; no database migration is needed.

## Ownership

The teacher specifies semantic objectives and examples. The API validates and
stores an immutable versioned plan with a digest. The student main process claims
the delivery, opens and verifies its selected material, and runs one child task
at a time. Each child has a new task ID and a server-authorized work session for
the target assignment, even when the student joined through another assignment.

- Explain and Help use the existing read-only CoachRuntime with the reviewed
  material and current screen. Without capture permission, assignment/source text
  can be explained without making claims about unseen work.
- Demonstrate uses the existing LocalAgentRuntime, with a frozen, narrowed tool
  catalogue. Only observed Chrome browser exercise controls are supported.
  Terminal, general desktop coordinates, arbitrary navigation, submission and
  grading tools are unavailable. Input cannot overwrite pre-existing student work.
- Practice opens the material and returns control to the student without a model
  or input action. Help and Check stay within this parent lesson.
- Check returns published criterion outcomes with evidence locators. Teacher
  progress receives criterion IDs/outcomes; student text/evidence remains in the
  encrypted local journal. Checks do not submit or complete an assignment.

The controller uses TaskApplicationService's existing device reservation. Ordinary
work, old classroom guidance and a lesson cannot acquire independent ownership.
The material-opening operation completes and releases its CUA session before a
child starts. The next child waits for terminal completion and native cleanup.

## Authority and durability

Version 1 uses separate lesson endpoints and four tables added by migration 037.
Old broadcast payloads and feed versions remain unchanged. Capability discovery
adds optional `classroomLessons.contractVersion: 1`. Server checks include teacher
space access, student membership/participation, published version, target attempt,
run window, class state, insight acknowledgement, allowed origins and pinned sources.

Before dispatch, main rechecks ownership, consent, expiry and server authority.
Every demonstration tool is serialized and rechecks its local policy and server
status; native actions require a fresh verified observation. Removing a child
retains a revoked-task marker so late tools cannot escape the lesson guard.
SDK requests are bounded by the admitted child's turn budget; the host does not
introduce a second model loop or a per-model-round SDK protocol handshake.

The default bounds are eight steps/resources, 64 KiB serialized plan, and 30
minutes server expiry. A step allows eight reserved model requests, 16 observations
and 20 input actions; the parent caps models at 64 and input actions at 160.
Demonstration children reserve at most six SDK turns, leaving two requests for
read-only follow-up within the same step. Reservations are conservative: unused
SDK turns are not refunded. A new practice step has its own budget.

Owner-scoped journals use the operating system's encryption and atomic writes.
Commit/start/step IDs are durable before requests. Duplicate IDs resolve to the
same records; different content conflicts. Unknown commit/start results are
looked up rather than blindly resent. An interrupted native action is never
replayed. Ordinary SDK restoration rejects lesson children. Known interruption
requires an explicit Resume; an unknown action requires Stop and inspection
before accepting another lesson.

## Visible controls and troubleshooting

New joins and restored sessions default to automatic material opening and
demonstrations. A student's explicit lesson preference is stored in the encrypted
account/session journal and restored, including opt-out.
Initial feed snapshots and busy devices require **Start lesson**. Only a fresh
live delivery on an idle, consenting device auto-starts.

The main workspace shows material, current step, feedback, errors and
Pause/Resume/Stop outside the collapsed Class updates sidebar. Non-web material
must contain readable text and be visible in the viewport, with its visible center
uncovered by another DOM element, before its renderer acknowledges readiness.
Coach keeps this material window visible for explanations and help while hiding
floating overlays. Checks hide Tro so Coach can observe the student's work;
ordinary and web observations also hide Tro.
The floating Tro card supplies controls while opening and
between steps; child tasks use existing task/Coach presentation. Teacher progress
separates receipt from execution and displays step, reason, build and heartbeat.
A missing receipt is not completion. A heartbeat older than 30 seconds is stale;
it does not establish whether an older build is installed. “Automatic lessons on”
reports consent, not proof that Chrome and OS permissions are ready.

- **Permission required:** grant screen recording/accessibility in Tro Settings,
  then Resume. Browser material requires verified Chrome on macOS or Windows.
- **Surface unverified / unknown:** inspect the actual page and stop the lesson.
  Never retry a possibly executed input just to obtain a successful receipt.
- **Existing work:** use a fresh exercise surface or a different reviewed example.
  Tro does not clear a student's populated editor.
- **Budget exhausted:** stop this lesson and prepare a shorter reviewed example.
- **Connection unavailable:** verify both client revisions, account roles, class
  membership and shared staging API. Check server capability after signing in.

Completed explanations and help exchanges remain in the encrypted lesson journal
(up to 12 entries). Each Coach child receives the current question, material
identity/text and the last four exchanges, with answers capped at 1,500 characters
each. This is lesson context, not evidence of student completion. Unknown or
failed actions do not create completed history entries.
The task request carries the mode and current question or instruction; the full
reviewed step travels separately in typed lesson context so valid long lessons
do not exceed the task request limit.

Local structured logs use `[classroom:lesson]` with lesson, step and child task IDs,
status, phase and reason, plus resource identity/kind, character counts and history
length. `Material ready` follows successful visibility acknowledgement or web
verification, before `Explaining`. Feed failures log error classes. Avoid copying secret
values, screenshots or student work into operational logs or PR reports.

For the source-material regression, use separate teacher/student accounts on the
shared staging API and the same client revision. Restart the joined student,
confirm automatic lessons are on, then send a fresh explanation of
`01-python-bai-hoc.md`. With Class updates collapsed, the material should appear
in the main workspace and remain visible as Tro observes and explains. Ask a
follow-up about that explanation. Open the student's editor and use Check my work:
Tro should hide during observation so feedback can refer to the visible work.
Cover material with Settings before readiness: coaching must wait or show a
resumable visibility error. Then opt out and restart: the opt-out should
remain off. A blank or unreadable source must block with a visible error. This
two-machine check remains necessary in addition to the simulated regressions.

## Rollout and rollback

CI and the two-machine acceptance in `testing/shared-test-environment.md` are
release gates. Deploy the compatible API/migration before updating test desktops;
then distribute the same validated client revision. Migration 001–036 must remain
unchanged. No credentials or database endpoints need changing for this feature.

The simulated browser fixture is disabled unless the API explicitly sets
`TROCODE_CLASSROOM_TEST_FIXTURE_ENABLED=true`. It is not a Python interpreter.
Keep that flag off outside the test deployment.

To roll back, stop active lessons while the new endpoints remain available, remove
the advertised capability/lesson UI in the rollback release, and retain the new
SQL/history. Do not down-migrate or reinterpret lessons as old broadcasts.

Material links open in the installed Chrome application using native argument
vectors. Tro then verifies the actual browser surface before executing a lesson
step; successful process launch alone is not proof that the material opened.
