# Implementation report: Cost-aware inference and presentation architecture

## Outcome

Implemented the cost-aware inference architecture across the Electron desktop
and hosted API. Production Responses calls now have a request UUID, task UUID,
server-owned price version, atomic pre-dispatch reservation, actual token
settlement, sanitized immutable usage record, and task/day/month enforcement.
The desktop no longer broadly falls back to Terra after an ambiguous call.

The implementation replaces the monolithic `GptResponsesAgent` with an
object-oriented application shell (`CostAwareAgent`, `InferenceOrchestrator`,
`InferenceSession`, gateway, application service, budget service, presentation
coordinator) and pure policies for profiles, context, fallback, completion
review, and presentation state.

## What changed

- Added versioned integer micro-USD price calculation for GPT-5.6 Luna and
  Terra, including ordinary input, cached input, cache writes, and output.
- Added PostgreSQL reservations and append-only sanitized usage events with
  per-user transaction locks, idempotent settlement, explicit release, and
  retained uncertain reservations.
- Added configurable `$0.50` task, `$2.00` daily, and `$20.00` monthly defaults,
  observe/enforce modes, 80% warning threshold, and paid-call kill switch.
- Delegated the hosted Responses route to `OpenAiResponsesService`; budget
  denial happens before upstream dispatch and ambiguous calls are not retried.
- Added authenticated `GET /v1/usage/budget` and narrow renderer IPC with
  settled, reserved/estimated, limit, and remaining micro-USD only.
- Added voice-lane accounting: Realtime session creation is explicitly
  estimated; speech settles from actual character count.
- Replaced the old agent transport with bounded inference classes. Normal and
  visual output caps are 2,000 tokens; long/quality profiles cap at 4,000.
- Luna is the default. Terra requires an explicit pre-dispatch quality override;
  the legacy fallback option is accepted only for configuration compatibility.
- Stabilized tool ordering, capped request context at 128 items, capped session
  memory, resized wide screenshots to 1,536 pixels/JPEG 72, allowed one current
  image per request, and demoted its bytes after one sample.
- Added task-contract v4 sample, image, tool, time, and micro-USD ceilings while
  retaining persisted v2/v3 compatibility.
- Made completion review selective for visible-context and outcome-critical
  tool tasks instead of charging every tool task for another full-context call.
- Added `TaskApplicationService` and main-owned seven-state presentation
  projection. Analytics no longer reveals or focuses windows.
- Added an Insights budget card and main-process budget attention projection.
- Added content-free offline cost fixtures, operational diagrams, security
  invariants, rollout controls, and environment documentation.

## Verification

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run test`: passed.
  - Vitest: 62 files, 340 tests passed.
  - Windows release metadata: 2 tests passed.
  - Hosted API: 16 tests passed.
- Targeted post-wiring regression: 3 files, 25 tests passed.
- `git diff --check`: passed.
- `npm run cost:report`: passed. Content-free modeled fixtures report:
  - text answer: 73% reduction
  - five-step visual task: 82% reduction
  - ambiguous provider failure: 91% reduction
- `npm run package`: could not start because this environment does not have the
  Doppler `tro-app/prd` project.
- `npm exec -- electron-forge package`: passed for macOS arm64, validating the
  same Forge build and package hooks without secret injection.

The cost fixture percentages are architecture-shape estimates, not a claim
about a production invoice. Observe-mode ledger totals must be compared with
provider billing before enforcement is enabled.

## Plan deviations and known rollout limits

- The worktree was on a detached Codex worktree commit, so branch pull/rebase
  was skipped to preserve the user's worktree state.
- Production Doppler injection was unavailable; direct Forge packaging passed.
- Realtime WebRTC currently exposes no authoritative duration usage to the API,
  so it is labeled and settled as an estimate. A later transport event should
  replace this with measured duration if the provider exposes it.
- The `$0.50` task tranche currently blocks and explains the next action. A
  signed explicit continuation-grant endpoint is not included; the monthly cap
  remains server-authoritative and cannot be changed by the renderer.
- Context is bounded by deterministic retention and image demotion. Semantic
  summarization is intentionally not added because it would require another
  model call and could erase task evidence.
- The legacy renderer `setCompanionState` IPC remains as a compatibility
  surface for one release, but the main renderer no longer calls it; task,
  voice, and budget projection is owned by `PresentationCoordinator`.

## Privacy review

The usage migration and repository contain no prompt, model-output, screenshot,
base64, URL, recipient, file-path, secret, reasoning-text, or raw-tool-argument
columns. Structured inference logs contain only request/response/task IDs,
lane/model/profile, token counts, image count, duration, usage source, and
integer cost.
