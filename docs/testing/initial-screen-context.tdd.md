# Initial screen context TDD evidence

## Source

No plan file was provided. The journeys and guarantees were derived from the
reported Google Sheets failure and the approved selective-observation design.

## User journeys

- As an Everyday agent user with a sheet already open, I want TroCode to see
  the current screen before its first model response so it can act without
  asking where to create the sheet.
- As a user asking a self-contained text question, I want TroCode to avoid an
  unnecessary screenshot and image charge.
- As a user approving a consequential desktop action, I want the existing
  fresh-screen fingerprint check to remain enforced.

## Task report

### Initial observation and first multimodal request

- RED: `npm exec -- vitest run src/main/agent/execution-coordinator.test.ts src/main/agent/openai-agents-runtime.test.ts`
  failed 2 of 31 tests. CUA had zero calls before the first sample, and the
  hosted request contained only the text request.
- GREEN: `npm exec -- vitest run src/main/agent/completion-policy.test.ts src/main/agent/execution-coordinator.test.ts src/main/agent/openai-agents-runtime.test.ts && npm run typecheck`
  passed 47 tests and TypeScript validation.
- Evidence commits: `d27e83b` (RED) and `187c1fa` (GREEN).

### Selective local routing

- RED: `npm exec -- vitest run src/main/agent/completion-policy.test.ts`
  failed 8 new cases because the routing function did not exist.
- GREEN: the focused three-file run above passed all 47 tests.
- Evidence commits: `173a1e5` (RED) and `187c1fa` (GREEN).

### False-positive hardening

- RED: `npm exec -- vitest run src/main/agent/completion-policy.test.ts`
  failed the `vegetables` substring and drafting-only email cases.
- GREEN: the policy suite passed 18 tests; coordinator/runtime suites passed
  31 tests; `npm run typecheck` passed.
- Evidence commits: `79bd3eb` (RED) and `a31bb2b` (GREEN).

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Sheet/form work captures one task-scoped observation before the first model sample | `execution-coordinator.test.ts: captures screen-dependent work once before the first model sample` | Integration | PASS |
| 2 | The first hosted Responses request contains the original request, trusted observation metadata, observation ID, and screenshot | `openai-agents-runtime.test.ts: attaches a trusted initial desktop observation to the first model request` | Integration | PASS |
| 3 | Text-only and navigation-first requests do not pre-capture | `completion-policy.test.ts: does not pre-capture for text or navigation-first work` | Unit | PASS |
| 4 | English and Vietnamese visible app requests do pre-capture | `completion-policy.test.ts: captures initial screen context for visible app work` | Unit | PASS |
| 5 | Approved desktop actions still stop when the screen fingerprint changes | `execution-coordinator.test.ts: invalidates approved desktop work when the screen fingerprint changes` | Integration | PASS |

## Coverage and final validation

- `npm run test:coverage`: 81.07% statements, 83.86% lines, 86.49%
  functions; 550 tests passed.
- `npm run check`: lint, typecheck, 550 app tests, 6 script tests, and 56 API
  tests passed.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `npm run package`: Electron Forge packaged the arm64 macOS application.

Known gap: capture begins immediately after task submission rather than while
push-to-talk audio is still being transcribed. This preserves task-scoped CUA
sessions and removes the extra model decision round-trip; speech-time prewarming
would be a separate latency optimization.

## Merge evidence

The RED/GREEN checkpoints are preserved as the five commits listed above. If
they are later squashed, copy this report into the pull request or squash commit
body so the regression evidence remains reviewable.
