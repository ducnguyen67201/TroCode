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
| Missing, degraded, mismatched, undecodable, and invalid evidence fails closed | `src/main/agent/desktop-state-validator.test.ts` |
| Cursor input never makes the approval window focusable | `src/main/presentation/non-activating-window.test.ts` |
| Settings shows both modes and requires the Full acknowledgement | `src/renderer/SettingsPage.test.ts` |

## Validation record

- ESLint: PASS.
- TypeScript: PASS after correcting a policy-union narrowing annotation.
- Vitest: PASS, 69 files / 407 tests.
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
