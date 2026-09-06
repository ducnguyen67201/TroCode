# Knowledge Spaces

Knowledge Spaces are TroCode's database-backed container for reusable context and guided work. The vocabulary is intentionally general: a Space can be a class, onboarding program, workshop, research project, field procedure, or team playbook. Activities can be assignments, labs, drills, cases, or work orders.

## Classroom package and roles

The desktop presents education-focused Spaces as **Class workspaces**. Account
creation does not grant a classroom role. An administrator assigns one of these
roles from `/source/admin`:

- **Teacher** — may create Class workspaces. A class owner can add registered
  Teachers and Students; a non-owner Teacher can add registered Students.
- **Student** — may access a class only after a Teacher adds the registered
  account as a participant, then use assigned class resources, Activities,
  Attempts, help, and submissions. Student views do not expose the roster,
  groups, upload controls, authoring, Runs, or facilitator insights.
- **Unassigned** — may not create or access a class until an administrator
  assigns Teacher or Student.

The administrator-assigned role is an eligibility boundary. The existing
`owner | facilitator | participant` membership remains the authority inside one
specific class. A Teacher may therefore own one class, facilitate another, and
participate in a third without receiving owner access everywhere. A Student may
only hold participant memberships. Existing owner/facilitator accounts are
backfilled to Teacher and participant-only accounts to Student by migration 018.

Teachers add already registered accounts by email from the People tab. Requests
are deduplicated, limited to 500 emails per idempotent batch, and may be repeated
as often as needed. Missing, blocked, ambiguous, or incorrectly assigned accounts
are not added and are reported separately. Student codes never create Space
membership: an active Teacher-managed participant membership must already
exist. Facilitator invites remain role-checked for adding Teachers.

Organization access and class enrollment are separate steps. An organization
organizer first reserves a seat using the student's exact Google email from
**Settings → Organization settings**. The student then receives plan access
automatically when signing in with that verified account, without entering a
code and without Tro sending an invitation email. This does not assign the
Student role or enroll a class. After registration and administrator role
assignment, a Teacher opens **Class workspaces → class → People** and adds that
registered Student to the specific class.

Class workspaces are navigation over existing Spaces, not trusted local folders
and not a second lifecycle/session system. Switching class changes only the
current classroom surface.

## Canonical model

PostgreSQL owns Space membership, groups, immutable Activity versions, Runs, assignment snapshots, Attempts, Work Sessions, submissions, and evidence. A private S3-compatible bucket owns uploaded bytes. There is no required `trocode.space.yaml` and no folder-as-database behavior. A folder upload is a reviewed point-in-time snapshot.

```text
Space
├── Library (versioned Sources)
├── People and Groups
└── Activities
    └── immutable Activity Version
        └── Run (live, async, or hybrid)
            └── private Attempt
                ├── bounded Work Sessions
                ├── explicit submissions
                └── provenance-labeled evidence
```

## Live classroom rooms

A live classroom is a `live` or `hybrid` Run with a `room` target; it is not a
second session model. A draft Run is the lobby, an open Run is the live class,
and a closed Run removes the student's sticky Activity authority. The teacher
creates a short-lived room code. The API stores only its HMAC digest. An
authenticated join requires an active participant membership that a Teacher
already created, then creates or reuses exactly one assignment, Attempt, and
participation for that Run.

Teachers can broadcast only typed exercise or public-HTTPS link directives.
Automatic link opening requires both an origin published in the immutable
Activity version and local student consent; Electron main claims and
revalidates the directive before opening it once. Otherwise the student gets a
visible Open link action. A model may assist with the student's explicit Help
or Check Work Session, but it cannot broadcast, submit, mark work ready, or
complete an Attempt on its own.

The classroom dashboard is intentionally event-based. It reports join/lobby,
Work Session, explicit Help, Ready, Submit, Return, Complete, and Leave facts.
It does not collect cursor motion, typing speed, screen history, attention, or
an inferred “stuck” state.

The Classroom pet uses only the current local Run and Attempt projection while
an open Run is live. Its curated, local messages may celebrate only explicit
Ready, Submit, or Complete states, and are not persisted as class evidence.
Tro does not inspect YouTube, other applications or websites, screen contents,
typing, attention, or idle time for this feature. The general desktop pet may
locally check only whether the current pointer is over its own rectangle to
play a hover reaction. That ephemeral boolean is never classroom evidence and
no cursor coordinate is retained or sent. Pet messages,
display state, and the local preference are not sent to the teacher dashboard
or application analytics.

