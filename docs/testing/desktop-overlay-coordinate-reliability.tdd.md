# Desktop overlay coordinate reliability — TDD evidence

## Source and user journeys

No plan file was supplied. The guarantees were derived from the reported
misplaced walkthrough widget and the requested active-control screen outline.

- As a walkthrough user, I want every target marker and callout placed from one
  documented image coordinate system, so the overlay does not move depending
  on whether the model emits pixels or normalized values.
- As a desktop-control user, I want a subtle, click-through outline around the
  screen while TroCode is controlling it, so control is always visibly
  disclosed without obscuring the application.

## RED evidence

`npm exec -- vitest run src/main/agent/runtime-tool-registry.test.ts
src/main/agent/openai-agents-runtime.test.ts` executed 24 tests and failed the
two new coordinate-contract assertions:

- `show_guidance` and `control_desktop` did not identify their coordinates as
  normalized 0–1000 image values.
- Initial visual context did not tell the model to avoid raw screenshot pixels.

RED checkpoint: `74366b8` (`test: reproduce ambiguous desktop coordinate
contract`).

## GREEN evidence

`npm exec -- vitest run src/main/agent/runtime-tool-registry.test.ts
src/main/agent/openai-agents-runtime.test.ts
src/renderer/desktop-control-indicator.test.ts` passed 25 of 25 tests after:

- applying the same explicit normalized-coordinate description to click,
  scroll, drag, guidance point, and guidance-region fields;
- adding the coordinate rule to initial desktop observation evidence; and
- restyling the existing active-control border as a translucent TroCode-gold
  outline while preserving its non-interactive status semantics.

GREEN checkpoint: `2925f0c` (`fix: stabilize desktop overlay coordinates`).

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Every model-visible point and region field declares normalized 0–1000 image coordinates and rejects raw-pixel interpretation in its description | `src/main/agent/runtime-tool-registry.test.ts` | Contract | PASS |
| 2 | Initial screenshot context repeats the same coordinate rule before the model can place a widget or request desktop control | `src/main/agent/openai-agents-runtime.test.ts` | Integration | PASS |
| 3 | The active-control overlay remains a visible status border without buttons or focus targets | `src/renderer/desktop-control-indicator.test.ts` | Component | PASS |
| 4 | The full application lint, typecheck, app tests, script tests, and API tests remain green | `npm run check` | Integration | PASS |
| 5 | The Electron application packages successfully for arm64 macOS | `npm run package` | Build | PASS |

## Coverage and known gaps

`npm run test:coverage` passed 572 tests with 81.68% statements, 84.42%
lines, and 87.01% functions. `npm run check` passed 572 app tests, 6 script
tests, and 56 API tests. `npm run package` completed successfully.

A live CUA walkthrough was not automated because it requires OS Accessibility
and Screen Recording permissions plus a real target application. The regression
is covered at the model schema, model-input, renderer, full-check, and package
boundaries.

## Merge evidence

The RED and GREEN commits are consecutive and reachable from the current HEAD.
If they are later squashed, preserve the checkpoint hashes and command results
from this report in the squash commit or pull-request description.
