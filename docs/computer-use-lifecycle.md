# Computer-use lifecycle

Computer use is an optional capability of the Rust agent loop. A text-only task
does not capture the screen or initialize CUA.

## Grounded flow

```text
model -> observe_desktop
  Rust CUA host -> frontmost on-screen window
    -> bounded accessibility tree + screenshot
    -> window screenshot when accessibility is unavailable
    -> full-desktop screenshot when no truthful window capture exists
  <- observation UUID, SHA-256 fingerprint, dimensions, opaque element refs

model -> control_desktop(observation UUID + fingerprint + one action)
  Rust host -> exact-action approval when policy requires it
  Rust host -> capture again
    changed fingerprint -> execute nothing; return a recoverable rejection
    same fingerprint -> uniquely rebind semantic identity or use approved pixels
  CUA SDK -> dispatch exactly once
  Rust host -> fresh observation and confirmed/no-effect result
```

Accessibility is preferred because its opaque element token is scoped to one
driver snapshot and fails closed when stale. A held semantic action is rebound
only when role and label identify one enabled element in an unchanged fresh
observation. Pixel coordinates are normalized by the model and converted once
to the fresh window or desktop screenshot dimensions.

Only the newest screenshot enters model input, and screenshot/tool/session byte
limits are enforced before provider dispatch. CUA handles and process authority
never enter the renderer. Tro's approval windows are not a source of authority.

## Outcomes and cleanup

A validation rejection or stale element is known not to have executed, so the
agent may observe again. An unknown post-dispatch result is terminal and is
never retried. Cancellation interrupts model sampling and waits, clears pending
approval/input channels, removes observations, and unregisters the global
Escape shortcut after the last active task finishes.

The native voice shortcut is Command+Control+Space on macOS and
Control+Alt+Space on Windows/Linux. Escape is registered globally only while a
task is active so normal application Escape behavior is not intercepted while
Tro is idle.
