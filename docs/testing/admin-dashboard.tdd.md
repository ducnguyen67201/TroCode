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
   limits, strict CSP, parameterized SQL, and one-time plaintext code display.

## RED / GREEN report

- RED: `npm --prefix services/api test` failed on the new admin imports,
  blocked-account behavior, admin configuration, migration count, and browser
  origin delegation. The failures were the intended missing-feature signal.
- GREEN: `npm --prefix services/api test` passed 82 runnable tests with one
  PostgreSQL integration test skipped because `TEST_DATABASE_URL` was not set.
- Repository gate: `npm run check` passed 96 Vitest files / 662 tests, 9 root
  Node tests, and the API suite.
- Packaging gate: `npm run package` successfully produced the Darwin arm64
  Electron package.
- Dependency audit: both `npm audit --audit-level=high` and
  `npm --prefix services/api audit --audit-level=high` reported zero known
  vulnerabilities.

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
| 8 | Bulk code creation is atomic, returns plaintext once, and sends only HMAC digests to PostgreSQL. | `services/api/test/admin-repository.test.mjs` | Unit | PASS |
| 9 | Admin support is disabled without a token and rejects tokens shorter than 32 characters. | `services/api/test/config.test.mjs` | Unit | PASS |
| 10 | Admin browser requests are delegated before the Electron API's browser-origin denial. | `services/api/test/server.test.mjs` | Integration | PASS |
| 11 | The block and audit schema is included in forward migration order. | `services/api/test/migrate.test.mjs` | Unit | PASS |

## Coverage and browser QA

`node --experimental-test-coverage --test
services/api/test/admin-http-controller.test.mjs
services/api/test/admin-repository.test.mjs` reported 83.40% line coverage for
the admin HTTP controller and 92.51% for the admin repository. The aggregate
report is lower because those tests also import existing shared access-code and
HTTP modules that have their own suites.

A local seeded preview was exercised in headless Chrome at 1440×1000 and
390×844. Login, user rendering, block confirmation, summary refresh, bulk code
generation, and responsive layout all completed without console errors or
failed network responses. The mobile page had no body-level horizontal
overflow; dense rows switch to a card layout. No committed visual baseline
exists, so visual-regression comparison is **INCONCLUSIVE** rather than a pass.

## Known gaps

- The real PostgreSQL integration test remains environment-gated and was not
  run because `TEST_DATABASE_URL` was not configured.
- Automated browser QA used seeded local data and a test token, not production
  credentials or production mutations.
