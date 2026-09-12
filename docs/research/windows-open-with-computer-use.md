# Opening lesson material through the Windows app chooser

Research date: 12 September 2026. Scope: the supplied Vietnamese Windows Open With screenshot, Tro's installed Cua Driver 0.19.3, and the latest local execution trace. This report documents research and recommendations; it does not claim a successful live interaction.

## Findings

The chooser requires an application selection followed by an open confirmation. In the supplied screenshot, Notepad appears unselected and both bottom buttons are disabled. The expected next steps are to select Notepad, verify that “Chỉ một lần” (Just once) becomes enabled, activate it, and verify the requested document in the resulting viewer. This sequence is an inference from the screenshot, not an observed successful run.

The latest recorded failure is earlier in that sequence: the captured native calls contain observations, but no native click or keypress. Desktop inspection was refused under the installed runtime's session rules. A later window inspection targeted the driver's own authorization process and was refused. The agent then ended its turn without establishing material visibility. There is no evidence in this run that Windows rejected a delivered Notepad click.

There is also a separate Tro code limitation: a desktop observation without a window identity always returns `ready: false`. Fixing input delivery alone cannot make that verification branch succeed. These are distinct defects to investigate and test, rather than one generic “CUA failed” diagnosis.

## What the computer-use agent needs to do

| Step | Action selected from fresh evidence | Required observation before proceeding |
| --- | --- | --- |
| Locate | Enumerate windows and inspect the actual chooser's PID and HWND. | The target is the chooser shown in the screenshot, not Tro, Codex, or another app's window. |
| Select | Select the Notepad item using an advertised accessibility action, or a screenshot-grounded click. | Notepad becomes selected; the confirmation button becomes enabled. |
| Confirm | Invoke or click the enabled Just once button. | The chooser disappears or transitions to another opening state. |
| Rediscover | Enumerate and inspect the resulting viewer window. | A viewer exists and contains the requested file, rather than an empty editor or an unrelated document. |
| Verify | Compare the filename and visible lesson content with the supplied resource context. | The requested material is demonstrably visible. |
| Teach | Explain the visible section and use fresh screen coordinates for pointing or scrolling. | Explanations and pointers correspond to the current viewport. |

This is a model-directed sequence, not a proposal for a hardcoded Notepad workflow. The application name and control labels should come from the current observation. Coordinates from a cropped attachment must not become live desktop coordinates.

Windows distinguishes selectable items from commands. Its SelectionItem pattern exposes `Select` and `IsSelected`; that supports selecting a list item and checking its state.[1] We have not captured this chooser's actual accessibility tree, so it would be premature to claim that its Notepad row exposes that specific pattern. If the native adapter cannot execute the advertised selection action, a pixel click is a reasonable next capability to test.

The current Cua Windows reference provides exact window targeting and snapshot-bound element addressing. Its documented input strategy starts with supported background delivery and uses foreground delivery after a known refusal or observed failure. Element handles must belong to the relevant current snapshot.[2] An Enter keypress without verified focus is weaker evidence than selecting a known item and activating a known enabled button.

## Delivery does not establish completion

There are three separate facts: the operating system accepted an open request; an input event was dispatched; the requested document became visible. They must not share a single success flag.

Electron's `shell.openPath` opens a file in the desktop's default manner and resolves with an empty string when it reports no failure. Its contract does not promise that a particular viewer is showing the document.[3] The chooser in this case is an intermediate operating-system UI, not completion of the lesson goal.

Likewise, Windows `SendInput` reports inserted input events, not that Notepad was selected. Existing keyboard state can affect input, and integrity-level restrictions can block injection.[4] No evidence collected here establishes an integrity mismatch; changing elevation would therefore be an unsupported remedy.

Windows also restricts foreground activation. `SetForegroundWindow` can fail even when documented eligibility conditions appear satisfied.[5] This explains why focus receipts and target identity matter, but does not establish an activation failure in the latest run: there was no recorded native input attempt to diagnose.

