# Production membership gate TDD evidence

## Source

Journeys were derived from the rollout request during this TDD run. No external
plan file was used.

## User journeys

1. As a local developer, I can use TroCode without membership setup.
2. As a packaged-app user, I finish login and permissions, then either enter
   the workspace with active membership or see my reference and activation form.
3. As the administrator, I can issue an account-bound code for a chosen number
   of days without distributing the signing private key.
4. As the product owner, I need task and voice effects denied in the trusted
   main process when membership is missing, invalid, or expired.

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

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Development bypasses membership and does not read activation storage | `membership-service.test.ts` | Unit | PASS |
| 2 | Production fails closed without a valid Ed25519 public key | `membership-service.test.ts` | Unit/security | PASS |
| 3 | Valid codes are signature-checked, account-bound, persisted, and expired codes are denied | `membership-service.test.ts` | Unit/security | PASS |
| 4 | Activation codes are stored only through OS credential encryption | `membership-activation-store.test.ts` | Unit | PASS |
| 5 | Protected task IPC rejects authenticated users without membership | `register-ipc.test.ts` | Integration/security | PASS |
| 6 | Membership inspect/activate IPC validates and routes signed-in users | `register-ipc.test.ts` | Integration | PASS |
| 7 | CLI-issued codes are compatible with the application verifier | `membership-service.test.ts` | Integration | PASS |
| 8 | Only active or development-bypassed statuses admit the renderer workspace | `membership.test.ts` | Unit | PASS |

## Coverage and known gaps

The focused command
`npm exec -- vitest run src/main/membership/membership-service.test.ts src/main/membership/membership-activation-store.test.ts src/renderer/membership.test.ts --coverage --coverage.include='src/main/membership/*.ts' --coverage.include='src/renderer/membership.ts'`
passed 20 tests with 89.09% statements, 84.41% branches, 93.75% functions,
and 91.34% lines. These tests cover cryptographic verification, account
binding, expiry, encrypted persistence, local bypass, and the renderer access
policy. IPC authorization is covered by the full suite.

The React screen itself is covered by typecheck/package compilation rather
than a DOM test because this repository does not currently include a React DOM
test harness. Offline codes cannot be revoked early and rely on local system
time; an authenticated backend is the follow-up when those controls are
required.

No TDD checkpoint commits were created because the worktree already contained
unrelated user changes in overlapping files, and repository guidance requires
the full check and package gates before any commit.
