# macOS voice shortcut release TDD evidence

## Source

The user journey and acceptance criteria were derived from the reported stuck
`LISTENING` state and its renderer diagnostics. No source plan was provided.

## User journey

As a macOS user, I want releasing the global push-to-talk shortcut to finish my
voice turn even if TroCode becomes focused while I am speaking, so that the
microphone never remains stuck in the listening state.

## Task report

1. Added a focused-window transition reproducer to
   `src/main/voice/global-voice-shortcut.test.ts`.
   - RED command: `npm exec vitest run -- src/main/voice/global-voice-shortcut.test.ts`
   - RED result: 1 failed, 6 passed. The release assertion failed because only
     the press event reached the renderer.
2. Allowed macOS `released` events through the focused-window filter while
   preserving the existing suppression for `pressed` events.
   - GREEN command: `npm exec vitest run -- src/main/voice/global-voice-shortcut.test.ts`
   - GREEN result: 7 passed.
3. Verified the surrounding shortcut and push-to-talk behavior.
   - Command: `npm exec vitest run -- src/main/voice/global-voice-shortcut.test.ts src/main/voice/macos-voice-shortcut-watcher.test.ts src/renderer/use-push-to-talk.test.ts src/renderer/push-to-talk.test.ts`
   - Result: 23 passed.
4. Ran the repository gates.
   - `npm run check`: passed; 82 Vitest files and 531 tests passed, along with
     lint, typecheck, script tests, and API tests.
   - `npm run package`: passed for macOS arm64, including the native shortcut
     helper build.

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | A global macOS press is delivered while TroCode is not focused | `global-voice-shortcut.test.ts` | Unit | PASS |
| 2 | Its matching release is still delivered if TroCode becomes focused during the hold | `global-voice-shortcut.test.ts` | Regression | PASS |
| 3 | Focused-window duplicate press handling and renderer release processing remain compatible | Focused voice test set | Integration | PASS |

## Coverage and known gaps

`npm run test:coverage` passed with 80.13% statements, 86.66% functions, and
82.86% lines overall. Branch coverage was 70.06%, below 80% but unchanged as an
existing repository-wide gap; the new focus-transition branch is directly
covered. No physical-keyboard automation is available in the unit suite, so the
native helper is additionally covered by the successful package build and its
existing watcher tests.

## Merge evidence

- RED checkpoint: `cb5ed63 test: reproduce lost macOS voice shortcut release`
- GREEN checkpoint: `d84daca fix: preserve macOS voice shortcut release`
