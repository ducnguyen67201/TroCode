# Automatic task start and Escape cancellation — TDD evidence

## Source and user journeys

This change was derived from the request to remove the extra **Start task**
click after goal compilation. No external plan file was used.

1. When a compiled task reaches `ready` and OpenAI/CUA are available, execution
   starts automatically once, without another confirmation click.
2. While any task is nonterminal, the main window shows **Stop task** with an
   **Esc** hint.
3. Pressing Escape in TroCode cancels the current task without waiting for a
   normal form action.
4. Because TroCode hides its main window during desktop work, the trusted main
   process registers Escape system-wide only while tasks are active and removes
   it after the last task becomes terminal.
5. Consequential actions still stop at the existing exact-action approval gate;
   automatic start does not approve or dispatch them.
6. If automatic start initialization fails, the goal remains visible with a
   bounded **Try again** action rather than retrying indefinitely.

## RED and GREEN evidence

The first focused run failed at module resolution because neither automatic
start policy nor lifecycle-scoped global cancellation existed:

```text
npm test -- src/main/agent/global-task-cancel-shortcut.test.ts src/renderer/task-execution.test.ts
Test Files 2 failed
```

After implementing the two policies, the same focused run passed:

```text
Test Files 2 passed
Tests 6 passed
```

The full verification run passed after renderer and main-process integration:

```text
npm run check
Test Files 39 passed
Tests 205 passed

npm run package
Packaging for arm64 on darwin: passed
```

## Test specification

| # | What is guaranteed | Test target | Result |
|---|---|---|---|
| 1 | Only a ready, dependency-ready, idle task auto-starts | `src/renderer/task-execution.test.ts` | PASS |
| 2 | Every nonterminal phase is cancellable and terminal phases are not | `src/renderer/task-execution.test.ts` | PASS |
| 3 | Only a non-repeating Escape key stops an active task | `src/renderer/task-execution.test.ts` | PASS |
| 4 | Escape registers once while one or more tasks are active | `src/main/agent/global-task-cancel-shortcut.test.ts` | PASS |
| 5 | One Escape cancels every tracked active task | `src/main/agent/global-task-cancel-shortcut.test.ts` | PASS |
| 6 | Escape is released after the last terminal update and during cleanup | `src/main/agent/global-task-cancel-shortcut.test.ts` | PASS |
| 7 | Shortcut registration failure is logged and does not trigger cancellation | `src/main/agent/global-task-cancel-shortcut.test.ts` | PASS |

## Coverage and known gaps

Focused coverage across the new policy modules passed with 92.5% statements,
88% branches, 100% functions, and 92.1% lines. Existing lifecycle and approval
tests in the full suite continue to prove that automatic execution cannot bypass
host policy or exact-action approval.

The React screen is covered by pure policy tests, typecheck, lint, and packaged
webpack compilation because this repository does not currently include a React
DOM test harness. A packaged manual pass should still confirm system-wide Escape
registration on each supported operating system, including the collision path
where another application owns that accelerator.

No TDD checkpoint commits were created because the worktree already contained
unrelated user changes, which were preserved.
