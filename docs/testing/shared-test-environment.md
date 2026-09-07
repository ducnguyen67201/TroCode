# Two-computer classroom test

Both computers run the desktop locally and connect to the same hosted test API.
They do not need Docker, a local API, a shared Wi-Fi network, or an incoming port.

| Setting | Value |
| --- | --- |
| Doppler project/config | `tro-app` / `stg` (staging) |
| Railway project/environment | `trohoc-site` / `test` |
| API | `https://api-test-test-d2da.up.railway.app` |
| API service | `api-test` |
| Ingestion worker | `ingestion-test` |
| Database | `Postgres-9YEL` (fresh test database) |
| Object storage | `tro-test-knowledge` (private test bucket) |
| Desktop name and profile directory | `Tro Test` |
| macOS bundle ID | `com.trocode.desktop.test` |

## Start each computer

Install the repository's supported Node.js version, Rust toolchain, platform build
prerequisites, and Doppler CLI. Both operators need access to `tro-app/stg`.
Use the same revision of this repository on both computers. From that checkout:

```bash
npm ci
npm run agent-sdk:install
doppler login
npm run start:test
```

The first two commands are needed after initial checkout or dependency updates;
Doppler login is needed once per computer. Subsequent launches use only:

```bash
npm run start:test
```

The command reads `tro-app/stg` explicitly, checks the exact test API URL and
Google OAuth configuration, verifies `/readyz`, builds the local Agents SDK
runtime, and starts Electron. It does not start Postgres or kill other app
processes. `npm test` continues to run automated tests.

Tro Test has separate login storage and a separate single-instance lock from
Tro and Tro Development. Its renderer/logger ports are 3011/9101. Forge still
uses its normal `.webpack` build directory: use separate checkouts if running
ordinary development and test builds concurrently on one machine.

Sign in with **different Google accounts** on the teacher and student computers.
The fresh database has no production users, memberships, assignments, or classes.
After first sign-in, use the test admin at
`https://api-test-test-d2da.up.railway.app/source/admin` to enable Knowledge Spaces
and assign Teacher and Student classroom roles to the two test users. Retrieve
its admin credential from **Doppler `tro-app/stg`, `TROCODE_ADMIN_ACCESS_TOKEN`**.
Grant a test access code in that admin if the chosen test needs a paid plan.
Production access codes and room codes do not apply here.

### Access for teacher-added students

Give the class owner a shared access code with enough seats for the teacher and
students. After the teacher adds an existing Student account to the class roster,
the student's next access check claims a seat on that code without code entry.
This also applies to rosters created before the fix: sign in, or select **Check
again** on the access screen. The hosted staging API must run the updated backend;
updating only the desktop checkout does not change staging access checks.

Verify the student receives the code's plan and that repeated checks consume only
one seat. Paused/full codes and classes with different owner codes report an
actionable error. Existing redemptions and reserved organization seats are left
unchanged; organization codes still require organization assignment. A claimed
shared-code seat is a normal persistent redemption, not a class-scoped lease, so
removing a student from the roster does not revoke that redemption. Existing Free
access remains usable when no shared-code seat can be claimed.

### Classroom broadcast acceptance

1. On the teacher computer, create the class workspace, publish Assignment 1,
   and start a live class.
2. On the student computer, join with the new test room code.
3. On the teacher computer, use regular Ask Tro voice to say:
   “Explain Assignment 1 to this class.” Review the prepared broadcast and send it.
4. New teacher explanations start automatically on idle student devices after
   the live session feed is established. Existing or reconnecting feed snapshots
   still require **Start explanation**. Allow the required OS screen/microphone
   permissions; without screen access, explanations use text only. Students can
   disable automatic explanations in the class controls.
5. Verify the student gets guidance based on that computer's current screen and
   the selected assignment. Broadcasts distribute instructions; each student's
   local agent observes its own context.

Joining a room enables automatic opening of links approved by the published
Activity. Students can turn it off in the class controls; refreshing or rejoining
the same active Attempt preserves that choice. Restoring a room after restarting
the app keeps automatic links off until the student enables them or explicitly
leaves and joins again. Sites absent from **Websites Tro may open automatically**
remain manual-only, and old directives are not retried just because a toggle changes.

## Packaged test app

```bash
npm run package:test
```