## Launch context and performance

An Activity launch combines a compact immutable definition with fresh work context. Workspace Activities use one explicitly trusted local folder. Current-screen Activities force one fresh CUA observation; the semantic route is preferred when available and the existing screenshot route remains the fallback. Uploaded books and course material are not inserted wholesale. The task gets a title/role catalog and an Attempt-scoped `search_activity_knowledge` tool capped at six results and 12,000 characters.

Starter materialization is explicit. Electron main downloads exact pinned starter versions using short-lived GET tickets, validates path, size, and SHA-256, writes into a new staging directory, atomically renames it, and registers that directory as a trusted Workspace. It never overwrites or runs starter code.

## Privacy and insights

Participants see the Run's insight policy before starting. The default policy reports explicit help requests and operational state. Optional agent candidates are bounded to allowlisted criteria/tags, capped per Work Session, and labeled as hypotheses. They cannot grade, diagnose, or change Attempt state. Facilitators receive no live screen, ordinary task conversation, unsaved editor state, or unrelated local files.

Submission is a separate participant action. The renderer previews relative paths; Electron main hashes and uploads only those selected files. Task completion never triggers upload.

## Deployment and rollback

Migration 023 adds `users.knowledge_spaces_enabled` with a default of `true`. Administrators can enable or disable Knowledge Spaces per account from the Users dashboard; the API reads that database field for capability discovery and every Knowledge Spaces request. There is no deployment-wide feature flag.

Configure the private bucket credentials before enabling file upload, download, or ingestion workflows. Run `./bin/trocode-api ingestion-worker` as a separate Railway worker process, or `cargo run --manifest-path services/api/Cargo.toml --locked -- ingestion-worker` locally. The bucket role should permit only exact-object `PutObject`, `GetObject`, and `HeadObject`; public access and bucket listing should be denied. Navigation and metadata routes remain available when object storage is absent, while storage-dependent routes return a service-unavailable response.

The Rust API owns the complete live-room, directive, assessment, and dashboard
route families. It applies the checked-in migration chain, uses HMAC-authenticated `tro_live_`
sessions, and preserves the installed Electron response contracts. The same
binary owns material ingestion through its worker command. Startup with the
required database or HMAC key unavailable fails closed. Partially configured
object storage is rejected at startup.

Back up PostgreSQL metadata and object storage together. Retention deletion must remove metadata and objects through an audited job; never infer object keys in desktop code. To suspend access without deleting data, disable Knowledge Spaces for the affected accounts in the admin dashboard, stop the worker after its current lease, and retain both stores.

During rollback, redeploy the recorded last-known-good whole backend. Never
split one mutation family across deployments; rollback requires no row
conversion or destructive SQL.

The operational load script covers 200/500-row dashboard projection. With
`TEST_DATABASE_URL`, the PostgreSQL integration suite also admits 200 students
concurrently and verifies one participation and Attempt per user. Real
assignment/start/search latency gates require a disposable S3-compatible test
service.

The Rust `classroom_e2e` test applies the checked-in migration chain to a
disposable PostgreSQL database and exercises the desktop-facing flow through
Axum: room creation, lobby join, Run start, directive delivery and one-time
claim, Help and resolution, Ready and review, Leave, authentication rejection,
and the exact 200-participant capacity boundary.

## Teacher voice broadcasts and individual explanations

Open a live teacher session, then use the existing **Task** microphone gesture or
ordinary task composer: “Send Assignment 1” or “Explain Assignment 1 to the
class.” Dictation still inserts text. The assistant has two classroom tools:
`list_session_assignments` and `prepare_classroom_broadcast`. Preparation saves an
encrypted preview on the teacher's device. **Broadcast to class** is the explicit
send action. The card shows the exact session, published assignment and audience.

The session broadcast feed includes students who joined that session, including
later joiners while it remains open. Updated teacher and student clients are
required. The legacy Run directive feed remains separate. “Broadcast saved” means
the server persisted it; it does not mean every student displayed it. A save with
an unknown outcome is reconciled by receipt lookup, never automatically resent.

