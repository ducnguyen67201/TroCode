# Tro

Tro is a goal-driven desktop agent with a sandboxed React renderer and a Rust
authority boundary. Production uses no Node.js or Electron process.

Read the [privacy policy](PRIVACY.md), [code-signing policy](CODE_SIGNING_POLICY.md),
[security model](docs/security.md), and [Knowledge Spaces guide](docs/knowledge-spaces.md).

## Runtime architecture

```text
React renderer
  -> bounded Tauri commands/events
  -> tro-desktop (Rust)
       -> bounded Responses API tool loop
       -> CUA Rust SDK
       -> confined workspace, approval, voice, auth, update, and window services
       -> tro-api (Axum)
            -> SeaORM-owned PostgreSQL pool
            -> OpenAI / ElevenLabs / private S3

Railway processes
  tro-migrate  singleton pre-deploy migration
  tro-api      stateless HTTP replicas
  tro-worker   lease-coordinated Knowledge ingestion replicas
```

The TypeScript that remains is unprivileged renderer code, shared frontend
schemas, AudioWorklet code, tests, static admin-dashboard code, and frontend
build configuration.

## Workspace

- `apps/tro-api`: Axum hosted API and authenticated admin endpoints
- `apps/tro-worker`: Knowledge ingestion worker
- `apps/tro-migrate`: forward-only migration runner
- `apps/tro-admin`: access-code, membership, contract, and load tooling
- `crates/tro-*`: contracts, domain rules, persistence, providers, Knowledge,
  agent runtime, CUA, and desktop services
- `src-tauri`: Tauri application and native command boundary
- `src/renderer`: sandboxed React UI
- `services/api/public`: static, unprivileged admin dashboard assets
- `services/api/migrations`: preserved SQL baseline imported by `tro-migration`

## Prerequisites

- Rust 1.95 (selected by `rust-toolchain.toml`)
- Node.js 24 for renderer tooling only
- PostgreSQL 17 for local hosted development
- platform prerequisites for [Tauri 2](https://v2.tauri.app/start/prerequisites/)

Copy `.env.example` into your secret manager. Do not commit a populated env
file.

## Local development

```bash
npm ci
npm run db:up
npm run migrate
npm run api
npm run worker
npm start
```

The API defaults to port `8080`. The desktop accepts loopback HTTP for local
development; production `TROCODE_API_BASE_URL` must be HTTPS.

## Verification

```bash
npm run check
npm run package
```

`npm run check` validates the renderer, formats/lints/tests the entire Rust
workspace, and enforces the no-backend-JavaScript gate. CI also runs dependency
license/advisory checks and native desktop builds on macOS and Windows.

## Administration

```bash
npm run access-code:create -- --label "Beta cohort" --plan pro --max-users 25
npm run membership:keygen -- --private-key ./membership-private.pem --public-key ./membership-public.txt
npm run membership:issue -- --private-key ./membership-private.pem --reference TRC-AAAA-BBBB-CCCC --days 30
cargo run -p tro-admin -- contract compare --node-url http://127.0.0.1:8081 --rust-url http://127.0.0.1:8080
cargo run -p tro-admin -- load --base-url http://127.0.0.1:8080 --requests 100
```

Administrative commands never print database/provider credentials. Membership
private keys must remain outside the repository.

The optional dashboard is served at `/source/admin` when
`TROCODE_ADMIN_ACCESS_TOKEN` is configured. Rust exchanges that token for a
signed `HttpOnly`, `Secure`, `SameSite=Strict` cookie. The dashboard can list
accounts and access codes, block/unblock users, and create or retrieve encrypted
codes. Administrators can pause or resume new redemptions without changing
existing users' access, and can permanently delete only codes that have never
been redeemed. Blocking a user revokes all device sessions. Access-code lookup keeps the
existing keyed HMAC identifier; retrievable copies use AES-256-GCM with
`TROCODE_ACCESS_CODE_ENCRYPTION_KEY`. During the Node-to-Rust cutover only, an
unset encryption key falls back to the session HMAC key so codes written by the
brief Node admin release remain retrievable; production should set a separate
32+ character encryption key before creating new codes.

## Railway

The root `railway.json` is the default API deployment config; the API and worker
also have explicit configs under `apps/` for services that use custom config
paths. The API image contains `tro-migrate` and runs it as its pre-deploy
command. The worker uses the same PostgreSQL and private S3 variables but
exposes no public port.

See [API cutover](docs/runbooks/rust-api-cutover.md),
[desktop cutover](docs/runbooks/rust-desktop-cutover.md),
[architecture](docs/architecture.md), and [security](docs/security.md).
