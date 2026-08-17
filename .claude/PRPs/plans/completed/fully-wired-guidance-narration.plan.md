# Plan: Fully Wired Guidance Narration and Playback

## Summary

Finish the partially connected walkthrough voice path so every user-facing
`show_guidance` step is presented, narrated exactly once, and held until the
narration and playback policy permit advancement. Replace full-file/base64
ElevenLabs delivery with authenticated HTTP streaming behind a private Electron
media protocol, wire Back/Pause/Next to the execution coordinator, and retain a
single non-overlapping system-speech fallback when hosted TTS is unavailable.

This plan deliberately defines “every step” as every grounded walkthrough step
created by the `task.guidance` / `show_guidance` tool. Silent model sampling,
desktop observations, automated clicks, verification, and long final answers are
not narrated; speaking those internal operations would be noisy and could expose
content that the user did not ask to hear.

## User Story

As a TroCode user following a walkthrough, I want each visible guidance step to
be spoken and controllable before TroCode advances, so that I can follow the
pointer without repeatedly looking back at the task window or missing an
explanation while audio is still loading.

## Problem → Solution

`show_guidance` starts a fire-and-forget, fully buffered ElevenLabs request while
the agent immediately continues; late audio is discarded or aborted, the 2.2 s
browser fallback can race it, and the displayed J/K/L controls have no live input
path → make narration an explicit guidance-step lifecycle, stream it through a
private media URL, wait for typed playback completion plus the existing dwell
policy, and connect safe global Back/Pause/Next accelerators to step history.

## Metadata

- **Complexity**: XL
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 36 files
- **Recommended Delivery**: Four mergeable gates: streaming transport, renderer
  playback, coordinator pacing/history, then shortcuts/observability/docs.
- **Working Tree Note**: The repository currently contains uncommitted
  companion-interaction work in `src/shared/contracts.ts`,
  `src/shared/desktop-api.ts`, `src/preload.ts`, and
  `src/main/ipc/register-ipc.test.ts`, plus new companion-interaction files.
  Preserve and integrate with those edits; do not revert them.

---

## Product Semantics

### What counts as a narrated step

1. A fresh `show_guidance` tool call that has passed registry parsing, policy,
   observation freshness, and presentation mapping.
2. A replay of a previously completed guidance step after Back. Replay uses a
   new ephemeral audio ticket but does not create a new model call, tool result,
   history event, or progress increment.
3. A failed or unavailable ElevenLabs attempt still counts as narrated when the
   system-speech fallback completes. If neither audio source works, the visible
   step remains usable and can advance after the dwell timer or Next.

### What does not count

- `observe_desktop`, planning, verification, policy checks, and background state.
- Autonomous desktop/direct actions. Their descriptions may remain visible in
  the main task UI, but they are not spoken as walkthrough instructions.
- Approval and clarification prompts. They keep the existing main-renderer
  system speech in this delivery, with cleanup fixed so it cannot overlap a
  resumed guidance narration.
- Final assistant answers. They remain visual because they can be long, contain
  code, or contain material that is inappropriate to read aloud automatically.

### Playback rules

- A new guidance step starts one ElevenLabs stream when configured; it does not
  also start browser speech.
- The visible message and target appear immediately; audio loading never blocks
  pointer presentation.
- Auto-advance occurs only when both conditions are true: the existing 15-second
  step dwell has elapsed and narration reached a terminal outcome. This preserves
  the current reading interval without cutting off long audio.
- Next cancels the current audio immediately. From the newest cached step it
  resumes the model; from an older cached step it moves to the next cached step.
- Back cancels current audio, moves to the previous cached step, and replays its
  narration without re-running the model tool or CUA adapter.
- Pause pauses the active HTML audio or system utterance and suspends auto-advance.
  Resume continues both. Resuming may restart the dwell timer, matching the
  current `GuidancePlaybackController` behavior.
- Task cancel, deadline, sign-out, window destruction, a pending interaction, or
  app shutdown cancels the audio fetch, player, timers, protocol ticket, and wait.
- Only one audio source may be audible at a time.

---

## UX Design

### Before

~~~text
┌─────────────────────────────────────┐
│ TroCode · Guiding                  │
│ Click the Filters button.             │
│                         [Filters]      │
│ J Back   K Pause   L Next             │  visual only
└─────────────────────────────────────┘
       ├─ full MP3 generated remotely
       ├─ full MP3 buffered by API
       ├─ full MP3 buffered/base64 encoded by main
       └─ next model step may abort it before playback
~~~

### After

~~~text
┌─────────────────────────────────────┐
│ TroCode · Speaking                 │
│ Click the Filters button.             │
│                         [Filters]      │
│ ⌘⌥J Back  ⌘⌥K Pause  ⌘⌥L Next       │
└─────────────────────────────────────┘
       ├─ first ElevenLabs audio bytes stream immediately
       ├─ player reports playing / ended through validated IPC
       ├─ coordinator holds the model at this step
       └─ provider error OR startup deadline → one system fallback
~~~

