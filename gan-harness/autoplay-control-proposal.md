# The Pace Thread

## Recommendation

Default every first walkthrough to **Manual**. TroCode should wait at the end of
each explanation until the user chooses **Next**.

Manual is the high-confidence default because the interface is teaching over
someone else's content. Reading speed, difficulty, and the cost of losing one's
place vary more than the cost of one extra click. Starting motion without prior
consent would also make the companion feel autonomous before the user understands
how to pause it.

Autoplay is a remembered convenience, not a new execution authority. It may
advance only between already-approved, non-consequential teaching steps. It must
never carry through an approval, sensitive action, ambiguous target, or user-input
step.

The signature visual is the **pace thread**: the thin line that already visually
ties the companion to its floating callout becomes a quiet time signal. It rests
in Manual, fills with amber in Autoplay, and breaks into a dotted line when
paused. This makes pacing feel like part of a cursor-led guide—not a miniature
video player.

## Hierarchy near the cursor

The callout has three layers, in this order:

1. **Teaching content** — the current explanation remains the largest and
   highest-contrast element.
2. **Position in the walkthrough** — `3 of 16` sits above the explanation in a
   small monospaced label, paired with the objective if space permits.
3. **Pacing controls** — a low, single-row footer. The pace button is secondary;
   the action needed now is primary.

Manual:

```text
       ◉ companion ──────────────╮  resting pace thread
                                │
  ┌─────────────────────────────┴──────────────┐
  │  03 / 16 · FRACTIONS                       │
  │                                             │
  │  Divide both sides by 4. That leaves x = 6.│
  │                                             │
  │  [ Pace · Manual ▾ ]               [ Next →]│
  └─────────────────────────────────────────────┘
```

Autoplay:

```text
       ◉ companion ━━━━━━━╸──────╮  amber fill approaches next step
                                │
  ┌─────────────────────────────┴──────────────┐
  │  03 / 16 · FRACTIONS                       │
  │                                             │
  │  Divide both sides by 4. That leaves x = 6.│
  │                                             │
  │  [ Pace · Auto ▾ ]        [ Next now ] [ Pause · 8s ]│
  └─────────────────────────────────────────────┘
```

At widths below 320 px, `Next now` becomes an arrow button with the accessible
name “Next now.” `Pause · 8s` remains a text button; pause must never be hidden in
an overflow menu. A small `Stop` control sits in the callout's top-right corner,
separate from the footer, with a 44 × 44 px hit target.

## First walkthrough

Show the first explanation immediately in Manual. Do not put a modal or setup
screen in front of it. On the first callout only, expand a two-line pace nudge
between the explanation and footer:

**Heading:** `Choose your pace`

**Body:** `I can wait after each step, or keep moving.`

**Choices:**

- `Wait for me` — selected by default
- `Keep moving` — starts Autoplay

**Footnote:** `Change this anytime.`

Ignoring the nudge is safe: **Next** remains available and pressing it commits
Manual. Choosing either option collapses the nudge into the `Pace · …` button in
160 ms. Do not show the nudge again after an explicit choice; subsequent
walkthroughs show the compact footer directly.

The companion may add one short chat sentence above the controls, only on first
use:

> I’ll wait after each step. Want me to keep moving instead?

This is explanatory text, not another control.

## Pace menu

Clicking `Pace · Manual` or `Pace · Auto` opens a two-option popover attached to
the footer. It does not open the main TroCode window.

| Option | Supporting line | Selection result |
| --- | --- | --- |
| `Manual` | `Wait after every step` | Cancels any timer and waits here |
| `Autoplay` | `Move on after reading time` | Starts a fresh timer on this step |

The selected option uses a checkmark, not color alone. The popover footer reads
`Remembered for similar walkthroughs` when persistence is allowed. There is no
Save button.

Switching Manual → Autoplay never advances immediately. TroCode starts a full
reading interval for the current callout and briefly shows:

`Autoplay on · Moving in 10s`

Switching Autoplay → Manual cancels the timer immediately and shows:

`Waiting here · Use Next when ready`

Temporary **Pause** is different from changing the mode. Pause retains Autoplay
and changes the right action to `Resume`. The pace button reads
`Pace · Auto paused` so the state is not encoded only in the broken thread.

## Exact control copy

