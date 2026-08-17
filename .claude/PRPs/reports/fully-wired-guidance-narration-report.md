# Implementation Report: Fully Wired Guidance Narration and Playback

## Result

Implemented the PRP on `codex/hosted-backend`. Every successfully presented
`show_guidance` step now receives one streamed narration attempt, the agent loop
waits for narration plus the dwell gate, and users can navigate with dynamically
registered global Back/Pause/Next shortcuts.

## Delivered

- Replaced renderer-facing base64 MP3 payloads with validated
  `trocode-audio://speech/<UUID>` descriptors and fixed-enum playback reports.
- Added a main-owned `CompanionNarrationService` with short-lived one-use
  tickets, bounded active state, cancellation, a terminal watchdog, trusted
  reporting, system fallback descriptors, and content-free timing logs.
- Changed direct ElevenLabs and hosted Railway TTS success paths to progressive
  streaming with MIME checks, five-megabyte limits, abort propagation, client
  disconnect handling, and backpressure.
- Added a renderer playback state machine with a four-second startup deadline,
  exclusive local system-speech fallback, real pause/resume, stale-event
  suppression, and StrictMode-safe playback leases.
- Connected narration completion to the guidance dwell controller and the
  execution coordinator. Back/forward uses bounded presentation history without
  resampling the model, redispatching CUA, or recording progress/history again.
- Added scoped `CommandOrControl+Alt+J/K/L` global shortcuts with independent
  collision handling and trusted availability labels in the callout.
- Tightened `show_guidance.description` to 240 characters and added model
  instructions for one visible, narrated target per tool call.
- Preserved and integrated the pre-existing companion clarification/approval
  window work, including its trusted auxiliary sender boundary.
- Updated README, architecture, conversational execution, security, and privacy
  documentation.

## Verification

- `npm run check` — passed.
  - ESLint passed; one React dependency warning observed in the first run was
    removed and `npm run lint` was rerun cleanly.
  - TypeScript passed.
  - 59 Vitest files / 355 tests passed.
  - 2 Windows release metadata tests passed.
  - 9 hosted API tests passed, including progressive first-chunk delivery.
- `npm run package` — passed for macOS arm64 through the configured production
  Doppler environment.
- `git diff --check` — passed.
- No real or paid ElevenLabs request was made. The manual cross-application
  audio/shortcut checklist remains an operator validation step.

## Notable Implementation Choices and Deviations

- Interaction prompt speech is local system speech in `GuidanceCallout`; only
  grounded guidance text uses ElevenLabs. The in-progress interaction work had
  already moved this lifecycle out of `App.tsx`, so no new App-owned speech
  implementation was introduced.
- Replay invariants are covered in coordinator integration tests rather than a
  separate task-runtime replay test because replay never enters TaskRuntime.
- A small reference-counted renderer lease was added beyond the original file
  sketch because the actual application mounts the guidance window under React
  StrictMode; without it, the development probe would consume a one-use ticket.
- Live time-to-first-audio and background-focus shortcuts were not exercised
  automatically; automated tests use controlled progressive streams and fake
  shortcut registries.

## Scope Preserved

No database migration or dependency was added. The renderer remains sandboxed
with context isolation and no Node integration. Provider credentials, session
credentials, audio bytes, provider bodies, and narration text are absent from
the renderer contract and timing logs.
