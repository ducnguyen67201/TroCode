# Admin dashboard TDD evidence

## Source and user journeys

The journeys were derived from the implementation request; no external plan
file was used.

1. As an administrator, I can open a separate `/source/admin` dashboard and
   see registered users, plans, access-code labels, last-seen dates, and access
   status.
2. As an administrator, I can block an account so its active sessions are
   revoked and future sessions are denied; I can also reverse that decision.
3. As an administrator, I can generate 1–100 codes at once, choosing the plan
   and the number of users admitted by each code.
4. As the service owner, I can rely on the page and API being protected by an
   opt-in server secret, same-origin browser checks, bounded inputs, rate
   limits, strict CSP, parameterized SQL, and encrypted code storage.
5. As an administrator, I can open an Access codes view and inspect the exact
   value, plan, label, capacity, usage, creation date, and status of codes
   created after encrypted retrieval was enabled.
6. As an administrator, I can still inspect metadata for legacy digest-only
   codes without the system pretending their unrecoverable plaintext exists.
7. As an administrator, I can sign in once and keep this browser authenticated
   for 30 days without persisting the raw admin token in page-accessible
   storage; Lock signs the browser out.
8. As an administrator, I can see how many seats each code has used and open a
   paginated list of the users who redeemed it, including redemption date and
   current active or blocked status.
9. As an administrator, I can pause or resume a code, permanently delete an
   unused code after confirmation, and continue creating new code batches from
   the same Access codes page. Pausing blocks only new redemptions; existing
   users retain access, and codes with redemption history cannot be deleted.

## RED / GREEN report

- RED: `npm --prefix services/api test` failed on the new admin imports,
  blocked-account behavior, admin configuration, migration count, and browser
  origin delegation. The failures were the intended missing-feature signal.
- GREEN: `npm --prefix services/api test` passed 95 runnable tests with one
  PostgreSQL integration test skipped because `TEST_DATABASE_URL` was not set.
- Repository gate: `npm run check` passed 96 Vitest files / 662 tests, 9 root
  Node tests, and the API suite.
- Packaging gate: `npm run package` successfully produced the Darwin arm64
  Electron package.
- Dependency audit: both `npm audit --audit-level=high` and
  `npm --prefix services/api audit --audit-level=high` reported zero known
  vulnerabilities.
- Access-code inventory RED checkpoint: commit `f4544cb` captured missing
  encryption, migration, listing API, and inventory-page failures.
- Access-code inventory GREEN checkpoint: commit `d9de307` passed the same 14
  focused tests after implementing the encrypted, backward-compatible path.
- Persistent-session RED checkpoint: commit `c2660fc` captured missing signed
  sessions, secure cookie issuance, reload restoration, and logout clearing.
- Persistent-session GREEN checkpoint: commit `2641158` passed the same 11
  focused tests after adding the signed HttpOnly session flow. Commit `36e4fa6`
  then cleared the raw token from the hidden login form after cookie issuance.
- Code-user detail RED checkpoint: commit `3145598` captured the missing
  repository query, protected route, and dashboard dialog.
- Code-user detail GREEN checkpoint: commit `478faf3` passed all 17 focused
  tests after adding the bounded user-detail flow.
- Access-code lifecycle RED checkpoint: commit `4d05c58` captured missing
  pause/resume, guarded-delete, paused-redemption, dashboard-action, and
  migration behavior in nine intended test failures.
- Access-code lifecycle GREEN checkpoint: commit `1e4f2cf` passed all 47
  focused tests after adding transactional lifecycle controls and the
  forward-only migration.

## Test specification

