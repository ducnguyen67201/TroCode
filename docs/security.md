# Security model

TroCode has unusually powerful local permissions. The model is treated as an untrusted tool chooser operating inside a trusted host policy.

## Trust boundaries

- The React renderer is sandboxed and unprivileged.
- The preload exposes a fixed, typed API rather than raw Electron IPC.
- The main process validates the sending renderer and parses all payloads.
- Only trusted main-process code creates and destroys the CUA runtime.
- A model cannot register a tool, approve an action, alter host limits, or make
  a private/local browser target admissible.

## Default behavior

- Google sign-in opens in the system browser and uses a random loopback port,
  state, nonce, and PKCE. The main process verifies the ID token signature,
  issuer, audience, timestamps, nonce, and verified-email claim.
- The renderer receives only an allowlisted user ID, email, display name, and
  sign-in status. OAuth codes and tokens never cross the preload boundary. The
  saved session is encrypted through Electron `safeStorage`; sign-out deletes
  it.
- On macOS, launch checks Accessibility and Screen Recording state without
  prompting. Text work does not require microphone or CUA permissions.
  Push-to-talk requests microphone access when used; desktop work pauses until
  the user clicks Connect computer. Model output cannot open System Settings.
- Packaged builds require an active membership after language setup.
  The renderer can inspect and submit membership codes only through narrow,
  schema-validated IPC. The main process verifies an Ed25519 signature, binds
  the signed payload to a reference derived from the verified Google user ID,
  checks its expiry, and rechecks membership before task and voice operations.
  Local development bypasses this gate; packaged builds fail closed if the
  public verification key is absent.
- Assistant text and tool calls share one model session. A model tool call is a
  proposal, not permission or proof that an effect occurred.
- Consequential actions require explicit approval. For desktop control, the
  trusted tool operation—not the model's declared consequence—sets the minimum
  approval level: click, drag, text entry, and keypress operations all pause,
  while scroll remains non-mutating.
- Remote navigation and creation of unexpected Electron windows are denied.
- Current actions are bounded by registered tool operations, public-target
  checks, task budgets, fresh observations, and exact approvals. A task does
  not gain authority from a keyword, domain label, or model-produced capability
  string.

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

Local PostgreSQL binds only to `127.0.0.1:54320`, receives its generated
password from Doppler at container startup, and persists data in a named Docker
volume. The password and `DATABASE_URL` are not committed or compiled into the
application. Production database credentials and network policy are deliberately
separate from this development setup.

PostHog runs only in the trusted Electron main process. Its event surface is an
explicit allowlist of application lifecycle, task phase, contract version,
tool ID/operation, and count fields. Voice events contain only character count.
Anonymous activity uses a random local installation ID without a person
profile. Email and display name are sent only after successful Google
authentication.

Do not ship a shared model-provider API key inside the renderer or application
bundle. Doppler injects the developer-owned OpenAI and optional ElevenLabs keys
into the Electron main process at runtime. Responses sampling and speech
synthesis stay in that process; only short-lived Realtime transcription secrets
and validated MP3 companion data cross narrow preload boundaries. A production
service may replace this with an authenticated cloud gateway.

The membership signing private key is an administrative secret and must never
be added to the repository, Doppler application runtime, analytics, or a
release bundle. Only the Ed25519 public key is compiled into packaged builds.
Offline activation codes support account binding and expiry but not immediate
revocation or authoritative time; those require an authenticated backend.

Every nonterminal task exposes a renderer **Stop task** control, and the trusted
main process registers **Escape** system-wide while work is active. Cancelling
does not widen authority or bypass exact-action approvals.

## Release requirements

Before distributing the application:

1. Define a strict Content Security Policy without development localhost exceptions.
2. Generate per-skill CUA capability manifests.
3. Add approval UI with exact target and consequence descriptions.
4. Sign and notarize macOS builds.
5. Sign Windows installers.
6. Run dependency, secret, and packaged-application security checks.
7. Test permission upgrades, revocation, and app restarts on clean machines.