| State | Pace button | Primary control | Secondary control | Status text |
| --- | --- | --- | --- | --- |
| Manual, waiting | `Pace · Manual` | `Next` | — | `Waiting for you` |
| Autoplay, counting | `Pace · Auto` | `Pause · {n}s` | `Next now` | `Moving in {n}s` |
| Autoplay, paused | `Pace · Auto paused` | `Resume` | `Next` | `Paused here` |
| Companion moving | current pace | `Moving…` disabled | `Pause` remains enabled | `Moving to {next} of {total}` |
| User input required | `Pace · Manual` locked | task-specific action | — | `Your input is needed` |
| Approval required | pace hidden | approval controls | — | `Autoplay paused for approval` |
| Walkthrough complete | pace hidden | `Done` | `Review steps` if available | `Walkthrough complete` |
| Stopped | pace hidden | `Undo stop` for 3 seconds | — | `Walkthrough stopped` |

Use `Auto`, not a play triangle, in the persistent pace label. Use `Autoplay` in
the menu and first-run explanation where there is room. Avoid “speed,” because
the setting controls who advances—not how fast the companion moves.

## Reading interval and motion

Autoplay duration is based on visible explanation length rather than a fixed
speed:

```text
readingMs = clamp(6_000, 18_000, 2_000 + visibleWordCount / 3 * 1_000)
```

This provides roughly 180 words per minute plus two seconds to orient to the
target. The countdown starts only after:

- the companion has reached the current target;
- the callout has remained layout-stable for 500 ms;
- the app is foregrounded and the current step is fully visible; and
- no approval, clarification, text selection, or user takeover is active.

The pace thread fills left-to-right over the reading interval. Its amber is
muted until the final three seconds; then the footer shows `Pause · 3s`,
`Pause · 2s`, `Pause · 1s`. Do not pulse or flash the whole card.

On advance:

1. Fade the callout content to 70% over 90 ms.
2. Glide the companion to the next target in 260–480 ms, scaled by distance.
3. Keep the step label visible as `Moving to 4 of 16` so movement has a stated
   destination.
4. Re-anchor the callout 12–16 px from the companion, respecting screen edges.
5. Crossfade the new explanation over 140 ms, then begin its reading interval.

The callout should not chase the pointer continuously. It disappears during the
middle 60% of a long glide and reappears close to the destination, preventing a
large panel from sweeping across the worksheet.

Hovering the callout, focusing any control, or selecting explanation text freezes
the countdown. Pointer exit alone does not resume it; show `Resume` so progression
cannot restart unexpectedly. Window blur, display change, target loss, or physical
mouse takeover also pause and require explicit resume.

## Keyboard behavior

Shortcuts are active only while the companion callout owns focus. TroCode must
not capture keys while the user is typing in the underlying page or another app.

| Key | Behavior |
| --- | --- |
| `Enter` or `→` | Next in Manual; next immediately while Auto is paused |
| `Space` | Pause or resume Autoplay |
| `Esc` | Pause at the current step in either mode and focus `Resume`/`Next` |
| `Shift` + `Esc` | Stop the walkthrough and offer `Undo stop` for 3 seconds |
| `Tab` / `Shift` + `Tab` | Move through Stop, pace, secondary, and primary controls |

When the callout does not own focus, clicking the callout or using the existing
TroCode focus shortcut should focus it first; a navigation key should never both
focus and advance in one press.

After each step, focus remains on the semantic primary control in the callout—it
does not follow the moving visual cursor. The screen-reader virtual cursor is
never moved programmatically.

## Remembering the choice

Persist the last **explicit** selection locally, not a temporary pause. Suggested
preference shape:

```ts
type WalkthroughPacePreference = {
  hasSeenPaceChoice: boolean;
  general: 'manual' | 'autoplay' | null;
  repetitive: 'manual' | 'autoplay' | null;
  updatedAt: string;
};
```

Resolve each new walkthrough in this order:

1. Sensitive, consequential, input-heavy, or low-confidence walkthrough:
   **Manual**, regardless of remembered preference. Label the pace menu option
   `Manual · required for this step` where applicable.
2. Repetitive worksheet with an explicit `repetitive` preference: use it.
3. Other non-sensitive walkthrough with an explicit `general` preference: use
   it.
4. No prior explicit choice: Manual and show the first-run nudge.