**Open assignment** resolves the student's existing Attempt for the selected
published Run. It does not start work. **Start explanation** uses that student's
own Tro account allowance and assignment context. **Explain without screen** is
available. Screen guidance uses existing screen permissions, refreshes on Next or
a question, and shows one grounded pointer at a time. It never clicks, types,
submits, grades, or treats a presented step as successful work. Each explanation
is limited to eight model requests, sixteen observations and ten minutes.

Students may opt into automatic explanation starts for the current session on
that device. Consent starts off, resets on leave/logout/restart, only applies to
new live notices while the device is idle, and never starts a reconnect backlog.
A busy device retains a manual notice. Two devices belonging to one student
cannot claim the same broadcast twice. Stop releases local presentation even if
status reporting is offline. Teacher activity counts describe explanation
lifecycle; they are not attention, delivery acknowledgements or learning results.

Migration 034 is the immutable, previously deployed Run explanation directive
migration from PR #61. Session broadcasts and individual guidance use migrations
035/036 in that history. Local databases that already applied PR #63 retain their
034 broadcasts and 035 guidance records and apply the legacy directive SQL as
036. Startup selects that history only for the exact known 034 checksum; SQLx
still validates every migration. Both histories reach the same schema at 036.
The upgrade preserves the deployed Run create/feed/claim contract and
its consent-required directives; updated desktops can read those existing notices
without automatically starting an explanation from them.

Deploy the compatible API and let startup complete migrations before updating
the desktop build. Capabilities
`classroomBroadcasts` and `classroomGuidance` each use contractVersion 1;
`knowledgeSpaces` remains version 2. Absent capabilities keep the existing manual
classroom workflow available. Rollback should disable the capabilities and retain
broadcast/start data, never drop tables or reinterpret guided work as Help.

## Assignment checks from the work app

During an open student assignment, **⌘⌥K** on macOS or **Ctrl+Alt+K** on
Windows/Linux checks the current work and shows a floating Tro panel. The main
window does not need to be opened. If the shortcut is already taken, the panel
provides **Check my work**. Normal typing, including number keys, remains in the
work app. Opening this panel does not register a start; **Start working** or an
accepted Check creates a Work Session and records the first `startedAt`.

The published teacher criteria define what is checked. A current-screen check
uses one capture and explicitly has partial coverage: hidden Scratch sprites,
unseen PDF pages, and off-screen code are not verified. A workspace check reads
supported saved text/code files only from a folder explicitly selected through
the native picker. It excludes hidden/build directories and symlinks, limits
discovery to 200 entries/depth 10, and reads at most 20 files, 20,000 characters
per file and 100,000 total. Oversized files (over 5 MiB), PDFs and `.sb3` archives
are omitted. Discovered entries are sorted before reading; a directory that
exceeds the enumeration budget is explicitly partial. Unsaved editor changes
and program execution are not checked. Up to six published reference excerpts
(12,000 characters total) can supply requirements, never proof of student work.

Tro makes one read-only model request with no tools. Each criterion receives
**Looks met**, **Needs work**, or **Could not verify**, backed by captured evidence
IDs. Missing context never becomes a pass. Typed feedback and relative evidence
labels/hashes are kept in the student's encrypted local task history; raw files
and screenshots are not added to the check report. Code and document text are
untrusted evidence and cannot authorize actions or change the teacher's criteria.

**Send for teacher review** is an explicit student action. For file assignments,
the panel opens the native picker, previews selected filenames and requires
**Submit files** before uploading. A successful check does not send work, award a
grade, or complete the assignment. Teacher **Complete** and **Return** remain the
official outcomes. Cancelled, stale or uncertain checks do not retry themselves.
Unknown submission responses are not replayed automatically.

The teacher dashboard shows start time and latest check execution state, without
sending private AI feedback or source content. Work Session PATCH requests are
ordered locally and lock the server session row; terminal states cannot regress.
A failed Check does not turn the assignment into a failed launch. If reporting
fails, the student sees that progress sync could not be confirmed.

Future Python execution, Scratch project readers, and full PDF extraction require
separate bounded reader/checker capabilities. Screen visibility alone does not
provide those capabilities.
