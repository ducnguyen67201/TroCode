# VAD-segmented Whisper transcription TDD evidence

## Source and user journey

Implementation follows
`.claude/PRPs/plans/vad-segmented-whisper-transcription.plan.md`.

As a TroCode customer, I want push-to-talk to show completed phrases quickly
without maintaining a paid provider connection while idle, and I want task
submission to remain blocked until key release and complete transcription.

## RED and GREEN trace

| Behavior | Test target | RED trace | GREEN target |
|---|---|---|---|
| Silence, pre-roll, natural pauses, hard cuts, overlap, and the 60-second cap are deterministic | `src/renderer/voice-segmentation.test.ts` | The previous renderer had no pure PCM segmentation state machine. | Frame fixtures cover no-speech, adaptive noise, 700 ms pause cuts, 12-second cuts, overlap-only suppression, and the cap. |
| Every upload is an independent mono 16 kHz PCM16 WAV | `src/renderer/voice-segmentation.test.ts` | The previous path streamed WebRTC media and had no independent file encoder. | Header, resampling, clipping, empty input, and maximum duration are checked. |
| Idle is free and release is the task-dispatch gate | `src/renderer/use-push-to-talk.test.ts` | The previous warm transport could connect before key-down. | Tests cover zero idle work, early provisional phrases, ordered completion, failure/cancel suppression, permission races, and physical release at 60 seconds. |
| Renderer audio capability remains narrow and sandboxed | `src/renderer/voice-capture.test.ts`, `src/main/ipc/register-ipc.test.ts` | No AudioWorklet capture adapter or bounded segment IPC existed. | The worklet is own-origin, capture cleanup is idempotent, payloads are parsed twice, and active membership is required. |
| Hosted spend is reserved from parsed WAV duration and settled from provider usage | `services/api/test/openai-transcription-service.test.mjs`, `services/api/test/usage-repository.test.mjs` | Realtime setup used a flat estimate with no final audio-duration reconciliation. | Strict WAV validation happens before reserve, multipart fields are exact, no retry occurs after dispatch, and latency/audio duration remain separate sanitized fields. |
| The customer endpoint is authenticated and bounded | `services/api/test/server.test.mjs` | Only the legacy Realtime SDP endpoint existed. | Session/access, exact JSON shape, UUIDs, language, base64, body size, WAV format, security headers, and sanitized success are checked. |

The implementation was applied to an already dirty worktree, so isolated RED
commands and checkpoint commits were not created; unrelated user changes were
preserved. The consolidated automated verification result is recorded below.

## Automated verification

- `npm run check`: passed. Runtime compatibility, ESLint, and TypeScript passed;
  Vitest passed 78 files/421 tests; the two Node script suites passed six
  tests; and the hosted API passed all 42 tests.
- `npm run cost:report`: passed. The projected same-duration voice case reports
  17,000 -> 6,000 micro-USD (65% rounded saving), while the explicitly assumed
  pause-trimmed case reports 17,000 -> 4,620 micro-USD (73% rounded saving).
- `npm run package`: passed for Electron Forge macOS arm64 using the production
  configuration.
- Packaged worklet smoke check: `app.asar` contains the renderer bundle and
  `/.webpack/renderer/b255f06fdb72eeaa88d0.js`; the emitted asset registers
  `trocode-voice-capture` and writes zeroes to every output channel.

## Manual and production verification

These checks require a packaged desktop, microphone hardware, deployed hosted
API, and provider usage access; they are not represented as automated results:

- Packaged AudioWorklet load and microphone permission on macOS/Windows.
- Quiet-room, fan-noise, Vietnamese/English, brief-pause, and continuous-speech
  fixture recordings with false-start/false-stop and release-latency notes.
- Ten minutes idle with voice enabled and no key press, confirming zero audio
  provider requests.
- Canary reconciliation of summed provider `usage.seconds`, ledger
  `audio_duration_ms`, and the OpenAI organization usage export.
- Verification that no new desktop client calls the compatibility Realtime
  endpoint before that endpoint and its flat estimate are removed in the later
  rollout gate.

No transcript text, PCM, WAV/base64 data, prompts, or provider response bodies
may be captured in this evidence or in production telemetry.
