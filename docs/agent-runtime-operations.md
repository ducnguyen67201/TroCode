# Durable agent runtime operations

The backend runtime is disabled by default. Enabling it requires a dedicated
32-byte AES key encoded as `version:base64`, a nonzero canary cohort, current
desktop protocol support, and a published privacy notice covering encrypted
short-lived task state.

## Rollout

1. Set `TROCODE_BACKEND_AGENT_ENABLED=true` and keep rollout at `0`.
2. Add internal user IDs to `TROCODE_BACKEND_AGENT_CANARY_USERS`.
3. Deploy protocol v2 and migration 015, set
   `TROCODE_INTENT_AUTHORIZATION_ENABLED=true`, and add internal IDs to
   `TROCODE_INTENT_AUTHORIZATION_CANARY_USERS`. Keep its rollout percent at `0`.
4. Run the deterministic reliability benchmark and packaged macOS/Windows
   restart, reconnect, approval, permission, and sign-out checks.
5. Advance intent authorization through internal, 1%, 5%, 25%, then 100% only
   when false completion, duplicate consequential action, and hard-confirm
   bypass counts remain zero; recovery stays above 95%; and unnecessary
   approvals materially decrease.

Assignment uses an HMAC of the user ID, so cohorts do not change per request.
The intent kill switch creates fail-closed v8 contracts with no instruction
grants for new tasks. Existing v8 tasks retain their encrypted contract, remain
visible/cancellable, and are never restarted as duplicate v7/local runs.
The desktop-only fallback also emits fail-closed v8 authority; instruction
grants become active only from a compatible backend-owned canary contract.

## Incident checks

- Query nonterminal `agent_runs` by state, deadline, lease owner, and lease
  expiry. Do not select ciphertext columns during routine operations.
- A run in `awaiting_worker` needs a current signed-in desktop heartbeat.
- An expired lease in a runnable state is reclaimable. Repeated recovery stops
  at the configured ceiling and becomes blocked.
- An invocation in `executing` after desktop loss is ambiguous. Mark it unknown
  and do not manually set it to confirmed.
- Use the global enable flag for provider, schema, encryption, or false-
  completion incidents. Preserve in-flight records for inspection/cancellation.
- Use `TROCODE_INTENT_AUTHORIZATION_ENABLED=false` for authorization-policy
  incidents. Do not rewrite stored intent revisions or executing invocations.
- Reject protocol-v1 workers. Legacy protocol-v1 runs remain visible and
  cancellable but do not inherit protocol-v2 instruction grants.
- Rotate any PostgreSQL credential exposed in a chat, log, screenshot, or
  support trace before deployment; do not use it for rollout validation.

## Key rotation and retention

Add the new key alongside the previous key, increment
`TROCODE_AGENT_STATE_KEY_VERSION`, and write only with the new version. Retain
old read keys until every older encrypted payload has passed its TTL and cleanup
has run. Never reuse the device-session HMAC key for agent state.

Cleanup deletes expired checkpoints and session items and removes sensitive
evidence detail while retaining sanitized lifecycle and billing rows. Screenshot
bytes are memory-only and disappear on consumption, timeout, or process exit.

## Release gates

- `npm run agent:benchmark -- --baseline <json> --candidate <json>`
- `npm run check`
- `npm run package`
- zero false completions;
- zero duplicate consequential actions;
- zero hard-confirm bypasses;
- lower unnecessary approvals and approvals per verified success;
- stale workers rejected;
- API and desktop restart recovery demonstrated;
- privacy and security documentation matches the deployed data flow.
