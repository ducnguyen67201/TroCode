# Production access-code gate TDD evidence

## Source

Journeys were derived from the rollout request during this TDD run. No external
plan file was used.

## User journeys

1. As a local developer, I can use TroCode without membership setup.
2. As a hosted packaged-app user, I finish login, immediately see the shared
   access-code field, and reach permission onboarding only after activation.
3. As the administrator, I can create `CODEA` with a ten-account limit without
   writing database rows manually or storing plaintext codes.
4. As the product owner, I need each Google account tied to one code and need
   concurrent redemptions to stop exactly at the configured limit.
5. As an offline packaged-app user, I retain the signed account-bound fallback.

## Task report

- RED: `npm test -- src/main/membership/membership-service.test.ts` failed
  because `membership-service` did not exist.
- GREEN: focused membership, encrypted-store, IPC, auth, and renderer policy
  tests passed after implementation.
- RED: the IPC suite admitted task submission without membership and did not
  register membership handlers.
- GREEN: task and voice effects now pass through main-process membership
  authorization while permission-onboarding calls remain available after login.
- RED: the administrator CLI compatibility test failed because
  `scripts/membership-codes.mjs` did not exist.
- GREEN: codes issued by the CLI activate through the same verifier used by the
  packaged application.
- RED: hosted sessions entered the workspace without any database-backed code,
  and the API proxy accepted authenticated users regardless of membership.
- GREEN: hosted status and redemption endpoints now enforce one code per user,
  serialize quota updates with row locks, and protect every provider proxy.
- RED: code creation required manual database knowledge.
- GREEN: `npm run access-code:create` applies migrations and stores only the
  normalized keyed HMAC digest plus its user limit.
- RED: a fresh packaged install delayed membership lookup and the access-code
  field until language and Windows permission onboarding completed.
- GREEN: membership lookup now starts immediately after Google sign-in, the
  membership gate takes precedence, and CUA permission inspection stays idle
  until access is active.

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Development bypasses membership while every packaged build requires it | `membership-service.test.ts` | Unit | PASS |
| 2 | Offline production fails closed without a valid Ed25519 public key | `membership-service.test.ts` | Unit/security | PASS |
| 3 | Valid codes are signature-checked, account-bound, persisted, and expired codes are denied | `membership-service.test.ts` | Unit/security | PASS |
| 4 | Activation codes are stored only through OS credential encryption | `membership-activation-store.test.ts` | Unit | PASS |
| 5 | Protected task IPC rejects authenticated users without membership | `register-ipc.test.ts` | Integration/security | PASS |
| 6 | Membership inspect/activate IPC validates and routes signed-in users | `register-ipc.test.ts` | Integration | PASS |
| 7 | CLI-issued codes are compatible with the application verifier | `membership-service.test.ts` | Integration | PASS |
| 8 | Only active or development-bypassed statuses admit the renderer workspace | `membership.test.ts` | Unit | PASS |
| 9 | Hosted codes are case-normalized and stored only as keyed HMAC digests | `access-code-repository.test.mjs` | Unit/security | PASS |
| 10 | User and code rows are locked before quota checks and full codes do not insert | `access-code-repository.test.mjs` | Unit/concurrency | PASS |
| 11 | One account cannot switch to a second code | `server.test.mjs`, `access-code-repository.test.mjs` | Integration/security | PASS |
| 12 | A code at its user limit rejects new accounts while existing accounts remain active | `server.test.mjs` | Integration | PASS |
| 13 | Hosted model, realtime, and speech proxies deny authenticated users without a redemption | `server.test.mjs` | Integration/security | PASS |
| 14 | All checked-in SQL migrations run in order | `migrate.test.mjs` | Unit | PASS |
| 15 | A signed-in user sees membership before first-run language and permission onboarding | `membership.test.ts` | Unit/regression | PASS |

## Coverage and known gaps

The focused command
`npm exec -- vitest run src/main/membership/membership-service.test.ts src/main/membership/membership-activation-store.test.ts src/renderer/membership.test.ts --coverage --coverage.include='src/main/membership/*.ts' --coverage.include='src/renderer/membership.ts'`
covers cryptographic verification, account binding, expiry, encrypted
persistence, local bypass, and the renderer access policy. Hosted API tests add
quota, one-code-per-account, row-lock, migration, and provider-boundary
coverage. IPC authorization is covered by the full suite.

The React screen itself is covered by typecheck/package compilation rather
than a DOM test because this repository does not currently include a React DOM
test harness. Hosted account-to-code links are intentionally permanent in this
version. Offline codes cannot be revoked early and rely on local system time.

No TDD checkpoint commits were created; the implementation is shipped as one
focused PR after the repository check and package gates.