Choices made during repetitive worksheets update only `repetitive`; choices in
other walkthroughs update only `general`. This prevents one worksheet from
unexpectedly changing ordinary guided tours. The first-run nudge appears once;
when a later task category has no stored choice it quietly uses Manual and keeps
the pace menu available. A Settings row can later expose
`Walkthrough pace: Remembered / Always manual`, but the main-window setting is
not required to operate the callout.

Every automatic override is disclosed once in the callout:

`Paused for this step · Your input is needed`

After the sensitive/input step resolves, return to **Auto paused**, not running
Auto. The user chooses `Resume`.

## State model

Implementation should use explicit pacing state rather than deriving behavior
from button labels:

```ts
type WalkthroughPaceState =
  | { mode: 'manual'; status: 'waiting' }
  | { mode: 'autoplay'; status: 'counting'; deadline: number }
  | { mode: 'autoplay'; status: 'paused'; reason: PauseReason }
  | { mode: 'autoplay'; status: 'advancing'; destinationStep: number }
  | { mode: 'manual'; status: 'blocked'; reason: BlockReason }
  | { mode: 'manual'; status: 'stopped'; undoUntil: number }
  | { mode: 'manual'; status: 'complete' };

type PauseReason =
  | 'user'
  | 'hover_or_focus'
  | 'window_blur'
  | 'pointer_takeover'
  | 'target_lost'
  | 'interaction_required';

type BlockReason = 'approval' | 'clarification' | 'sensitive_step';
```

Minimum events are `PACE_CHOSEN`, `COUNTDOWN_ELAPSED`, `NEXT_REQUESTED`,
`PAUSE_REQUESTED`, `RESUME_REQUESTED`, `USER_POINTER_MOVED`, `WINDOW_BLURRED`,
`INTERACTION_REQUIRED`, `TARGET_LOST`, `STOP_REQUESTED`, and `UNDO_STOP`.

The controller must re-check that the task, step, target, and authorization are
still current after `COUNTDOWN_ELAPSED` and before moving or clicking. An elapsed
timer is only a request to advance; it is never approval to perform a
consequential action.

## Accessibility and prevention of accidental activation

- Controls have at least 44 × 44 px hit targets and a visible 2 px focus ring.
- Manual/Auto, running/paused, and completed/failed states use text and icon
  shape in addition to color.
- The callout is a named `region`; step changes use a polite live region. Do not
  announce every countdown second. Announce `Autoplay on`, `Three seconds to
  next step`, pause reasons, and new step headings only.
- `Pause · {n}s` has the stable accessible name `Pause autoplay`; the changing
  number is `aria-hidden`. Expose the remaining time separately through a
  progressbar with `aria-valuemin`, `aria-valuemax`, and `aria-valuenow`.
- The pace menu is a radio group with `aria-checked`; closing it returns focus to
  the pace button.
- The companion hotspot and the visual callout never overlap the underlying
  target. At high zoom or large text, the footer wraps to two rows and the
  explanation scrolls up to a capped 60vh; Pause and Stop remain sticky.
- With `prefers-reduced-motion`, replace glides and pulses with an 80 ms
  crossfade, keep the numeric countdown, and preserve all timing controls.
- Autoplay never starts through hover. It requires an explicit click, tap, or
  keyboard selection at least once.
- Use a minimum six-second first interval and reset it whenever explanation
  content changes.
- If the user moves the physical pointer during companion movement, pause before
  any click or next-step action. Never retry a consequential action whose result
  is unknown.
- Stop is always visible. It requires one deliberate activation, then provides a
  three-second Undo rather than a confirmation modal.

## Acceptance checks

1. A first-time user can read step one and proceed without answering a modal.
2. Ignoring the first-run nudge leaves the walkthrough safely in Manual.
3. Autoplay can be paused in one click and with `Space` while the callout is
   focused.
4. `Esc`, window blur, hover/focus, pointer takeover, target loss, and required
   interaction cannot result in a surprise advance.
5. Switching to Autoplay grants a full reading interval on the current step.
6. Returning from approval/input leaves Autoplay paused until explicit resume.
7. The user can distinguish Manual, Auto, and Auto paused without color.
8. At 200% zoom, step, Stop, pace, and Pause/Next remain available without
   horizontal scrolling.
9. Reduced-motion mode contains no continuous pulse or spatial glide.
10. Restarting TroCode uses the last explicit appropriate preference while still
    forcing Manual for sensitive or low-confidence walkthroughs.
