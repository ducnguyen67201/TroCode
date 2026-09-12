# Staging execution diagnostics

Run `npm run start:test` on the student computer with this revision. Tro Test
prints `[execution]` JSON records to the launch terminal and saves them in its
profile. The startup line prints the exact file location. The ordinary app
prints diagnostics to the terminal but does not enable this file sink.

On Windows, inspect the latest records with PowerShell:

```powershell
Get-Content "$env:APPDATA\Tro Test\diagnostics\execution.jsonl" -Tail 150
```

On macOS:

```bash
tail -n 150 "$HOME/Library/Application Support/Tro Test/diagnostics/execution.jsonl"
```

The current file is `execution.jsonl`; rotation retains one
`execution.previous.jsonl`. Each is limited to 2 MiB. Files survive app restarts;
the `app.started` record identifies the build, platform, process and timestamp.
These are local diagnostics, not uploaded telemetry. The teacher computer does
not receive the student's tool trace. Update both clients to the same revision
and collect the files from the computer where opening failed.

## Reading a failed opening

Find `lesson.failure` or `turn.terminal`, then follow `taskId` and `turnId`
backward. `callId` ties a model tool to its native calls; `nativeCallId` separates
multiple native calls inside one model tool. Tool arguments are not recorded.

| Event | What it establishes |
| --- | --- |
| `tool.received`, `tool_started` | Model tool, operation, call and lesson identity; start of dispatch |
| `opening.dispatch`, `opening.still_pending` | One OS open request exists; it may be waiting for application UI |
| `opening.completed`, `opening.failed`, `opening.unknown` | The existing request's completion, rejection, or uncertain result |
| `opening.restored_unknown`, `opening.persistence_failed` | A restart lost the live request, or its completion could not be saved |
| `cua.started`, `cua.result`, `cua.exception` | Native tool, target PID/window, requested delivery mode, duration, effect, route, error/refusal code and redacted failure text |
| `tool.result` | Host result before SDK normalization; observation identity/route and opening operation ID/status when present |
| `lesson.guard_denied`, `tool.policy_denied` | Failure before control dispatch, including stale evidence or revoked authority |
| `tool.dispatch_exception`, `tool_unknown` | Original failure before the SDK replaces it with a generic unknown-outcome message |
| `tool.settled` | Duration of the host tool request, including policy/journal work |
| `lesson.transition`, `lesson.failure`, `turn.terminal` | Lesson status, reason, effect, budgets, and final runtime outcome |

An unmatched `cua.started` shows a native call has not returned in the captured
trace. A `cua.result` with `effect: "unverifiable"` is different from an explicit
refusal or thrown activation error. `opening.completed` means OS acceptance;
it does not prove that the document is visible. Preserve the original failure
records before reproducing the problem.

Screenshots, accessibility trees, source text, raw native payloads, successful
tool summaries and model prompts are not included. Diagnostic error prose is
bounded and redacts common credential formats, URLs, emails and native paths;
arbitrary third-party error prose is not guaranteed to be free of sensitive
content. Logging and file-write failures cannot change tool results, grant
authority, or trigger a replay.

Regression coverage exercises overlapping-call correlation, native refusal and
exception capture, the original tool error preceding a generic unknown terminal,
no redispatch of a journaled unknown call, redaction, file rotation across
restarts, and console/disk failures. CI owns execution of these checks.
No backend API, IPC, database migration, or staging service deployment is needed.


## Windows input verification recovery

The September 12 Windows trace reports OS acceptance of the material opening,
then an Enter delivered through background PostMessage without verification.
That receipt does not establish whether Enter landed. Previously semantic input
always requested background delivery, and the classroom guard treated native
accessibility reads as actions after an unknown result.

Native semantic controls now default to foreground delivery and accept an
explicit `deliveryMode` of `foreground` or `background`. Browser semantic actions
keep their browser route. No fallback replays an input automatically.

An input receipt with native effect `unverifiable` or `suspected_noop` remains
`unknown` in the invocation journal. Inside a guarded desktop lesson, it carries
`recovery: observe` through the SDK so observation can continue. Shared native
observation registration covers accessibility/window/browser state and window
listing; unknown capabilities and optional file exports remain actions.
`lesson.input_verification_pending` records that transition.

Fresh generic observations do not prove delivery or authorize another mutation.
Only a semantic control explicitly requesting `verification: material_visible`,
using the fresh observation from a failed `lesson_observe` while an OS opening
is completed and the material has not yet been verified, can use this recovery.
Ordinary edits and raw driver actions cannot be resolved by resource identity.
`lesson_observe` must verify the requested material before the lesson can resume;
`lesson.material_verified_after_input` records that evidence. If the chooser is
still visible, control remains blocked. A partial native effect, thrown dispatch,
unknown opening, stopped lesson, or revoked authority cannot be cleared by this
recovery path. Revocation or persistence errors during recovery restore the unknown
effect. The original call is never dispatched again, including after a
restart or repeated runtime message.

For Windows acceptance, run the revised student build against staging and repeat
the material-opening flow. Confirm `cua.started` requests foreground for native
semantic Enter. If delivery remains unverified, confirm native accessibility
reads are allowed, the material is verified before explanation, and there is
only one dispatch for the original call. CI and this Windows run are required;
mocked native tests cannot prove OS delivery or window activation.
