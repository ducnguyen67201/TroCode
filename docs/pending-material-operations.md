# Pending material operations

## Evidence and scope

The September 10 lesson began `lesson_open` at 07:23:58.283 UTC and returned
`unknown` at 07:24:10.720. The agent subsequently requested observations, but the
lesson guard rejected them. The old catch blocks discarded the native exception,
so those logs cannot distinguish a timeout, native rejection, or a later state
write failure. Direct Windows probes returned OS acceptance in 144–155 ms while
an application chooser existed. OS acceptance is not document verification.

## Implementation plan

1. Introduce a shared asynchronous operation tracker. Persist an operation ID and
   pending receipt before dispatch; release the agent loop without awaiting UI.
2. Reuse the receipt for repeated resource requests. Keep the existing SDK journal
   for tool-call checkpointing; the separate operation receipt records the longer
   OS request, which may outlive that tool call.
3. Save completion independently of the lesson. Background callbacks must never
   change a replacement lesson, restart a task, or restore revoked authority.
4. Report a 10-second pending diagnostic instead of imposing a failure deadline.
   Log original errors, operation ID, timestamps, and elapsed time. A rejected
   promise or lost pending receipt becomes unknown and is never replayed.
5. Permit read-only reconciliation of unknown outcomes. Keep mutations blocked
   until new authorized work; pending UI interactions retain normal lesson policy.
6. Require document verification before explanation or completion. Neither a
   pending dispatch receipt nor OS acceptance is evidence of visible content.

## Persistence and compatibility

Operation records are encrypted, owner/lesson/resource scoped, and schema parsed
in main. Existing material records and signed plans remain unchanged. No backend,
SQL migration, renderer API, provider protocol, or account setup changes are
needed. On process restart, a stored pending operation has lost its live completion
receipt and becomes unknown. Completed/failed/unknown operations do not redispatch.
Explicit Pause/Stop and cancellation remain authoritative.

## Verification

CI owns lint, typecheck, regression tests, backend checks, and platform packaging.
Tests cover delayed completion, duplicate/concurrent calls, restarts, rejection,
durable-write failure, observation after unknown, and a chooser-to-presentation
flow whose open promise resolves only after a shared control action.

Native diagnostic probes and simulated lifecycle coverage are separate from full
teacher/student acceptance. Record the actual live outcome; do not infer that an
entire lesson succeeded because an OS open call returned success.
