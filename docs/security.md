# Security model

TroCode has unusually powerful local permissions. The model is treated as an untrusted tool chooser operating inside a trusted host policy.

## Trust boundaries

- The React renderer is sandboxed and unprivileged.
- The preload exposes a fixed, typed API rather than raw Electron IPC.
- The main process validates the sending renderer and parses all payloads.
- Only trusted main-process code creates and destroys the CUA runtime.
- A model cannot register a tool, approve an action, alter host limits, or make
  a private/local browser target admissible.
- A model cannot select a runtime, choose or expand a workspace, change the
  trusted root, grant itself an approval, or operate TroCode approval controls.

## Default behavior

- Google sign-in opens in the system browser and uses a random loopback port,
  state, nonce, and PKCE. The main process verifies the ID token signature,
  issuer, audience, timestamps, nonce, and verified-email claim.
- The renderer receives only an allowlisted user ID, email, display name, and
  sign-in status. OAuth codes and tokens never cross the preload boundary. For
  hosted builds, the Railway API independently verifies the Google ID token and
  exchanges it for a random opaque device token. Electron `safeStorage`
  encrypts that token locally; PostgreSQL stores only its HMAC digest. Sign-out
  revokes the server session and deletes the local copy.
- On macOS, launch checks Accessibility and Screen Recording state without
  prompting. Text work does not require microphone or CUA permissions.
  Push-to-talk requests microphone access when used; desktop work pauses until
  the user clicks Connect computer. Model output cannot open System Settings.
- Packaged builds without a hosted API require an active membership after language setup.
  The renderer can inspect and submit membership codes only through narrow,
  schema-validated IPC. The main process verifies an Ed25519 signature, binds
  the signed payload to a reference derived from the verified Google user ID,
  checks its expiry, and rechecks membership before task and voice operations.
  Local development bypasses this gate; legacy packaged builds fail closed if
  the public verification key is absent. Hosted builds authorize access through
  the revocable Google-backed device session instead of an offline activation.
- Assistant text and tool calls share one model session. A model tool call is a
  proposal, not permission or proof that an effect occurred.
- Approval requirement and consequence are separate. In Balanced mode,
  authenticated user text compiles to closed grants for requested reversible
  private create/update/rename/move/comment and safe Workspace effects. The pure
  host classifier still resolves the exact effect and can raise risk from
  normalized payload facts, opaque/stale state, or visible cues. Send/invite,
  delete/archive, unexpected overwrite, publish/deploy/merge, money/trade,
  credentials, permissions, installs, sensitive transfer, and unknown effects
  always require exact approval. Strict mode confirms every mutation or side
  effect. Untrusted content can raise risk but can never create or satisfy a
  grant.
- Remote navigation and creation of unexpected Electron windows are denied.
- Current actions are bounded by registered tool operations, public-target
  checks, task budgets, fresh observations, and exact approvals. A task does
  not gain authority from a keyword, domain label, or model-produced capability
  string.
- Semantic browser/accessibility data is parsed and bounded in Electron main.
  The model receives only normalized surface facts and observation-local opaque
  references; raw process/window/tab IDs, driver tokens, snapshots, and the
  generic CUA call surface never cross into preload or renderer.
- Browser-profile attachment is never implicit. A one-use authorization broker
  defaults to deny and grants only an already-approved exact session,
  operation, and resource digest. Semantic approval revalidation can only
  rebind a uniquely matching target on the unchanged surface.

Workspace mode uses the authenticated TroCode backend; it never asks the user
for a Codex login, ChatGPT subscription, or OpenAI API key. The trusted
main-process picker canonicalizes one directory and returns only an opaque
selection ID to the renderer. SDK patch operations resolve paths against that
canonical root, reject lexical and symlink escapes, bound file and patch sizes,
and pass host policy at the SDK interruption. Requested create/update/move
patches may resume without user UI; delete and unexpected overwrite remain
exact. SDK shell operations start in the root, receive only an allowlisted OS
environment, and bypass user UI only for the closed read/validation/requested-
local command policy. TroCode, provider, database, analytics, and release
secrets are not inherited. When approval is required, the card displays the full
command or patch and remains single-use. The shell is not an OS
sandbox: it starts in the selected directory, but an approved command can use
absolute paths or the network. Patch operations, unlike shell commands, are
structurally confined to the selected root.

## Sensitive data

Screenshots, URLs, document text, file paths, typed input, voice transcripts,
model reasoning, and raw tool arguments may contain private data. Do not write
them to analytics logs. Task-history persistence is enabled only when the operator configures
`DATABASE_URL`. It stores task requests, conversations, goal scope, and
lifecycle outcomes under the verified Google user ID, but not raw screenshots,
OAuth tokens, or model-provider credentials. Hosted connections must use TLS,
a least-privilege database role, access controls, and an explicit retention
policy. Rich screenshot or document trajectory storage remains out of scope and
should be opt-in and encrypted.

