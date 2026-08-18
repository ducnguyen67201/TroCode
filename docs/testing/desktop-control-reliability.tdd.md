# Desktop control reliability — TDD evidence

## Source and user journeys

No plan file was supplied. The journeys were derived from the reported Google
Sheets failure and screenshot:

- As a user approving a desktop action, I want harmless focus, caret, or
  animation changes to avoid cancelling the held action while real screen or
  target changes still stop safely.
- As a user creating a spreadsheet, I want tabular values and formulas to land
  in separate cells instead of one long string in the active cell.
- As a user, I want an unmistakable, click-through screen border while TroCode
  controls the computer, and I do not want that border included in verification
  screenshots.

## RED evidence

`npm exec -- vitest run src/main/agent/execution-contracts.test.ts
src/main/agent/runtime-tool-registry.test.ts src/main/cua/cua-service.test.ts
src/main/agent/approval-observation.test.ts
src/main/agent/execution-coordinator.test.ts
src/renderer/desktop-control-indicator.test.ts` failed as intended:

- 7 behavior tests failed and 2 new suites could not load because the approval
  matcher and control indicator did not exist.
- The failures reproduced the missing `paste_table` contract, unsupported CUA
  paste shortcut, exact-fingerprint cancellation, absent control lifecycle, and
  absent visible indicator.
- RED checkpoint: `843e9d1`.

The local review added one further adversarial matcher case. The focused
approval suite failed 1 of 5 tests because a fixed sampling grid missed changed
pixels between its sample columns.

## GREEN evidence

- The six focused suites passed 72 tests after the first implementation.
- The approval matcher suite passed all 5 tests after switching from a fixed
  grid to complete decoded-pixel comparison.
- GREEN checkpoint: `393657d`.

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Spreadsheet tables are rectangular, bounded, and converted to safe TSV | `execution-contracts.test.ts` | Unit | PASS |
| 2 | Ragged rows are rejected before desktop execution | `execution-contracts.test.ts` | Unit | PASS |
| 3 | The model receives one strict `paste_table` variant whose only consequence is `type_text` | `runtime-tool-registry.test.ts` | Contract | PASS |
| 4 | Table rows normalize to one trusted desktop action with row, column, and TSV evidence | `runtime-tool-registry.test.ts` | Unit | PASS |
| 5 | CUA writes TSV to the clipboard and then uses the native macOS/Windows/Linux paste shortcut | `cua-service.test.ts` | Integration | PASS |
| 6 | Exact screenshots pass approval revalidation without image decoding | `approval-observation.test.ts` | Unit | PASS |
| 7 | Small off-target focus/caret changes pass | `approval-observation.test.ts` | Unit | PASS |
| 8 | Broad changes, target changes, and changes between fixed sample points fail closed | `approval-observation.test.ts` | Unit | PASS |
| 9 | The coordinator can dispatch an approved action after perceptual validation | `execution-coordinator.test.ts` | Integration | PASS |
| 10 | The active-control lifecycle always hides the indicator after a driver failure | `execution-coordinator.test.ts` | Integration | PASS |
| 11 | The control indicator is a visible status element with no buttons or focus targets | `desktop-control-indicator.test.ts` | Component | PASS |

## Coverage and final validation

- `npm run test:coverage`: 563 tests passed; 81.66% statements, 84.40%
  lines, and 87.01% functions. The new approval matcher has 89.36% line and
  81.81% branch coverage.
- `npm run check`: lint, typecheck, 563 app tests, 6 script tests, and 56 API
  tests passed.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `npm run package`: Electron Forge packaged the arm64 macOS application after
  the final matcher hardening.
- Local code review: APPROVE; no critical, high, medium, or low findings remain.

## Known boundary

The CUA integration is contract-tested with the typed driver, and the complete
Electron application packages successfully. A live Google Sheets E2E was not
automated because it requires an authenticated browser and OS-level desktop
control. `paste_table` uses the system clipboard as the native cross-platform
paste transport, so the clipboard contains the pasted table afterward, matching
normal user paste behavior.
