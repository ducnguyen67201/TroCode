# GPT Transcribe migration TDD evidence

Date: 2026-08-18

## User journey

1. A user selects Vietnamese as the primary spoken language.
2. TroCode captures a bounded PCM WAV segment and sends it through the existing
   desktop IPC/API boundary.
3. The hosted API sends the audio to `gpt-transcribe` with `languages[]=vi`.
4. TroCode validates the provider response and returns the ordered transcript.
5. The usage ledger settles from the server-validated WAV duration at the
   configured GPT Transcribe rate.
6. During rollout, older clients receive their legacy model alias while new
   clients opt into the v2 response contract.

## RED checkpoint

Commit: `e8fae58` (`test: add gpt-transcribe migration coverage`)

The tests first required the new model literal, multipart language hint,
response shape, validated-duration settlement, and default price. Production
still used `whisper-1`, the singular `language` field, verbose JSON duration
usage, and the old rate.

- `npm exec -- vitest run src/main/voice/voice-service.test.ts src/shared/contracts.test.ts`
  failed 4 tests and passed 17.
- `node --test services/api/test/openai-transcription-service.test.mjs services/api/test/config.test.mjs`
  failed 4 tests and passed 7.

The rollout compatibility checkpoint is commit `9bd26ba` (`test: cover
transcription rollout compatibility`). Its focused run failed three assertions:
the new desktop contract rejected the legacy alias, the hosted client did not
advertise v2, and the API returned the new literal to an unversioned client.

## GREEN verification

- `npm run check` passed lint, typecheck, 571 Vitest tests, 6 script tests,
  and 56 API tests.
- `npm run test:coverage` passed 571 tests with 81.66% statement, 72.83%
  branch, 87.01% function, and 84.4% line coverage.
- `npm run package` produced the macOS arm64 Electron package successfully.

The API integration test specifically verifies that a Vietnamese request sends
`languages[]=vi`, does not send the legacy singular field, and returns
`model: gpt-transcribe` with the validated 300 ms audio duration. It also
verifies that an unversioned installed client receives the compatibility alias
without changing the actual provider dispatch or usage record.

## Remaining quality validation

The automated suite validates routing, contracts, billing, and failure
handling without calling a paid provider. Before broad rollout, compare
Vietnamese word error rate on representative accents, microphones, background
noise, names, and Vietnamese-English code switching. Keep a rollback flag or
small canary cohort until that sample confirms the expected quality gain.