On Windows and Linux, the labels use `Ctrl+Alt+J/K/L`. On macOS they use
`⌘⌥J/K/L`. Do not register bare letters globally: the guidance window is
non-focusable and the user may be typing in another application.

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Step appearance | Callout appears and model continues | Callout appears immediately and model waits at the step | Pointer presentation is never gated on provider latency |
| ElevenLabs playback | Complete MP3 buffered twice, then base64 IPC | Progressive HTTP audio through `trocode-audio://speech/<uuid>` | Provider/session credentials never enter the renderer |
| Slow provider | Browser speech starts after 2.2 s and ignores late ElevenLabs | A bounded startup deadline cancels provider playback, then starts one fallback | No double speech |
| Audio completion | Not reported to main | Typed `playing`, `fallback_started`, `ended`, or `failed` report | Stale/mismatched IDs are rejected or ignored safely |
| Back | Displayed but inactive | Re-present cached previous guidance and replay narration | No new model/CUA/tool progress |
| Pause | Only changes label | Pause audio and auto-advance; resume both | Task cancellation still wins |
| Next | Displayed but inactive | Cancel audio and move forward/resume model | No wait for a stalled stream |
| Approval/clarification | Main renderer uses browser speech without cleanup | Existing speech is cancelled when interaction clears or guidance resumes | ElevenLabs unification is out of scope |
| Completion/cancel | Cleanup can race fire-and-forget synthesis | All tickets, streams, player state, waits, and shortcuts are disposed | No orphan audio |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---:|---|
| P0 | `src/index.ts` | 150-165, 350-470, 507-578, 720-762, 1131-1214 | Current TTS construction, global presentation state, fire-and-forget speech, shortcut setup, and sandboxed guidance window |
| P0 | `src/main/agent/execution-coordinator.ts` | 31-92, 230-267, 405-447, 830-910 | Injection surface, presentation mapping, unused playback methods, and exact place where guidance must wait |
| P0 | `src/main/agent/guidance-playback.ts` | all | Pure transport controller whose wait is currently never called |
| P0 | `src/main/voice/elevenlabs-tts-service.ts` | all | Credential selection, timeouts, bounds, full buffering, and provider errors |
| P0 | `services/api/src/server.mjs` | 1-17, 51-73, 114-156, 342-376 | Hosted auth/rate limit plus the second full-response buffer to replace for TTS only |
| P0 | `src/renderer/GuidanceCallout.tsx` | all | Audio element, 2.2 s fallback race, and current visual controls |
| P0 | `src/shared/contracts.ts` | 174-207, 537-610, inferred types at file end | Task events and companion guidance/speech schemas; preserve concurrent companion-interaction additions |
| P0 | `src/shared/desktop-api.ts` | 32-129 | Narrow IPC channel and `CompanionApi` contracts |
| P0 | `src/preload.ts` | 289-end | Companion event parsing and the correct place for playback reports |
| P1 | `src/main/ipc/register-ipc.ts` | 31-95, 97-132, 215-250, 352-370 | Trusted-sender validation, handler cleanup, task resume, and update forwarding |
| P1 | `src/main/agent/global-task-cancel-shortcut.ts` | all | Dynamic global-shortcut registration/cleanup pattern to mirror |
| P1 | `src/main/agent/global-task-cancel-shortcut.test.ts` | all | Fake registry and lifecycle source test pattern |
| P1 | `src/main/agent/runtime-tool-registry.ts` | 418-427, 685-740 | `show_guidance` input bound, model description, and normalized guidance action |
| P1 | `src/main/agent/responses-agent.ts` | 18-48 | Model instructions; add one-step-at-a-time walkthrough semantics without precompiling modes |
| P1 | `src/main/agent/task-runtime.ts` | 198-214 | Guidance event recording; replay must not call it again |
| P1 | `src/renderer/App.tsx` | 1011-1034 | Existing interaction speech that must clean up to prevent overlap |
| P1 | `src/index.html` | 5-14 | Production CSP currently lacks a media source for the custom protocol |
| P1 | `forge.config.ts` | 210-239 | Development CSP must match production media policy |
| P1 | `services/api/src/config.mjs` | 38-47 | Existing server-side ElevenLabs model and voice configuration |
| P2 | `src/main/voice/elevenlabs-tts-service.test.ts` | all | Injected fetch and secret-safe provider test pattern |
| P2 | `src/main/agent/execution-coordinator.test.ts` | 1-137 and guidance additions | Fake agent/CUA harness for proving the model actually waits |
| P2 | `services/api/test/server.test.mjs` | hosted speech test | Real local HTTP integration test and provider-key assertion |
| P2 | `docs/architecture.md` | 10-27, 57-98 | Renderer/main/API/provider trust boundary to preserve |
| P2 | `docs/conversational-task-execution.md` | 1-27, 42-77 | One-call-at-a-time agent loop and guidance tool boundary |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| ElevenLabs streaming endpoint | [Stream speech](https://elevenlabs.io/docs/api-reference/text-to-speech/stream) | Use `POST /v1/text-to-speech/:voice_id/stream`; it returns progressive audio and accepts the existing model/output format |
| ElevenLabs latency | [Latency optimization](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization) | Flash + HTTP streaming is recommended when the complete text is already known; WebSocket is for incremental text |
| Latency measurement | [Understanding latency](https://elevenlabs.io/docs/eleven-api/concepts/latency) | Measure time-to-first-audio, not only model inference; audio-player buffering and application buffering are part of latency |
| Electron streamed custom protocols | [protocol API](https://www.electronjs.org/docs/latest/api/protocol/) | Register the scheme before `ready`, use `protocol.handle` after `ready`, and set the `stream` privilege for `<audio>` |
| Electron global shortcuts | [globalShortcut API](https://www.electronjs.org/docs/latest/api/global-shortcut) | Global shortcuts work while unfocused, registration can return false on collision, and every accelerator must be unregistered |
| Cross-platform accelerator syntax | [Keyboard shortcuts](https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts) | `CommandOrControl+Alt+<key>` maps to ⌘⌥ on macOS and Ctrl+Alt elsewhere |

### Research Findings

`KEY_INSIGHT`: The standard ElevenLabs endpoint returns a complete audio file,
while the `/stream` endpoint progressively returns audio for text that is already
known. `APPLIES_TO`: desktop TTS service and hosted proxy. `GOTCHA`: the existing
`optimize_streaming_latency` parameter is deprecated; do not build new behavior
around it.

`KEY_INSIGHT`: Eleven Flash v2.5 is already the correct low-latency multilingual
model, including Vietnamese. `APPLIES_TO`: keep the existing default model.
`GOTCHA`: the advertised ~75 ms is model inference only and excludes network,
player buffering, and TroCode's pipeline.

`KEY_INSIGHT`: Electron custom media protocols require `stream: true` so audio
elements do not assume a fully buffered response. `APPLIES_TO`: privileged scheme
registration before `app.whenReady()` and `protocol.handle()` after ready.
`GOTCHA`: do not use `bypassCSP`; explicitly allow only `trocode-audio:` in
`media-src`.

`KEY_INSIGHT`: HTTP streaming is simpler than ElevenLabs WebSocket streaming here
because each guidance description already exists in full before synthesis.
`APPLIES_TO`: provider transport choice. `GOTCHA`: WebSockets would add connection,
framing, and chunk-scheduling state without improving the model/tool boundary.

---

## Unified Discovery Table

| Category | File:Lines | Pattern | Key Evidence |
|---|---|---|---|
| Similar implementation | `src/renderer/realtime-voice-transport.ts`, `src/renderer/warm-realtime-voice-transport.ts` | Abortable voice transport with explicit readiness/cleanup | Voice input already treats transport as a lifecycle rather than a one-shot UI side effect |
| Naming | `src/main/voice/elevenlabs-tts-service.ts:29-146` | PascalCase service, options interface, verb methods, bounded constants | `ElevenLabsTtsService`, `isConfigured`, `synthesize` |
| Error handling | `src/main/voice/elevenlabs-tts-service.ts:133-145` | Distinguish caller abort, provider timeout, and provider error; never expose body | Abort maps to `AbortError`, timeout to bounded message |
| Logging | `src/main/voice/elevenlabs-tts-service.ts:138-140`, `src/main/agent/responses-agent.ts` | Namespaced message with bounded structured metadata | `[voice:tts] synthesis failed` and model timing logs |
| Type definitions | `src/shared/contracts.ts:537-610` | Zod schema first, inferred type at file end | Companion guidance/speech and in-progress interaction contracts |
| Test pattern | `src/main/voice/elevenlabs-tts-service.test.ts:5-93` | Inject fetch/logger and assert exact URL/headers without real provider calls | Hosted and direct modes are deterministic |
| Configuration | `services/api/src/config.mjs:38-47`, `README.md:133,186` | Optional ElevenLabs key/voice; Flash v2.5 default | Production keeps provider key server-side |
| Dependencies | `package.json` | Electron 43, React 19, Zod 4, Node Web streams are sufficient | No new runtime or native audio dependency is required |
| Entry point trace | `App.tsx` → `preload.ts` → `register-ipc.ts` → coordinator | Renderer submits a typed task through authenticated IPC | Narration control must remain a narrow companion report, not raw IPC |
| Guidance trace | `responses-agent.ts` → `runtime-tool-registry.ts` → `execution-coordinator.ts` → `index.ts` → `GuidanceCallout.tsx` | One model call becomes one grounded pointer/callout | Wait belongs after the tool output is recorded and before the next model sample |
| TTS data flow | `index.ts:376-412` → `elevenlabs-tts-service.ts` → hosted `server.mjs` → ElevenLabs | Current path buffers full MP3 at API and desktop, then base64 IPC | Replace with stream response and opaque internal URL |
| State changes | `execution-coordinator.ts:432-447`, `guidance-playback.ts` | Per-task execution context owns cancellation and playback transport | Add bounded guidance history/cursor to the same context; never use module-global history |
| Contracts | `desktop-api.ts:115-129`, `preload.ts:289-end` | Companion API exposes named, parsed functions/events only | Add one playback-report method; never expose `ipcRenderer`, token, or fetch |
| Architecture | `docs/architecture.md:57-98` | Sandboxed renderer, credentials in main/API, typed boundaries | Custom protocol handler belongs in main and tickets contain no provider credential |

---

## Patterns to Mirror

### SCHEMA_FIRST_COMPANION_BOUNDARY

SOURCE: `src/shared/contracts.ts:537-600`

~~~ts
export const CompanionGuidanceSchema = z.object({
  message: z.string().trim().min(1).max(240),
  playback: z.enum(['playing', 'paused']).default('playing'),
  side: z.enum(['left', 'right']),
  target: z.string().trim().min(1).max(80).optional(),
});
~~~

Define the streamed speech descriptor and playback report with Zod, infer their
TypeScript types, and parse on both sides of IPC. Preserve the concurrent
`CompanionInteractionSchema` additions.

### NARROW_PRELOAD_EVENT

SOURCE: `src/preload.ts:322-335` before the companion-interaction edits

~~~ts
onSpeechChange(listener) {
  const eventHandler = (_event, value: unknown): void => {
    listener(CompanionSpeechSchema.nullable().parse(value));
  };
  ipcRenderer.on(IPC_CHANNELS.companionSpeechChanged, eventHandler);
  return () => ipcRenderer.removeListener(
    IPC_CHANNELS.companionSpeechChanged,
    eventHandler,
  );
}
~~~

The renderer receives only a bounded descriptor. The new report method parses
before invoke, and main parses again before mutating playback state.

### ABORTABLE_PROVIDER_SERVICE

SOURCE: `src/main/voice/elevenlabs-tts-service.ts:73-145`

~~~ts
const controller = new AbortController();
const handleAbort = (): void => controller.abort(signal?.reason);
signal?.addEventListener('abort', handleAbort, { once: true });
const timer = setTimeout(() => controller.abort(), this.timeoutMs);
try {
  // provider request
} finally {
  clearTimeout(timer);
  signal?.removeEventListener('abort', handleAbort);
}
~~~

Retain linked abort and timeout cleanup. Change only the returned body from a
fully consumed buffer to a bounded `ReadableStream<Uint8Array>`.

### SECRET_SAFE_ERROR_AND_LOGGING

SOURCE: `src/main/voice/elevenlabs-tts-service.ts:118-141`

~~~ts
if (!response.ok) {
  throw new Error(`ElevenLabs returned HTTP ${response.status}.`);
}
this.logger.warn('[voice:tts] synthesis failed', {
  error: error instanceof Error ? error.message.slice(0, 300) : 'Unknown error',
});
~~~

Never read/log provider error bodies, text, audio, access tokens, voice IDs, or
URLs containing private query data. New timing logs may include task ID, speech
ID, character count, status, milliseconds, provider mode, and fallback reason.

### PURE_PLAYBACK_TRANSPORT

SOURCE: `src/main/agent/guidance-playback.ts:23-108`

~~~ts
export class GuidancePlaybackController {
  private paused = false;
  private pendingWait: PendingWait | null = null;

  togglePause(): boolean { /* pure timer/navigation state */ }
  async wait(signal: AbortSignal): Promise<GuidanceNavigation> { /* ... */ }
}
~~~

Keep model/runtime effects outside this controller. Extend `wait` with a narration
readiness promise or equivalent two-gate state, but do not import Electron, React,
CUA, or provider services into it.

### DYNAMIC_GLOBAL_SHORTCUT

SOURCE: `src/main/agent/global-task-cancel-shortcut.ts:41-104`

~~~ts
const registered = registry.register(accelerator, callback);
if (!registered) {
  logger.warn('[task] Could not register the global cancel shortcut.', {
    accelerator,
  });
}
return () => registry.unregister(accelerator);
~~~

Register guidance accelerators only while a task has a pending guidance wait,
handle partial registration failure, and unregister exactly the accelerators that
this feature successfully registered.

### TRUSTED_AUXILIARY_SENDER

SOURCE: in-progress `src/main/ipc/register-ipc.test.ts` companion-interaction tests

~~~ts
const interactionEvent = {
  sender: { id: 84 },
  senderFrame: interactionFrame,
};
// protected auxiliary calls must reject any other renderer
~~~

Mirror the companion-interaction trusted-window pattern for speech playback
reports, but target `guidanceWindow`. Do not authorize a report merely because it
came from some renderer in the application.

### TEST_WITH_INJECTED_FETCH

SOURCE: `src/main/voice/elevenlabs-tts-service.test.ts:6-33`

~~~ts
const fetchImpl = vi.fn<typeof fetch>(async () =>
  new Response(Uint8Array.from([1, 2, 3]), {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg' },
  }),
);
~~~

For streaming tests, gate the second chunk with a promise and prove the first
chunk is observable before the stream completes. No test calls ElevenLabs.

---

## Strategic Design

### Approach

1. Keep `show_guidance` as the sole source of walkthrough steps. Tighten its
   description length to the existing display/TTS maximum of 240 characters so
   the model, callout, and provider all narrate identical text without silent
   slicing.
2. Change the desktop and hosted ElevenLabs requests to the official `/stream`
   endpoint while retaining Flash v2.5, authentication, rate limits, timeouts,
   MIME checks, and the 5 MB maximum.
3. Add a main-process `CompanionNarrationService` that issues short-lived UUID
   tickets and maps each ticket to bounded text, an abort controller, timestamps,
   and a completion waiter.
4. Register `trocode-audio` as a secure, standard, streamed custom scheme before
   Electron ready. After ready, `protocol.handle` validates `GET`/`HEAD`, host,
   UUID, expiry, and one-time consumption, then returns the provider stream as a
   no-store `audio/mpeg` response.
5. Replace `CompanionSpeech.dataBase64` with a discriminated descriptor:
   ElevenLabs source + internal media URL, or immediate system fallback. The
   renderer never receives text beyond the already visible guidance message,
   audio bytes through IPC, provider credentials, or the hosted session token.
6. Extract renderer playback/fallback state into a dependency-injected helper.
   It owns one `<audio>`, system utterance fallback, startup deadline, pause,
   resume, cancellation, and typed lifecycle reports.
7. Have `presentCompanionAction` return a presentation/narration handle for
   guidance. The coordinator records/dispatches the model tool once, then calls
   `context.playback.wait(signal, handle.finished)` before the next model sample.
8. Store bounded guidance presentation history and a cursor in `ExecutionContext`.
   Back/forward replay only the presentation; they never append tool output or
   increment progress.
9. Add dynamic cross-platform global accelerators and update the callout labels.
10. Measure provider headers, time-to-first-audio, completion, cancellation, and
    fallback with content-free structured logs.

### Core Contracts

The exact names may be adjusted to current conventions, but implementation must
preserve these semantics:

~~~ts
const CompanionSpeechSchema = z.discriminatedUnion('source', [
  z.object({
    id: z.string().uuid(),
    mediaUrl: z.string().max(200).refine(isTroCodeSpeechUrl),
    mimeType: z.literal('audio/mpeg'),
    source: z.literal('elevenlabs'),
  }),
  z.object({
    id: z.string().uuid(),
    source: z.literal('system'),
  }),
]);

const CompanionSpeechPlaybackReportSchema = z.object({
  id: z.string().uuid(),
  phase: z.enum(['playing', 'fallback_started', 'ended', 'failed']),
  source: z.enum(['elevenlabs', 'system']),
  reason: z.enum([
    'not_configured',
    'provider_error',
    'startup_timeout',
    'autoplay_rejected',
    'decode_error',
    'fallback_error',
  ]).optional(),
});

interface NarrationHandle {
  id: string;
  descriptor: CompanionSpeech;
  finished: Promise<'ended' | 'failed' | 'cancelled'>;
  cancel(): void;
}
~~~

`reason` is a fixed enum, never a raw DOM/provider error. Reports with an unknown,
expired, completed, or non-active ID must not settle another step.

### Streaming Path

~~~text
GuidanceCallout <audio src="trocode-audio://speech/<uuid>">
        |
        v
Electron protocol.handle (validates one-time ticket)
        |
        +-- local development --> ElevenLabs /stream (xi-api-key in main only)
        |
        +-- production --> TroCode API /v1/elevenlabs/speech
                              |
                              +--> ElevenLabs /stream (xi-api-key in API only)
~~~

Both local and hosted paths must stream without calling `arrayBuffer()` for a
successful TTS response. The API's buffered helper remains in place for Responses
and SDP; introduce a TTS-specific bounded streaming helper instead of changing
unrelated proxy behavior.

### Ticket Rules

- Use `randomUUID()`; never put speech text in the URL.
- Ticket TTL: 10 seconds to start the media request; configurable in tests.
- Single consumer: the first valid GET consumes the ticket. HEAD may validate and
  return headers without consuming it.
- Maximum active tickets/waits: bounded (for example 16); issuing beyond the bound
  cancels the oldest ticket so a faulty model cannot grow memory indefinitely.
- Successful replay issues a new ticket. Do not persist or globally cache audio in
  this delivery.
- `request.signal`, task cancellation, Next/Back, deadline, window close, sign-out,
  and shutdown all abort upstream fetch.
- Set `Cache-Control: no-store`, `Content-Type: audio/mpeg`, and
  `X-Content-Type-Options: nosniff`. Do not set `bypassCSP` on the scheme.

### Playback and Fallback State Machine

~~~text
descriptor received
  |
  +-- source=system --------------------------> system speaking
  |
  +-- source=elevenlabs --> loading --> playing --> ended
                              |           |
                              |           +--> pause/resume/cancel
                              |
                              +-- startup deadline / play rejection /
                                  media error --> cancel audio request
                                                   |
                                                   v
                                             system speaking --> ended
                                                   |
                                                   +--> failed
~~~

Use a 4-second renderer startup deadline, injected in tests. It begins when the
descriptor is received and clears on the audio `playing` event. The fallback does
not start merely because the full stream has not completed. Call
`speechSynthesis.cancel()` before every fallback and on cleanup; wire utterance
`onstart`, `onend`, and `onerror` to the report contract. Handle `audio.play()`
promise rejection as `autoplay_rejected`.

The main service also uses a bounded terminal watchdog (45 seconds is sufficient
for the existing 240-character maximum) so a destroyed renderer cannot stall a
task forever.

### Guidance Wait and History

Add to each `ExecutionContext`:

~~~ts
interface GuidanceHistoryEntry {
  command: Extract<DesktopCommand, { kind: 'point' }>;
  presentation: DesktopPresentation;
}

guidanceHistory: GuidanceHistoryEntry[];
guidanceCursor: number;
activeNarration?: NarrationHandle;
~~~

After a new guidance tool result is appended, enter a loop:

1. Present/narrate the current history entry.
2. Await Back/Next/auto-navigation. Auto-navigation is gated by both the dwell
   timer and `NarrationHandle.finished`.
3. Back with a previous entry decrements cursor and repeats the loop.
4. Back at the first entry is a no-op and leaves the current step active.
5. Next with a cached forward entry increments cursor and repeats the loop.
6. Next/auto at the newest entry exits the loop and calls `runtime.resumePlanning`.

Cap history at the task tool-call limit (currently 30). Dropping the oldest entry
must adjust the cursor. Replays call presentation only; do not call
`toolDispatcher.dispatch`, `runtime.recordGuidance`, `recordToolResult`, or
`agent.appendToolOutput` again.

### Shortcut Design

Use:

- Back: `CommandOrControl+Alt+J`
- Pause/Resume: `CommandOrControl+Alt+K`
- Next: `CommandOrControl+Alt+L`

Register them only while a coordinator context has a pending guidance wait.
Surface registration availability in the guidance contract so the callout does
not advertise controls that failed to register. A partial collision should hide
or mark only the failed command, log its accelerator, and leave the others usable.

### Alternatives Considered

| Alternative | Decision | Reason |
|---|---|---|
| Keep full MP3 + base64 IPC and only increase fallback timeout | Reject | Still waits for complete synthesis/download, copies bytes twice, and permits step cancellation before playback |
| Let the sandboxed renderer fetch the hosted TTS endpoint directly | Reject | Would expose the opaque session token and contradict the API's browser-origin rejection/trust boundary |
| Push base64 audio chunks over repeated IPC events | Reject | Adds 33% encoding overhead, high event volume, chunk ordering/backpressure state, and a larger IPC attack surface |
| Add a native Node audio playback dependency in main | Reject | Adds cross-platform native packaging risk and bypasses the existing renderer audio surface |
| Use ElevenLabs WebSocket TTS | Reject for this delivery | The full step text is already known; official guidance recommends HTTP streaming for that case |
| Use deprecated `optimize_streaming_latency` | Reject | Deprecated and trades pronunciation quality for latency; streaming removes the dominant TroCode-side delay |
| Register bare J/K/L globally | Reject | Would intercept ordinary typing in whatever application the user is learning |
| Speak every observation, click, and model status | Reject | Noisy, can disclose private screen-derived descriptions, and does not match walkthrough-step semantics |
| Cache completed MP3s for Back | Defer | Saves replay cost but adds sensitive in-memory cache lifecycle and eviction complexity; re-synthesize within the task first |

### Scope

- Narration for every `show_guidance` step and replay.
- Progressive ElevenLabs HTTP streaming in direct and hosted modes.
- Private Electron streaming protocol with one-time bounded tickets.
- Exactly one system-speech fallback with explicit startup/error policy.
- Playback completion reports and coordinator wait integration.
- Back/Pause/Next history and safe global accelerators.
- Interaction-speech cleanup to prevent overlap.
- Content-free latency/fallback diagnostics.
- Unit, integration, packaged Electron manual verification, and docs.

## NOT Building

- Narration of internal planning, observations, automated actions, or verification.
- ElevenLabs narration of approvals, clarifications, or final answers.
- Realtime token-to-speech WebSockets.
- Persistent/generated-audio cache or saved audio artifacts.
- User-selectable voices, rates, output formats, or narration preference UI.
- Word-level timestamps, captions synchronized to phonemes, or barge-in speech
  recognition while narration is playing.
- Changes to approval policy, CUA authority, task limits, or provider credentials.
- Raw Electron IPC, raw protocol access, provider tokens, or provider keys exposed
  through `DesktopApi`/`CompanionApi`.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/main/voice/companion-narration-service.ts` | CREATE | Own ticket issuance, protocol requests, playback waiters, bounds, cancellation, and timing logs |
| `src/main/voice/companion-narration-service.test.ts` | CREATE | Ticket, expiry, one-use, abort, stale report, watchdog, and stream tests |
| `src/renderer/guidance-audio-playback.ts` | CREATE | Testable audio/system-fallback state machine independent of React |
| `src/renderer/guidance-audio-playback.test.ts` | CREATE | Startup, fallback, pause/resume, cancel, stale descriptor, and no-overlap tests |
| `src/main/agent/global-guidance-shortcuts.ts` | CREATE | Dynamically register modifier-based Back/Pause/Next |
| `src/main/agent/global-guidance-shortcuts.test.ts` | CREATE | Registration, partial collision, routing, and cleanup tests |
| `src/main/voice/elevenlabs-tts-service.ts` | UPDATE | Return a bounded stream from the official `/stream` endpoint instead of base64 |
| `src/main/voice/elevenlabs-tts-service.test.ts` | UPDATE | Prove first chunk is available before completion and preserve auth/error behavior |
| `services/api/src/server.mjs` | UPDATE | Stream only TTS upstream responses with byte bounds/backpressure/abort |
| `services/api/test/server.test.mjs` | UPDATE | Prove hosted first-chunk delivery, provider key isolation, errors, size, and disconnect abort |
| `src/shared/contracts.ts` | UPDATE | Replace base64 speech with stream descriptor; add playback report and shortcut availability without reverting interaction work |
| `src/shared/contracts.test.ts` | UPDATE | Validate URL scheme/host/UUID, report enums, bounds, and reject arbitrary URLs/raw errors |
| `src/shared/desktop-api.ts` | UPDATE | Add companion playback-report channel/method and typed shortcut metadata |
| `src/preload.ts` | UPDATE | Parse stream descriptors and playback reports at the isolated bridge |
| `src/main/ipc/register-ipc.ts` | UPDATE | Accept reports only from the current guidance window and clean handler up |
| `src/main/ipc/register-ipc.test.ts` | UPDATE | Merge with in-progress companion-interaction tests; add trusted guidance sender cases |
| `src/renderer/GuidanceCallout.tsx` | UPDATE | Use playback helper, streamed `<audio>`, real pause state, status label, and accurate shortcut labels |
| `src/main/agent/guidance-playback.ts` | UPDATE | Gate auto-next on dwell + narration terminal outcome while preserving immediate navigation |
| `src/main/agent/guidance-playback.test.ts` | UPDATE | Test two-gate advance, pause, Next, Back, abort, and failed narration |
| `src/main/agent/execution-coordinator.ts` | UPDATE | Store history/cursor, await steps, route replay, cancel narration, and expose active guidance |
| `src/main/agent/execution-coordinator.test.ts` | UPDATE | Prove model pacing, replay without side effects, interaction interruption, and cleanup |
| `src/main/agent/runtime-tool-registry.ts` | UPDATE | Bound model guidance descriptions to 240 and document one narrated target per call |
| `src/main/agent/runtime-tool-registry.test.ts` | UPDATE | Reject overlong guidance and assert updated model-visible contract |
| `src/main/agent/responses-agent.ts` | UPDATE | Instruct visible walkthroughs to emit one `show_guidance` call per user-controlled step |
| `src/main/agent/responses-agent.test.ts` | UPDATE | Assert instruction/tool contract without changing general answer/act behavior |
| `src/main/agent/task-runtime.ts` | UPDATE | Make the waiting summary/next actions describe playback controls; no replay events |
| `src/main/agent/task-runtime.test.ts` | UPDATE | Assert one event/progress record per original step, not per replay |
| `src/index.ts` | UPDATE | Register scheme/handler, construct narration service, return handles from presentation, wire shortcuts and shutdown |
| `src/renderer/App.tsx` | UPDATE | Cancel interaction system speech on interaction clear/unmount so it cannot overlap guidance |
| `src/index.html` | UPDATE | Add only `trocode-audio:` to `media-src` |
| `forge.config.ts` | UPDATE | Match development CSP to production media policy |
| `README.md` | UPDATE | Describe streamed optional companion narration and fallback behavior |
| `docs/architecture.md` | UPDATE | Document main-owned stream tickets and playback acknowledgement |
| `docs/conversational-task-execution.md` | UPDATE | Document the narrated guidance wait between model calls |
| `docs/security.md` | UPDATE | Document one-time URL, sender validation, no-store response, and content-free logs |
| `PRIVACY.md` | UPDATE | Clarify that short guidance text is streamed to ElevenLabs and audio is not persisted |

No database migration and no new npm dependency are required.

---

## Step-by-Step Tasks

### Task 1: Lock behavior with failing contract and pacing tests

- **ACTION**: Add the red tests that define the end-to-end contract before
  changing production behavior.
- **IMPLEMENT**:
  - Add a coordinator scenario: observe → `show_guidance` step 1 → step 2 →
    completion. Assert `agent.sample` does not request step 2 until step 1 is
    released by Next or the narration+dwell gates.
  - Assert Back re-presents step 1 without a new agent sample, CUA dispatch, tool
    output, progress increment, or task-history message.
  - Assert cancel while narrating aborts the wait and calls cleanup once.
  - Add shared-contract tests for valid internal stream URLs and bounded reports.
  - Add service/API tests whose second audio chunk is promise-gated.
- **MIRROR**: `FakeAgent`/fake CUA in
  `src/main/agent/execution-coordinator.test.ts:22-137` and injected fetch in the
  current ElevenLabs service test.
- **IMPORTS**: `describe`, `expect`, `it`, `vi`, `randomUUID`, Web `ReadableStream`,
  existing agent/CUA helpers and schemas.
- **GOTCHA**: `npm test -- --run ...` passes the filter into the nested API npm
  script and fails. Use `npx vitest run <files>` for focused desktop tests and
  `npm --prefix services/api test` separately.
- **VALIDATE**: New tests fail for the known reasons: full buffering, no
  coordinator wait, no report contract, and inactive shortcuts.

### Task 2: Define stream descriptors and the private media scheme

- **ACTION**: Replace the base64 companion speech contract with a safe streamed
  descriptor and typed playback report.
- **IMPLEMENT**:
  - Add a shared `TROCODE_AUDIO_SCHEME`/URL validator in a main-safe shared module
    or keep the constant in contracts plus narration service without importing
    Electron into shared code.
  - Replace `dataBase64` with the discriminated `elevenlabs`/`system` descriptor
    shown above.
  - Validate exactly `trocode-audio://speech/<uuid>`; reject credentials, query
    strings, fragments, other hosts, path traversal, and non-UUID IDs.
  - Add `CompanionSpeechPlaybackReportSchema` with fixed phase/source/reason enums.
  - Add shortcut availability/labels to `CompanionGuidanceSchema` so UI never
    advertises an accelerator that failed registration.
  - Add `companion:report-speech-playback` and
    `CompanionApi.reportSpeechPlayback()`; parse in preload before invoke.
  - At module initialization in `src/index.ts`, call
    `protocol.registerSchemesAsPrivileged` exactly once with `standard`, `secure`,
    `supportFetchAPI`, and `stream`; do not use `bypassCSP` or `corsEnabled`.
  - Add `media-src 'self' trocode-audio:` in both production and Forge development
    CSPs. Remove `data:` from media policy after base64 playback is gone.
- **MIRROR**: Schema-first companion interaction/guidance contracts and the
  existing preload listener pattern.
- **IMPORTS**: `z` schemas already in contracts; Electron `protocol` in main;
  inferred shared types in `desktop-api.ts`/preload.
- **GOTCHA**: `registerSchemesAsPrivileged` must run before Electron `ready` and
  only once. `protocol.handle` must run after ready and before the guidance window
  loads. Default-session registration is correct because current windows do not
  specify a custom partition.
- **VALIDATE**: Contract tests reject arbitrary HTTPS/file/data URLs and raw error
  strings; packaged/dev CSP contains the custom scheme but no CSP bypass.

### Task 3: Stream ElevenLabs in the desktop service

- **ACTION**: Refactor `ElevenLabsTtsService` from complete-file synthesis to an
  abortable bounded response stream.
- **IMPLEMENT**:
  - Rename `SynthesizedSpeech` to `SynthesizedSpeechStream` and `synthesize` to
    `stream` (or keep a temporary private alias only while migrating callers).
  - Use `/v1/text-to-speech/<voice>/stream` for direct mode and the existing
    hosted endpoint for production.
  - Retain `eleven_flash_v2_5`, `mp3_44100_128`, 240 characters, 15-second header
    timeout, token/key selection, HTTPS validation, and no provider-body logging.
  - Validate successful `Content-Type` begins with `audio/mpeg`.
  - Return after response headers with a counting `ReadableStream` wrapper. Abort
    and error if cumulative bytes exceed 5 MB; never call `arrayBuffer()` on a
    successful response.
  - Link task/ticket/request cancellation through one controller and remove every
    listener/timer on terminal state.
- **MIRROR**: Existing constructor injection, error mapping, URL normalization,
  and abort cleanup in `elevenlabs-tts-service.ts`.
- **IMPORTS**: No new package; use global `fetch`, `Response`, `ReadableStream`,
  `AbortController`.
- **GOTCHA**: A fetch timeout should cover reaching response headers. Once the
  stream starts, task/request cancellation and the narration watchdog own the
  lifetime; a single 15-second timer must not cut off valid long playback.
- **VALIDATE**: Tests can read chunk 1 while chunk 2 remains blocked; oversize and
  abort fail during stream consumption; hosted Authorization and direct xi-api-key
  remain mutually exclusive.

### Task 4: Stream the hosted TTS proxy with bounds and backpressure

- **ACTION**: Make `/v1/elevenlabs/speech` progressive without weakening the API
  boundary.
- **IMPLEMENT**:
  - Switch the upstream URL to
    `/v1/text-to-speech/<voiceId>/stream?output_format=mp3_44100_128`.
  - Keep session authentication, per-user rate limiting, server-side provider key,
    1-240 character request validation, model configuration, and 20-second
    provider-header timeout.
  - Add a TTS-specific `pipeBoundedUpstreamResponse` that sets no-store/MIME
    headers, reads the Web stream incrementally, counts bytes, honors Node response
    backpressure, and aborts provider fetch when the client disconnects.
  - Map non-2xx provider status to a bounded generic 502/503 before sending audio
    headers. Never forward provider error text.
  - If the 5 MB limit is crossed after headers, abort/destroy the stream; do not
    append JSON to an audio response.
  - Leave `readBoundedUpstreamBody` unchanged for Responses and Realtime SDP.
- **MIRROR**: Existing `requireSession`, `enforceRateLimit`, `HttpError`, security
  headers, and server test harness.
- **IMPORTS**: `once` from `node:events` if needed for `drain`; no new package.
- **GOTCHA**: The test must prove progress, not merely that the final byte array is
  correct. Resolve the second provider chunk only after the client has observed
  the first.
- **VALIDATE**: API tests cover first-chunk delivery, disconnect abort, oversize,
  provider error, session/rate-limit behavior, and absence of xi-api-key in the
  desktop-facing request.

### Task 5: Build the main-process narration ticket/playback service

- **ACTION**: Create `CompanionNarrationService` as the single owner of narration
  tickets and completion waiters.
- **IMPLEMENT**:
  - Inject the TTS service, UUID/time functions, logger, ticket TTL, completion
    timeout, and a publisher callback so tests need no Electron window.
  - `begin(text, taskSignal)` returns a `NarrationHandle`. If TTS is not configured,
    publish a `source: 'system'` descriptor immediately.
  - If configured, store a bounded one-time ticket and publish a
    `source: 'elevenlabs'` descriptor containing only the internal media URL.
  - `handleRequest(Request)` validates method/URL/ticket/expiry, handles HEAD
    without consumption, consumes a GET once, obtains the provider stream, and
    returns a no-store typed response.
  - `report(report)` matches only the active speech ID, records TTFA/source/fallback
    metadata, and resolves only on terminal ended/failed.
  - `cancel(id)`, task abort, Next/Back, ticket eviction, window close, sign-out,
    and `shutdown()` abort provider activity and settle waiters idempotently.
  - Add the 45-second terminal watchdog; it resolves failed and lets visible
    guidance continue rather than blocking the model forever.
  - Expose content-free timing data to the injected logger; never log text.
- **MIRROR**: Abort-linking in ElevenLabs service, bounded map/history patterns in
  agent contexts, and namespaced structured logs.
- **IMPORTS**: `randomUUID` from `node:crypto`; shared companion schemas/types;
  `ElevenLabsTtsService` type.
- **GOTCHA**: Do not resolve on an ElevenLabs media error if the renderer reports
  `fallback_started`; wait for system `ended` or terminal `failed`. Ignore stale
  reports without affecting the current handle.
- **VALIDATE**: Unit tests cover configured/unconfigured modes, HEAD then GET,
  second GET rejection, expiry, maximum active tickets, stale report, fallback,
  report order, task abort, watchdog, and shutdown.

### Task 6: Implement renderer streaming playback and exclusive fallback

- **ACTION**: Extract playback lifecycle from `GuidanceCallout` into a testable
  helper and connect it to React.
- **IMPLEMENT**:
  - Inject factories/interfaces for audio, speech synthesis, timers, and report
    callback. Do not require jsdom in unit tests.
  - For ElevenLabs descriptors, assign the internal URL and call `play()`. Clear
    the 4-second startup timer on `playing`.
  - On startup timeout, `play()` rejection, or audio error: pause, remove source,
    call `load()` to abort the media request, report `fallback_started`, then start
    exactly one `SpeechSynthesisUtterance` from the visible guidance message.
  - For system descriptors, begin fallback immediately with reason
    `not_configured`.
  - Use the current Vietnamese character heuristic for fallback language and the
    current rate 0.92 unless product requirements change separately.
  - Report playing/ended/failed through `window.troCompanion` using only fixed
    reason enums.
  - Drive audio/system `pause`/`resume` from `guidance.playback`; ensure React
    StrictMode double-effect setup cannot start duplicate audio.
  - Cancel both audio and speech synthesis on descriptor change, Next/Back event,
    guidance removal, unmount, and window unload.
  - Replace the old 2.2-second unconditional fallback timer and base64 data URL.
  - Show `Loading voice`, `Speaking`, `Fallback voice`, or `Paused` status based on
    the helper state; keep `aria-live` text and do not put decorative controls
    inside `aria-hidden` if they communicate actual availability.
- **MIRROR**: Current `GuidanceCallout` subscription cleanup and push-to-talk
  renderer helpers that isolate browser APIs behind functions.
- **IMPORTS**: Shared `CompanionSpeech`, playback report type, React refs/effects.
- **GOTCHA**: `HTMLMediaElement.play()` returns a promise and can reject. A late
  event from an old audio element/utterance must be ignored by ID/generation.
- **VALIDATE**: Tests prove first source exclusivity, fallback once, no late
  ElevenLabs takeover, pause/resume, stale-event ignore, cancellation, autoplay
  rejection, audio decode error, fallback error, and StrictMode-safe disposal.

### Task 7: Await narration and implement guidance history navigation

- **ACTION**: Connect presentation handles to the agent loop so the next step
  cannot outrun current audio.
- **IMPLEMENT**:
  - Extend `presentAction` to return an optional guidance presentation handle; keep
    desktop/direct callers compatible.
  - In `presentCompanionAction`, show pointer/callout first, call narration service,
    publish the descriptor, and return its handle.
  - Initialize `guidanceHistory`, cursor, and active handle in each
    `ExecutionContext`.
  - Dispatch a fresh guidance tool once, record one guidance message/result/output,
    then enter the history/navigation loop described in Strategic Design.
  - Extend `GuidancePlaybackController.wait` so auto-next requires both the dwell
    gate and narration terminal gate; direct Back/Next remains immediate.
  - `toggleGuidancePause` updates callout playback, which pauses the renderer, and
    stops/resumes the auto timer.
  - Back/forward presentation creates a new narration handle but does not dispatch
    or record anything.
  - Call `dismissPresentation` and cancel narration before an interaction/approval
    is exposed, on completion/failure/block/cancel/deadline, and in cleanup.
  - Keep `waitForIdle` semantics: it should remain pending while the task is truly
    awaiting guidance.
- **MIRROR**: Per-task `ExecutionContext`, current serialized `run` loop, and pure
  playback controller.
- **IMPORTS**: New `NarrationHandle`/presentation handle types and existing
  `GuidanceNavigation`, `DesktopPresentation`, `DesktopCommand`.
- **GOTCHA**: Append the model tool output exactly once before waiting so the
  Responses session remains valid, but do not sample again until the user/auto
  advance exits the newest step. Avoid holding an exact approval grant across a
  guidance wait.
- **VALIDATE**: Coordinator tests prove sample count, single dispatch/progress,
  Back/forward replay, first-step Back no-op, pause, Next cancellation, auto gate,
  narration failure continuation, interaction interruption, task cancel, and
  history cap.

### Task 8: Wire safe global Back/Pause/Next shortcuts

- **ACTION**: Make the callout controls work while another application has focus.
- **IMPLEMENT**:
  - Create `registerGlobalGuidanceShortcuts` using the three modifier accelerators.
  - Accept injected registry/logger and callbacks to coordinator methods for one
    active task ID.
  - Register only when the coordinator enters a pending guidance wait and
    unregister when it exits, cancels, or shuts down.
  - Handle partial failures independently and return availability metadata for the
    callout.
  - In `src/index.ts`, keep one disposer/active task, route J/K/L to
    `previousGuidance`, `toggleGuidancePause`, and `nextGuidance`, and dispose
    before app shutdown.
  - Render platform-correct labels from trusted main metadata. Never register bare
    J/K/L.
- **MIRROR**: `registerGlobalTaskCancelShortcut` and its fake registry tests.
- **IMPORTS**: `globalShortcut` in `index.ts`; no new package.
- **GOTCHA**: A shortcut can be owned by another app and return false without an
  exception. Do not claim the key works or unregister a key TroCode never owned.
- **VALIDATE**: Tests cover all success, each partial collision, task switch,
  repeated activation, callback routing, no active guidance, and exact cleanup.

### Task 9: Align model/tool semantics and stop other speech overlap

- **ACTION**: Ensure guided requests consistently produce one narratable step per
  model call and existing interaction speech cannot linger.
- **IMPLEMENT**:
  - Change `show_guidance.description` input/model schema maximum from 2,000 to
    240, matching `CompanionGuidanceSchema` and TTS. Remove silent slicing in
    `showGuidanceCallout` once all boundaries agree.
  - Update tool description: one visible target, one concise spoken instruction,
    no click/mutation, host waits for user playback control.
  - Add a system instruction: when the user asks for a visible walkthrough, call
    `show_guidance` once per step, wait for its tool output, and do not substitute
    `control_desktop` unless the user asked TroCode to act.
  - Preserve the architecture invariant that requests are not precompiled into a
    guide mode; this is tool-use guidance, not authorization.
  - In `App.tsx`, cancel existing system speech whenever pending interaction
    becomes null, changes ID, or the component unmounts. Add utterance cleanup so
    a just-answered question cannot overlap the next walkthrough stream.
  - Update task runtime guidance summary/next actions to mention the actual
    controls without adding replay events.
- **MIRROR**: Current `SYSTEM_INSTRUCTIONS` array, strict registry schema, and App
  effect cleanup patterns.
- **IMPORTS**: No new dependencies.
- **GOTCHA**: Do not instruct the model to emit a batch/list of future coordinates;
  every point must use the latest observation ID and one function call.
- **VALIDATE**: Registry/agent tests assert the 240 bound and instruction; existing
  general answer/desktop action tests remain unchanged; interaction speech cleanup
  has a focused helper/effect test.

### Task 10: Add trusted playback reporting and lifecycle integration

- **ACTION**: Complete the renderer-to-main acknowledgement path without widening
  trust.
- **IMPLEMENT**:
  - Extend `registerIpcHandlers` services with `getGuidanceWindow()` and
    `reportCompanionSpeechPlayback(report)` or equivalent narrow callbacks.
  - Add `assertTrustedGuidanceSender` that checks sender ID and main frame against
    the current, non-destroyed guidance window.
  - Parse the report in main even though preload already parsed it.
  - Do not require a fresh membership check for terminal cleanup reports; sender
    identity + active ticket ID is sufficient and permits cleanup after sign-out.
  - Add the channel to handler removal.
  - Merge rather than replace the in-progress companion-interaction auxiliary
    sender logic and tests.
- **MIRROR**: Existing `assertTrustedSender` and the in-progress interaction-window
  trusted sender tests.
- **IMPORTS**: Playback report schema/type, BrowserWindow type.
- **GOTCHA**: Main window, companion cursor window, interaction window, voice
  island, devtools, and stale destroyed guidance windows must all be rejected.
- **VALIDATE**: IPC tests accept one valid guidance report and reject every other
  renderer/frame, malformed report, stale ID, and report after handler cleanup.

### Task 11: Add latency diagnostics, documentation, and delivery gates

- **ACTION**: Make slow/choppy reports diagnosable without collecting content and
  document the new boundary.
- **IMPLEMENT**:
  - Log `stream.requested`, `stream.headers`, `playback.started`,
    `fallback.started`, `playback.ended`, and `playback.cancelled` under
    `[voice:tts]` with speech/task ID, character count, mode, milliseconds,
    provider status, and fixed reason only.
  - If available, record the ElevenLabs `x-region` header as a bounded allowlisted
    string; never log full headers.
  - Add tests asserting guidance text, target, provider body, credentials, and
    audio bytes are absent from log objects.
  - Update architecture/conversational/security/privacy docs and README with the
    streaming path, fallback, controls, non-persistence, and out-of-scope speech.
  - Run focused tests, full checks, and packaging; manually validate real
    ElevenLabs only through the user's configured development environment.
- **MIRROR**: Existing privacy-safe voice transcript analytics and bounded
  provider logs.
- **IMPORTS**: Existing logger only; do not add analytics fields unless separately
  approved because privacy documents currently allow only count-based voice data.
- **GOTCHA**: Do not make a live paid provider call in automated tests. Time-to-
  first-audio targets are operational measurements, not deterministic unit-test
  assertions.
- **VALIDATE**: Log privacy tests, docs review, `npm run check`, and
  `npm run package` pass; manual checklist below is complete.

---

## Testing Strategy

### Unit and Integration Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Desktop stream starts progressively | Response stream with chunk 2 gated | Service returns and chunk 1 reads before chunk 2 resolves | Yes |
| Hosted stream starts progressively | Mock Eleven stream with gated second chunk | API client observes first bytes before upstream completion | Yes |
| Stream size bound | More than 5 MB cumulative chunks | Stream aborts/errors and does not continue | Yes |
| Provider abort | Cancel ticket/client request midstream | Upstream fetch/body is cancelled exactly once | Yes |
| Provider non-2xx | Eleven returns 401/429/500 body | Bounded generic error; body never logged/forwarded | Yes |
| Ticket validation | Wrong host/path/query/UUID, expired or reused ID | 400/404/410; no provider call | Yes |
| HEAD then GET | Valid ticket | HEAD does not consume; one GET succeeds | Yes |
| Playback happy path | Eleven descriptor, `playing`, `ended` | One audio source; reports correct ID/source; no fallback | No |
| Startup timeout | No `playing` before 4 s | Audio cancelled; one system fallback | Yes |
| Autoplay/decode failure | `play()` rejection or media error | One fallback with fixed reason | Yes |
| Fallback failure | Speech synthesis error/unavailable | Terminal failed; visible step can still advance | Yes |
| StrictMode/stale events | Mount/unmount/re-mount; old audio fires | Only current generation reports/plays | Yes |
| Pause/resume | Pause during audio and dwell | Audio/timer pause; resume continues | Yes |
| Next | Next during loading/playing | Fetch/player cancel immediately; newest step resumes model | Yes |
| Back | Two cached steps, Back on second | First re-presented/re-narrated; no model/CUA/progress change | Yes |
| Back at start | One cached step | No-op; current step remains | Yes |
| Auto gate | Dwell ends before audio and audio ends before dwell | Advance only after both in either order | Yes |
| Narration failure gate | No audio source succeeds | Advance after terminal failure + dwell, never hang | Yes |
| Interaction interruption | Guidance then request input | Guidance disposed before prompt system speech | Yes |
| Task lifecycle cancellation | cancel/deadline/sign-out/shutdown | Wait, stream, timers, player, shortcut all cleaned once | Yes |
| Shortcut collision | One or more `register` calls return false | Working keys remain; unavailable labels hidden; exact warning | Yes |
| Trusted report | Guidance vs main/other/stale frame | Only current guidance main frame accepted | Yes |
| Privacy logging | Secret/text/audio-like sentinel values | None appear in logs | Yes |

### Edge Cases Checklist

- [ ] Empty/whitespace guidance is rejected before provider call.
- [ ] Exactly 240 characters are identical in model input, callout, and TTS; 241
      characters are rejected instead of silently truncated.
- [ ] Vietnamese fallback language remains `vi-VN`; English remains `en-US`.
- [ ] Provider not configured starts system fallback immediately.
- [ ] Hosted session expires between ticket issuance and media GET.
- [ ] Provider returns missing/wrong MIME type.
- [ ] Stream exceeds 5 MB after headers are committed.
- [ ] Client disconnects while API is backpressured.
- [ ] Guidance window loads slowly and receives current descriptor after
      `did-finish-load`.
- [ ] Guidance window closes/recreates while speech is pending.
- [ ] Browser `play()` rejects due to autoplay policy.
- [ ] Audio emits `error` after fallback already started.
- [ ] Old utterance/audio emits `ended` after a new speech ID is active.
- [ ] Pause occurs while ElevenLabs is still loading.
- [ ] Next/Back occurs during system fallback.
- [ ] Multiple rapid shortcut presses do not create concurrent waits/audio.
- [ ] Shortcut registration partially or fully collides with another app.
- [ ] Multiple task contexts cannot take ownership of the single global guidance
      presentation simultaneously; latest activation disposes previous ownership.
- [ ] Task deadline occurs while an older history step is replaying.
- [ ] Interaction/approval arrives after the user advances the newest step.
- [ ] Sign-out and shutdown permit cleanup reports without provider/membership work.
- [ ] Current uncommitted companion-interaction changes remain intact and tested.

---

## Validation Commands

### Focused Static Analysis

```bash
npm run lint
npm run typecheck
```

EXPECT: Zero lint or TypeScript errors, including sandbox/preload contract types.

### Focused Desktop Tests

```bash
npx vitest run \
  src/main/voice/elevenlabs-tts-service.test.ts \
  src/main/voice/companion-narration-service.test.ts \
  src/renderer/guidance-audio-playback.test.ts \
  src/main/agent/guidance-playback.test.ts \
  src/main/agent/global-guidance-shortcuts.test.ts \
  src/main/agent/execution-coordinator.test.ts \
  src/main/agent/runtime-tool-registry.test.ts \
  src/main/agent/responses-agent.test.ts \
  src/main/ipc/register-ipc.test.ts \
  src/shared/contracts.test.ts
```

EXPECT: All focused tests pass without a real provider call.

### Hosted API Tests

```bash
npm --prefix services/api test
```

EXPECT: Hosted stream/auth/rate-limit tests and all existing API tests pass.

### Full Verification

```bash
npm run check
```

EXPECT: Lint, typecheck, all Vitest tests, Windows metadata tests, and API tests
pass. This is required by `AGENTS.md`.

### Packaging

```bash
npm run package
```

EXPECT: Electron package succeeds with the privileged custom scheme and no new
native dependency. This command uses the repository's configured Doppler
production environment and should be run only where that access is already
authorized. This is required by `AGENTS.md` before committing.

### Manual Electron Validation

- [ ] Start TroCode through the normal configured development command.
- [ ] Ask: “Guide me through filtering this inbox,” with a visible inbox.
- [ ] Confirm step text/pointer appears immediately.
- [ ] Confirm audio begins before the Network response finishes downloading.
- [ ] Confirm exactly one voice is audible; no ElevenLabs/system overlap.
- [ ] Press platform Back/Pause/Next shortcuts while the target app, not TroCode,
      has focus.
- [ ] Confirm Pause stops/resumes sound and automatic movement.
- [ ] Confirm Back replays the previous step without a new task progress event.
- [ ] Confirm Next during loading and during playback cancels sound immediately.
- [ ] Temporarily point TTS at a controlled failing stub; confirm one system
      fallback and continued navigation.
- [ ] Disable both TTS and browser speech in a controlled test; confirm the
      visible walkthrough remains navigable and does not hang.
- [ ] Answer a clarification while its system speech is active; confirm the next
      guidance narration does not overlap it.
- [ ] Cancel, sign out, and quit during narration; confirm no sound continues and
      no pending request survives.
- [ ] Inspect logs: timing/status only, no guidance text, target, credentials,
      provider body, or audio bytes.
- [ ] Validate production and packaged CSP permits `trocode-audio:` but no other
      external media origin.
- [ ] On a representative connection, record time-to-first-audio. Target median
      under 1.5 seconds; treat geography/provider load as diagnostics rather than
      a deterministic release failure. The 4-second deadline must reliably fall
      back.

---

## Acceptance Criteria

- [ ] Every successfully presented `show_guidance` call produces one current
      narration attempt using the exact visible message.
- [ ] The next model sample cannot occur until the newest guidance step advances
      through Next or the narration+dwell auto gate.
- [ ] ElevenLabs audio begins from progressive bytes; neither desktop nor hosted
      success paths call `arrayBuffer()` for the full MP3.
- [ ] Provider credentials and opaque TroCode session credentials remain outside
      the renderer and never appear in the internal media URL.
- [ ] ElevenLabs and system fallback never play concurrently.
- [ ] Provider unavailable/error/startup timeout/autoplay failure falls back once,
      then produces a terminal playback outcome.
- [ ] Back/Pause/Next work globally with modifier shortcuts and accurate labels.
- [ ] Back/forward replay does not re-run the model tool, CUA, task result,
      history, analytics, or progress.
- [ ] Pause controls both active audio and auto-advance.
- [ ] Cancel/deadline/interaction/sign-out/window close/shutdown dispose every
      request, timer, waiter, player, ticket, and shortcut idempotently.
- [ ] Playback reports are schema-validated and accepted only from the current
      guidance renderer main frame.
- [ ] Stream/ticket/history sizes and lifetimes are bounded.
- [ ] Logs expose timing/count/status only and never text, target, secrets,
      provider bodies, or audio.
- [ ] Existing companion-interaction work and all prior agent, approval, CUA,
      voice-input, and API tests remain passing.
- [ ] `npm run check` and `npm run package` pass.

## Completion Checklist

- [ ] Code follows schema-first contracts and dependency-injected service patterns.
- [ ] Renderer remains sandboxed with `nodeIntegration: false` and
      `contextIsolation: true`.
- [ ] No raw Electron IPC/CUA/provider client is exposed to the renderer.
- [ ] Every provider/task abort listener and timeout has symmetric cleanup.
- [ ] Errors and logs are bounded and content-free.
- [ ] Global shortcut collision/cleanup is handled per accelerator.
- [ ] No new npm/native dependency is introduced.
- [ ] No deprecated ElevenLabs latency option is introduced.
- [ ] Tests cover progressive first-byte behavior, not only final output.
- [ ] Documentation and privacy wording match the final implementation.
- [ ] Uncommitted user changes were preserved and merged, never reset.
- [ ] Self-contained: implementation needs no additional codebase/API search.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Chromium custom-protocol audio buffering differs by platform | Medium | High | Set Electron `stream` privilege, retain system fallback, and manually validate packaged macOS/Windows/Linux |
| `<audio>` issues HEAD/Range behavior before GET | Medium | Medium | Support non-consuming HEAD, return 200 streaming GET with no-store/MIME, test actual Electron media requests |
| Global shortcut collision | Medium | Low | Modifier accelerators, per-key registration status, truthful labels, cleanup |
| External latency still high by geography/voice | Medium | Medium | Flash v2.5 + streaming, TTFA logs/region, 4-second fallback; do not promise inference benchmark as UX latency |
| Stream errors after response headers | Low | Medium | Abort/destroy stream, renderer media-error fallback, bounded terminal watchdog |
| Replay increases ElevenLabs usage/cost | Medium | Low | Cap history/tool calls, cancel promptly, no speculative prefetch; consider in-memory cache later |
| Renderer never reports terminal state | Low | High | 45-second main watchdog plus cancellation on window/task lifecycle |
| Stale audio events settle the wrong step | Medium | High | UUID/generation matching in renderer and active-ID matching in main |
| Concurrent task guidance fights for one overlay | Low | High | Explicit single active presentation ownership; switching ownership disposes previous shortcuts/audio |
| Concurrent uncommitted companion-interaction work conflicts | High | Medium | Re-read diff before implementation, reuse its auxiliary trusted-sender pattern, never revert user changes |
| CSP change accidentally broadens media access | Low | High | Allow only `trocode-audio:`; no `https:`, `data:`, wildcard, or `bypassCSP` after migration |

## Notes

- This is a standalone plan, not generated from a PRD phase.
- Existing focused tests observed during diagnosis pass, but they test TTS,
  playback transport, and coordinator independently. They do not prove narrated
  step pacing; Task 1 adds that missing integration evidence.
- The current 15-second `GuidancePlaybackController` default is not the source of
  today's latency because its `wait()` is never called. This plan wires it as a
  minimum step dwell gated by narration completion.
- The current 2.2-second fallback is the source of potential competing behavior.
  It is removed in favor of a single explicit state machine.
- The custom protocol is transport only. CUA remains execution capability and
  does not gain goal, policy, or approval authority.
- Do not perform a live paid ElevenLabs request as part of implementation unless
  the user explicitly authorizes manual validation in their configured
  environment.
