# Frontend module ownership

The desktop composition lives in `src/renderer/App.tsx` and `src/renderer/app/`.
App connects resource owners and routes their state/actions into the workspace,
sidebar, settings, and entry gates. Feature modules never import App.

| Boundary | Responsibility |
| --- | --- |
| `features/tasks/` | Session subscriptions/history, commands, task presentation |
| `features/voice/` | Voice routing, shortcut coordination, completion and pure audio helpers |
| `features/settings/` | Settings sections, preferences, updates, permissions, connectors |
| `features/account/` | Membership, organization profile, banner and roster resources |
| `features/classroom/` | Class selection, facilitator controls and attempt controls |
| `features/knowledge/` | Space people/group presentation |
| `features/companion/` | Companion customization resource, generation and gallery |
| `i18n/vi/` | Vietnamese dictionaries composed behind the existing translation API |
| `apps/admin/src/` | Independent admin HTTP client, pages, components and query hooks |

Existing cohesive renderer modules remain at their current import paths. Use a
feature folder for related extraction; do not create empty layers or generic
utility collections. A component should express a recognizable surface. A hook
should own a resource or lifecycle, including its cleanup. Pure calculations
belong beside that feature rather than inside its render function.

`usePushToTalk` remains the capture/turn resource owner. Shortcut and completion
hooks receive explicit refs/actions from that owner. The turn's destination is
captured at start, and task/class changes reject delivery while preserving the
draft. Unknown delivery outcomes must never trigger an automatic retry.

`useTaskSession` owns task/activity/focus subscriptions. Task commands share its
snapshot refs and update actions. Subscriptions must remain unique under React
StrictMode replay; navigation must not create a second task session.

Renderer code uses the narrow `DesktopApi` bridge. Existing shared Zod contracts,
IPC parsing, sandboxing and wire payloads remain unchanged. ESLint rejects
frontend imports of Electron, Node, CUA, main-process code, and runtime cycles.

## Size policy

Aim for 150–300 lines where responsibilities allow it. Handwritten production
source has a 500-physical-line ceiling. Do not compress formatting or manufacture
one-line wrappers to meet it. Tests are reported separately and split by behavior.

`npm run source:inventory` reports source sizes. `npm run check:source-size` tests
and enforces the policy without installing dependencies. CI runs it in preflight.
Only the explicit native/backend/shared paths in `scripts/source-size-baseline.json`
are grandfathered. Existing exceptions cannot grow, shrinkage must lower their
baseline, and renamed/new paths cannot inherit an oversized exception in CI.
Generated admin bundles and dependency/build directories are excluded.

## Styles and verification

The desktop and admin CSS entries import contiguous rule groups in original
order. Numbered filenames preserve cascade order; the selector name gives the
start of each group. Do not reorganize overrides across those files as incidental
cleanup. SHA-256 tests compare expanded CSS with the original complete stylesheets.
The broadcast stylesheet retains its separate App import timing.

`npm run test:frontend` runs desktop/admin tests plus preservation tests with
coverage. `npm run test:typescript` runs the full TypeScript suite with coverage
in CI. Coverage includes the extracted feature modules, admin hooks and voice
adapters. Critical command/routing/query files have initial measured coverage
floors; raise them with new behavior coverage rather than lowering them.

The file inventory is in `docs/frontend-source-inventory.md`. The refactoring
plan records outstanding platform CI and live visual/classroom acceptance. Local
unit tests and byte-preservation checks do not establish those acceptance results.