Knowledge Spaces are the intentional exception for user-uploaded reusable
Source content and structured Activity/evidence data. Source bytes are stored in
a private S3-compatible bucket and extracted bounded chunks in PostgreSQL.
Signed object URLs, object keys, checksums, local canonical paths, and Source
bytes stay in trusted main/API memory and never cross the renderer bridge.
Folder imports reject symlinks and expose only reviewed relative paths. A
participant's local Workspace, screen, unsaved editor state, and ordinary task
conversation are never uploaded. Submission always requires a separate exact
file preview and user action. Agent evidence is policy-acknowledged, allowlisted,
bounded, provenance-labeled, and cannot grade or change state.

Backend-agent canary runs are a separate, explicit privacy path: task text and
bounded tool results are processed by Railway and short-lived operational state
is stored under AES-256-GCM with authenticated run metadata and a dedicated
versioned key. Sanitized events contain no task content. Screenshot and crop
bytes live only in a bounded in-memory sidecar and are removed before any
session item or tool result is written to PostgreSQL.

Local PostgreSQL binds only to `127.0.0.1:54320`, receives its generated
password from Doppler at container startup, and persists data in a named Docker
volume. The password and `DATABASE_URL` are not committed or compiled into the
application. Production database credentials and network policy are deliberately
separate from this development setup.

PostHog runs only in the trusted Electron main process. Its event surface is an
explicit allowlist of application lifecycle, task phase, contract/runtime/profile
labels, first-delta latency, tool ID/operation, and count fields. Voice events
contain only character count. Partial text, command text, arguments, paths, and
approval descriptions are excluded.
CUA performance events contain only the fixed route, operation name, bounded
duration, screenshot-present boolean, fallback enum, and effect status. They do
not include titles, URLs, code, visible text, typed text, filesystem paths,
identifiers, resources, screenshots, or raw arguments.
Anonymous activity uses a random local installation ID without a person
profile. Email and display name are sent only after successful Google
authentication.

Do not ship a shared model-provider API key inside the renderer, Electron main,
or application bundle. Production OpenAI and optional ElevenLabs keys are
injected into the Railway API only. Electron sends its opaque device session to
fixed, HTTPS provider-proxy endpoints; provider credentials never reach the
desktop. Responses streaming is SDK-driven behind the host broker. Voice audio
crosses the narrow preload boundary only as a schema-bounded base64 PCM WAV
segment with UUIDs, sequence, and claimed duration. The hosted API parses mono,
16 kHz, PCM16 WAV structure and authoritative duration before reserving spend;
raw audio and transcript text are never persisted or added to structured logs.
MP3 bytes stream through a `trocode-audio://speech/<UUID>` protocol handler
owned by Electron main. Tickets are short-lived, one-use, bounded, and served
with `Cache-Control: no-store`; they contain no session or provider credential.
Playback reports are fixed-enum payloads accepted only from the current guidance
renderer main frame. Timing logs contain IDs, counts, status, and fixed reasons,
not guidance text, provider bodies, credentials, or audio bytes.

The Tro device credential is deliberately not a JWT. Tokens contain no user
claims and are useful only through the API; PostgreSQL-backed digest lookup
supports immediate revocation and rotation. Public endpoints reject browser
origins, validate content types and body sizes, apply rate limits, return
generic errors, and emit logs without identity tokens, provider keys, task text,
or model output.

Every hosted paid request is bound to an authenticated user, request UUID, task
UUID, server-owned price-catalog version, and transactional reservation before
provider dispatch. The client cannot provide prices, usage, limits, or
settlement state. Explicit pre-inference rejection may release a reservation;
an ambiguous dispatch retains it and is never retried automatically. Usage rows
contain IDs, lane/model, counts, integer micro-USD, disposition, and timestamps
only—never prompts, outputs, screenshots, base64, URLs, recipients, file paths,
secrets, or raw tool arguments.

The membership signing private key is an administrative secret and must never
be added to the repository, Doppler application runtime, analytics, or a
release bundle. Only the Ed25519 public key is compiled into packaged builds.
Offline activation codes support account binding and expiry but not immediate
revocation or authoritative time; those require an authenticated backend.

Every nonterminal task exposes a renderer **Stop task** control, and the trusted
main process registers **Escape** system-wide while work is active. Cancelling
does not widen authority or bypass exact-action approvals.

Backend ownership does not move local authority to Railway. A protocol-v2
durable tool call carries a typed effect proposal, intent revision, approval
requirement, authorization source, and independent consequence bit. Only the
exact signed-in desktop worker may transition it to executing, after repeating
schema validation, workspace binding, effect normalization, policy, and any
one-use approval. A stale worker result is rejected. Loss after executing is
recorded as unknown and blocks completion rather than replaying the effect.

## Release requirements

Before distributing the application:

1. Define a strict Content Security Policy without development localhost exceptions.
2. Generate per-skill CUA capability manifests.
3. Add approval UI with exact target and consequence descriptions.
4. Sign and notarize macOS builds.
5. Sign Windows installers.
6. Run dependency, secret, and packaged-application security checks.
7. Test permission upgrades, revocation, and app restarts on clean machines.
