# Computer-use lifecycle

For hosted runs, CUA remains local to Electron main. The backend persists a
tool interruption and waits; the desktop requests an exactly-once executing
transition, performs the action through the existing CUA session, observes the
result, and returns evidence. Requested or delivered invocations may be
redelivered with the same ID. Executing invocations are never replayed after a
disconnect; an absent terminal result becomes unknown.

Visual evidence uses semantic facts without an image when sufficient, a
1536-pixel overview by default, and an observation-bound original-resolution
crop only on demand. One original is retained in task memory, every new
observation invalidates prior crop authority, and cleanup removes both CUA and
image state.

Computer use is an optional tool inside the Everyday Agents SDK loop. A new task
does not create a CUA session, infer a computer capability, or capture a
screenshot.

## Lazy flow

```text
model calls observe_surface (when the compatible CUA capability is available)
  -> host checks/starts task-scoped CUA in Auto scope
  -> if permission is absent, pause for user-clicked Connect computer
  -> identify one current non-TroCode browser/native window
  -> try browser semantics, window accessibility, window screenshot, then desktop screenshot
  -> return bounded facts and opaque e1/e2 references to the same call ID
  -> model may call control_surface using the latest observation ID and reference
  -> host resolves the private token and records the declared consequence
  -> host merges the typed effect proposal with payload and visible risk raisers
  -> policy matches a current reversible instruction grant, denies, or asks for exact approval
  -> execute one atomic command
  -> refresh the exact same bound surface and replace all old references
  -> return outcome + fresh evidence to the same model session

If semantic capability is absent or the target is ambiguous, the existing
observe_desktop/control_desktop coordinate flow is used unchanged. Auto is a
hardcoded session invariant, not a user, environment, or model option. The host
keeps the session window-scoped while semantic reading works and explicitly
escalates it to desktop scope only when desktop vision or coordinate control is
required.
```

The model never receives CUA, Electron IPC, driver handles, process/window/tab
IDs, browser targets, accessibility tokens, or snapshots. Semantic references
are observation-local aliases held only in Electron main. Its normalized legacy
coordinates are converted once into screenshot pixels; companion presentation
coordinates are mapped separately into desktop points.

Before model input, wide screenshots are resized to at most 1,536 pixels and
encoded as bounded JPEG evidence. Exactly one current screenshot may appear in
a Responses request. After that model boundary its bytes are demoted from the
bounded SDK session while textual observation facts remain. A later action must
produce a newer observation; historical screenshots are never replayed.

## Freshness and approvals

Every control call must cite the latest observation UUID. The host includes the
observation UUID and fingerprint in the normalized `ProposedAction` and approval
digest. Before executing a held consequential desktop action, it captures the
screen again. Any fingerprint change invalidates the grant, returns
`not_executed` plus the new screenshot, and requires a newly grounded proposal.
Opening a browser URL also invalidates the cached observation before any later
coordinate action can be resolved.

For semantic approval, the host refreshes the same application/window/tab and
requires one unique match for the approved element's bounded semantic identity.
It then rebinds the new private token to the held public reference. A surface
change, missing target, or duplicate match discards the grant and executes
nothing. Existing-profile browser attachment is a separate one-use
`system_permission` approval; the authorization host denies every callback
unless its session, operation, and resource digest match the armed grant.

The model's declared effect/consequence is retained for policy evidence and
exact approval copy, but it cannot downgrade host normalization. Balanced
autonomy allows effect-free grounded controls and current instruction-matched
reversible private effects. Attendees force a calendar save to an invitation;
generic submit is unknown. Sensitive cues, opaque targets, stale observations,
or contradictory metadata raise to exact approval. Strict autonomy confirms
every mutation or side effect.

## Outcomes

Adapters return `confirmed`, `unknown`, `failed`, `denied`, or `not_executed`
with bounded text and optional in-memory image evidence. A dispatched desktop
action is followed by a fresh observation even when the driver reports an
unknown outcome. The exact action digest is then placed on a do-not-dispatch
list. If an approved consequential action has an unknown outcome, TroCode blocks
and cleans up the task so neither the same action nor another consequential
action can be dispatched from that session.

## Cancellation and cleanup

One serialized run is active per task. A newer observation invalidates prior
semantic references. Cancellation aborts model sampling,
permission work, observation, or adapter work. CUA is ended only if it was
started, the in-memory model session is erased, and resolved call IDs are
released. Reference bindings and armed authorization are cleared on task end,
disconnect, and shutdown. A cancellation received after an atomic external
effect does not undo or automatically retry that effect.