| # | What is guaranteed | Evidence | Type | Result |
|---|---|---|---|---|
| 1 | The dashboard page and static assets are served with a self-only script/style CSP and no embedded admin token. | `services/api/test/admin-http-controller.test.mjs` | Integration | PASS |
| 2 | Missing/invalid admin tokens and cross-origin browser requests are denied. | `services/api/test/admin-http-controller.test.mjs` | Security integration | PASS |
| 3 | User pagination/search values and code-batch inputs are bounded and validated. | `services/api/test/admin-http-controller.test.mjs` | Integration | PASS |
| 4 | User rows expose only bounded admin metadata and use parameterized pagination/search queries. | `services/api/test/admin-repository.test.mjs` | Unit | PASS |
| 5 | Blocking a user revokes active device sessions in the same transaction. | `services/api/test/admin-repository.test.mjs` | Unit | PASS |
| 6 | Blocked users cannot obtain or authenticate a hosted session. | `services/api/test/session-repository.test.mjs` | Unit | PASS |
| 7 | A blocked account resolves to inactive membership status. | `services/api/test/access-code-repository.test.mjs` | Unit | PASS |
| 8 | Bulk code creation is atomic, returns plaintext, and stores an HMAC digest plus an AES-256-GCM encrypted copy rather than plaintext. | `services/api/test/admin-repository.test.mjs` | Unit | PASS |
| 9 | Admin support is disabled without a token and rejects tokens shorter than 32 characters. | `services/api/test/config.test.mjs` | Unit | PASS |
| 10 | Admin browser requests are delegated before the Electron API's browser-origin denial. | `services/api/test/server.test.mjs` | Integration | PASS |
| 11 | The block and audit schema is included in forward migration order. | `services/api/test/migrate.test.mjs` | Unit | PASS |
| 12 | Encrypted access codes round-trip under the server key, use randomized nonces, contain no plaintext bytes, and reject a mismatched digest. | `services/api/test/access-code-cipher.test.mjs` | Security unit | PASS |
| 13 | The code inventory reports capacity, usage, status, retrieval availability, and legacy metadata with bounded parameterized pagination. | `services/api/test/admin-repository.test.mjs` | Unit | PASS |
| 14 | The protected code-list API supports bounded search/status filters and sends `Cache-Control: no-store`. | `services/api/test/admin-http-controller.test.mjs` | Security integration | PASS |
| 15 | The Access codes page and navigation are present in the strict-CSP dashboard. | `services/api/test/admin-http-controller.test.mjs` | Integration | PASS |
| 16 | The nullable encrypted-code column is included as the twelfth forward-only migration, preserving legacy digest-only rows. | `services/api/test/migrate.test.mjs` | Unit | PASS |
| 17 | Admin browser sessions expire after 30 days and fail verification after tampering or admin-token rotation. | `services/api/test/admin-session.test.mjs` | Security unit | PASS |
| 18 | The persistent cookie contains no raw token and is `HttpOnly`, `Secure`, `SameSite=Strict`, path-scoped to `/`, and bounded by `Max-Age`. | `services/api/test/admin-session.test.mjs` | Security unit | PASS |
| 19 | A bearer-token login issues the cookie, and the cookie alone authenticates a later request as it would after a reload. | `services/api/test/admin-http-controller.test.mjs` | Security integration | PASS |
| 20 | Lock clears the cookie with `Max-Age=0` and no-store response semantics. | `services/api/test/admin-http-controller.test.mjs` | Security integration | PASS |
| 21 | Each access code returns its redeemers in deterministic, parameterized, bounded pages with redemption dates and current active/blocked status. | `services/api/test/admin-repository.test.mjs` | Unit | PASS |
| 22 | The code-user route validates UUID and pagination inputs, is protected by the common admin boundary, is non-cacheable, and returns 404 for missing codes. | `services/api/test/admin-http-controller.test.mjs` | Security integration | PASS |
| 23 | The deployed dashboard includes a dedicated “Who’s using it” column and protected detail dialog. | `services/api/test/admin-http-controller.test.mjs` | Integration | PASS |
| 24 | Paused codes reject new redemptions while existing linked accounts continue to resolve their current membership. | `services/api/test/access-code-repository.test.mjs`, `services/api/test/server.test.mjs` | Unit / integration | PASS |
| 25 | Pause and resume update the code and append a sanitized audit event in one transaction; a resumed full code remains accurately reported as full. | `services/api/test/admin-repository.test.mjs` | Unit | PASS |
| 26 | Delete locks the code row and refuses any code with redemptions before issuing a delete, preserving user and audit history. | `services/api/test/admin-repository.test.mjs` | Security unit | PASS |
| 27 | Lifecycle routes require common admin authorization, strict UUID/body validation, and return conflict for a used-code deletion. | `services/api/test/admin-http-controller.test.mjs` | Security integration | PASS |
| 28 | The dashboard exposes Pause/Resume and confirmed Delete actions while leaving bulk New code creation available. | `services/api/test/admin-http-controller.test.mjs` | Integration | PASS |
| 29 | The nullable pause timestamp and expanded audit actions are included as the thirteenth forward-only migration. | `services/api/test/migrate.test.mjs` | Unit | PASS |

