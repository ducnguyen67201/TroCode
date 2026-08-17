# Implementation Report: Codex-Style Unified GPT Agent Loop

## Summary

TroCode now sends each task directly into one persistent OpenAI Responses
session. GPT can finish with an ordinary assistant message or request one
host-advertised tool. The Electron main process parses, normalizes,
policy-checks, approves when necessary, executes, and returns each result to the
same session.

New tasks use host-owned contract v3 and real tool-call progress. Text work does
not start CUA. Desktop work starts lazily, requires fresh observation IDs,
returns a post-action screenshot, invalidates approvals after screen changes,
and prevents exact re-dispatch after unknown outcomes. The renderer is
text-first, optional computer access is user-clicked, and history/insights now
show tools instead of semantic grants.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | XL | XL |
| Confidence | 9/10 | 9/10 |
| Files Changed | 45–55 | 78 working-tree paths including preserved concurrent UI/localization work |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | General-purpose evaluation matrix | Complete | Covers multilingual text, desktop, interaction, approval, stale screen, and permission cases. |
| 2 | v3 host contracts and progress | Complete | v1/v2 persistence remains readable. |
| 3 | Model/tool boundary contracts | Complete | Bounded assistant/function-call parsing; old forced decision protocol removed. |
| 4 | Persistent Responses agent | Complete | Auto tool choice, serialized calls, local bounded history, reasoning-item continuity, fallback, no server storage. |
| 5 | Trusted tool router | Complete | Strict model specs, trusted IDs, duplicate rejection, optional provider proof. |
| 6 | Sample-first coordinator | Complete | Lazy CUA, tool outputs, clarification resume, exact approval, screen freshness, unknown no-repeat. |
| 7 | Concrete-call policy | Complete | Registry and public HTTPS checks retained; semantic grants removed. |
| 8 | Main/IPC simplification | Complete | One Responses agent; direct runtime submit/respond; narrow DesktopApi preserved. |
| 9 | Text-first readiness | Complete | Optional microphone/CUA no longer gate text; Connect computer is explicit and recoverable. |
| 10 | History, insights, analytics | Complete | v3 tool usage and count-only analytics; legacy behavior displayed only for old tasks. |
| 11 | Old stack deletion | Complete | Compiler, submission service, planners, keyword router, old guidance shortcuts, and unused Vision helper removed. |
| 12 | Documentation and verification | Complete | README and architecture/security/lifecycle docs describe the unified loop. |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static analysis | Pass | ESLint and `tsc --noEmit` pass. |
| Unit tests | Pass | 52 files, 284 tests. |
| Build | Pass | Electron Forge packaged arm64 macOS successfully through the production Doppler config. |
| Integration | Pass | Coordinator integration tests exercise assistant-only, desktop, clarification, approval, stale approval, and missing-permission flows. |
| Edge cases | Pass | Malformed/multiple calls, private URLs, exact digests, cancellation, missing provider, fallback, and legacy history are covered. |
| Diff review | Pass | `git diff --check` clean; no package dependency changes. |

## Principal Files Changed

| File/group | Action | Purpose |
|---|---|---|
| `src/main/agent/agent-contracts.ts` | Created | Responses message, function-call, output, and invocation boundaries. |
| `src/main/agent/responses-agent.ts` | Created | Persistent assistant-or-tool model session. |
| `src/main/agent/runtime-tool-registry.ts` | Rewritten | Model-visible specs, strict parsing, normalization, trusted identity. |
| `src/main/agent/runtime-tool-dispatcher.ts` | Rewritten | Generic resolved-invocation dispatch. |
| `src/main/agent/execution-coordinator.ts` | Rewritten | Serialized sample/tool/result loop and safety invariants. |
| `src/main/agent/task-runtime.ts` | Rewritten | Direct v3 lifecycle, interactions, approvals, and tool progress. |
| `src/shared/contracts.ts` | Updated | v2/v3 union, v3 progress, tool event metadata. |
| `src/index.ts`, `src/main/ipc/register-ipc.ts` | Updated | Unified-agent construction and direct runtime IPC. |
| `src/renderer/*` | Updated | Text-first readiness, optional computer connection, v3 live/history/insights UI. |
| `src/main/analytics/*` | Updated | Count/ID-only model and tool analytics. |
| `README.md`, `docs/*`, `.env.example` | Updated | Unified architecture and agent configuration. |
| Old compiler/planner/router files | Deleted | Removed superseded two-stage semantic routing and forced-decision protocols. |

## Deviations from Plan

- Missing desktop permission uses the existing typed clarification interaction
  with `Connect computer` and `Continue without computer access` choices instead
  of adding another renderer IPC or a new interaction union member. This keeps
  the public API narrow while safely resuming the held observation call.
- The old macOS Vision numbered-guidance helper and J/K/L walkthrough transport
  were removed with the forced planner. The new `show_guidance` call is one
  atomic screenshot-grounded tool call and does not keep the old planner-owned
  sequence state.
- Manual GUI exercises were represented by deterministic coordinator and
  renderer tests in this pass; the packaged application was built successfully.

## Issues Encountered

- Initial consolidated lint found one type-import rule, import ordering, and
  unused fake parameters; fixed and lint rerun cleanly.
- Type checking exposed an over-narrow mock and generic tool-definition
  variance; the mock was typed to `CuaStatus` and tool definitions now use
  method signatures that preserve typed implementations.
- One stale-approval assertion stringified an image-content array incorrectly;
  the fixture assertion was corrected and the full test suite passed.
- Concurrent UI localization/voice-island edits present in the shared worktree
  were preserved and included in the successful check/package validation.

## Tests Written or Replaced

| Test file | Coverage |
|---|---|
| `src/main/agent/agent-contracts.test.ts` | Assistant/function parsing, reasoning preservation, malformed/multiple calls. |
| `src/main/agent/responses-agent.test.ts` | Request shape, continuation, exact call IDs, fallback, auth. |
| `src/main/agent/agent-eval.test.ts` | General text/music and desktop-tool evaluation matrix. |
| `src/main/agent/execution-coordinator.test.ts` | Full unified loop, lazy CUA, post-action screenshot, clarification, approval, permission. |
| `src/main/agent/runtime-tool-registry.test.ts` | Specs, trusted identity, freshness, duplicates, optional music provider. |
| `src/main/agent/task-runtime.test.ts` | v3 lifecycle, progress, interaction, approval, steering, cancellation. |
| `src/shared/contracts.test.ts` | v1/v2/v3 mixed persistence and progress. |
| Renderer/history/insights/analytics tests | Text-first start, tool usage, privacy-safe metadata. |

## Next Steps

- [ ] Review the branch with `/code-review`.
- [ ] Exercise the packaged app once with real macOS permissions and a live API key.
- [ ] Create a pull request with `/prp-pr` after review.
