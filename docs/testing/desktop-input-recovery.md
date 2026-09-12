# Desktop input recovery

The September 12 trace on 8bdb5c4 delivered a coordinate click with an
unverifiable receipt. Fresh observation succeeded but the lesson guard blocked
the next action. A subsequent lesson observation attempted a window-scoped call
after permanent desktop escalation and received window_scope_disabled.

Desktop click/key/scroll receipts now carry observe recovery through the desktop
outcome schema. A fresh screenshot permits a new decision after such a receipt;
the original invocation stays unknown in the journal and is never replayed.
Missing receipts, refusal, lost opening outcomes and Stop remain authoritative.

Lesson observation follows the active capture scope. After desktop escalation it
returns desktop evidence without calling a disabled window tool, inventing a
window identity, or treating the screenshot as verified lesson content.
This fixes chooser interaction recovery. Automated material verification remains
window-based; a desktop-only screenshot does not satisfy that existing contract.

No backend, SQL, IPC, or staging configuration change is needed. Tests cover
receipt propagation, fresh-observation recovery, stale action rejection, desktop
capture routing and unverified material evidence. CI owns verification.