This produces a `Tro Test` app under `out/` with the test URL compiled in; build
it natively for the receiving computer's OS and CPU architecture. Server-side
secrets are not compiled in. **Use `npm run start:test` for the two-computer
test.** The current Rust desktop OAuth exchange reads
`GOOGLE_OAUTH_CLIENT_SECRET` from its process environment. A standalone package
launched from Finder does not receive Doppler configuration, and Google sign-in
failed in that launch mode. Standalone OAuth configuration needs a separate fix;
packaging verification below covers building the artifact, not completed sign-in.
The test app uses the same isolated profile whether launched through Forge or
as a package. Package creation validates configuration but does not require the
API to be online. Signing credentials are forwarded only to packaging.
Production auto-updates are disabled for Tro Test; install a new test build
manually. Signing and distribution requirements remain platform-specific.

## Operations

Test API and worker follow GitHub `main`. Railway builds at repository root with
`cargo build --manifest-path services/api/Cargo.toml --release --locked`, then
copies `target/release/trocode-api` to `bin/trocode-api`. The API starts with
`./bin/trocode-api serve`; the worker starts with
`./bin/trocode-api ingestion-worker`. These explicit Railway settings mirror `services/api/railway.json` and
`services/api/railway.worker.json`; update the test service settings too if those
commands change.

Health checks:

```bash
curl --fail https://api-test-test-d2da.up.railway.app/healthz
curl --fail https://api-test-test-d2da.up.railway.app/readyz
```

Doppler `stg` is the administrative source for test secrets. Initial provider and
Google OAuth settings were copied from `dev`; session HMAC and admin secrets
were generated independently. Test provider calls use the development provider
accounts and are billable normally. PostHog collection is disabled for this
launcher.

Doppler can flag a secret as missing simply because another config defines it.
`TROCODE_POSTGRES_PASSWORD` belongs only in local development configs: Docker
Compose reads it, while hosted staging uses `DATABASE_URL`. Do not copy the local
database password into staging to clear that warning. The retired hosted-agent
protocol, state-encryption, backend-agent rollout, intent-authorization rollout,
membership public-key, and planner model variables are no longer runtime
configuration. Historical implementation plans may still mention them.

Railway runtime variables were populated from `stg`; this is not an automatic
Doppler integration. After changing a backend secret in Doppler, update that
variable in both test services through Railway's Variables panel and redeploy
them. Keep secret values out of source files, command arguments, and logs.

Use these exact selectors for test operations:

- Project: `3e8515d0-43a9-4b6c-bdbf-f45402d8dfd1`
- Environment: `c3f77285-4f76-4d9c-8e0e-4a9a3390ae3d`
- API: `dcd59870-ce1c-49a1-94d2-71f6e5a8f301`
- Worker: `7f14bfb8-2207-4c1f-ad42-d0c9d70958ee`

The database URL uses Railway's environment-local
`${{Postgres-9YEL.DATABASE_URL}}` reference; do not replace it with a local or
production database URL. Deploying `main` changes code but preserves the
separate database, bucket, and session keys. No production data was copied.

## Initial verification (2026-09-05)

- API deployment `ff335420-9fc0-46bd-9682-6d8b57d42e37` and worker deployment
  `fe22ab72-26fa-4789-b336-1f69c15e646f` reached Railway `SUCCESS` from main
  revision `7ba076e70dc35544d82379d673822c6c7ea1fa2d`.
- `/healthz` and `/readyz` returned HTTP 200; readiness reported database OK.
- Test admin authentication succeeded and reported zero users. Production's
  environment configuration was compared before/after and was unchanged.
- The test bucket accepted an owned smoke object and returned its expected
  size via HEAD; the object was deleted afterward.
- `npm run check`, `npm run package`, and `npm run package:test` passed.
  Desktop coverage: 914 tests; Agents SDK: 24 tests; enabled Rust checks/tests
  passed. Runtime npm audit found zero vulnerabilities; the full dependency
  tree retained three pre-existing moderate development-tool advisories.
- Test package metadata uses `com.trocode.desktop.test`; its ASAR contains the
  test API URL and no configured server-secret values. The regular package
  retains `com.trocode.desktop` and the production API URL.
- `npm run start:test` launched to Google sign-in. Two-person Google sign-in,
  voice broadcast, and student screen-guidance acceptance still require the
  two test accounts and computers.

## Teacher lesson execution acceptance

