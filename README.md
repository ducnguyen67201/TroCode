# TroCode

TroCode is a cross-platform, general-purpose desktop agent foundation. It turns a user request into a typed, bounded goal before any tool or computer action is allowed.

The desktop application uses Electron, React, TypeScript, and [CUA Driver](https://github.com/trycua/cua). The current foundation compiles and previews goals, enforces lifecycle transitions, evaluates proposed actions against capability and resource scopes, and automatically initializes CUA after operating-system permissions have been granted.

## Current status

Implemented:

- Secure Electron main/preload/renderer separation.
- General-purpose goal routing across education, productivity, coding, research, business, creative, and general domains.
- `answer`, `guide`, `act`, and `mixed` interaction modes.
- Typed task lifecycle with guarded transitions.
- Capability, resource-scope, and approval policy evaluation.
- Automatic CUA initialization after explicit first-run permission onboarding.
- Platform-specific, focused-window push-to-talk voice transcription.
- Goal preview and lifecycle activity UI.
- Unit tests and cross-platform CI definition.

Not implemented yet:

- Model-provider integration and streaming planning.
- Real action execution from compiled goals.
- Persistent task and trajectory storage.
- Production capability manifests, signing, notarization, and update delivery.

The UI deliberately stops at `ready` until a model provider and execution approval flow are implemented. It does not silently simulate task completion.

## Requirements

- Node.js 24 or newer.
- npm 11 or newer.
- macOS 13+ or a supported 64-bit Windows environment for CUA.
- macOS development requires Accessibility and Screen Recording permissions for the Electron host.

## Start locally

```bash
npm install
npm start
```

Choose **Connect computer** once when you are ready to grant desktop permissions. Later launches connect automatically without showing another permission prompt.

With the TroCode window focused, hold **Command + Control** on macOS or the
physical **left Alt + left Control** keys on Windows. Release either key to
finish the transcript and submit it through the same bounded task pipeline as
typed input. Voice currently reaches the deterministic goal compiler;
model-provider integration is still planned.

## Quality checks

```bash
npm run check
npm run test:coverage
npm run package
```

`npm run make` generates a distributable for the current operating system. Production distribution still requires Apple notarization and Windows code signing.

CUA installs a native package for the host OS and CPU, so build each release on
its target operating system. During packaging, TroCode stages the CUA JavaScript
SDK and native libraries together outside ASAR; this preserves CUA's relative
native-library resolution in the packaged application.

## Architecture

```text
React renderer
  -> typed preload API
    -> trusted Electron IPC
      -> goal runtime / policy engine
      -> CUA service
        -> native CUA runtime
```

The renderer cannot import Node, Electron, CUA, or filesystem APIs. Every message crosses a narrow preload contract and is validated again in the main process.

Read:

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/computer-use-lifecycle.md`](docs/computer-use-lifecycle.md)
- [`docs/security.md`](docs/security.md)

## Repository map

```text
src/
├── main/
│   ├── agent/       goal routing, state machine, policy, task runtime
│   ├── cua/         permission-aware CUA lifecycle
│   └── ipc/         trusted renderer boundary
├── renderer/        React desktop interface
├── shared/          Zod schemas and typed preload contract
├── index.ts         Electron main entry
├── preload.ts       minimal renderer API
└── renderer.tsx     React entry
```

## Design rule

CUA is a capability, not the planner. A task must have an outcome, success criteria, capability scope, resource scope, approval rules, and execution limits before computer use can begin.
