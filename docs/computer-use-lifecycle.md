# Computer-use lifecycle

## Goal contract

A goal is an outcome plus proof. It is not a list of clicks.

Every active `TaskContract` v2 contains:

- `answer`, `guide`, or `act` behavior.
- Natural-language objective.
- Observable success criteria and verifier descriptions.
- Actions that always require user approval.
- Step and time budgets.

The contract and limits are immutable during one execution. Tools come from the
trusted runtime registry, not the request. A planner may revise its route but
cannot register a tool or widen its own authority.

## Task states

```text
idle
  -> interpreting
  -> clarifying | ready
  -> awaiting_approval | planning
  -> observing | awaiting_input
  -> acting
  -> verifying
  -> completed | blocked | failed | cancelled
```

Invalid transitions throw instead of being silently accepted. In particular, an idle task cannot jump directly to `acting`, and terminal states cannot restart.

`clarifying` completes an underspecified goal before compilation. `awaiting_input`
pauses an already-compiled running task for a task-scoped answer. Free-form
answers and exact approvals use separate contracts. After either interaction,
the task returns to `observing`; it never resumes directly into `acting`.
Steering received while a task is running is queued without interrupting an
atomic action. It invalidates any unconsumed approval and requires goal review
at the next safe boundary before the task re-observes.

## Execution loop

The implemented computer-use iteration is:

1. Re-read the current goal and remaining budget.
2. Capture a fresh desktop observation through the task-scoped CUA session.
3. Ask the GPT Responses visual manager for a typed function-call decision, or
   advance the next host-owned item in a validated static guidance plan.
   Guide-mode points stop at a host-owned playback boundary: autoplay advances
   after 15 seconds, J replays the previous cached point, K pauses/resumes, and
   L advances. Cached replay does not invoke the model or increment progress.
4. Validate the registered tool operation, target, consequence, and approval policy.
5. Ask the user if approval is required.
6. Dispatch the action once through its registered adapter.
7. Inspect CUA delivery/effect metadata.
8. Stop without retry when completion is unknown.
9. Re-observe and let the latest screenshot prove progress or completion.
10. Continue, ask, block, fail, or complete.

The current vertical slice supports coordinates, typing, keypresses, scrolling,
dragging, and direct public HTTPS navigation. Accessibility element actions and app-specific
independent verifiers remain the next hardening step. Non-idempotent actions
with unknown completion are never retried automatically.

## Tool result contract

Every agent-facing adapter should normalize results to:

```ts
interface ToolResult {
  status: 'success' | 'warning' | 'error';
  summary: string;
  nextActions: string[];
  artifacts: string[];
}
```

Errors additionally need a root-cause hint, a safe retry instruction, and an explicit stop condition.

## Initial evaluation set

Before broad execution is enabled, add repeatable evaluations for at least:

1. Guide the user to open YouTube without clicking.
2. Open YouTube after an explicit action request.
3. Refuse navigation outside the allowed domain.
4. Require approval before sending a message.
5. Cancel during observation.
6. Recover from a stale accessibility element.
7. Stop after the action budget is exhausted.
8. Complete a coding task using files and tests rather than desktop clicks.
