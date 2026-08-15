# Security model

TroCode has unusually powerful local permissions. The model is treated as an untrusted planner operating inside a trusted host policy.

## Trust boundaries

- The React renderer is sandboxed and unprivileged.
- The preload exposes a fixed, typed API rather than raw Electron IPC.
- The main process validates the sending renderer and parses all payloads.
- Only trusted main-process code creates and destroys the CUA runtime.
- A model cannot approve an action, change a capability grant, or widen resource scope.

## Default behavior

- On macOS, launch checks Accessibility and Screen Recording state without
  prompting. **Connect computer** is the explicit permission-onboarding action;
  later launches initialize automatically once both grants exist.
- No task executes merely because it was described as a question.
- `guide` mode observes and explains; it does not act.
- Consequential actions require explicit approval.
- Remote navigation and creation of unexpected Electron windows are denied.
- Current CUA actions are bounded by the compiled goal, host policy, task
  budget, fresh observation, and exact approvals. Per-skill native capability
  manifests remain a release hardening requirement.

## Sensitive data

Screenshots, URLs, document text, file paths, and typed input may contain private data. Do not write them to analytics logs. Trajectory storage should be opt-in, encrypted locally, and have a clear retention policy.

PostHog runs only in the trusted Electron main process. Its event surface is an
explicit allowlist of application lifecycle, task lifecycle, platform, version,
and compiled-goal classification fields. Anonymous activity uses a random local
installation ID without a person profile. Email and display name are sent only
when a future authenticated account flow explicitly calls the identify hook.

Do not ship a shared model-provider API key inside the renderer or application
bundle. Doppler injects the developer-owned OpenAI key into the Electron main
process at runtime, and only short-lived Realtime client secrets cross into the
renderer. A production service may replace this with an authenticated cloud
gateway.

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