Cua's verification guide explicitly uses an independently observed postcondition to establish that an action took effect. A timeout can leave dispatch uncertain, so replaying the original operation is not a reliable recovery strategy.[6] For this chooser, the immediate postcondition is selection and an enabled confirmation button; it is not yet the final lesson being visible.

## Latest local evidence

Source: `%APPDATA%\Tro Test\diagnostics\execution.jsonl`, task `a7805a51-9337-4fcd-b2ee-0089eb51ad37`. Times below are UTC; local time is UTC+7. The examined records cover the run ending at approximately 16:02 local time.

| UTC time | Recorded event | What it establishes |
| --- | --- | --- |
| 09:01:16.156 | Tool result: `not_executed`; “Show the requested file, or select its window to explain it.” | Material observation did not establish the requested file. |
| 09:01:27.880 | Same material result. | Another observation did not resolve the mismatch. |
| 09:01:38.005 | Native `get_desktop_state` refused: desktop scope locked for the auto session; message requires the window action ladder and `escalate_session`. | The model's requested desktop observation was unavailable under this runtime/session contract. |
| 09:01:49.457 | Native `get_window_state` returned without a recorded error. | Some window inspection succeeded; this alone does not prove it was the chooser or requested file. |
| 09:01:57.846 | Material observation again returned `not_executed`. | The file was still unverified. |
| 09:02:07.172 | Native `get_window_state`: “Permission denied: Cua Driver refuses operations that target its own authorization process”. | The chosen target was rejected by the driver's self-target protection. |
| 09:02:15.724 | `get_browser_state` returned without a recorded error. | Browser inspection happened; it does not prove a native chooser interaction. |
| 09:02:29.542 | `lesson.failure`, effect `none`: `LessonBlockedError: The local agent completed the turn.` | The model ended without satisfying the lesson's visibility requirement. |

The native records inspected for this task contain `list_windows`, `get_window_state`, `get_desktop_state`, and `get_browser_state`, rather than `click` or `press_key`. Consequently the strongest supported diagnosis is failure to progress from observation to a correctly targeted input action. A previous run's uncertain SendInput receipt must not be used as evidence that this run attempted the same click.

The self-target refusal should prompt correction of window selection. It is not evidence that the legitimate chooser must be made exempt from all restrictions. Determine the actual chooser owner from the window inventory before changing any policy.

## Installed behavior differs from current documentation

The locally installed `node_modules/@trycua/cua-driver/package.json` reports version **0.19.3**. Its live error describes session escalation. Current Cua documentation describes per-action window and desktop targets and explicitly states that a desktop action does not disable subsequent window tools. It also describes combined screenshot/accessibility observation and separate delivery/effect signals.[7]

This mismatch matters: instructions written for today's documented contract may not work with the installed native runtime. The exact published release introducing the new behavior has not been established by this research. An upgrade is a hypothesis to validate, not a demonstrated fix. Package version, native binary version, exposed tool schemas, and observed runtime behavior should be recorded together before choosing a migration.

## Tro's separate verification dead end

In `src/main/knowledge/classroom-lesson-surface-service.ts`, the observation path contains:

```ts
if (!result.identity) {
  this.bindings.delete(state.envelope.lessonId);
  return { ready: false, observation, error: new LessonBlockedError(
    'surface_unverified',
    'Desktop capture is active. Inspect this fresh screen and continue opening the material; this capture alone does not verify the document.') };
}
```

The desktop fallback in the Cua service supplies an observation without that window identity. This branch therefore cannot accept a visible document from desktop evidence, even when a model could recognize it. This is a source-level finding; it is not proof that the latest run reached the branch after a successful chooser interaction.

The normal window path checks the resource against window title and available content. Those checks have a useful purpose: preventing explanation of the wrong file. Their implementation is tied to one observation representation. The architectural correction should preserve the requirement for evidence while allowing supported observation forms to provide it.

## Recommended engineering direction

The harness should provide resource context, usable observations, generic actions, and a clear task postcondition. The model should choose the intermediate UI steps. Nothing in this case establishes a need for a `chooseNotepad` or `handleMarkdownChooser` product function.

