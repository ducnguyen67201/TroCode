# Multi-display overlay origin — TDD evidence

## Source and user journey

No plan file was supplied. The regression was derived from the reported
intermittent widget placement and the follow-up question about normalizing to
the user's screen size.

- As a desktop-control user, I want guidance drawn over the same target that
  the agent saw in its screenshot, including when a monitor is left of or
  above the primary display and therefore has a negative desktop origin.
- As an execution-system maintainer, I want model coordinates to remain
  normalized image coordinates and CUA commands to remain screenshot pixels,
  so Electron-only display offsets cannot change the action sent to CUA.

## RED evidence

`npm exec -- vitest run src/main/agent/execution-contracts.test.ts
src/main/companion/companion-position.test.ts src/main/cua/cua-service.test.ts`
ran 39 tests and failed the four new assertions:

- point and region conversion omitted the capture's desktop origin;
- the CUA observation discarded driver-provided `screen_x` and `screen_y`;
- the application had no way to infer full-virtual-desktop or single-display
  capture bounds when the driver omitted the origin.

RED checkpoint: `391f1c3` (`test: reproduce multi-display overlay origin bug`).

## GREEN evidence

The same focused command passed 39 of 39 tests after:

- preserving optional capture origins in the validated observation contract;
- adding that origin only when converting screenshot pixels to Electron
  desktop coordinates;
- leaving normalized-to-screenshot conversion unchanged for real CUA actions;
- inferring a missing origin from Electron virtual, primary, or uniquely
  matching display bounds without guessing when dimensions are ambiguous.

GREEN checkpoint: `c2b10a5` (`fix: preserve desktop capture origins`).

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | A point and region gain the negative desktop origin only during overlay conversion | `src/main/agent/execution-contracts.test.ts` | Unit | PASS |
| 2 | Model-normalized coordinates still map to screenshot pixels independently of desktop origin | `src/main/agent/execution-contracts.test.ts` | Unit | PASS |
| 3 | Virtual-desktop, primary-display, unique-display, and unresolved capture sizes are handled deterministically | `src/main/companion/companion-position.test.ts` | Unit | PASS |
| 4 | A real CUA service observation call preserves driver-provided `screen_x` and `screen_y` metadata | `src/main/cua/cua-service.test.ts` | Service integration | PASS |
| 5 | Lint, typecheck, application tests, script tests, and API tests remain green | `npm run check` | Integration | PASS |
| 6 | The Electron application packages for arm64 macOS | `npm run package` | Build | PASS |

## Coverage and known gap

`npm run test:coverage` passed 576 tests with 81.70% statements, 84.44%
lines, and 87.01% functions. `npm run check` passed 576 application tests,
6 script tests, and 56 API tests. `npm run package` completed successfully.

The CUA service test calls the production observation path with a contract-faithful
driver response, but it does not take control of the developer's live desktop.
A live multi-monitor acceptance run still requires OS Screen Recording and
Accessibility permission and a known target on each physical monitor.

## Merge evidence

The RED and GREEN commits are consecutive and reachable from the current HEAD.
If they are later squashed, preserve these checkpoint hashes and command
results in the squash commit or pull-request description.
