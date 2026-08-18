# Companion Response Card TDD Evidence

## Source Plan

No external plan file was used. The behavior came from the approved request to match the OpenClicky-style companion chat card: stream the latest answer beside the companion, persist the completed answer, provide fixed actions, keep guidance and approval precedence, and avoid broad IPC.

## User Journeys

- As a desktop user, I want the latest assistant answer to appear beside the companion while work is happening, so I do not have to open the main window to see the result.
- As a desktop user, I want completed answers to expose only fixed actions, so I can dismiss, open the task, ask a follow-up, or read the answer aloud without granting extra authority.
- As a user relying on walkthrough guidance, I want approval and guidance cards to stay above response cards, so the companion does not hide required next-step instructions.

## Task Report

| Behavior | Test target | RED/GREEN evidence | Guarantee |
|---|---|---|---|
| Duplicate task-start events must not erase a streamed response card | `src/main/companion/companion-response-controller.test.ts` | RED: `npm test -- src/main/companion/companion-response-controller.test.ts` failed on `keeps the current draft...`; GREEN: focused Vitest suite passed | Same-task `run_started` / first task update races preserve the current draft |
| Response-card payloads and actions are bounded schemas | `src/shared/contracts.test.ts`, `src/main/ipc/register-ipc.test.ts` | GREEN: focused Vitest suite passed | Renderer input is parsed, strict where needed, and stale/invalid action requests do not dispatch |
| The companion card renders plain text and fixed controls only | `src/renderer/companion-response-card-view.test.ts` | GREEN: focused Vitest suite passed | Model output is not rendered as HTML or links, and streaming cards do not show inactive controls |
| Foreground completion is visible without forced narration; explicit audible requests narrate | `src/main/presentation/electron-presentation-presenter.test.ts`, `src/main/presentation/presentation-policy.test.ts` | GREEN: focused Vitest suite passed | Normal answers stay silent; explicit read-aloud requests use the existing narration service with fallback behavior |
| Coverage remains at or above the project floor | `src/main/agent/guidance-playback.test.ts` | GREEN: `npm run test:coverage` passed with statements 80.03%, lines 82.73% | Coverage remains above 80% for the configured covered surface |

## Validation Commands

- `npx vitest run src/main/companion/companion-response-controller.test.ts src/shared/contracts.test.ts src/renderer/companion-response-card-view.test.ts src/main/ipc/register-ipc.test.ts src/main/presentation/electron-presentation-presenter.test.ts src/main/presentation/presentation-policy.test.ts`
- `npm run test:coverage`
- `npm run check`
- `npm run package`

## Known Gaps

No E2E screenshot test was added for the floating Electron window. The behavior is covered by pure lifecycle tests, IPC boundary tests, renderer static-markup tests, full typecheck/lint, and package build.
