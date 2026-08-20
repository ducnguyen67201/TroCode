# Security model

Tro treats the renderer, model output, screen content, websites, source files,
provider responses, and network errors as untrusted.

## Desktop boundary

- Tauri runs with Node integration absent. The renderer uses only the narrow
  `DesktopApi` adapter.
- Capabilities are scoped per window and every Rust command checks its invoking
  window label and validates bounded input again.
- OAuth uses loopback PKCE, state, and nonce. The Rust host exchanges the Google
  token for an opaque device session and never exposes either token to React.
- Device credentials are encrypted in a Stronghold snapshot. A random 256-bit
  Stronghold master secret is kept by Keychain, Windows Credential Manager, or
  the Linux Secret Service through the Rust keyring adapter. Existing Electron
  secrets are not decrypted or copied; the first Tauri upgrade requires one
  new sign-in.
- Preferences are atomically stored in the app config directory with owner-only
  permissions on Unix. Provider secrets never enter desktop builds.

## Agent and local actions

- The host owns tool registration, consequence classification, workspace roots,
  budgets, lifecycle state, and approval digests.
- A model tool call is a proposal, not authority. Consequential actions require
  approval of the exact argument digest; changing arguments invalidates it.
- Tro's own windows cannot self-approve. Approval denial is returned to the
  model as a denial and does not execute the action.
- CUA commands require a fresh observation identifier and fingerprint.
- Workspace paths reject absolute paths, parent traversal, and symlink escape.
  Reads and output are bounded; writes are staged; delete/write/command actions
  require exact approval.
- Public navigation accepts HTTPS only and rejects credentials, IP literals,
  localhost, private, link-local, `.local`, and `.internal` targets.
- An uncertain consequential result is terminal and is never retried blindly.

## Hosted boundary

- Axum applies request IDs, security headers, content/body bounds, origin
  policy, generic public errors, authentication/access gates, and rate limits.
- PostgreSQL calls use bound parameters through one SeaORM-owned pool. Locks and
  transaction boundaries preserve idempotency, quota, spend, invite, run, and
  worker correctness.
- Paid provider calls reserve integer micro-USD budget before dispatch and
  settle, release, or mark uncertainty after the result. Provider errors and
  payloads are not returned verbatim.
- Knowledge objects are private. Tickets name exact objects and expire quickly;
  completion reconciles size, media type, and checksum using HEAD before work is
  admitted.
- The worker revalidates downloaded bytes and keeps extracted source content out
  of logs.
- Admin API requests require either the configured bearer secret or a signed,
  30-day `HttpOnly`, `Secure`, `SameSite=Strict` session cookie plus a
  same-origin browser request. Blocking an account atomically records an audit
  event and revokes every active device session.
- Access-code lookup remains a keyed HMAC. New retrievable copies are sealed
  with AES-256-GCM, bind the digest as associated data, and use a distinct
  production encryption key. Legacy digest-only rows remain valid and are never
  fabricated into plaintext.

## Logs and analytics

Rust processes use structured `tracing` with allowlisted IDs, enums, counts,
latency, and public error codes. Do not log prompts, responses, transcripts,
screenshots, file contents or paths, URLs, commands, tool arguments, object keys,
signed URLs, tokens, cookies, credentials, or database connection strings.

The previous PostHog backend integration was removed during the migration. No
desktop behavioral analytics are emitted by the Rust host in this release.

## Production secrets

Keep `OPENAI_API_KEY`, ElevenLabs credentials, PostgreSQL credentials, the admin
access token, session HMAC key, access-code encryption key, and S3 credentials
in Railway/Doppler only. Tauri signing keys,
Apple credentials, Windows certificates, and the updater public/private key pair
belong in the release secret store. Never put production provider keys in the
renderer, desktop environment, repository, or updater metadata.
