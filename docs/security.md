# Security model

TroCode has unusually powerful local permissions. The model is treated as an untrusted planner operating inside a trusted host policy.

## Trust boundaries

- The React renderer is sandboxed and unprivileged.
- The preload exposes a fixed, typed API rather than raw Electron IPC.
- The main process validates the sending renderer and parses all payloads.
- Only trusted main-process code creates and destroys the CUA runtime.
- A model cannot approve an action, change a capability grant, or widen resource scope.

## Default behavior

- No computer permissions are requested during application startup.
- No task executes merely because it was described as a question.
- `guide` mode observes and explains; it does not act.
- Consequential actions require explicit approval.
- Remote navigation and creation of unexpected Electron windows are denied.
- CUA actions will use bounded authorization and a generated capability manifest before production execution is enabled.

## Sensitive data

Screenshots, URLs, document text, file paths, and typed input may contain private data. Do not write them to analytics logs. Trajectory storage should be opt-in, encrypted locally, and have a clear retention policy.

Do not ship a shared model-provider API key inside the renderer or application bundle. Use a cloud gateway or a user-owned key stored through an operating-system credential store.

## Release requirements

Before distributing the application:

1. Define a strict Content Security Policy without development localhost exceptions.
2. Generate per-skill CUA capability manifests.
3. Add approval UI with exact target and consequence descriptions.
4. Add an always-available cancel control and keyboard shortcut.
5. Sign and notarize macOS builds.
6. Sign Windows installers.
7. Run dependency, secret, and packaged-application security checks.
8. Test permission upgrades, revocation, and app restarts on clean machines.
