# Rust migration parity matrix

Baseline: `12e4cb14144767c5adda7b3bbb5a80ac46adf958` (PR #9, secure admin PR #10,
access-code lifecycle PR #11, and latest `main`).
Statuses are `fixture`, `implemented`, `verified`, and `cutover`. Every row is
owned by a Rust crate and has a release gate.

## Hosted HTTP

| Contract | Owner | Compatibility proof | Gate | Status |
|---|---|---|---|---|
| `GET /healthz` | `tro-api` | status/body/security headers | API | fixture |
| `GET /readyz` | `tro-api`, `tro-persistence` | schema/database readiness | API | fixture |
| `POST /v1/auth/google/exchange` | `tro-api` | bounded JSON, Google claims, opaque session | API | fixture |
| `POST /v1/auth/session/refresh` | `tro-api` | rotation invalidates prior token | API | fixture |
| `DELETE /v1/auth/session` | `tro-api` | revocation and idempotent response | API | fixture |
| `GET /v1/access-code-redemptions/me` | `tro-api` | auth, current plan snapshot | API | fixture |
| `POST /v1/access-code-redemptions` | `tro-api` | capacity lock and error codes | API | fixture |
| `POST /v1/agent-turns` | `tro-api` | request/task idempotency and call cap | API | fixture |
| `POST /v1/openai/responses` | `tro-providers`, `tro-api` | byte/event-ordered SSE and settlement | API | fixture |
| `GET /v1/usage/budget` | `tro-domain`, `tro-api` | exact integer counters/limits | API | fixture |
| `POST /v1/openai/audio/transcriptions` | `tro-providers` | WAV parsing, v1/v2 headers, multipart | API | fixture |
| `POST /v1/openai/realtime/calls` | `tro-providers` | admission and uncertain dispatch | API | fixture |
| `POST /v1/elevenlabs/speech` | `tro-providers` | bounded MP3 streaming | API | fixture |
| `GET /v1/capabilities` | `tro-knowledge` | plan-derived Knowledge limits | Knowledge | fixture |
| `GET /source/admin` and assets | `tro-api` | static page, strict CSP, no embedded secret | API | fixture |
| `POST,DELETE /v1/admin/session` | `tro-api` | bearer exchange, signed hardened cookie, expiry | API | fixture |
| `GET /v1/admin/users` | `tro-api` | bounded search/status/page projection | API | fixture |
| `PATCH /v1/admin/users/:user/access` | `tro-api` | block audit and immediate session revocation | API | fixture |
| `GET /v1/admin/access-codes` | `tro-api` | bounded filters and authenticated retrieval | API | fixture |
| `GET /v1/admin/access-codes/:code/users` | `tro-api` | bounded redemption roster | API | fixture |
| `POST /v1/admin/access-codes/bulk` | `tro-api` | 1-100 codes, HMAC digest, AES-GCM copy, audit | API | fixture |
| `PATCH,DELETE /v1/admin/access-codes/:code` | `tro-api` | pause/resume audit, paused admission denial, delete-only-unredeemed | API | verified |
| `GET,POST /v1/spaces` | `tro-knowledge` | owner list/create semantics | Knowledge | fixture |
| `POST /v1/space-invites/redeem` | `tro-knowledge` | one-use/capacity transaction | Knowledge | fixture |
| `GET /v1/spaces/:space` | `tro-knowledge` | membership-scoped summary | Knowledge | fixture |
| `GET /v1/spaces/:space/sources` | `tro-knowledge` | source metadata only | Knowledge | fixture |
| `POST /v1/spaces/:space/uploads/initiate` | `tro-knowledge` | quota, object key, presign headers | Knowledge | fixture |
| `GET,POST /v1/spaces/:space/groups` | `tro-knowledge` | list/create and member bounds | Knowledge | fixture |
| `GET /v1/spaces/:space/members` | `tro-knowledge` | role-scoped roster | Knowledge | fixture |
| `POST /v1/spaces/:space/invites` | `tro-knowledge` | owner permission and expiry | Knowledge | fixture |
| `POST /v1/uploads/complete` | `tro-knowledge` | HEAD checksum/size/media reconciliation | Knowledge | fixture |
| `POST /v1/spaces/:space/activities` | `tro-knowledge` | strict draft version | Knowledge | fixture |
| `POST /v1/spaces/:space/activities/:activity/publish` | `tro-knowledge` | immutable published version | Knowledge | fixture |
| `POST /v1/spaces/:space/runs` | `tro-knowledge` | assignment snapshot | Knowledge | fixture |
| `POST /v1/spaces/:space/runs/:run/open` | `tro-knowledge` | lifecycle transition | Knowledge | fixture |
| `POST /v1/spaces/:space/runs/:run/close` | `tro-knowledge` | lifecycle transition | Knowledge | fixture |
| `GET /v1/assignments/me` | `tro-knowledge` | participant-only assignments | Knowledge | fixture |
| `GET /v1/attempts/:attempt` | `tro-knowledge` | immutable context projection | Knowledge | fixture |
| `GET /v1/attempts/:attempt/starter-files` | `tro-knowledge` | short-lived private downloads | Knowledge | fixture |
| `POST /v1/attempts/:attempt/submissions/initiate` | `tro-knowledge` | exact-file upload admission | Knowledge | fixture |
| `POST /v1/attempts/:attempt/submissions/commit` | `tro-knowledge` | HEAD reconciliation and event | Knowledge | fixture |
| `POST /v1/attempts/:attempt/acknowledge` | `tro-knowledge` | policy acknowledgement | Knowledge | fixture |
| `POST /v1/attempts/:attempt/help` | `tro-knowledge` | bounded help event | Knowledge | fixture |
| `POST /v1/attempts/:attempt/work-sessions` | `tro-knowledge` | session start and ownership | Knowledge | fixture |
| `PATCH /v1/work-sessions/:session` | `tro-knowledge` | bounded progress update | Knowledge | fixture |
| `POST /v1/attempts/:attempt/knowledge/search` | `tro-knowledge` | attempt authorization, `simple` ranking | Knowledge | fixture |
| `POST /v1/attempts/:attempt/evidence` | `tro-knowledge` | allowlist/bounds/provenance | Knowledge | fixture |
| `GET /v1/spaces/:space/runs/:run/dashboard` | `tro-knowledge` | event projection and row bounds | Knowledge | fixture |

All HTTP routes additionally prove: origin rejection, fixed security headers,
request IDs, strict content type, declared and actual body caps, generic public
errors, sanitized logs, rate limits, cancellation, and graceful drain.

## Desktop queries and mutations

| `DesktopApi` contract | Rust owner | Gate | Status |
|---|---|---|---|
| membership activate/status | `tro-desktop-core` | Desktop | fixture |
| task submit/start/steer/respond/approve/cancel/history | `tro-agent`, `tro-desktop-core` | Agent | fixture |
| update status/check/install | `src-tauri` | Release | fixture |
| voice configure/status/transcribe/record/diagnostic/duck | `tro-desktop-core` | Desktop | fixture |
| CUA connect/status/open permission settings | `tro-cua`, `src-tauri` | Native | fixture |
| preferences get/update | `tro-desktop-core` | Desktop | fixture |
| usage budget | `tro-desktop-core` | Desktop | fixture |
| auth sign-in/status/sign-out | `tro-desktop-core` | Desktop | fixture |
| workspace availability/select | `tro-desktop-core` | Workspace | fixture |
| Knowledge capabilities/spaces/sources/files/uploads | `tro-desktop-core` | Knowledge | fixture |
| Knowledge activities/runs/assignments/attempt/dashboard | `tro-desktop-core` | Knowledge | fixture |
| Knowledge groups/invites/help/submission/starter | `tro-desktop-core` | Knowledge | fixture |
| companion state/voice/reveal/response/playback | `src-tauri` | Native | fixture |

Every command is tested with a valid payload, invalid payload, unknown fields,
size/range boundary, unauthenticated state, and a disallowed invoking window.

## Ordered renderer events

| Event | Owner | Proof | Status |
|---|---|---|---|
| task update and composer focus | `tro-agent`, `src-tauri` | order, unsubscribe, task scope | fixture |
| agent activity | `tro-agent`, `src-tauri` | allowlisted payload | fixture |
| update status | `src-tauri` | lifecycle sequence | fixture |
| voice shortcut | `tro-desktop-core`, `src-tauri` | active-window/task rules | fixture |
| companion position/guidance/visual/interaction/response/speech/state/voice | `src-tauri` | order, window scope, cleanup | fixture |

## Native surfaces and authority

| Surface | Owner | Gate | Status |
|---|---|---|---|
| main window | `src-tauri` | Native | fixture |
| companion window | `src-tauri` | Native | fixture |
| voice island | `src-tauri` | Native | fixture |
| guidance target and guidance overlay | `src-tauri` | Native | fixture |
| control indicator | `src-tauri` | Native | fixture |
| tray/menu/single instance/background lifecycle | `src-tauri` | Native | fixture |
| Escape cancel, voice and numbered-choice shortcuts | `src-tauri` | Native | fixture |
| private one-use narration delivery | `tro-desktop-core` | Native | fixture |
| CUA semantic/accessibility/vision routes | `tro-cua` | Native | fixture |
| exact approval revalidation and unknown result | `tro-agent` | Agent | fixture |
| Stronghold secrets and authenticated bridge/sign-in | `src-tauri` | Release | fixture |
| updater/signing/notarization/MSIX | `src-tauri` | Release | fixture |

## Persistence and operations

| Contract | Owner | Proof | Status |
|---|---|---|---|
| SQL migrations 001-013 and 31-table schema | `tro-migration` | ordered migration test plus empty/populated fingerprints | implemented |
| one SeaORM pool per process | `tro-persistence` | dependency/config review | fixture |
| reservation locks and usage ledger | `tro-persistence` | concurrent PostgreSQL tests | fixture |
| ingestion claim/reclaim/finalize | `tro-persistence`, `tro-worker` | multi-worker tests | fixture |
| S3 presign/HEAD/checksum/private bytes | `tro-knowledge` | disposable object store | fixture |
| access-code administration and encrypted retrieval | `tro-api`, `tro-admin` | HTTP/CLI snapshots and cipher fixtures | fixture |
| membership keygen/issue | `tro-admin` | signature fixture | fixture |
| Knowledge smoke/load reports | `tro-admin` | safe local harness | fixture |
| runtime/dependency reports | `tro-admin` | deterministic CLI output | fixture |
| Railway API/worker/migrator | `apps/*` | health, migration, rollback drill | fixture |

## Sanitized fixture rules

Fixtures may contain deterministic UUIDs, enum values, counts, timestamps, and
synthetic public hostnames. They must never contain provider credentials, device
tokens, OAuth material, prompts, output, transcripts, screenshots, local paths,
object keys, signed URLs, raw tool arguments, or command text. A checked-in
fixture is immutable unless both implementations and this matrix explain the
contract change.
