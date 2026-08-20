# Inference cost lifecycle

The Rust desktop decides when a model sample is needed. The Rust API is the only
component allowed to price, reserve, dispatch, and settle a paid provider call.

```text
desktop -> create agent turn (task/user quota in PostgreSQL)
desktop -> POST streamed Responses request with request/task/turn IDs
API -> advisory lock + idempotency check + micro-USD reservation
API -> OpenAI Responses (stream=true, store=false, no automatic retry)
API -> settle provider usage or retain an uncertain reservation
desktop -> append final text or execute one host-owned tool call
```

Money is stored as integer micro-USD. PostgreSQL is authoritative for user-turn
quotas, per-turn call caps, task/day/month spend, request idempotency, reserved
cost, actual usage, and uncertainty. Explicit pre-dispatch rejection releases a
reservation. A timeout, disconnect after dispatch, malformed admitted response,
or missing usage retains the conservative reservation and is never resent
automatically.

Voice transcription follows the same rule. The API validates bounded PCM WAV,
reserves from decoded audio duration, and settles from that duration because the
transcription response has no token-duration ledger. Knowledge and task paths do
not receive a second hidden reasoning call.

The desktop sends at most one current screenshot and caps model output at 4,000
tokens. Old screenshot bytes are removed from later provider requests while
bounded textual tool evidence remains. No prompts, outputs, transcripts,
screenshots, URLs, recipients, tool arguments, provider keys, or reasoning text
are written to usage rows or tracing events.

Use the content-free Rust admin load/contract commands documented in the README
for operational checks. Production provider calls can be disabled with
`TROCODE_PAID_CALLS_ENABLED=false`; cost enforcement defaults to `enforce`.