## Coverage and browser QA

`node --test --experimental-test-coverage` over the focused inventory suite
reported 86.49% line coverage for the cipher, 83.74% for the admin HTTP
controller, 93.45% for the admin repository, and 100% for the migration runner.
The transitive aggregate is 76.51% because the focused tests import the
pre-existing access-code repository and HTTP primitives, which have separate
suites.

The persistent-session focused suite reported 92.22% line coverage for the
session signer/verifier, 85.49% for the admin HTTP controller, and 86.60%
aggregate line coverage across its transitive source files.

The final 17-test admin-focused suite reported 90.89% aggregate line coverage
across the admin controller, repository, and session modules; the controller
and repository individually reported 86.57% and 94.32%.

The final 22-test lifecycle-focused admin suite reported 90.95% aggregate line
coverage across the admin controller, repository, and session modules; the
controller and repository individually reported 86.96% and 93.70%. The full
repository gate passed 96 Vitest files / 662 tests, 9 root Node tests, and 102
runnable API tests; one PostgreSQL-only integration test remained skipped.

A local seeded preview was exercised in headless Chrome at 1440×1000 and
390×844. Login, user rendering, block confirmation, summary refresh, bulk code
generation, and responsive layout all completed without console errors or
failed network responses. The mobile page had no body-level horizontal
overflow; dense rows switch to a card layout. No committed visual baseline
exists, so visual-regression comparison is **INCONCLUSIVE** rather than a pass.

The encrypted-code release was canary-deployed to the isolated Railway service
before production. Production deployment `e25821df-7e19-4bc2-8e39-6049fe1c5266`
then passed `/healthz`, `/readyz`, strict-CSP dashboard delivery, unauthenticated
`401`, authenticated users, and authenticated code-inventory smoke checks. The
live current-database snapshot reported 6 users, 2 legacy codes, and 1
redemption without logging token or code values.

Persistent sessions were canary-deployed as
`9366bc07-29c7-4783-8216-18965781dd2d`, where login, cookie restoration,
logout, and post-logout denial returned `204`, `200`, `204`, and `401`.
Production deployment `b15a8217-6223-449c-bc6a-ec05203dd5ff` passed the same
flow, confirmed all hardening flags, confirmed the cookie did not contain the
admin token, and retained access to all 6 current-database users.

Code-user details were canary-deployed as
`e95bc291-c358-48fb-b40a-89448bd18517`; health, readiness, anonymous denial,
dashboard assets, inventory, and an empty bounded code-user result all passed.
Production deployment `b7d637e6-b0b9-4cec-9f5d-ddb66572ab46` then passed the
same read-only checks against the current Tro database. The safe snapshot
reported 2 codes, 1 redemption, and one active redeemer on the used code;
tokens, code values, names, and emails were not printed.

## Known gaps

- The real PostgreSQL integration test remains environment-gated and was not
  run because `TEST_DATABASE_URL` was not configured.
- The browser automation extension was unavailable for a new automated
  click-through, so visual regression for the new detail dialog is
  **INCONCLUSIVE**. Production verification used authenticated, read-only HTTP
  smoke checks; the interaction and data contracts are covered by repository
  and HTTP integration tests.
- The two access codes created before migration 012 contain only one-way
  digests. Their metadata remains visible, but their original plaintext cannot
  be reconstructed. New dashboard-generated codes are retrievable.
