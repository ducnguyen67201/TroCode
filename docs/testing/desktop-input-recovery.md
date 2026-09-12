# Desktop input recovery

The September 12 trace on 8bdb5c4 delivered a coordinate click with an
unverifiable receipt. Fresh observation succeeded but the lesson guard blocked
the next action. A subsequent lesson observation attempted a window-scoped call
after permanent desktop escalation and received window_scope_disabled.

Desktop click/key/scroll receipts now carry observe recovery through the desktop
outcome schema. A fresh screenshot permits a new decision after such a receipt;
the original invocation stays unknown in the journal and is never replayed.
Missing receipts, refusal, lost opening outcomes and Stop remain authoritative.

The legacy driver permanently escalates a native session. The adapter now keeps
subsequent window operations in a task-owned window session and closes both at
task end. Lesson observation rediscovers the actual window after desktop input;
it no longer gets stuck returning identity-less desktop captures forever.
Direct catalog desktop capture uses the shared observation path, which prepares
scope and returns a screenshot with an observation id and fingerprint. Missing
window targets still return desktop evidence for the agent's next decision.

Fresh intermediate UI evidence can recover shared semantic and native navigation
as well as desktop input. This permits selecting an application, observing the
enabled confirmation control, and then choosing the next action. It does not
declare the material visible or confirm the original uncertain invocation.

The SDK tool catalog can mark a completion tool as required. Desktop lessons mark
lesson_finish; only a confirmed host receipt satisfies it. A premature narrative
final response gets at most two continuation attempts using the same SDK session
history and the remaining model-turn budget, including restored SDK turns.
Unknown outcomes without recovery still stop. This local protocol is version 7;
the main process and bundled SDK worker must be rebuilt together.

No backend, SQL, renderer IPC, or staging configuration change is needed. Tests cover
receipt propagation, fresh-observation recovery, stale action rejection, desktop
capture routing, window rediscovery, completion receipts and bounded continuation.
CI owns verification. Live acceptance must still demonstrate chooser selection,
confirmation, the requested file visible, and grounded presentation on Windows.
