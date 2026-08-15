# TroCode

TroCode is a cross-platform, general-purpose desktop agent foundation. It turns a user request into a typed, bounded goal before any tool or computer action is allowed.

The desktop application uses Electron, React, TypeScript, and [CUA Driver](https://github.com/trycua/cua). The current foundation compiles and previews goals, enforces lifecycle transitions, evaluates proposed actions against capability and resource scopes, and automatically initializes CUA after operating-system permissions have been granted.

## Current status

Implemented:

- Secure Electron main/preload/renderer separation.
- General-purpose goal routing across education, productivity, coding, research, business, creative, and general domains.
- `answer`, `guide`, `act`, and `mixed` interaction modes.
- Typed task lifecycle with guarded transitions.
- Task-scoped clarification replies that continue the same goal conversation.
- Structured pending interactions and exact, single-use approval decisions.
- Task steering queued for goal review at the next safe execution boundary.
- Capability, resource-scope, and approval policy evaluation.
- Native Google OAuth sign-in with Authorization Code + PKCE, verified identity
  claims, and an operating-system-encrypted one-time local session.
- A post-login permission checklist for Microphone, Accessibility, and Screen
  Recording that automatically rechecks when TroCode regains focus.
- Automatic CUA initialization after explicit first-run permission onboarding.
- Task-scoped CUA sessions with bounded screenshots, typed clicks, text entry,
  keypresses, scrolling, and session cleanup.
- GPT Realtime 2.1 visual planning through one validated function-call decision
  per fresh observation.
- A serialized observe → policy → act → verify loop with step/time limits,
  cancellation, safe steering, and no automatic retry after an unknown result.
- Direct HTTPS navigation for allowed domains and exact, revalidated approval
  before consequential CUA actions such as Send.
- Platform-specific, focused-window push-to-talk through OpenAI Realtime using
  `gpt-realtime-whisper`.
- Doppler-injected OpenAI voice setup; only short-lived Realtime session
  secrets cross into the renderer.
- Privacy-safe PostHog product analytics for app activity and task funnels.
- Goal preview, conversation, clarification, approval, and lifecycle activity UI.
- Unit tests and cross-platform CI definition.

Not implemented yet:

- Accessibility-first element targeting and production application allowlists.
- Direct Gmail/Calendar connectors and app-specific independent verifiers.
- System-wide voice capture while another application has focus.
- Persistent task and trajectory storage.
- Production capability manifests, signing, notarization, and update delivery.

The UI stops at `ready` so the user can review the compiled goal. **Start task**
then creates task-scoped GPT Realtime and CUA sessions. The loop observes after
every admitted action, and consequential actions pause on an exact approval
card before anything is dispatched.

## Requirements

- Node.js 24 or newer.
- npm 11 or newer.
- macOS 13+ or a supported 64-bit Windows environment for CUA.
- macOS development requires Accessibility and Screen Recording permissions for the Electron host.

## Start locally

```bash
npm install
npm start
```

On first launch, sign in with Google, then use the one-time permission screen to
enable Microphone, Accessibility, and Screen Recording. TroCode moves into the
workspace only after every required grant is ready. When macOS opens System
Settings, return to TroCode and it will recheck automatically. Later launches
reuse the saved Google session and connect CUA automatically while the operating
system grants remain enabled.

### Environment and Doppler

The default `npm start` command runs Electron through the `tro-app` project and
`dev` config in Doppler, then uses npm to resolve the project-local Electron
Forge executable. The project and config are explicit in the script, so startup
does not depend on a machine-local Doppler selection. Configure these values:

```bash
doppler secrets set OPENAI_API_KEY GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET GOOGLE_OAUTH_PROJECT_ID
npm start
```

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

Use `npm run start:local` only when intentionally testing with an ignored
`.env.local` or `.env` file. Copy `.env.example` as the starting template; never
commit a populated environment file.

### Product analytics

Set the PostHog project token and ingestion host in Doppler, or in an ignored
local environment file when using `npm run start:local`. Analytics is disabled
when `POSTHOG_PROJECT_TOKEN` is absent. The build injects these values into the
Electron main bundle only; the preload and renderer cannot access them.

TroCode records `application opened`, `application closed`, task funnel events,
and non-sensitive goal metadata. A durable anonymous installation ID powers DAU
before sign-in; authenticated identity can then be associated with the same
installation without adding task contents to analytics.

Task text, messages, screenshots, URLs, document contents, file paths,
credentials, and approval descriptions are never added to analytics events.

Closing the TroCode window or pressing **Command+Q** stops the cursor companion,
shuts down CUA, and exits the application. If native shutdown does not respond,
TroCode forces a process exit after a short grace period.

With the TroCode window focused, hold **Command + Control** on macOS or the
physical **left Alt + left Control** keys on Windows. Release either key to
finish the transcript and submit it through the same bounded task pipeline as
typed input. When TroCode has asked a clarification, the next transcript answers
that same task rather than creating another one. Short pending prompts are also
spoken locally.

When `OPENAI_API_KEY` is injected by Doppler, TroCode enables voice and planning
automatically at launch. The renderer never asks for or receives the long-lived
API key; only short-lived voice session secrets come back. System-wide voice
capture while another application is focused is still planned.

### First Gmail execution test

1. Start TroCode with `OPENAI_API_KEY` configured and choose **Connect
   computer** if CUA is not ready.
2. Sign in to Gmail yourself. TroCode will not type passwords.
3. Enter a complete bounded request, for example: `Open Gmail, compose an
   email from my work account to me@example.com with subject "TroCode test"
   and body "The desktop loop works", then send it after I approve.`
4. Review the compiled goal and choose **Start task**.
5. If TroCode needs a material detail, answer in the same task. Voice input
   currently requires bringing the TroCode window back into focus.
6. Before Send, confirm the approval card's account, recipients, subject, body,
   target, and exact command. Send is dispatched once only after the button is
   approved and the latest observation produces the same payload.

## Quality checks

```bash
npm run check
npm run test:coverage
npm run package
```

`npm run make` generates a distributable for the current operating system. Production distribution still requires Apple notarization and Windows code signing.
Use `npm run package:doppler` when validating a package with the Google OAuth
client configuration injected into the main bundle.

CUA installs a native package for the host OS and CPU, so build each release on
its target operating system. During packaging, TroCode stages the CUA JavaScript
SDK and native libraries together outside ASAR; this preserves CUA's relative
native-library resolution in the packaged application.

## Architecture

```text
React renderer
  -> typed preload API
    -> trusted Electron IPC
      -> Google OAuth service / encrypted local session
      -> goal runtime / policy engine
      -> GPT Realtime visual planner (one typed decision per observation)
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
│   ├── agent/       goals, policy, GPT Realtime planner, execution coordinator
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

CUA is a capability, not the planner. A task must have an outcome, success criteria, capability scope, resource scope, approval rules, and execution limits before computer use can begin.
