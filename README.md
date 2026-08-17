# TroCode

TroCode is a cross-platform, general-purpose desktop agent foundation. One GPT Responses session receives the conversation and the concrete tools installed by the trusted host; it can answer normally or request one tool call at a time.

Read the [privacy policy](PRIVACY.md), [code signing policy](CODE_SIGNING_POLICY.md),
and [security model](docs/security.md).

The desktop application uses Electron, React, TypeScript, and [CUA Driver](https://github.com/trycua/cua). It is domain-agnostic: requests are not placed into a Gold domain/capability grant before execution. The host still enforces concrete tool availability, public HTTPS targets, fresh observations, exact consequential-action approvals, cancellation, and task limits.

## Current status

Implemented:

- Secure Electron main/preload/renderer separation.
- One persistent assistant-or-tool Responses loop for multilingual reasoning,
  writing, coding, music ideas, and installed-tool work.
- A trusted model-visible tool registry with desktop observation/control,
  public HTTPS navigation, grounded guidance, and user-input adapters.
- Typed task lifecycle with guarded transitions.
- Task-scoped clarification replies that continue the same goal conversation.
- Structured pending interactions and exact, single-use approval decisions.
- Task steering queued for goal review at the next safe execution boundary.
- Concrete tool/operation, target, and approval policy evaluation.
- Native Google OAuth sign-in with Authorization Code + PKCE, verified identity
  claims, and an operating-system-encrypted one-time local session.
- Text-first workspace readiness; microphone and computer permissions are
  optional and requested only when their feature is used.
- A production-only membership gate after language setup, with
  account-bound, time-limited activation codes verified by Ed25519 signatures.
- Lazy CUA initialization after a model desktop-observation request or an
  explicit user-clicked Connect computer action.
- Task-scoped CUA sessions with bounded screenshots, typed clicks, text entry,
  keypresses, scrolling, dragging, and session cleanup.
- GPT-5.6 Luna reasoning through the Responses API, with GPT-5.6 Terra fallback.
- A serialized sample → tool → result loop with tool/time limits, cancellation,
  safe steering, post-action screenshots, and no repeat after unknown results.
- Direct public HTTPS navigation and exact, revalidated approval
  before consequential CUA actions such as Send.
- Focused-window push-to-talk plus system-wide background voice shortcuts
  through OpenAI Realtime using `gpt-realtime-whisper`.
- Optional ElevenLabs `eleven_flash_v2_5` speech for short companion
  explanations, with local system-speech fallback; TTS failures never block the
  desktop task.
- Doppler-injected OpenAI voice setup; only short-lived Realtime session
  secrets cross into the renderer.
- PostHog product analytics for count-only app, model, and tool activity; task
  text, voice transcripts, screenshots, and tool arguments are excluded.
- Account-scoped PostgreSQL task history that saves the latest validated task
  snapshot and immutable lifecycle events, then restores History and Insights
  after restart.
- Goal preview, automatic execution, always-available Stop/Escape cancellation,
  conversation, clarification, approval, and lifecycle activity UI.
- Unit tests and cross-platform CI definition.

Not implemented yet:

- Accessibility-first element targeting and production application allowlists.
- Direct Gmail/Calendar connectors and app-specific independent verifiers.
- Persistent screenshot-rich execution trajectory storage.
- Direct media/music generation providers and release-credential provisioning.

Music and other creative work can already be performed through an installed or
browser-based application using navigation, visible guidance, clicks, hotkeys,
typing, scrolling, and drag. TroCode does not yet claim to generate an MP3
directly: that requires a separately configured `music.generate` adapter, which
can be added to the registry without changing request classification.

When a host-created task reaches `ready`, TroCode starts its task-scoped
Responses session. CUA remains stopped unless GPT requests a desktop tool. The visible **Stop task** control and
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

For macOS permission testing, use the packaged `TroCode.app`. Raw `npm start`
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
doppler secrets set OPENAI_API_KEY GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET GOOGLE_OAUTH_PROJECT_ID
npm start
```

Companion speech is optional. To use ElevenLabs credits, also configure
`ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`. Agent sampling defaults to
`gpt-5.6-luna` with `gpt-5.6-terra` fallback and can be overridden with
`TROCODE_AGENT_MODEL` and `TROCODE_AGENT_FALLBACK_MODEL`. The old planner
variable names remain fallback aliases for one compatibility release.

Paste the value at Doppler's prompt, then enter a line containing only `.`.
Doppler injects the values while Electron Forge builds and starts the app. The
OpenAI key and Google tokens stay main-process-only. A desktop OAuth client
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

The production desktop build may receive public build-time configuration such
as the Google desktop OAuth client metadata, PostHog project token, and
`TROCODE_MEMBERSHIP_PUBLIC_KEY`. Do not compile `OPENAI_API_KEY`,
`ELEVENLABS_API_KEY`, `DATABASE_URL`, or database passwords into the desktop
application. Those secrets belong in the hosted backend's Doppler `prd` runtime
once that service exists.

### PostgreSQL task history

Local development uses PostgreSQL 17 from [`compose.yaml`](compose.yaml), bound
only to `127.0.0.1:54320`. `TROCODE_POSTGRES_PASSWORD` and the matching
`DATABASE_URL` live in Doppler's `tro-app/dev` config; they are injected into
Compose and Electron only at runtime. The named `trocode_postgres_data` volume
preserves records, while [`migrations/001_task_history.sql`](migrations/001_task_history.sql)
initializes a new database. TroCode also verifies the schema idempotently when
it starts and keys every query by the verified Google user ID.

The URL is intentionally not added to Webpack's `DefinePlugin`, so database
credentials are not compiled into the desktop bundle or exposed through
preload. Deployment database configuration remains separate from this local
Compose setup.

When `DATABASE_URL` is absent or PostgreSQL cannot initialize, the app remains
usable and labels History as **Session only**. Task requests, conversation
messages, goal scope, and lifecycle outcomes are stored; raw screenshots and
OAuth/model credentials are not part of the task snapshot contract.

### Production memberships

Membership checks are bypassed by raw local development (`npm start`) and are
required whenever Electron is running a packaged build. A packaged build fails
closed when `TROCODE_MEMBERSHIP_PUBLIC_KEY` is missing or invalid.

Generate the signing keys once. Keep the private key outside this repository
and never place it in Doppler or the application bundle:

```bash
npm run membership:keygen -- \
  --private-key /secure/location/trocode-membership-private.pem \
  --public-key /secure/location/trocode-membership-public.txt
```

The command prints `TROCODE_MEMBERSHIP_PUBLIC_KEY=...`. Put that public value in
the environment used to package TroCode. After a user finishes permissions,
their membership screen shows a reference such as `TRC-AAAA-BBBB-CCCC`. Issue
an activation for the desired number of days:

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

TroCode records `application opened`, `application closed`, task funnel events,
non-sensitive goal metadata, and a `voice transcription completed` event that
contains only the transcript character count. A durable anonymous installation
ID powers DAU before sign-in; authenticated identity is associated with the
same installation and its count-only voice events.

Typed task text, messages, voice transcript content, screenshots, URLs,
document contents, file paths, credentials, and approval descriptions are not
added to analytics events.

Closing the TroCode window hides it while TroCode stays available from the menu
bar or system tray for background voice input. Choose **Quit TroCode** there, or
press **Command+Q** on macOS, to stop the cursor companion, shut down CUA, and
exit. If native shutdown does not respond, TroCode forces a process exit after
a short grace period.

With the TroCode window focused, hold **Command + Control** on macOS or the
physical **left Alt + left Control** keys on Windows. Release either key to
finish the transcript and submit it through the same bounded task pipeline as
typed input. The same **Command + Control** hold gesture works system-wide on
macOS; on Windows, hold **Ctrl + Alt + Space** globally and release it to finish.
The cursor companion shows audio bars while listening and a processing spinner
after release until the transcript returns. When TroCode has asked a
clarification, the next transcript answers that same task rather than creating
another one. Short pending prompts are also spoken locally.

When `OPENAI_API_KEY` is injected by Doppler, TroCode enables voice and visual
planning automatically at launch. The renderer never asks for or receives the
long-lived API key; only short-lived voice session secrets come back. OpenAI
Responses requests and optional ElevenLabs synthesis remain in the main process.

### First Gmail execution test

1. Start TroCode with `OPENAI_API_KEY` configured and choose **Connect
   computer** if CUA is not ready.
2. Sign in to Gmail yourself. TroCode will not type passwords.
3. Enter a complete bounded request, for example: `Open Gmail, compose an
   email from my work account to me@example.com with subject "TroCode test"
   and body "The desktop loop works", then send it after I approve.`
4. Review the compiled goal as TroCode starts it automatically. Press
   **Escape** or choose **Stop task** to cancel at any time.
5. If TroCode needs a material detail, answer in the same task from the main
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
its target operating system. During packaging, TroCode stages the CUA JavaScript
SDK and native libraries together outside ASAR; this preserves CUA's relative
native-library resolution in the packaged application.

### Application updates and releases

Installed macOS and Windows builds expose **Settings → Application update**.
The trusted main process checks the fixed TroCode feed on
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

The tag-triggered workflow above is the certificate-file release path. TroCode
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
inside TroCode. Linux continues to use its package manager because Electron's
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

## Architecture

```text
React renderer
  -> typed preload API
    -> trusted Electron IPC
      -> Google OAuth service / encrypted local session
      -> goal runtime / policy engine
      -> GPT Responses visual manager (Luna first, Terra fallback)
      -> PostHog analytics service (allowlisted metadata only)
      -> OpenAI voice service (short-lived Realtime sessions)
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
│   ├── agent/       task runtime, Responses agent, tool router, policy, coordinator
│   ├── analytics/   privacy-safe PostHog events and durable identity
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
