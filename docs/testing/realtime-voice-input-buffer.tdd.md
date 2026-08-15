# Realtime voice input buffer TDD evidence

## Source and user journey

This fix was derived from the runtime error reported during push-to-talk use; no
external plan file was supplied.

As a TroCode user, I want a Realtime transport created when I hold the
push-to-talk shortcut with my microphone included in the initial negotiation,
then closed after transcription, so the app streams only for an active turn and
does not send an empty audio buffer.

## RED and GREEN evidence

| Behavior | Test target | RED evidence | GREEN evidence |
|---|---|---|---|
| The microphone track is included in the initial WebRTC SDP negotiation | `src/renderer/realtime-voice-transport.test.ts` | The fake peer connection received no microphone track. | The supplied track is added before `createOffer`. |
| Outbound audio byte and packet counts are available before commit | `src/renderer/realtime-voice-transport.test.ts` | `readOutboundAudioStats` did not exist. | Audio RTP statistics are aggregated while video statistics are ignored. |
| Provider error codes are retained for diagnostics | `src/renderer/push-to-talk.test.ts` | The parsed error omitted its provider code. | The parsed error includes both code and message. |
| Empty-buffer errors become actionable user guidance | `src/renderer/push-to-talk.test.ts` | No local error mapping existed. | Empty or too-small buffer errors explain how to retry push-to-talk. |
| A fresh microphone-backed transport is scoped to one push-to-talk turn | `src/renderer/use-push-to-talk.test.ts` | The hook opened a trackless transport while idle and reused it across turns. | Nothing connects before key-down; the microphone track is passed into transport creation, and the connection closes after transcription. |
| A voice turn requires new outbound RTP traffic before commit | `src/renderer/use-push-to-talk.test.ts` | The app could commit before any microphone packets reached the peer connection. | The readiness check requires new bytes and packets, then allows a short RTP flush before commit. |

Focused RED command:

```text
npm test -- --run src/renderer/realtime-voice-transport.test.ts src/renderer/push-to-talk.test.ts src/renderer/use-push-to-talk.test.ts
```

Focused GREEN result: 3 test files passed, 24 tests passed.

Full GREEN result from `npm run check`: lint passed, typecheck passed, 28 test
files passed, and 146 tests passed.

Packaged-build result from `npm run package`: Electron Forge packaged the arm64
macOS application successfully.

## Coverage and known gaps

`npm run test:coverage` passed with 146 tests. The repository currently limits
coverage collection to `src/main/agent/**/*.ts`, so the report does not include
the renderer voice files changed by this fix. Existing configured-scope coverage
was 79.36% statements, 75% branches, 82.2% functions, and 82.09% lines.

The microphone-to-OpenAI media path still requires a live Electron microphone
test for end-to-end validation; unit tests cannot prove that the operating
system and remote WebRTC endpoint exchange audio packets.

No TDD checkpoint commits were created because the worktree already contained
unrelated user changes and this task did not authorize commits.
