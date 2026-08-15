# Computer-use lifecycle

## Goal contract

A goal is an outcome plus proof. It is not a list of clicks.

Every `GoalSpec` contains:

- Domain and interaction mode.
- Natural-language objective.
- Observable success criteria and verifier descriptions.
- Granted capabilities.
- Allowed applications, domains, and paths.
- Actions that always require user approval.
- Step and time budgets.

The goal, scope, and limits are immutable during one execution. A planner may revise its route but cannot widen its own authority.

## Task states

```text
idle
  -> interpreting
  -> clarifying | ready
  -> awaiting_approval | planning
  -> observing
  -> acting
  -> verifying
  -> completed | blocked | failed | cancelled
```

Invalid transitions throw instead of being silently accepted. In particular, an idle task cannot jump directly to `acting`, and terminal states cannot restart.

## Execution loop

Once a model provider and executor are added, one computer-use iteration will be:

1. Re-read the current goal and remaining budget.
2. Observe the exact target window.
3. Propose one typed action.
4. Evaluate capability, resource, and approval policy.
5. Ask the user if approval is required.
6. Execute the action through CUA.
7. Inspect the structured result and verification metadata.
8. Re-observe when an action is not verified.
9. Run the independent goal verifier.
10. Continue, re-plan, block, fail, or complete.

Accessibility element actions should be preferred. Pixel or foreground actions are escalation paths, not the default. Non-idempotent actions with unknown completion must not be retried automatically.

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
