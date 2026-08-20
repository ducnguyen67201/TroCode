# Direct Chrome launch verification

## Source and user journey

No source plan was provided. The journey was derived from the reported desktop-agent failure:

> As a Tro user, I want “Open Chrome” to launch Google Chrome directly, so the task does not depend on visually finding and clicking an operating-system launcher.

## TDD task report

### RED

Command:

```bash
npm exec -- vitest run src/main/application/desktop-application-launcher.test.ts src/main/agent/runtime-tool-registry.test.ts src/main/agent/execution-coordinator.test.ts
```

The valid RED run executed the new targets and failed for the intended missing behavior:

- `desktop-application-launcher.test.ts` could not resolve the not-yet-created launcher.
- `open_application` was absent from the runtime registry.
- the coordinator never previewed or dispatched the requested application launch.
- Result: 3 test files failed; 3 tests failed and 50 existing tests passed.

Checkpoint: `fa9bdf4 test: add reproducer for direct Chrome launch`

### GREEN

The host now exposes only `chrome` through `open_application`, resolves a standard installation path for macOS, Windows, or Linux, launches it through Electron's operating-system API, and invalidates stale screen context without starting CUA.

Command:

```bash
npm exec -- vitest run src/main/application/desktop-application-launcher.test.ts src/main/agent/runtime-tool-registry.test.ts src/main/agent/execution-coordinator.test.ts
```

Result: 3 test files passed; 57 tests passed.

Checkpoints:

- `9031eea fix: launch Chrome through a direct host tool`
- `2f92377 refactor: satisfy launcher lint contracts`

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | A current-user Windows Chrome installation is found and opened. | `desktop-application-launcher.test.ts` | Unit | PASS |
| 2 | The standard macOS Chrome application is found and opened. | `desktop-application-launcher.test.ts` | Unit | PASS |
| 3 | Missing Chrome and operating-system launch failures return actionable errors. | `desktop-application-launcher.test.ts` | Unit | PASS |
| 4 | The model sees a strict `open_application` tool limited to `chrome`, normalized as `application.launch`. | `runtime-tool-registry.test.ts` | Contract unit | PASS |
| 5 | Direct Chrome launch is previewed, dispatched once, and does not start a CUA session. | `execution-coordinator.test.ts` | Host integration | PASS |

## Full verification

| Command | Result |
|---|---|
| `npm run check` | PASS: runtime versions, lint, typecheck, 668 Vitest tests, 9 script tests, and 102 API tests passed; one database integration test skipped because `TEST_DATABASE_URL` is not configured. |
| `npm run package` | PASS: Electron Forge packaged the macOS arm64 application, including webpack and native dependency stages. |
| `npm audit --audit-level=high` | PASS: 0 vulnerabilities. |

## Coverage and known gaps

The focused launcher coverage is 85.71% statements, 90% functions, and 84.37% lines. The repository's configured global coverage target includes only `src/main/agent/**/*.ts`; it reported 79.29% statements, 85.5% functions, and 81.97% lines. The global statement metric was already below the skill's 80% target and remains a known repository-level gap; no unrelated production code was added merely to inflate it.

No live Chrome window was opened during automated verification because doing so would change the developer's active desktop. The launcher is host-integrated and package-verified; a release smoke test on each target operating system remains appropriate.

## MCP verification performed with this change

The project-scoped `trocode_postgres` server completed a real MCP initialization and exposed `execute_sql` plus `search_objects`. A query reported the `railway` database with `transaction_read_only=on`; an `UPDATE ... WHERE FALSE` probe was rejected with `READONLY_VIOLATION` before execution.
