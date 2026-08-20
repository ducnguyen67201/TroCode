# Tro

Tro is a cross-platform, general-purpose agent foundation. Everyday and
Workspace tasks run through the OpenAI Agents SDK and Tro's authenticated
backend. Both stay behind the same trusted host policy and activity stream.

Read the [privacy policy](PRIVACY.md), [code signing policy](CODE_SIGNING_POLICY.md),
the [security model](docs/security.md), and the
[Knowledge Spaces guide](docs/knowledge-spaces.md).

The desktop application uses Electron, React, TypeScript, and [CUA Driver](https://github.com/trycua/cua). It is domain-agnostic: requests are not placed into a Gold domain/capability grant before execution. The host still enforces concrete tool availability, public HTTPS targets, fresh observations, exact consequential-action approvals, cancellation, and task limits.

## Current status

Implemented:

- Feature-flagged Knowledge Spaces with a private versioned Library, reusable
  Activities, groups and expiring join codes, live/async/hybrid Runs, private
  Attempts, starter Workspaces, scoped source search, explicit submissions,
  and evidence-based facilitator dashboards. PostgreSQL is authoritative; no
  manifest or Firebase is required.

- Secure Electron main/preload/renderer separation.
- One persistent OpenAI Agents SDK loop for multilingual reasoning, writing,
  desktop work, and installed tools, with incremental Responses SSE.
- An explicit Workspace mode backed by a canonical user-selected root and the
  Agents SDK's local shell and patch tools. Commands and file mutations require
  exact, one-use Tro approval; provider credentials remain backend-only.
- A trusted model-visible tool registry with desktop observation/control,
  public HTTPS navigation, grounded guidance, and user-input adapters.
- Typed task lifecycle with guarded transitions.
- Task-scoped clarification replies that continue the same goal conversation.
- Structured pending interactions and exact, single-use approval decisions.
- Task steering queued for the next safe Agents SDK model boundary.
- Concrete tool/operation, target, and approval policy evaluation.
- Native Google OAuth sign-in with Authorization Code + PKCE, locally verified
  identity claims, and an operating-system-encrypted, revocable hosted session.
- Text-first workspace readiness; microphone and computer permissions are
  optional and requested only when their feature is used.
- Hosted production access for signed-in users; offline builds retain the
  account-bound, time-limited Ed25519 activation-code fallback.
- Lazy CUA initialization after a model desktop-observation request or an
  explicit user-clicked Connect computer action.
- Task-scoped CUA sessions with bounded screenshots, typed clicks, text entry,
  keypresses, scrolling, dragging, and session cleanup.
- One configured GPT-5.6 model through the Responses API (Luna by default),
  with no classifier or fallback request after a failure.
- API-owned Free, Basic, Pro, and Max entitlements with atomic agent-message and
  integer micro-USD reservations before any paid provider dispatch.
- One resized current screenshot per visual sample, bounded context, and a
  4,000-token output ceiling.
- SDK-owned model → tool → result continuation with host-owned
  tool/time limits, cancellation, safe steering, post-action screenshots, and
  no repeat after unknown results.
- Direct public HTTPS navigation and exact, revalidated approval
  before consequential CUA actions such as Send.
- Focused-window push-to-talk plus system-wide background voice shortcuts with
  local VAD, bounded PCM WAV segments, and upload-based `gpt-transcribe`
  transcription. Voice enabled while idle creates no provider audio session.
- Every grounded `show_guidance` step has one narration attempt. Optional
  ElevenLabs `eleven_flash_v2_5` audio streams progressively through a private,
  one-time Electron media URL; unavailable or slow startup falls back once to
  local system speech and never blocks the desktop task.
- Railway-hosted Responses, GPT Transcribe, and optional ElevenLabs
  access; provider keys are never compiled into or stored by the customer
  application.
- PostHog product analytics for count-only app, model, and tool activity; task
  text, voice transcripts, screenshots, and tool arguments are excluded.
- Account-scoped PostgreSQL task history that saves the latest validated task
  snapshot and immutable lifecycle events, then restores History and Insights
  after restart.
- Streamed draft text, bounded live activity and optional plan history, explicit
  Everyday/Workspace selection, Balanced/Strict autonomy, automatic execution,
  and always-available Stop/Escape cancellation.
- Unit tests and cross-platform CI definition.

Current computer-context support and limits:

- Compatible CUA builds use browser semantics or native-window accessibility
  before screenshots, with opaque observation-local element references. Canvas
  editors, ambiguous windows, unsupported apps, and incomplete accessibility
  trees fall back to window or full-desktop vision.
- Existing logged-in browser-profile attachment remains a separate exact
  permission action. Tro does not ship a browser or VS Code extension, so
  unsaved editor buffers and diagnostics are available only when the browser or
  operating-system accessibility surface exposes them.

Not implemented yet:

- Production application allowlists beyond current-window selection and the
  explicit exclusion of Tro's own windows.
- Direct Gmail/Calendar connectors and app-specific independent verifiers.
- Persistent screenshot-rich execution trajectory storage.
- Direct media/music generation providers and release-credential provisioning.

Music and other creative work can already be performed through an installed or
browser-based application using navigation, visible guidance, clicks, hotkeys,
typing, scrolling, and drag. Tro does not yet claim to generate an MP3
directly: that requires a separately configured `music.generate` adapter, which
can be added to the registry without changing request classification.

When a host-created task reaches `ready`, Tro starts its selected task-scoped
runtime. CUA remains stopped unless the agent requests a desktop tool.
The visible **Stop task** control and
the system-wide **Escape** shortcut cancel a nonterminal task, including while
the main window is hidden for desktop work. The loop observes after every
admitted action, and consequential actions still pause on an exact approval
card before anything is dispatched.

## Requirements

- Node.js 24 or newer.
- npm 11 or newer.
- Docker Desktop with Docker Compose v2 for local PostgreSQL.
- macOS 13+ or a supported 64-bit Windows environment for CUA.
- macOS development requires Accessibility and Screen Recording permissions.

## Start locally

```bash
npm install
npm start
```

`npm start` starts the loopback-only PostgreSQL container, waits for its health
check, and then launches Electron. The named Docker volume keeps task history
between container restarts. Use `npm run db:down` to stop the container without
deleting its data.

On first launch, sign in with Google and choose a language. Text work is then
available immediately. Push-to-talk requests microphone access when used;
desktop work pauses with a Connect computer choice when Accessibility or Screen
Recording is missing. System Settings opens only from that user action, and the
app rechecks grants when it regains focus.

The registration attempt is controlled by the trusted Electron main process. It
creates a hidden, sandboxed renderer with its own in-memory session, starts a
real display-media stream, waits for its first frame (or a short bounded
fallback), and then stops every track. The temporary session accepts only that
window's main-frame request; captured images and source details are never
exposed to the application renderer.

For macOS permission testing, use the packaged `Tro.app`. Raw `npm start`
runs through Electron's development host, whose separate identity can appear as
`Electron` in Privacy & Security and does not represent the shipped app's grant.
The packaged application uses the stable bundle identifier
`com.trocode.desktop`; production releases must keep that identifier and use a
consistent Apple signing identity so macOS can preserve grants across updates.
Local packages fall back to an ad-hoc signature so they remain launchable, but
an ad-hoc build is not an authoritative test of automatic TCC registration or
grant persistence. Set `TROCODE_MACOS_SIGNING_IDENTITY` to the installed
Developer ID Application certificate name for distributable macOS builds;
those builds retain hardened runtime signing and a stable code requirement.

### Environment and Doppler

The default `npm start` command runs Electron through the `tro-app` project and
`dev` config in Doppler, then uses npm to resolve the project-local Electron
Forge executable. The project and config are explicit in the script, so startup
does not depend on a machine-local Doppler selection. Configure these values:

```bash
doppler secrets set TROCODE_API_BASE_URL GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET GOOGLE_OAUTH_PROJECT_ID
npm start
```

Companion speech is optional. To use ElevenLabs credits, also configure
`ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`. Everyday agent sampling defaults
to `gpt-5.6-luna` and never falls back to a second model. See the
[inference cost lifecycle](docs/inference-cost-lifecycle.md) for the text,
screen, reservation, settlement, and presentation flow.

During a visible walkthrough, use **Command/Control + Alt + J** for Back,
**Command/Control + Alt + K** for Pause/Resume, and **Command/Control + Alt + L**
for Next. Tro registers each shortcut only while a guidance step is waiting
and hides any shortcut that the operating system would not grant.

Paste the value at Doppler's prompt, then enter a line containing only `.`.
Doppler injects the public configuration while Electron Forge builds and starts
the app. Provider keys stay only in the hosted API. A desktop OAuth client
secret is public-client configuration rather than an authorization credential;
the user session itself is encrypted with Electron `safeStorage` and never
crosses into the renderer.

For a machine that is not linked yet, run:

```bash
doppler setup --project tro-app --config dev
```

`npm start` and the local database scripts use the explicit Doppler
`tro-app/dev` configuration. Release scripts (`npm run package`, `npm run make`,
and `npm run publish`) use `tro-app/prd`; `npm run package:dev` and
`npm run make:dev` remain available for local packaged-build testing. Copy
`.env.example` only as a reference; never commit a populated environment file.

The production desktop build receives public build-time configuration such as
the Google desktop OAuth client metadata, PostHog project token, and
`TROCODE_API_BASE_URL`. Do not compile `OPENAI_API_KEY`,
`ELEVENLABS_API_KEY`, `DATABASE_URL`, or database passwords into the desktop
application. Those secrets belong only in the hosted API's Railway runtime;
Doppler `tro-app/prd` is their administrative source.

### Hosted production API

The production API runs at
`https://api-production-3022a.up.railway.app` with a separate Railway
PostgreSQL service. `GET /healthz` checks process liveness and `GET /readyz`
checks database readiness. Railway starts the API from
[`services/api`](services/api) and applies its idempotent session migration
before accepting traffic.

At sign-in, Electron verifies Google's JWT nonce and signature locally, then
the API verifies it independently and exchanges it for a random opaque device
session. Tro does not issue a JWT. Only a HMAC digest of the device token is
stored in PostgreSQL, enabling expiration, rotation, and immediate sign-out
revocation. The desktop stores the token with operating-system encryption.

The API requires these production variables:

- `DATABASE_URL`, supplied through a Railway reference to PostgreSQL
- `GOOGLE_OAUTH_CLIENT_ID`
- `OPENAI_API_KEY`
- `TROCODE_SESSION_TOKEN_HMAC_KEY`
- `TROCODE_AGENT_MODEL`
- `TROCODE_COST_GUARD_MODE` (`enforce` by default; `observe` is available for
  reconciliation)
- optional server-owned budget overrides documented in `.env.example`
- optional `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, and
  `ELEVENLABS_MODEL_ID`

Provider endpoints require the opaque session, atomically reserve spend before
dispatch, enforce per-user message/task/day/month limits and bounded bodies,
restrict Responses models to the configured allowlist, and keep `store: false`.
Burst limits use shared PostgreSQL buckets, so adding API replicas does not
multiply an allowance. The API stores sanitized usage counts and integer cost,
but never task prompts, model responses, screenshots, or desktop actions.
Native computer-use policy remains in the trusted Electron main process.

### PostgreSQL task history

Local development uses PostgreSQL 17 from [`compose.yaml`](compose.yaml), bound
only to `127.0.0.1:54320`. `TROCODE_POSTGRES_PASSWORD` and the matching
`DATABASE_URL` live in Doppler's `tro-app/dev` config; they are injected into
Compose and Electron only at runtime. The named `trocode_postgres_data` volume
preserves records, while [`migrations/001_task_history.sql`](migrations/001_task_history.sql)
initializes a new database. Tro also verifies the schema idempotently when
it starts and keys every query by the verified Google user ID.

The URL is intentionally not added to Webpack's `DefinePlugin`, so database
credentials are not compiled into the desktop bundle or exposed through
preload. Deployment database configuration remains separate from this local
Compose setup.

On history load, Tro validates every persisted snapshot and performs a
forward-only read repair for transitional v5 contracts created before runtime,
profile, autonomy, and workspace fields were introduced. Repairs default to
the Everyday OpenAI runtime unless a complete trusted workspace identity is
already present, then write back in bounded, owner-scoped batches guarded by
the previous JSONB value. Valid legacy contracts remain historical and cannot
silently gain execution authority.

When `DATABASE_URL` is absent or PostgreSQL cannot initialize, the app remains
usable and labels History as **Session only**. Task requests, conversation
messages, goal scope, and lifecycle outcomes are stored; raw screenshots and
OAuth/model credentials are not part of the task snapshot contract.

### Production access codes

Access checks are bypassed by raw local development (`npm start`). In hosted
builds, every Google account starts on Free immediately after sign-in. Packaged
builds without the hosted API retain the signed activation-code fallback.

Hosted builds configured with `TROCODE_API_BASE_URL` store each account's plan,
shared upgrade codes, and code redemptions in PostgreSQL. Create upgrade codes
with the administrator CLI; do not insert them manually:

```bash
doppler run --project tro-app --config prd -- \
  npm run access-code:create -- \
  --code CODEA \
  --max-users 10 \
  --plan basic \
  --label "Private beta batch A"
```

Omit `--code CODEA` to generate a strong random code. The command applies
pending API migrations, stores only a keyed HMAC digest of the code, and prints
the code once for secure distribution. `CODEA --max-users 10` admits at most ten
distinct Google accounts. Each account is permanently linked to its first code;
when a code is full, existing linked accounts retain access while new accounts
are rejected.

The API tier catalog is the pricing and entitlement source of truth:

| Plan | Recommended price | Agent messages/week | Provider-cost cap/month | Responses RPM |
|---|---:|---:|---:|---:|
| Free | $0 | 25 | $1 | 15 |
| Basic | $20 | 300 | $8 | 30 |
| Pro | $50 | 750 | $20 | 45 |
| Max | $100 | 1,875 | $45 | 60 |

#### Admin dashboard

Set a unique, random `TROCODE_ADMIN_ACCESS_TOKEN` of at least 32 characters in
the hosted API environment to enable the separate dashboard at
`/source/admin`. The token is entered when the page opens and is held only in
that browser tab's memory.

The dashboard lists registered users, their current plans and access status,
can block or unblock an account, and can generate 1–100 access codes in a
single batch with a selected `free`, `basic`, `pro`, or `max` plan. Blocking an
account immediately revokes all of its device sessions and prevents new
sessions from being issued. Generated plaintext codes are returned once; the
database stores only keyed HMAC digests.

One agent message is one accepted user turn: the initial request, a clarification
answer, or a steering message. The desktop sends its message UUID to
`POST /v1/agent-turns`; the API atomically and idempotently reserves the weekly
allowance and returns the server turn token required by `/v1/openai/responses`.
Internal model/tool continuations reuse that token and do not consume more agent
messages. Approval decisions, speech, and transcription do not consume agent
messages. A turn whose only provider request is explicitly rejected before
inference is released; an ambiguous dispatched turn remains counted. Whichever
weekly message or monthly provider-cost limit is reached first blocks more inference.
Environment budget values are emergency ceilings and may only lower a tier's
dollar limits.

Plans are account entitlements. New accounts default to Free; redeeming a code
atomically assigns that code's plan to the account. Existing redemptions are
backfilled into the account plan during migration. New database-level
access-code rows default to Free, while the administrator CLI requires an
explicit `--plan free|basic|pro|max`.

The API resolves the account plan again before proxying model, voice
transcription, or speech requests, so bypassing the renderer does not bypass the
quota.

Packaged builds without `TROCODE_API_BASE_URL` use the offline signed-membership
fallback and fail closed when `TROCODE_MEMBERSHIP_PUBLIC_KEY` is missing or
invalid.

Generate the signing keys once. Keep the private key outside this repository
and never place it in Doppler or the application bundle:

```bash
npm run membership:keygen -- \
  --private-key /secure/location/trocode-membership-private.pem \
  --public-key /secure/location/trocode-membership-public.txt
```

The command prints `TROCODE_MEMBERSHIP_PUBLIC_KEY=...`. Put that public value in
the environment used to package the offline build. After a user finishes
permissions, their membership screen shows a reference such as
`TRC-AAAA-BBBB-CCCC`. Issue an activation for the desired number of days:

```bash
npm run membership:issue -- \
  --private-key /secure/location/trocode-membership-private.pem \
  --reference TRC-AAAA-BBBB-CCCC \
  --days 30
```

Send the printed activation code to that user. It is signed for only that
Google account reference, is encrypted locally after entry, and stops granting
task and voice access at its signed expiry. Issued offline codes cannot be
revoked before expiry; use short durations or replace this verifier with an
authenticated membership service when immediate revocation or authoritative
server time is required.

### Product analytics

Set the PostHog project token and ingestion host in Doppler, or in an ignored
local environment file when using `npm run start:local`. Analytics is disabled
when `POSTHOG_PROJECT_TOKEN` is absent. The build injects these values into the
Electron main bundle only; the preload and renderer cannot access them.

Tro records `application opened`, `application closed`, task funnel events,
non-sensitive goal metadata, and a `voice transcription completed` event that
contains only the transcript character count. A durable anonymous installation
ID powers DAU before sign-in; authenticated identity is associated with the
same installation and its count-only voice events.

Typed task text, messages, voice transcript content, screenshots, URLs,
document contents, file paths, credentials, and approval descriptions are not
added to analytics events.

Closing the Tro window hides it while Tro stays available from the menu
bar or system tray for background voice input. Choose **Quit Tro** there, or
press **Command+Q** on macOS, to stop the cursor companion, shut down CUA, and
exit. If native shutdown does not respond, Tro forces a process exit after
a short grace period.

With the Tro window focused, hold **Command + Control** on macOS or the
physical **left Alt + left Control** keys on Windows. Release either key to
finish the transcript and submit it through the same bounded task pipeline as
typed input. The same **Command + Control** hold gesture works system-wide on
macOS; on Windows, hold **Ctrl + Alt + Space** globally and release it to finish.
The cursor companion shows audio bars while listening and a processing spinner
after release until the transcript returns. When Tro has asked a
clarification, the next transcript answers that same task rather than creating
another one. Short pending prompts use local system speech; ElevenLabs
narration is reserved for grounded walkthrough steps.

When `TROCODE_API_BASE_URL` is compiled into a production build, Tro enables
agent and voice access from the signed-in device session. The renderer and
Electron main never ask for or receive long-lived provider keys. OpenAI
Responses, segmented GPT Transcribe transcription, and ElevenLabs synthesis are
authenticated and proxied by Railway.

### First Gmail execution test

1. Start Tro with `TROCODE_API_BASE_URL` configured and choose **Connect
   computer** if CUA is not ready.
2. Sign in to Gmail yourself. Tro will not type passwords.
3. Enter a complete bounded request, for example: `Open Gmail, compose an
   email from my work account to me@example.com with subject "Tro test"
   and body "The desktop loop works", then send it after I approve.`
4. Review the compiled goal as Tro starts it automatically. Press
   **Escape** or choose **Stop task** to cancel at any time.
5. If Tro needs a material detail, answer in the same task from the main
   window or with the system-wide voice shortcut.
6. Before Send, confirm the approval card's account, recipients, subject, body,
   target, and exact command. Send is dispatched once only after the button is
   approved and the latest observation produces the same payload.

## Quality checks

```bash
npm run check
npm run test:coverage
npm run package
```

`npm run make` generates a distributable for the current operating system.
Development commands inject Doppler `dev`; package, make, and publish inject
Doppler `prd`. The release workflow requires Apple notarization and Windows
code-signing credentials before it will publish a release.

CUA installs a native package for the host OS and CPU, so build each release on
its target operating system. During packaging, Tro stages the CUA JavaScript
SDK and native libraries together outside ASAR; this preserves CUA's relative
native-library resolution in the packaged application.

### Application updates and releases

Installed macOS and Windows builds expose **Settings → Application update**.
The trusted main process checks the fixed Tro feed on
`update.electronjs.org`; the sandboxed renderer can request a check or restart,
but it cannot replace the feed URL. Available updates download in the
background and install after the user selects **Restart to update**.

To publish a release, bump `package.json`, commit the change, then push a tag
that exactly matches the version, such as `v0.2.0`. The release workflow builds
macOS arm64, macOS x64, and Windows x64 artifacts sequentially into one draft
GitHub Release, then publishes the release only after every signed artifact is
uploaded.

Configure these GitHub Actions secrets before pushing a release tag:

- `DOPPLER_TOKEN`
- `MACOS_CERTIFICATE_P12_BASE64`, `MACOS_CERTIFICATE_PASSWORD`, and
  `MACOS_SIGNING_IDENTITY`
- `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`
- `WINDOWS_CERTIFICATE_PFX_BASE64` and `WINDOWS_CERTIFICATE_PASSWORD`

The tag-triggered workflow above is the certificate-file release path. Tro
also provides a free open-source Windows path through SignPath Foundation. See
the [code signing policy](CODE_SIGNING_POLICY.md) for its roles and controls.
After SignPath accepts the project, configure this repository secret:

- `SIGNPATH_API_TOKEN`

Configure these repository variables using the values created in SignPath:

- `SIGNPATH_ORGANIZATION_ID`
- `SIGNPATH_PROJECT_SLUG`
- `SIGNPATH_SIGNING_POLICY_SLUG`
- `SIGNPATH_APP_ARTIFACT_CONFIGURATION_SLUG`
- `SIGNPATH_INSTALLER_ARTIFACT_CONFIGURATION_SLUG`

Import [`signpath/windows-app.xml`](signpath/windows-app.xml) and
[`signpath/windows-installer.xml`](signpath/windows-installer.xml) as the two
artifact configurations. Install the SignPath GitHub App for this repository,
restrict the signing policy to `main`, require manual approval, and then run
**Windows SignPath release**. The workflow signs the packaged app first and the
installer second, verifies both signatures, and publishes the stable release.

The first updater-enabled build still requires a normal manual installation.
After that bootstrap release, future published versions can be installed from
inside Tro. Linux continues to use its package manager because Electron's
native updater supports only macOS and Windows.

For a Windows-only customer build, run **Windows build and release** from the
GitHub Actions page. Leave `publish_release` disabled to receive a private CI
artifact. Enable both `require_signing` and `publish_release` to verify the
Authenticode signature and publish the Squirrel installer, full package,
`RELEASES` manifest, and SHA-256 checksums as `v<package.json version>`. Bump
`package.json` before each published run; an existing version is never
overwritten. Published assets are consumed by both the installed-app updater
and the Tro website's latest-release download routes.

Before SignPath approval, that workflow can also publish a clearly labeled
unsigned prerelease solely as the public artifact sample required by the
SignPath Foundation application. It must not be presented as a trusted customer
release; Windows will warn when it is installed. Stable customer releases use
the SignPath workflow or the certificate-file workflow above.

For macOS CI, run **macOS build and release**. The workflow builds separate
Apple silicon (`arm64`) and Intel (`x64`) ZIPs on native GitHub-hosted runners,
checks each application bundle, writes SHA-256 checksum files, and retains the
artifacts for 30 days. Leave `publish_release` disabled for a private CI build.
To add the ZIPs to a shared desktop prerelease, set `source_ref` and
`release_tag` to that existing tag, enable `publish_release`, and—until Apple
credentials are configured—explicitly enable `allow_unsigned_preview`.
Unsigned, unnotarized Mac builds are previews and may be blocked by Gatekeeper;
the workflow will never attach one to a stable release. Once all six Apple
secrets listed above exist, enable `require_signing` to require Developer ID
signing and notarization before upload.

## Architecture

```text
React renderer
  -> typed preload API
    -> trusted Electron IPC
      -> Google OAuth service / encrypted local session
      -> TaskContract v5 / runtime factory / policy brokers
      -> OpenAI Agents SDK through the Tro backend
        -> trusted local Workspace shell/patch tools when explicitly selected
      -> PostHog analytics service (allowlisted metadata only)
      -> local PCM/VAD voice capture
        -> bounded GPT Transcribe segments through authenticated IPC/API
      -> CUA service
        -> native CUA runtime
```

The renderer cannot import Node, Electron, CUA, or filesystem APIs. Every message crosses a narrow preload contract and is validated again in the main process.

Read:

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/computer-use-lifecycle.md`](docs/computer-use-lifecycle.md)
- [`docs/security.md`](docs/security.md)
- [`docs/conversational-task-execution.md`](docs/conversational-task-execution.md)

## Repository map

```text
src/
├── main/
│   ├── agent/       runtime boundary, SDK adapter, brokers, policy, coordinator
│   ├── analytics/   privacy-safe PostHog events and durable identity
│   ├── workspace/   canonical folder selection and opaque root binding
│   ├── cua/         permission-aware CUA lifecycle
│   └── ipc/         trusted renderer boundary
├── renderer/        React desktop interface
├── shared/          Zod schemas and typed preload contract
├── index.ts         Electron main entry
├── preload.ts       minimal renderer API
└── renderer.tsx     React entry
```

## Design rule

GPT chooses between assistant text and host-advertised tools, but it never gains
host authority. The main process owns tool registration, parsing, public-target
checks, exact approval, execution, cancellation, and limits. CUA is only one
lazy execution adapter behind that boundary.
