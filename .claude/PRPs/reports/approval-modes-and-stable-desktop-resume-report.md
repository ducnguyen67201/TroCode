# Implementation Report: Approval Modes and Stable Desktop Resume

## Summary

Implemented two trusted action-approval modes, immutable task-contract v5,
mode-aware host policy, deterministic target-aware approval resume, a
non-activating cursor approval card, and an acknowledged Settings control.
Full mode removes only per-action prompts; every hard policy, budget,
grounding, cancellation, post-action verification, and unknown-outcome
invariant remains active. Stable-state validation is local and adds no LLM
call.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---:|---:|
| Complexity | Large | Large |
| Confidence | 9/10 | 9/10 after automated gates |
| Files Changed | 27-31 | 37 implementation files, including preserved cursor-card work |

## Tasks Completed

| # | Task | Status | Notes |
|---:|---|---|---|
| 1 | Record regression specification and tests | Complete | RED cases were specified in the plan before coding; consolidated execution followed the PRP skill. |
| 2 | Add v5/contracts/preferences | Complete | Missing/old preferences default to Ask; v2-v4 tasks resolve to Ask. |
| 3 | Persist and snapshot trusted mode | Complete | `TaskApplicationService` reads main-process preferences before submit. |
| 4 | Add mode-aware pure policy | Complete | Allowed decisions explicitly audit `not_required` or `task_preapproved`. |
| 5 | Preserve unknown-outcome safety | Complete | Unknown task-preauthorized actions block and clean up without retry. |
| 6 | Add target-aware validator | Complete | Exact fast path plus crop/path/global grayscale-edge signatures; fail closed. |
| 7 | Integrate held reference evidence | Complete | The held action retains its exact reference observation and validates before grant consumption. |
| 8 | Keep cursor card non-activating | Complete | Focusability always remains false; mouse passthrough alone is toggled. |
| 9 | Add Settings UX | Complete | Ask default, Full warning/acknowledgement, English/Vietnamese copy, future-task semantics. |
| 10 | Documentation and release validation | Complete | Architecture/security/lifecycle/testing docs updated; automated gates pass. |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static analysis | Pass | ESLint passed; TypeScript passed after one narrowing-only correction. |
| Unit/integration tests | Pass | 69 Vitest files / 407 tests, 6 script tests, 23 API tests. |
| Build/package | Pass | Electron Forge packaged `out/TroCode-darwin-arm64/TroCode.app`. |
| Dependency/diff safety | Pass | No dependency changes; `git diff --check` clean; focus/hash safety greps clean. |
| Manual cross-app matrix | Pending release QA | Gmail/high-DPI/multi-display/Windows/Wayland checks require interactive packaged testing. |

## Files Changed

| Area | Action | Files |
|---|---|---:|
| Shared contracts and task authority | Updated | 8 |
| Execution policy/coordinator and tests | Updated | 6 |
| Desktop-state validator | Created | 2 |
| Preferences/application/IPC and tests | Updated | 6 |
| Non-activating presentation helper | Created | 2 |
| Cursor approval presentation baseline | Preserved and extended | 6 |
| Settings/localization and tests | Updated | 5 |
| Architecture/security/testing documentation | Updated/created | 7 |

## Deviations from Plan

- Added a small `non-activating-window` presentation helper and unit test so
  the no-focus invariant is testable outside the Electron entry module.
- Did not pull/rebase the remote because this feature worktree already
  contained user-owned dirty cursor-card changes that the plan explicitly
  required preserving.
- `docs/CODEX-NAVIGATION-GUIDE.md` was absent, as already noted in the plan.
- Separate RED execution was not performed during coding because the selected
  `/prp-implement` workflow requires one consolidated validation pass. The plan
  and new regression assertions preserve the RED specification.
- Interactive packaged cross-application testing remains a release-QA step;
  automated and package gates do not claim to verify OS focus behavior on every
  supported window manager.

## Issues Encountered

- TypeScript initially needed the policy result split into three truly
  discriminated variants; fixed and the failed typecheck was rerun successfully.
- One Settings static-markup assertion depended on HTML attribute order; the
  test was corrected to assert behavior independent of serialization order.

## Tests Written

| Test area | New cases | Coverage |
|---|---:|---|
| Contracts/preferences/application/IPC | 6 | Defaults, v5, forged/invalid mode, trusted snapshot, read failure |
| Policy/runtime | 8 | Ask, Full audit, hard denials, no fake grant, immutable task mode |
| Desktop validator | 8 | Exact, noise, unrelated/target/drag/global change, fail-closed evidence, thresholds |
| Coordinator | 3 | Stable resume, Full verified dispatch, unknown Full block |
| Presentation/Settings | 5 | Non-focusable toggles, default Ask, Full warning, localization |

## Next Steps

- Run the packaged manual matrix in
  `docs/testing/approval-mode-and-stable-resume.tdd.md` before release.
- Review the complete diff, then create a pull request when ready.
