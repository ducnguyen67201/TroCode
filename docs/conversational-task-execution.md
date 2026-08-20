# Conversational task execution

Each task runs in a bounded, host-owned Rust loop over the hosted Responses
proxy. The renderer submits validated requests and displays projections; it does
not own model sessions, tool registration, policy, approval, or execution.

```text
user request -> Rust Responses client
  final text -> completed task
  function call -> registered Rust tool
    routine and valid -> execute once
    exact approval required -> pause for matching single-use digest
    clarification required -> pause for one bounded user answer
    validation/stale-state rejection -> tool output, then continue
    unknown consequential outcome -> stop without retry
```

The loop is serial (`parallel_tool_calls=false`), uses `store=false`, and is
bounded by wall time, 48 model samples, 40 tool calls, 64 session items, argument
bytes, output bytes, and total session bytes. Clarification answers and queued
steering enter the same conversation at a safe model boundary.

Consequential actions show the exact bounded arguments and an action digest.
Approval covers one proposed operation only. Denial becomes a tool result so
the assistant can continue without executing it. Workspace writes, deletes,
and commands require approval; paths remain under a selected canonical root and
subprocesses receive a secret-free environment.

Desktop tools require a current observation ID and fingerprint. The host checks
the screen again after approval and dispatches nothing if it changed. Provider
or action outcomes that may have been admitted are terminal by design.

Only the newest screenshot is included in a model request. Prompts, responses,
screenshots, file contents, commands, and raw tool arguments are excluded from
structured logs and desktop analytics.
