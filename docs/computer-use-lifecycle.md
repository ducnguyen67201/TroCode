# Computer-use lifecycle

Computer use is an optional tool inside the general Responses loop. A new task
does not create a CUA session, infer a computer capability, or capture a
screenshot.

## Lazy flow

```text
model calls observe_desktop
  -> host checks/starts task-scoped CUA
  -> if permission is absent, pause for user-clicked Connect computer
  -> capture fresh observation and return screenshot to the same call ID
  -> model may call control_desktop using that observation ID
  -> host parses normalized coordinates and records the declared consequence
  -> host derives action identity and approval sensitivity from the command
  -> policy allows, denies, or asks for exact approval
  -> execute one atomic command
  -> always capture a fresh observation
  -> return outcome + screenshot to the same model session
```

The model never receives CUA, Electron IPC, or driver handles. Its normalized
coordinates are converted once into screenshot pixels; companion presentation
coordinates are mapped separately into desktop points.

Before model input, wide screenshots are resized to at most 1,536 pixels and
encoded as bounded JPEG evidence. Exactly one current screenshot may appear in
a Responses request. After that sample its bytes are demoted from manual
history while bounded textual observation facts remain. A later action must
produce a newer observation; historical screenshots are never replayed.

## Freshness and approvals

Every control call must cite the latest observation UUID. The host includes the
observation UUID and fingerprint in the normalized `ProposedAction` and approval
digest. Before executing a held consequential desktop action, it captures the
screen again. Any fingerprint change invalidates the grant, returns
`not_executed` plus the new screenshot, and requires a newly grounded proposal.
Opening a browser URL also invalidates the cached observation before any later
coordinate action can be resolved.

The model's declared consequence is retained for audit and exact approval copy,
but it cannot downgrade policy. The host requires approval for every desktop
click, drag, text-entry, or keypress operation; only non-mutating scrolling can
run without that desktop-mutation gate.

## Outcomes

Adapters return `confirmed`, `unknown`, `failed`, `denied`, or `not_executed`
with bounded text and optional in-memory image evidence. A dispatched desktop
action is followed by a fresh observation even when the driver reports an
unknown outcome. The exact action digest is then placed on a do-not-dispatch
list. If an approved consequential action has an unknown outcome, TroCode blocks
and cleans up the task so neither the same action nor another consequential
action can be dispatched from that session.

## Cancellation and cleanup

One serialized run is active per task. Cancellation aborts model sampling,
permission work, observation, or adapter work. CUA is ended only if it was
started, the in-memory model session is erased, and resolved call IDs are
released. A cancellation received after an atomic external effect does not undo
or automatically retry that effect.
