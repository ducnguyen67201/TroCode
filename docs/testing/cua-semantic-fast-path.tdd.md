# CUA semantic fast path verification

## Scope

This change keeps one Agents SDK harness and adds a capability-gated semantic
route before the existing desktop screenshot route. It covers browser state,
native accessibility state, opaque element references, exact approval rebind,
one-use browser authorization, privacy-safe metrics, and deterministic fallback.
Every CUA task starts in hardcoded Auto scope; regression coverage verifies that
semantic observation remains window-scoped and desktop fallback escalates before
desktop capture or coordinate actions.

## Automated evidence

The focused suites cover capability parsing, bounded normalization, window
selection, browser/native action dispatch, stale reference rejection,
authorization default-deny behavior, semantic tool schemas, risk escalation,
analytics privacy, and benchmark threshold calculation. Final `npm run check`
and `npm run package` results are recorded in the implementation report.

## Repeatable performance procedure

Use the same release build and record its Git commit, operating system/version,
CPU architecture, and reported CUA driver/contract versions. For each
configuration, discard three warm-up runs, then collect at least 20 runs per
scenario. Alternate baseline and candidate configurations to avoid comparing a
cold baseline with a warmed candidate.

Run this fixed order:

1. LeetCode/Replit browser editor: observe code and click one routine control.
2. Jupyter browser notebook: observe the active cell and run one routine cell.
3. VS Code saved file: observe the active editor and focus one named control.
4. Native application form: observe, type reversible text, and verify it.
5. Canvas-only or ambiguous surface: confirm deterministic vision fallback.
6. Consequential browser action: approve once, revalidate, and execute once.
7. Changed target after approval: confirm `not_executed` and no retry.

Capture the baseline from the last desktop-only build and the candidate from
the current build on the same machine. Capture only `[cua] performance` log
lines and produce the gate table with:

```bash
npm run cua:report -- --baseline artifacts/cua-baseline.log --candidate artifacts/cua-candidate.log
```

The report fails unless p50 is at most 70% of baseline, p95 at most 80%, desktop
vision and screenshot-bearing operations are each reduced by at least 75%, and
the confirmed-operation rate regresses by no more than two percentage points.
Logs containing any non-allowlisted field are rejected.

## Manual release matrix

Before release, run the complete scenario set in development and a
packaged macOS build, verify the configured native callback bridge outside
ASAR, and run the supported subset in a packaged Windows build. Linux remains
capability/fallback-tested according to the driver and CI environment. Record
the build hash and result table with the release artifact; these OS-level tests
cannot be proven by repository unit tests alone.