First, align the adapter and agent-visible instructions with the pinned runtime's real capabilities. Surface refusal messages in a structured way that permits an actionable next decision. Keep the chooser's PID/HWND separate from the host application's identity. Preserve screenshots and control metadata in the model-visible observation; a human-readable event summary alone is insufficient for grounded clicking.

Second, distinguish intermediate progress from final completion. A fresh observation can show that selection succeeded even though the document is not open yet. That should permit the next independently chosen action. It must not automatically turn an uncertain prior operation into a confirmed one or replay it.

Third, make material verification consume evidence through a shared interface. Window-backed evidence can retain its existing checks. Desktop visual evidence needs an explicit provenance, freshness, resource-match, and result contract before it can establish visibility. Simply removing the identity check would allow false completion; simply retaining it makes some valid execution paths impossible.

Finally, a model's final message is only a turn boundary. The lifecycle should compare the task postcondition with the evidence and either continue with a concrete recoverable state, report a specific blocking condition, or complete. Repeated observations of unchanged state should produce a different next action or a bounded failure reason, rather than an indefinite loop.

## Acceptance experiment before another fix claim

Run a controlled chooser test on this Windows machine with Tro's competing autonomous run stopped. Record Windows build, scaling, display layout, runtime versions, and the exact file path. Do not alter the system's default file association as a test shortcut.

1. Capture the chooser window inventory, accessibility tree, screenshot, and exact native target.
2. Perform one supported selection action and capture its receipt plus the resulting screen/control state.
3. If it was refused, choose a supported alternate delivery path. If completion is uncertain, observe before deciding anything further.
4. Activate Just once only after observing the enabled button.
5. Capture the resulting viewer and confirm the filename and lesson excerpt.
6. Repeat through Tro's agent loop with the same runtime and compare the full model-visible observations and native calls.
7. If testing a newer runtime, repeat the same scenario as a separate experiment, preserving the original trace.

| Outcome | Likely boundary to investigate |
| --- | --- |
| Direct native test cannot select the item | Driver action support, target identity, focus, or Windows input delivery. |
| Direct test succeeds but Tro never requests input | Agent context, tool exposure, observation delivery, or continuation behavior. |
| Tro selects the item but cannot confirm | Stale target, button state, action semantics, or delivery mode. |
| Document opens but Tro stays unverified | Material evidence contract and lifecycle integration. |

Success means one opening request, the requested file visibly open, an explanation grounded in that viewport, and a trace that connects each action to its observed effect. Unit tests or a green build cannot substitute for this live native acceptance evidence.

## Remaining uncertainty

The actual chooser accessibility patterns, the full images delivered to the model in the latest run, and the model's reason for ending were not established. The exact runtime release corresponding to current documentation remains unverified. No live selection was performed during this research. These gaps prevent attributing the entire incident to either model capability or the native driver alone.

## Sources

All online sources below are primary documentation, consulted 12 September 2026. Current documentation is not assumed to describe every historical package version.

[1]: https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-implementingselectionitem "Microsoft: SelectionItem Control Pattern"
[2]: https://cua.ai/docs/reference/cua-driver/mcp-tools-windows "Cua: MCP Tools (Windows)"
[3]: https://www.electronjs.org/docs/latest/api/shell "Electron: shell API"
[4]: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput "Microsoft: SendInput"
[5]: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow "Microsoft: SetForegroundWindow"
[6]: https://cua.ai/docs/how-to-guides/driver/verify-a-desktop-action "Cua: Verify a desktop action"
[7]: https://cua.ai/docs/concepts/capture-and-delivery-modalities "Cua: Capture and Delivery Modalities"

Local evidence: the supplied chooser screenshot; installed package manifest; `src/main/knowledge/classroom-lesson-surface-service.ts`; `src/main/cua/cua-service.ts`; and the diagnostic task identified above. Local evidence and the proposed experiments are original analysis, separate from documentation claims.
