# Approval loop prevention — TDD evidence

## Source and user journeys

No plan file was supplied. The journeys were derived from the reported desktop approval loop:

- As a user completing a desktop task, I want one exact approval decision to either dispatch that held action once or stop safely, so the same approval cannot be requested in a loop.
- As a user, I want approval decisions to remain mine, so TroCode can never click or otherwise operate its own approval UI.
- As a user, I want a changed screen after approval to stop safely once, so the agent cannot re-enter an approval-request loop.

## Task report

1. Preserved the host-owned exact approval boundary for desktop click, drag, typing, and keypress operations while adding loop prevention around that boundary.
   - RED: `npm exec -- vitest run src/main/agent/policy.test.ts src/main/agent/execution-coordinator.test.ts`
   - Evidence: 6 intended failures showed that an over-broad draft would have let model-declared benign operations bypass host approval and let two coordinator flows proceed without approval.
   - GREEN: the same focused suite passed after restoring host approval independently of model-declared consequence.
2. Added self-approval regression coverage using the reported TroCode approval phrasings and made that denial terminal for the current task.
   - RED: `npm exec -- vitest run src/main/agent/policy.test.ts`
   - Evidence: 2 additional screenshot-derived phrasings were incorrectly allowed.
   - GREEN: all three phrasings are denied by the host policy before dispatch or approval creation.
3. Added defense-in-depth model guidance that TroCode must never operate its own approval controls.
   - RED: `npm exec -- vitest run src/main/agent/responses-agent.test.ts`
   - Evidence: 1 intended failure because the instruction was absent.
   - GREEN: the focused agent test passed after adding the instruction.
4. Verified repository and package gates.
   - `npm run check`: PASS after merging current `main` — lint, typecheck, 59 Vitest files / 364 tests, 6 script tests, and 15 API tests.
   - `npm run package`: PASS — Electron Forge packaged the arm64 macOS application.

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Desktop click, drag, typing, and keypress operations require host approval even when the model calls them benign | `src/main/agent/policy.test.ts` | Unit | PASS |
| 2 | A sensitive declared desktop consequence can only escalate to exact approval; it cannot bypass the host boundary | `src/main/agent/policy.test.ts` | Unit | PASS |
| 3 | Screenshot-derived attempts to approve inside TroCode are denied | `src/main/agent/policy.test.ts` | Unit | PASS |
| 4 | A self-approval attempt creates no pending approval, dispatches no desktop command, and blocks the task | `src/main/agent/execution-coordinator.test.ts` | Integration | PASS |
| 5 | A changed screen after approval dispatches nothing and stops without another model sample | `src/main/agent/execution-coordinator.test.ts` | Integration | PASS |
| 6 | The model receives an explicit instruction that TroCode approval UI is user-only | `src/main/agent/responses-agent.test.ts` | Unit | PASS |

## Coverage and known gaps

`npm run test:coverage` passed all 364 Vitest tests with 81.16% statements, 84.36% lines, 88.03% functions, and 69.95% branches. The changed policy module is covered at 97.67% statements / 88.88% branches; the coordinator remains above 80% line coverage. The repository's aggregate branch coverage is below 80% and is not enforced by the current test configuration.

No E2E test was added because the defect is enforced at pure policy and coordinator boundaries with mocked CUA dispatch; the complete packaged application gate passed.

## Merge evidence

RED and GREEN evidence is recorded above. Separate checkpoint commits were intentionally not created because the shared worktree already contained user-owned, in-progress edits in the same coordinator and agent files; committing those stages independently would have captured or split unrelated work.