This flow requires the classroom lesson change on the API **and both desktop
checkouts**, not only a merged PR. Restart Tro Test after updating each checkout.
Confirm the signed-in capabilities response includes
`classroomLessons.contractVersion: 1`. Migration 037 must be applied by the API.
Use different teacher/student accounts and the shared staging configuration above.
The teacher's lesson progress panel shows student build and heartbeat information.
An absent heartbeat is unknown connectivity/version, not proof of a finished run.

For a deterministic browser interaction test, the test API operator can enable
`TROCODE_CLASSROOM_TEST_FIXTURE_ENABLED=true` in the **test deployment only**, after
an authorized deployment. Open
`https://api-test-test-d2da.up.railway.app/classroom-test/python-editor` in Chrome.
Its output is deliberately simulated. Repeat the full flow against the teacher's
real Python editor before accepting Python execution behavior. No request/query
parameter enables the fixture when its deployment flag is false.

Prepare a published `current_surface` Activity with the exact test material origin
in **Websites Tro may open automatically**, and a guidance policy that allows
answers for this teacher demonstration. Publish criteria for reading input,
constructing a greeting, and explaining the result. Workspace activities and
restricted-answer demonstrations are unsupported by the first release.

1. Start the class. On the student computer, grant screen recording/accessibility,
   open Chrome, and join with the current room code. Wait for the live feed before
   sending. New joins disclose automatic lessons; restored sessions require the
   student to enable the control or select **Start lesson**.
2. Teacher: select the assignment, **Teach a lesson**, **Browser exercise**, and
   enter the complete approved HTTPS URL. Set a short objective such as “Read a
   name, then extend the greeting with a hobby.”
3. Fill four steps: Explain the name input; Demonstrate a small name-only example
   with an explicit expected output; Practice adding the hobby independently;
   Check against the published criteria. Use an empty editor for the demo. Select
   **Preview exact lesson**, review audience/material/modes/example, then
   **Broadcast lesson**. Preparing alone must not send or move the student cursor.
4. Student: verify **Opening material** is visible before guidance. Chrome must
   display the exact reviewed page. The explanation points/narrates without typing.
   Select **Next step** to start the demonstration. Observe actual typing/clicks
   and result verification, then select **Next step** to practice. A received
   announcement or an HTTP send receipt alone does not pass this test.
5. During practice, verify Tro stops typing. Enter student work, select **Ask for
   help**, and ask a concrete question. The help child must use the current student
   work, leave it unchanged and return to the same practice step. Select **Check
   my work**; verify criterion feedback and teacher progress agree. No submission,
   numerical grade, or assignment completion should occur automatically.
6. Select **Next step** for the planned Check and **Finish lesson** at the end.
   Teacher: review roster outcomes, step, blocked reason and build. Use
   **Prepare another lesson** to test a fresh broadcast.

Failure exercises (record observed results separately on each platform):

- Use different student screen/window sizes; no teacher coordinates are replayed.
- Select Pause/Stop both from Class updates and the floating Tro/task controls.
  Verify native actions stop and a later ordinary task can acquire the device.
- Open the fixture with `?prefilled=true`; the demonstration must leave existing
  work intact and explain the blocker. Also test a wrong URL/app and missing OS
  permissions before any input effect.
- Opt out, send while another task is busy, reconnect, and restart. Initial
  snapshots require explicit Start. Unknown in-flight effects remain unknown and
  cannot automatically resume. Teacher Stop/close/removal blocks subsequent work.
- Lose a commit/start response and retry only the receipt lookup. Repeated feed
  delivery, duplicate Next, and two devices using the same student account must
  not create duplicate work sessions or simultaneous demonstration owners.
- Try assignment instructions and a pinned ready source as materials. Verify
  source text is acknowledged in Tro, pages can be read, and no original PDF
  layout or unseen screenshot is claimed. Check without visible work returns
  insufficient evidence.
- Test a class larger than 100 recipients with progress pagination, plus an old
  desktop/API combination. Missing lesson support must be actionable; legacy
  broadcasts retain their previous behavior.

Record API revision, both desktop revisions, OS/Chrome versions, lesson/step/task
IDs, observed native effects, final feedback and teacher progress. Keep student
work, screenshots and credentials out of the public report. This implementation's
local report distinguishes source review, CI status and physical acceptance.
