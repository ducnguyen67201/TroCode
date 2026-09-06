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
4. On the student computer, start the received guidance (or enable the existing
   idle auto-start option). Allow the required OS screen/microphone permissions.
5. Verify the student gets guidance based on that computer's current screen and
   the selected assignment. Broadcasts distribute instructions; each student's
   local agent observes its own context.

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
