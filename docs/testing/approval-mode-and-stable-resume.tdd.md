# Approval modes and stable desktop resume — TDD evidence

## Scope

This change adds trusted Ask/Full approval modes, task-contract v5, a
non-activating cursor approval interaction, and deterministic target-aware
desktop-state validation. The validator is local structural comparison, not
semantic image understanding, and does not call an LLM.

## RED specification

The pre-change failures and required assertions were recorded in
`.claude/PRPs/plans/approval-modes-and-stable-desktop-resume.plan.md` before
implementation:

- new tasks had no approval-mode field and preferences could not persist one;
- every desktop mutation always requested approval, with no audited Full path;
- approval resume rejected every changed full-screen SHA-256 fingerprint;
- the cursor approval window became focusable for button input;
- Settings had no Full warning or acknowledgement boundary.

The `/prp-implement` workflow intentionally performs one consolidated test pass
after coherent coding, so a separate failing-suite execution was not run during
implementation. The plan and newly added regression cases are the RED record.

## Automated matrix

| Guarantee | Test target |
|---|---|
| Legacy v2-v4 tasks resolve to Ask; new tasks persist v5 mode | `src/shared/contracts.test.ts`, `src/main/agent/task-contract.test.ts` |
| Renderer task input cannot grant Full; main preferences select the mode | `src/shared/contracts.test.ts`, `src/main/application/task-application-service.test.ts` |
| Ask mutations require an exact grant; Full returns `task_preapproved` | `src/main/agent/policy.test.ts`, `src/main/agent/task-runtime.test.ts` |
| Full retains unavailable/private-target/self-approval denials | `src/main/agent/policy.test.ts` |
| Full dispatches once, re-observes, and blocks unknown outcomes | `src/main/agent/execution-coordinator.test.ts` |
| Exact matches fast-path without image decode | `src/main/agent/desktop-state-validator.test.ts` |
| Cursor noise/unrelated change stays stable; target/drag/global change blocks | `src/main/agent/desktop-state-validator.test.ts` |
| Model-resized screenshots retain desktop coordinates, scale target evidence, and do not produce a false dimension mismatch | `src/main/agent/desktop-state-validator.test.ts` |
| Missing, degraded, mismatched, undecodable, and invalid evidence fails closed | `src/main/agent/desktop-state-validator.test.ts` |
| Cursor input never makes the approval window focusable | `src/main/presentation/non-activating-window.test.ts` |
| Settings shows both modes and requires the Full acknowledgement | `src/renderer/SettingsPage.test.ts` |

## Validation record

- ESLint: PASS.
- TypeScript: PASS after correcting a policy-union narrowing annotation.
- Vitest: PASS, 69 files / 408 tests.
- Script tests: PASS, 6 tests.
- Hosted API tests: PASS, 23 tests.
- Electron Forge package: PASS for arm64 macOS; packaged output is
  `out/TroCode-darwin-arm64/TroCode.app`.
- Dependency review: PASS; no `package.json` or lockfile change.
- Safety grep: PASS; there is no `setFocusable(true)` approval path and no
  direct full-screen fingerprint inequality used as the resume decision.

## Packaged manual matrix

- Save Ask, restart, and verify the next task displays the cursor approval chat.
- Approve in Gmail while the target app remains active; confirm one dispatch.
- Repeat with cursor movement, clock ticks, hover shimmer, and harmless animation.
- Move, obscure, or materially change the target; confirm no dispatch and one block.
- Save Full only after acknowledgement; restart and verify a new task skips prompts.
- Confirm an already-running task retains the mode captured when it started.
- In Full, verify private URLs, TroCode self-approval, Stop/Escape, budgets, and
  unknown outcomes remain blocked.
- Check high-DPI/multi-display coordinates on packaged macOS and Windows.
- Record Wayland inactive-window limitations rather than making the card focusable.
- Inspect logs/history/analytics for absence of screenshots, bitmaps, signatures,
  target text, and action payloads.

Manual packaged cross-application validation is required before release and is
not represented as completed by the unit/package gates alone.

## Resized-evidence runtime regression — 2026-08-18

### User journey

As a user approving a grounded desktop action on a high-DPI display, I want
TroCode to compare the intended target in the resized evidence it retained, so
that an unchanged target executes once without revealing the main window.

### Failure capture and RED

The live validator reported `dimension_mismatch` after approval. CUA metadata
described the original 3456×2234 capture, while the cost-aware model evidence
had intentionally been resized to 1536 pixels wide. The validator treated that
expected representation difference as a changed desktop.

`npx vitest run src/main/agent/desktop-state-validator.test.ts` executed the new
resized-evidence case and failed with the expected mismatch; the other eight
validator cases passed. Commit `dc3f7af` preserves the RED reproducer.

### Recovery and GREEN

The validator now requires equal decoded dimensions across the reference and
current samples, verifies that each decoded image preserves the declared
desktop aspect ratio, and scales the bounded target rectangle from desktop
coordinates into the decoded image before generating its signature. Genuine
coordinate-space, decoded-size, aspect-ratio, target, and evidence failures
continue to fail closed.

`npx vitest run src/main/agent/desktop-state-validator.test.ts` passed 9/9.
Commit `8cf5a42` preserves the GREEN implementation.

### Verification

| Guarantee | Command | Result |
|---|---|---|
| Resized stable evidence is accepted and a resized target change is rejected | `npx vitest run src/main/agent/desktop-state-validator.test.ts` | PASS, 9/9 |
| Changed validator meets the local coverage target | `npm run test:coverage -- src/main/agent/desktop-state-validator.test.ts` | PASS, 97.14% statements / 98.96% lines |
| Repository quality gates remain green | `npm run check` | PASS, 69 Vitest files / 408 tests, 6 script tests, 23 API tests |
| The production Electron configuration packages successfully | `npm run package` | PASS, arm64 macOS |

The targeted coverage command reports 8.81% across all files included by the
repository coverage configuration because only one test file was selected;
the changed validator itself is above the 80% requirement. A packaged manual
Gmail approval remains a release QA check.
