# Tauri desktop cutover

## Preconditions

- `npm run check` and native `npm run package` pass on macOS arm64/x64 and
  Windows x64 release runners.
- Update artifacts are signed and `TROCODE_UPDATE_PUBLIC_KEY` matches the
  release signing key.
- Clean-machine tests cover sign-in, membership, task clarification,
  approve/deny, cancellation, workspace confinement, voice, Knowledge, and
  update signature failure.
- The signed Tauri identity has verified macOS Accessibility and Screen
  Recording behavior with the direct CUA Rust integration.
- The last supported Electron installers remain downloadable for the rollback
  window.

## Release

1. Publish a beta cohort. Users sign in again; Electron `safeStorage` material
   is deliberately not copied into Tauri.
2. Verify product identifier, signing identity, permissions attribution, tray
   lifecycle, auxiliary windows, and background behavior on both platforms.
3. Run text-only, CUA, and Workspace tasks. Change the screen after an approval
   preview and confirm stale action data cannot execute.
4. Exercise update download/signature/install and recovery from an interrupted
   download.
5. Expand the cohort only while crash, failed-task, provider-uncertainty,
   permission, and update error rates remain acceptable.

## Rollback and support

- Stop publishing the Tauri update and restore the prior signed installer link.
- Do not attempt to import Tauri session memory into Electron. A rollback may
  require another sign-in.
- Preferences are in Tauri's application config directory; task history in this
  release is session-only.
- Database/API compatibility is independent of the desktop shell rollback.
- Preserve signing keys and bundle identifiers; never ship an unsigned hotfix
  to bypass updater or OS trust failures.
