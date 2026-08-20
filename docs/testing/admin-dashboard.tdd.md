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

## RED / GREEN report

- RED: `npm --prefix services/api test` failed on the new admin imports,
  blocked-account behavior, admin configuration, migration count, and browser
  origin delegation. The failures were the intended missing-feature signal.
- GREEN: `npm --prefix services/api test` passed 86 runnable tests with one
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

## Coverage and browser QA

`node --test --experimental-test-coverage` over the focused inventory suite
reported 86.49% line coverage for the cipher, 83.74% for the admin HTTP
controller, 93.45% for the admin repository, and 100% for the migration runner.
The transitive aggregate is 76.51% because the focused tests import the
pre-existing access-code repository and HTTP primitives, which have separate
suites.

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

## Known gaps

- The real PostgreSQL integration test remains environment-gated and was not
  run because `TEST_DATABASE_URL` was not configured.
- The current production browser extension was unavailable for a new automated
  click-through, so production verification used authenticated HTTP smoke
  checks. Earlier seeded desktop/mobile browser QA covers the shared dashboard
  shell; the new code inventory is covered by repository and HTTP integration
  tests.
- The two access codes created before migration 012 contain only one-way
  digests. Their metadata remains visible, but their original plaintext cannot
  be reconstructed. New dashboard-generated codes are retrievable.
