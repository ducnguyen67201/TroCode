# Numbered Voice Task Reliability TDD Evidence

## Source Plan

No external plan file was used. The behavior comes from the approved request to make numbered companion actions keyboard-selectable, keep the final segmented transcript visible before automatic submission, and stop desktop tasks from appearing frozen when a post-action observation stalls.

## Root-Cause Evidence

- The captured Google Sheets task completed navigation and desktop actions, then remained in `acting` after its final keypress while waiting for the next desktop observation. Observation capture shared only the ten-minute whole-task deadline.
- The segmented voice path published its final transcript and switched to `idle` in the same React update before submitting. The voice island is hidden in `idle`, so the confirmed transcript could disappear before the user saw it.
- The companion and clarification windows are intentionally shown without stealing focus from the active app. Renderer-only number listeners therefore could not guarantee that `1`–`9` worked while Chrome or Sheets remained focused.

## User Journeys

- As a user working in another app, I can press the number shown beside a companion choice and select that exact choice once.
- As a user typing a custom clarification answer, focusing the companion window releases the global digit bindings so numeric text remains typeable.
- As a voice user, I see the final assembled transcript for one second before TroCode submits and starts the task.
- As a desktop-task user, I receive a safe blocked result when a fresh desktop observation cannot be captured within 15 seconds instead of watching the task remain active until its overall deadline.

## Task Report

| Behavior | Test target | RED/GREEN evidence | Guarantee |
|---|---|---|---|
| Visible number choices are one-shot and scoped to the current overlay | `src/main/companion/global-numbered-choice-shortcuts.test.ts`, `src/renderer/companion-response-card-view.test.ts` | RED: missing shortcut module and three response-card mapping/markup failures; GREEN: focused suites passed | Only registered `1`–`9` keys dispatch, stale callbacks are ignored, and exact owned shortcuts are removed |
| Final speech remains visible before task submission | `src/renderer/use-push-to-talk.test.ts` | RED: three tests observed immediate submission; GREEN: focused suite passed | The ordered final transcript is published, held during `processing` for 1,000 ms, then submitted once |
| Stalled desktop verification terminates promptly and safely | `src/main/agent/execution-coordinator.test.ts` | RED: the coordinator did not reach idle within the regression deadline; GREEN: focused suite passed | Observation capture aborts at its operation deadline and a post-action verification failure blocks before further model/tool work |
| Repository behavior remains compatible | Full project gates | GREEN: `npm run check` passed 83 Vitest files / 537 tests plus script and API suites; `npm run package` passed | Lint, type boundaries, all tests, and the macOS Electron package remain green |
| Coverage remains above the project floor | `npm run test:coverage` | GREEN: 80.74% statements and 83.56% lines | The configured covered surface remains above 80% |

## Validation Commands

- `npm exec vitest run -- src/main/companion/global-numbered-choice-shortcuts.test.ts src/renderer/companion-response-card-view.test.ts src/renderer/use-push-to-talk.test.ts src/main/agent/execution-coordinator.test.ts`
- `npm run check`
- `npm run test:coverage`
- `npm run package`
- `git diff --check`

## Known Gaps

The OS-level digit path is covered through a fake Electron shortcut registry rather than a physical-key Electron E2E test. The renderer retains its local keyboard fallback when the companion window is focused, and the production package build validates the Electron integration surface.
