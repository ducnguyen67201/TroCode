# macOS Screen Recording onboarding — TDD evidence

## User journey

1. An authenticated user chooses **Enable all permissions** or **Request access**.
2. TroCode invokes the CUA native macOS permission request from its trusted main
   process.
3. If Screen Recording is still disabled, the main process creates a hidden,
   sandboxed renderer with a unique in-memory session and makes one real
   `getDisplayMedia` request. It immediately stops the returned tracks. The
   temporary session accepts only a user-gesture video request from that exact
   main frame; screen data never reaches the application renderer.
4. TroCode rechecks CUA status after that registration attempt. If the grant is
   ready, it returns the refreshed status without opening System Settings.
5. If Screen Recording is still missing, TroCode opens the matching System
   Settings pane. The user toggles the existing TroCode row; they do not locate
   the app in Finder or use the `+` button.
6. If macOS grants the native request immediately, neither source enumeration
   nor System Settings is needed.
7. Returning to TroCode triggers the existing automatic permission recheck and
   CUA connection.

The packaged macOS app and its Electron helpers use stable, product-owned bundle
identifiers. CUA remains in the Electron main process so macOS attributes the
grant to the same process that captures the screen.

## RED

The first focused run failed because the permission orchestration and stable app
identity module did not exist:

```text
npm test -- src/renderer/permission-onboarding.test.ts src/main/app-identity.test.ts
Test Files 2 failed; Tests 2 failed, 5 passed
```

After the initial renderer implementation, the trust-boundary tests exposed the
remaining split flow: the renderer tried to open Settings itself and the main
process did not perform the fallback after the native request.

```text
npm test -- src/renderer/permission-onboarding.test.ts src/main/ipc/register-ipc.test.ts
Test Files 2 failed; Tests 2 failed, 11 passed
```

Installed-artifact QA then showed that `CGRequestScreenCaptureAccess` was denied
without creating a visible Screen Recording row on the current macOS release.
The next RED test required the Electron capture registration step between the
native request and the Settings fallback:

```text
npm test -- src/main/ipc/register-ipc.test.ts
Test Files 1 failed; Tests 1 failed, 5 passed
```

Installed-artifact QA proved that both zero-size and one-pixel source enumeration
remain TCC no-ops on the current macOS release. The final focused RED tests
required a real display-media stream in an isolated renderer, strict request
scoping, and cleanup on failure:

```text
npm test -- src/main/screen-recording-registration.test.ts
Test Files 1 failed; Tests 4 failed
```

## GREEN

The trusted `cua:connect` handler now performs native request first, asks
Electron's main-process capture stack to register the app when necessary,
rechecks status, and then opens the screen-recording pane only when permission
is still missing. The renderer's raw permission-settings IPC capability was
removed. The registration stream is stopped immediately, and its temporary
permission handlers and hidden window are removed in a `finally` block.

```text
npm test -- src/renderer/permission-onboarding.test.ts src/main/ipc/register-ipc.test.ts src/main/app-identity.test.ts
Test Files 3 passed; Tests 15 passed

npm test -- src/main/screen-recording-registration.test.ts
Test Files 1 passed; Tests 4 passed
```

## Remaining release validation

- Package on macOS and verify the main and helper bundle identifiers.
- Sign every distributed build with the same Apple Developer ID and notarize it.
- When no Developer ID is installed, packaging uses a valid ad-hoc signature for
  local testing without hardened runtime. That fallback is not a substitute for
  a Developer ID build, which keeps hardened runtime enabled.
- On a clean macOS account, exercise first grant, denial, re-enable, revocation,
  restart, and upgrade from an older signed version.
- `npm start` uses Electron's development identity and is not an authoritative
  end-to-end TCC permission test.
