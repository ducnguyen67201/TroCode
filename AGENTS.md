# TroCode contributor guidance

## Architecture invariants

- Keep the Electron renderer sandboxed. Never enable Node integration.
- Expose narrow functions through `DesktopApi`; never expose raw Electron IPC or CUA.
- Parse data at IPC and model boundaries with the schemas in `src/shared/contracts.ts`.
- Keep goal compilation, lifecycle transitions, and policy decisions pure and testable.
- Treat CUA as an execution capability. It does not define goals or grant approvals.
- Prefer direct APIs, filesystem, and terminal tools over visual clicking when they are safer and more verifiable.
- Never retry a consequential action when completion is unknown.

## Required verification

Run before committing:

```bash
npm run check
npm run package
```

Add or update tests whenever goal routing, lifecycle transitions, policy decisions, or IPC contracts change.
