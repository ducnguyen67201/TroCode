# Plan: User-Instruction Intent Authorization

> Completed on 2026-08-21. See `.claude/PRPs/reports/user-instruction-intent-authorization-report.md` and `docs/testing/user-instruction-intent-authorization.tdd.md` for implementation and validation evidence. Live external-integration and production-canary checks remain rollout gates.

## Summary

Make Tro easy to test and operate by treating the user's explicit instruction as bounded authorization for the reversible work it directly requests. Balanced mode should continue through routine UI actions, creation and editing of private resources, and safe Workspace work without repeatedly asking for permission; Tro should still require an exact approval for communications, deletion or archival, unexpected overwrite, publication or deployment, money or trading, credentials, OS permissions, installation, sensitive data transfer, and material scope expansion.

This is a focused policy evolution on top of the completed durable-agent runtime in `.claude/PRPs/plans/completed/codex-level-verified-durable-agent-runtime.plan.md`. It preserves the existing exact-action approval digest, fresh-observation checks, outcome verification, durable Agents SDK checkpoints, and the rule that a consequential action with an unknown outcome is never blindly retried. It also fixes the current runtime-tool-registry wiring defect that prevents the calendar test from reaching execution.

The product invariant is:

> A trusted user instruction may authorize only an in-scope, typed effect that the instruction directly requests. It never authorizes a broader target, a high-risk effect, an untrusted page instruction, or a retry after an unknown outcome.

## User Story

As a Tro user, I want one clear instruction to authorize the ordinary reversible work needed to complete my task, so that Tro actively performs and verifies the task without making me approve every click, command, or edit.

## Problem -> Solution

Tro currently maps broad action labels such as `submit`, `run_command`, and `write_file` directly to a global always-confirm list. That makes an explicitly requested calendar creation, Workspace patch, or safe verification command pause for approval even though the user already asked Tro to do it. In the reported calendar trace, execution fails even earlier because the `TaskRuntime` policy owns a different tool registry from the coordinator and hosted desktop worker.

Replace the global action-label gate with a typed effect and bounded intent-authorization contract. Compile grants exclusively from trusted user-authored request and steering text, match normalized effects against those grants in the host policy, and keep approval requirement separate from consequential/unknown-result handling. Wire one shared tool registry through every local authority boundary so the same operation is supported during proposal, approval, and dispatch.

## Metadata

- **Complexity**: XL
- **Source PRD**: N/A
- **PRD Phase**: Standalone policy and approval-UX evolution after the verified durable runtime
- **Repository branch**: `codex/verified-durable-agent-runtime`
- **Repository HEAD inspected**: `895d36d52626cc19054353753e714d8d401aed02`
- **Origin main inspected**: `ba68b75ef04e6112b5b38c6c419e1886dd11bf4d`
- **Estimated files**: 42-50 files across shared contracts, Electron main, CUA/Workspace adapters, Railway API, migration, renderer, tests, benchmarks, configuration, and documentation
- **Estimated implementation tasks**: 11 dependency-ordered tasks
- **OpenAI package baseline**: `@openai/agents` 0.17.0 and `openai` 7.5.0
- **New dependencies**: None
- **Rollout shape**: Local parity tests first, then protocol v2 and internal canary behind a dedicated kill switch
- **Security precondition**: Rotate the Railway PostgreSQL credential previously pasted into the conversation before deployment. Never copy it into code, this plan, fixtures, logs, or analytics.

---

## UX Design

### Before

~~~text
User: Book a 20-minute meeting on my calendar. Make up the details.

Tro: What title should I use?
User: Make it up.

Tro: Approve typing the title.
User: Approve.
Tro: Approve selecting the time.
User: Approve.
Tro: Approve saving the event.

Or, in the current broken trace:
Tro: Approval cannot be requested for this action:
     The requested runtime tool operation is unavailable.
No calendar action occurs.
~~~

### After

~~~text
User: Book a 20-minute meeting on my calendar. Make up the details.

Tro: Working...
  [authorized by your instruction] Create a private calendar event
  [working] Open calendar and choose an available time
  [working] Fill a harmless title and 20-minute duration
  [verifying] Confirm the event is present

Tro: Completed and verified.
Created “Planning block” today for 20 minutes in your default calendar.
No attendees were invited.
~~~

If the task includes an attendee:

~~~text
User: Book a 20-minute meeting with alex@example.com.

Tro: [one exact approval card]
Inviting alex@example.com will send a calendar invitation.
[Deny] [Approve exact action]
~~~

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Task submission | Request text defines outcomes but not bounded action authority. | Contract v8 contains outcomes plus a versioned intent-authorization contract compiled from trusted user text. | The compiler receives no tools and cannot expand trusted workspace, URL, account, recipient, or permission scope. |
| Routine UI control | Balanced mode allows basic click/type/scroll until a broad consequence label appears. | Routine physical control stays automatic; typed reversible effects explicitly requested by the user are also automatic. | Physical action and semantic effect are separate fields. |
| Calendar save | Generic `submit` always asks. | `create_resource/calendar_event` with no attendees is authorized by the instruction and remains consequential for retry safety. | Generic or ambiguous `submit` still asks. |
| Calendar invite | Broad `submit` asks without distinguishing why. | `send_communication/calendar_invitation` asks once with exact attendees and event summary. | Communication is always-confirm. |
| Workspace patch | Every patch asks, including requested file edits. | In-scope create/update/move patches proceed in Balanced mode; delete and unexpected overwrite ask. | Exact root/symlink/size protections remain. |
| Workspace command | Every command asks. | A bounded safe command policy permits common inspection, test, lint, typecheck, build, and explicitly requested local commands; network, privilege, install, destructive, publish, deploy, push, secret-access, or out-of-root patterns ask or deny. | The existing shell is not an OS sandbox, so no blanket command grant is allowed. |
| Strict mode | Confirms routine desktop mutations and all consequential actions. | Continues to confirm every mutation/side effect. | Strict remains the user's explicit opt-in. |
| Exact approval | Used for every broad sensitive label. | Used only for the narrow hard-confirm set, ambiguous effects, and scope expansion. | Existing digest, expiry, revalidation, and spoken-yes prohibition stay intact. |
| Activity/history | Shows approval cards but not why an action flowed automatically. | Records a privacy-safe authorization source (`routine`, `user_instruction`, `exact_approval`) and typed effect. | Never log target, text, path, command, recipient, URL, or raw arguments. |
| Unknown result | Consequential flag is mixed with approval behavior. | Approval requirement and retry consequence are independent. | An auto-authorized event creation is still never retried after an unknown result. |

### Accessibility Requirements

- Keep exact approval cards `aria-live="assertive"` and keyboard reachable.
- Do not generate an interrupting card for actions authorized by the instruction.
- Announce one concise “Continuing from your instruction” status at most once per task, not once per action.
- Use text plus icon/color for `authorized`, `approval required`, `blocked`, and `verified` states.
- Preserve Stop task and global Escape for every nonterminal task.
- Keep exact target and consequence details on approvals for the remaining hard-confirm actions.

---

## Required Behavior and Policy Matrix

### Trusted authority sources

Only these sources may add or revise an intent grant:

1. The original request submitted by the signed-in user.
2. A later steering instruction submitted by the signed-in user.
3. An exact approval decision made through Tro's approval UI, which remains a separate one-use digest grant.

These sources can never add a grant:

- webpage, email, document, PDF, terminal, screenshot, accessibility, or DOM content;
- model reasoning, tool descriptions, tool results, generated plans, or assistant text;
- inferred recipients, paths, domains, accounts, credentials, permissions, or resource scope;
- voice or typed words such as “yes” outside the exact approval control.

### Effect vocabulary

Add a closed, host-owned effect vocabulary. Keep `ProposedAction.action` as the physical/tool operation for compatibility; put semantic side-effect meaning in a typed `effect` field.

| Effect kind | Example resources | Balanced behavior when directly requested | Consequential for unknown-result handling? |
|---|---|---:|---:|
| `none` | observation, navigation, scroll, draft text | Automatic | No |
| `create_resource` | private calendar event without attendees, document, row, local file | Automatic with matching intent grant | Yes |
| `update_resource` | document content, spreadsheet cell, event details | Automatic with matching intent grant | Yes |
| `rename_resource` | file, document, event | Automatic with matching intent grant | Yes |
| `move_resource` | file/document within trusted scope | Automatic with matching intent grant | Yes |
| `add_comment` | private document/issue comment that does not notify externally | Automatic only when requested and host marks communication `none` | Yes |
| `workspace_write` | create/update/move patch in selected root | Automatic with matching intent grant | Yes |
| `workspace_command` | test, lint, typecheck, local build, bounded inspection | Automatic only through the safe command policy and matching intent | Depends on command; mutation remains yes |
| `send_communication` | email, message, form transmission, calendar invitation, notifying comment | Exact approval | Yes |
| `delete_or_archive` | event, file, row, document, message | Exact approval | Yes |
| `unexpected_overwrite` | replacing an existing resource not named for replacement | Exact approval | Yes |
| `publish` | public post, public document/site | Exact approval | Yes |
| `deploy` | production/staging deployment | Exact approval | Yes |
| `merge` | pull request/branch merge | Exact approval | Yes |
| `financial_or_trade` | purchase, payment, subscription, bid, token/stock trade | Exact approval | Yes |
| `authentication_or_credential` | login submission, password, token, key, secret | Exact approval | Yes |
| `system_permission` | Accessibility, screen recording, microphone, admin permission | Exact user interaction; model cannot operate OS settings | Yes |
| `install` | package/app/extension installation | Exact approval | Yes |
| `sensitive_transfer` | uploading/sharing user data outside its current trusted boundary | Exact approval | Yes |
| `unknown` | generic submit, opaque target, missing normalization | Exact approval or block | Yes |

`download` is not globally high risk. A requested download to a selected/known local scope may normalize to `create_resource` and flow automatically. A download that executes content, overwrites unexpectedly, escapes scope, or introduces an install normalizes to the stricter effect.

### Resource kinds

Use a closed initial set rather than free-form model labels:

`calendar_event`, `document`, `spreadsheet`, `spreadsheet_row`, `workspace_file`, `workspace_repository`, `comment`, `issue`, `pull_request`, `email`, `message`, `form_submission`, `download`, `application`, `generic_private_resource`, `generic_public_resource`.

Unknown resource kinds cannot match an instruction grant. Adding a resource kind requires schema, normalizer, policy, tests, and protocol digest updates.

### Typed action effect

The target representation should be equivalent to:

~~~ts
type ActionEffect = {
  kind: ActionEffectKind;
  resourceKind: ResourceKind | null;
  reversibility: 'none' | 'reversible' | 'destructive' | 'unknown';
  externality: 'local' | 'cloud_private' | 'external' | 'public' | 'unknown';
  communication: 'none' | 'draft' | 'send' | 'invite' | 'notify' | 'unknown';
  overwrite: 'none' | 'requested' | 'unexpected' | 'unknown';
  sensitiveDataTransfer: boolean | 'unknown';
};
~~~

The host derives or raises risk fields from the registered tool schema, exact payload, trusted workspace binding, and visible semantic cues. A model may propose an effect, but it cannot lower a host-derived effect. Missing, contradictory, stale, or opaque effect data becomes `unknown` and cannot consume an intent grant.

### Intent authorization contract v1

Add a bounded contract equivalent to:

~~~ts
type IntentAuthorizationGrant = {
  id: string;
  effectKind:
    | 'create_resource'
    | 'update_resource'
    | 'rename_resource'
    | 'move_resource'
    | 'add_comment'
    | 'workspace_write'
    | 'workspace_command';
  resourceKinds: ResourceKind[];
  permitsSafeDefaults: boolean;
};

type IntentAuthorizationContract = {
  schemaVersion: 1;
  revision: number;
  source: 'user_instruction';
  grants: IntentAuthorizationGrant[];
};
~~~

The contract deliberately contains no arbitrary paths, URLs, credentials, recipients, account IDs, permissions, shell strings, or target text. Those remain bound by the trusted task/workspace/tool contracts and exact action normalization.

### Safe defaults

“Make it up,” “choose reasonable details,” or equivalent may set `permitsSafeDefaults: true` only for harmless, reversible fields needed to finish the requested resource:

- private title/description;
- duration or time within the user's stated bounds;
- default calendar/account already active in the trusted surface;
- no attendees, recipients, recurrence, attachments, public visibility, paid resource, or location booking;
- no new login, permission, integration, subscription, or data transfer.

Tro reports material defaults in the final result. It asks only when a choice changes recipients, money, public visibility, destructive behavior, access, or requested outcome.

### Policy result

Extend the pure decision result so downstream systems do not infer approval from consequence:

~~~ts
type PolicyDecision = {
  status: 'allowed' | 'needs_approval' | 'denied';
  effect: ActionEffect;
  authorizationSource: 'routine' | 'user_instruction' | 'exact_approval' | 'none';
  approvalRequired: boolean;
  consequential: boolean;
  summary: string;
  nextActions: string[];
  terminal?: boolean;
};
~~~

For an explicitly requested calendar creation with no invitees:

~~~text
status=allowed
authorizationSource=user_instruction
approvalRequired=false
consequential=true
effect=create_resource/calendar_event
~~~

This split is non-negotiable: `needsApproval: true` in the Agents SDK remains an internal durable interruption/checkpoint, while `approvalRequired` is Tro's user-facing policy decision.

---

## Current Request and Data Flow

~~~text
Renderer submit
  -> TaskApplicationService.submitAndStart
     -> TaskRuntime.submit -> createTaskContract(v7)
     -> HostedTaskClient.submit (when enabled)
        -> AgentRunService.submit
           -> OutcomeCompiler
           -> encrypted backend contract v7
           -> AgentRunWorker
              -> BackendAgentRuntime tool(needsApproval: true)
              -> durable SDK interruption
              -> DesktopToolWorker
                 -> registered tool normalization
                 -> evaluateAction(local goal)
                 -> optional exact approval
                 -> one-time executing transition
                 -> dispatch + fresh evidence
              -> SDK state resume
              -> outcome verification
~~~

### Confirmed current defect

`src/index.ts:198` constructs `new TaskRuntime()` with its default tool registry. `src/index.ts:274-281` later constructs a different `runtimeToolRegistry` containing the semantic `computer.control` definitions and passes it to the coordinator/worker. When the worker normalizes a semantic action, policy initially sees the semantic registry, asks for approval, and `TaskRuntime.requestApproval` reevaluates with its older registry. It then throws:

~~~text
Approval cannot be requested for this action:
The requested runtime tool operation is unavailable.
~~~

The fix is to construct one runtime registry after CUA service creation and inject the same instance into `TaskRuntime`, `TaskExecutionCoordinator`, and `DesktopToolWorker`. Add a regression test that exercises the complete approval path with a semantic tool present only in the injected registry.

### Current semantic mismatch

- `SensitiveActionSchema` mixes physical operations (`run_command`, `write_file`) with effects (`send`, `delete`).
- `HOST_ALWAYS_CONFIRM_ACTIONS` copies every sensitive label into one list.
- CUA puts a string `declaredConsequence` in a parameter record.
- Workspace SDK tools set `needsApproval: true` and always route every command/patch to the UI.
- Backend/local tool catalogs store one static `consequential` boolean per tool, too coarse for operations such as read versus write or click versus calendar save.
- The persistence/recovery worker correctly uses `consequential` to block unknown-result retries; that behavior must not be removed when reducing prompts.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---:|---|
| P0 | `AGENTS.md` | all | Renderer sandbox, pure policy, CUA authority, verification, and no-consequential-retry invariants. |
| P0 | `.claude/PRPs/plans/completed/codex-level-verified-durable-agent-runtime.plan.md` | all | Implemented architecture baseline; do not rebuild or contradict it. |
| P0 | `.claude/PRPs/reports/codex-level-verified-durable-agent-runtime.report.md` | all | Actual completed files, validation, and remaining limitations. |
| P0 | `src/shared/contracts.ts` | 44-97, 422-498, 1162-1198 | Existing action vocabulary, contract v7/legacy union, and hosted invocation protocol. |
| P0 | `src/main/agent/task-contract.ts` | 17-87 | New-contract construction and all version branches that must learn v8. |
| P0 | `src/main/agent/action-risk-classifier.ts` | 1-97 | Current pure monotonic risk classifier. |
| P0 | `src/main/agent/policy.ts` | 105-180 | Host policy order: support, target, approval-loop, risk, allow. |
| P0 | `src/main/agent/action-approval.ts` | 10-35 | Exact action digest that must remain for hard-confirm actions. |
| P0 | `src/main/agent/task-runtime.ts` | 548-651, 733-792 | Approval creation, one-use grant, expiry, and dispatch revalidation. |
| P0 | `src/index.ts` | 198, 268-281 | Shared-registry construction defect. |
| P0 | `src/main/agent/cua-semantic-agent-tools.ts` | 41-133, 404-452, 513-561 | Current consequence declaration, exact send payload, and action normalization. |
| P0 | `src/main/agent/workspace-agent-tools.ts` | 449-572 | Current blanket SDK approval callbacks and the shell-not-sandboxed warning. |
| P0 | `src/main/hosted/desktop-tool-worker.ts` | 61-139 | Local validation, policy, approval, executing transition, dispatch, and evidence. |
| P0 | `services/api/src/backend-agent-runtime.mjs` | 16-42, 66-99, 119-158 | SDK interruption is always enabled and resumed programmatically after the desktop result. |
| P0 | `services/api/src/agent-run-worker.mjs` | 123-181, 194-251 | Recovery and unknown consequential action behavior. |
| P0 | `services/api/src/agent-run-service.mjs` | 36-104, 182-267 | Canonical hosted contract compilation, steering revision, encryption AAD. |
| P0 | `services/api/src/agent-run-repository.mjs` | 510-617 | Invocation persistence and executing transition. |
| P0 | `services/api/migrations/014_agent_runtime.sql` | 97-128 | Current invocation schema to evolve forward. |
| P1 | `src/main/agent/outcome-contract.ts` | 24-82 | Pure schema-first compiler and authority-field validation pattern. |
| P1 | `services/api/src/outcome-compiler.mjs` | 13-74 | Deterministic baseline plus optional no-tools model compiler pattern. |
| P1 | `src/main/application/task-application-service.ts` | 51-112, 148-205 | Local/hosted submission, steering, goal projection, and restore. |
| P1 | `src/main/hosted/desktop-worker-protocol.ts` | 6-67 | Mirrored catalog and digest/version compatibility. |
| P1 | `services/api/src/agent-runtime-contracts.mjs` | 1-127 | Backend protocol schemas and version. |
| P1 | `src/main/agent/policy.test.ts` | all | Current policy test table to replace/extend. |
| P1 | `src/main/hosted/desktop-tool-worker.test.ts` | all | Hosted dedupe, expiration, and sensitive-effect integration style. |
| P1 | `src/main/analytics/analytics-service.ts` | 122-315, 424-447 | Privacy-safe fixed-property telemetry and best-effort failure handling. |
| P1 | `scripts/agent-reliability-benchmark.mjs` | all | Existing benchmark gates and metrics. |
| P1 | `test/fixtures/agent-reliability-scenarios.json` | all | Scenario manifest to expand. |
| P1 | `src/renderer/SettingsPage.tsx` | 167-199 | Balanced/Strict product copy. |
| P1 | `src/renderer/App.tsx` | 521-550, 762-818, 2354-2364 | Task details, exact approval card, and composer policy copy. |
| P1 | `docs/security.md` | 1-115 | Trust boundaries, current global approval claims, Workspace shell warning, analytics privacy. |
| P1 | `docs/agent-runtime-operations.md` | all | Existing canary, incident, rollback, and release-gate pattern. |
| P2 | `src/main/agent/execution-coordinator.ts` | approval and unknown-effect paths | Local execution checkpoint and no-retry behavior. |
| P2 | `src/main/preferences/app-preferences-service.ts` | all | Balanced default and persisted Strict choice. |
| P2 | `src/renderer/approval-details.ts` | all | Exact approval payload filtering. |
| P2 | `docs/architecture.md` | agent runtime and persistence sections | Ownership and privacy documentation to update. |

`docs/CODEX-NAVIGATION-GUIDE.md` is referenced by the workspace supplement but is absent in this worktree. Do not block implementation on it; the files above are the live ownership map.

## External Documentation and Competitive Evidence

| Topic | Source | Key takeaway |
|---|---|---|
| OpenAI autonomy boundaries | [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model) | Define what the request authorizes so the agent continues safe in-scope work, and stop for external, destructive, costly, or scope-expanding actions. Repeating “ask first” rules can cause unnecessary approval requests. |
| Inspectable OpenClicky policy | [OpenClicky AGENTS.md](https://raw.githubusercontent.com/jasonkneen/openclicky/main/AppResources/OpenClicky/AGENTS.md) | OpenClicky explicitly states that the user's instruction is approval for clearly requested reversible writes and confirms only a narrow risky set. |
| OpenClicky compatibility policy | [OpenClicky compatibility policy](https://raw.githubusercontent.com/jasonkneen/openclicky/main/AppResources/OpenClicky/OpenClickyBundledSkills/_shared/OpenClickySkillCompatibilityPolicy.md) | Creates documents, rows, comments, events, and similar requested resources directly; confirms sends, deletion/archive, unexpected overwrite, merge/deploy/publish/trade/spend. |
| OpenClicky host config | [OpenClicky Codex config template](https://raw.githubusercontent.com/jasonkneen/openclicky/main/cursor-buddy/ClickyCodexConfigTemplate.swift) | It uses `approval_policy = "never"` and `sandbox_mode = "danger-full-access"`; Tro must not copy this blanket trust model because it consumes untrusted screenshots, pages, and speech. |
| OpenClicky tool routing | [OpenClicky repository](https://github.com/jasonkneen/openclicky) | Prefer structured integrations/CLI tools; use CUA as last-mile visual fallback. |

Research conclusions:

~~~text
KEY_INSIGHT: The request should authorize its ordinary in-scope implementation work.
APPLIES_TO: Contract compiler, system instructions, policy matcher, and Workspace tools.
GOTCHA: Authority must come only from authenticated user text, never visible or tool content.

KEY_INSIGHT: Agents SDK needsApproval can be retained as an internal durable checkpoint.
APPLIES_TO: BackendAgentRuntime and AgentRunWorker.
GOTCHA: Do not expose every SDK interruption as a user approval; desktop policy decides that independently.

KEY_INSIGHT: OpenClicky's low-friction behavior comes with danger-full-access/never approval.
APPLIES_TO: Competitive target and NOT Building scope.
GOTCHA: Tro's stronger host isolation, exact approvals, and unknown-effect suppression must remain.
~~~

HeyClicky's current implementation is private and was not treated as verifiable architecture evidence. OpenClicky is the direct inspectable comparison.

---

## Patterns to Mirror

### SCHEMA_FIRST_CONTRACT

// SOURCE: `src/shared/contracts.ts:422-468`

~~~ts
export const AgentTaskContractV7Schema = z
  .object({
    schemaVersion: z.literal(7),
    id: z.string().uuid(),
    originalRequest: z.string().min(2).max(8_000),
    runtimeKind: AgentRuntimeKindSchema,
    executionProfile: ExecutionProfileSchema,
    autonomyMode: AutonomyModeSchema,
    workspace: WorkspaceIdentitySchema.nullable(),
    activity: ActivityContextSchema.nullable(),
    outcomeContract: OutcomeContractSchema,
    approvalPolicy: z.object({
      alwaysConfirm: z.array(SensitiveActionSchema),
    }),
    limits: AgentTaskContractV4Schema.shape.limits,
  })
  .superRefine((contract, context) => {
    const workspaceProfile = contract.executionProfile === 'workspace';
    if (workspaceProfile !== Boolean(contract.workspace)) {
      context.addIssue({
        code: 'custom',
        message:
          'Workspace profile and trusted workspace identity must be selected together.',
        path: ['workspace'],
      });
    }
  });
~~~

Mirror strict Zod schemas, bounded fields, discriminated enums, and cross-field `superRefine`. Add v8 to the union; do not mutate the persisted meaning of v2-v7.

### PURE_AUTHORITY_COMPILER

// SOURCE: `src/main/agent/outcome-contract.ts:24-82`

~~~ts
/**
 * Compiles the deterministic baseline that is safe before a model compiler is
 * available. It describes requested outcomes and never grants execution scope.
 */
export function compileOutcomeContract(originalRequest: string): OutcomeContract {
  // deterministic bounded output
  return OutcomeContractSchema.parse({
    schemaVersion: 1,
    revision: 1,
    completionMode: 'all_required',
    criteria,
  });
}

export function validateOutcomeContract(
  originalRequest: string,
  input: unknown,
): OutcomeContractValidation {
  const parsed = OutcomeContractSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => issue.message),
    };
  }
  // pure allowlist/authority validation
  return { valid: issues.length === 0, issues };
}
~~~

Create the intent compiler as a pure, testable contract compiler. Its output is not permission until host policy matches a normalized effect and trusted scope.

### NO_TOOLS_MODEL_COMPILER

// SOURCE: `services/api/src/outcome-compiler.mjs:55-73`

~~~js
export class OutcomeCompiler {
  constructor({ compileWithModel = null } = {}) {
    this.compileWithModel = compileWithModel;
  }

  async compile({ request, executionProfile, availableVerifierKinds }) {
    const deterministic = deterministicOutcomeContract(request, executionProfile);
    if (!this.compileWithModel || executionProfile === 'everyday') return deterministic;
    const candidate = OutcomeContractSchema.parse(await this.compileWithModel({
      request,
      executionProfile,
      availableVerifierKinds,
      tools: [],
    }));
    // host allowlist validation
    return candidate;
  }
}
~~~

The optional semantic intent compiler receives only trusted user messages, closed resource/effect enums, and `tools: []`. It cannot inspect the environment or manufacture resource scope.

### MONOTONIC_RISK_CLASSIFIER

// SOURCE: `src/main/agent/action-risk-classifier.ts:56-97`

~~~ts
/** Pure, monotonic classifier: untrusted context can raise risk, never grant authority. */
export function classifyActionRisk(
  goal: GoalSpec,
  action: ProposedAction,
): ActionRisk {
  // declared and visible risk can raise to sensitive
  return { level: 'routine', reason: 'The action is routine and in scope.' };
}
~~~

Preserve monotonicity: the effect resolver merges model declaration, registered-tool defaults, exact payload facts, and visible cues by taking the strictest result. Visible content never produces an authorization grant.

### POLICY_ORDER_AND_DENY_FIRST

// SOURCE: `src/main/agent/policy.ts:105-180`

~~~ts
export function evaluateAction(
  goal: GoalSpec,
  proposedAction: ProposedAction,
  toolRegistry: Pick<RuntimeToolRegistry, 'supports'> = defaultRuntimeToolRegistry,
): PolicyDecision {
  GoalSpecSchema.parse(goal);
  const action = ProposedActionSchema.parse(proposedAction);
  if (!toolRegistry.supports(action)) {
    return {
      status: 'denied',
      summary: 'The requested runtime tool operation is unavailable.',
      nextActions: ['Choose an operation exposed by the current runtime.'],
    };
  }
  // resource and approval-UI denies before risk/authorization
  const risk = classifyActionRisk(goal, action);
  // approval or allowed
}
~~~

Keep unavailable tool, inadmissible URL, Tro approval UI, workspace escape, stale observation, and protocol mismatch checks ahead of any user-intent match.

### EXACT_ONE_USE_APPROVAL

// SOURCE: `src/main/agent/action-approval.ts:20-35`

~~~ts
export function createActionDigest(input: unknown): string {
  const action = ProposedActionSchema.parse(input);
  const identity = toolIdentityForAction(action);
  const normalizedAction = {
    action: action.action,
    operation: identity.operation,
    toolId: identity.toolId,
    description: action.description,
    parameters: normalizeParameters(action.parameters),
    target: action.target ?? null,
  };

  return createHash('sha256')
    .update(JSON.stringify(normalizedAction))
    .digest('hex');
}
~~~

Include the typed effect in the digest. Do not turn a broad instruction grant into an exact approval grant or vice versa.

### DURABLE_UNKNOWN_EFFECT_SUPPRESSION

// SOURCE: `services/api/src/agent-run-worker.mjs:142-152`

~~~js
if (invocation.consequential && invocation.state === 'unknown') {
  return this.repository.transition({
    // ...
    to: 'blocked',
    eventType: 'run.blocked',
    summary:
      'A consequential desktop action has an unknown outcome and will not be retried.',
  });
}
~~~

This behavior remains unchanged. Reducing approval count must never increase duplicate side effects.

### TRANSACTIONAL_INVOCATION_REPOSITORY

// SOURCE: `services/api/src/agent-run-repository.mjs:510-549`

~~~js
async registerInvocation(input) {
  const request = envelopeValues(input.requestEnvelope);
  return inTransaction(this.pool, async (client) => {
    const locked = await client.query(
      `SELECT id FROM agent_runs WHERE id=$1 AND lease_owner=$2 AND run_version=$3
       AND lease_expires_at>NOW() AND state NOT IN
       ('completed','blocked','failed','cancelled','expired') FOR UPDATE`,
      [input.runId, input.workerId, input.runVersion],
    );
    if (!locked.rows[0]) throw staleLease();
    // insert invocation, move run to awaiting_worker, append public event
  });
}
~~~

Persist effect and authorization metadata in the same transaction as the invocation; never create an executing grant from renderer or model data.

### BEST_EFFORT_PRIVACY_SAFE_ANALYTICS

// SOURCE: `src/main/analytics/analytics-service.ts:424-447`

~~~ts
private async saveIdentity(): Promise<void> {
  if (!this.identity) return;
  try {
    await this.identityStore.save(this.identity);
  } catch {
    // Keep the current in-memory identity; analytics persistence is best-effort.
  }
}

private safeClientCall(operation: () => void): void {
  try {
    operation();
  } catch {
    // Product analytics must never affect the application's control flow.
  }
}
~~~

Track only fixed enums/counts. Authorization analytics must never affect execution or contain private action details.

### TABLE_DRIVEN_POLICY_TEST

// SOURCE: `src/main/agent/policy.test.ts:118-139`

~~~ts
it.each([
  'login',
  'send',
  'submit',
  'upload',
  'download',
  'delete',
  'purchase',
  'install',
  'run_command',
  'write_file',
  'system_permission',
] as const)('requires exact approval for %s', (action) => {
  expect(evaluateAction(contract, {
    action,
    toolId: 'desktop.control',
    operation: 'click',
    description: 'Perform the exact displayed action.',
  }).status).toBe('needs_approval');
});
~~~

Replace broad legacy expectations for v8 with effect/resource/intent matrices while retaining this exact behavior for persisted v2-v7 contracts.

### BACKEND_NODE_TEST_STYLE

// SOURCE: `services/api/test/outcome-runtime.test.mjs:1-24`

~~~js
import assert from 'node:assert/strict';
import test from 'node:test';

test('Chrome completion stays incomplete without fresh surface evidence', () => {
  const contract = deterministicOutcomeContract('Open Chrome for me.');
  const incomplete = verifyOutcomeContract({
    assistantOutput: 'Done.',
    contract,
    evidence: [],
  });
  assert.equal(incomplete.complete, false);
});
~~~

Backend parity and migration tests use built-in `node:test`; Electron/main tests use Vitest.

---

## Strategic Design

### Approach

1. Introduce a contract-v8 intent-authorization vocabulary and compile grants only from trusted user text.
2. Normalize every executable proposal into a typed semantic effect independent of its physical click/type/command operation.
3. Evaluate deny boundaries first, then hard-confirm risk, then Strict mode, then exact approval, then matching user-instruction grants, then routine allow.
4. Split `approvalRequired` from `consequential` in local decisions, hosted protocol, persistence, and recovery.
5. Keep Agents SDK tool interruptions for durable commit/resume, but show the user an approval card only when host policy says `needs_approval`.
6. Make the backend contract canonical for hosted tasks and project the same sanitized intent contract to the desktop worker.
7. Preserve v2-v7 behavior, exact approval digests, no-retry unknown handling, fresh observation, renderer sandbox, and tool-registry authority.
8. Roll out behind a separate flag with approval-rate and verified-success gates.

### Authorization flow

~~~text
authenticated user text
        |
        v
IntentAuthorizationCompiler (no tools, closed enums)
        |
        v
Contract v8: bounded reversible-effect grants
        |
        +---------------------------+
                                    v
registered tool -> normalized ActionEffect -> deny/risk checks
                                    |
                    +---------------+----------------+
                    |                                |
              hard-confirm/unknown             safe and in scope
                    |                                |
              exact approval card        match v8 user grant?
                                                     |
                                      +--------------+--------------+
                                      |                             |
                                     yes                            no
                                      |                             |
                           allowed/user_instruction          exact approval
                                      |
                           consequential independently
                                      |
                           execute once -> observe -> verify
                                      |
                      unknown consequential result => BLOCK, no retry
~~~

### Policy precedence

1. Parse contracts/action/effect.
2. Deny unsupported tool/operation, protocol mismatch, resource escape, unsafe URL, Tro approval UI operation, expired/stale observation, or missing task authority.
3. Resolve effective risk monotonically from tool definition, payload, workspace binding, model declaration, and visible cues.
4. Require exact approval for any hard-confirm effect or `unknown` effect.
5. In Strict mode, require exact approval for every mutation/side effect.
6. Accept a still-valid one-use exact approval digest for the exact action.
7. In v8 Balanced mode, allow a safe typed effect only if a current instruction grant matches its effect/resource and trusted task scope.
8. Allow effect `none` routine actions.
9. Otherwise require exact approval; never infer authority from similarity text.

### Local versus hosted contract ownership

- Local runtime: `createTaskContract` uses the deterministic local compiler and emits v8.
- Hosted runtime: Railway compiles the canonical intent contract and outcome contract. Submit/get/list responses expose only the sanitized contract projection required by Electron main.
- `TaskApplicationService` constructs/restores the local task goal from the backend projection for hosted tasks; it must not compile a competing local grant.
- Steering increments both outcome and intent authorization revisions from the ordered set of original request plus authenticated user steering messages.
- An invocation carries the intent revision it was evaluated against. A pending invocation from an older revision cannot consume a newer or removed grant without reevaluation.
- v2-v7 restored tasks use the existing global exact-approval behavior and never receive backfilled broad grants.

### Workspace command boundary

The current shell starts in the selected root but is not an OS sandbox. Therefore, user instruction alone must not blanket-authorize arbitrary shell strings.

Create a pure `WorkspaceCommandPolicy` that tokenizes the validated command list and returns one of:

- `safe_read`: repository inspection such as `rg`, `git status`, `git diff`, bounded file listing, version checks;
- `safe_validation`: project tests, lint, typecheck, package/build commands that do not install or publish;
- `requested_local_mutation`: explicitly requested local operations such as a named `git commit`, only with matching intent and no destructive flags;
- `requires_approval`: network access, install/update dependencies, credential access, push, remote PR mutation, publish/deploy, arbitrary absolute paths, redirects outside root, privilege elevation, process management, or unknown syntax;
- `denied`: destructive reset/clean/restore, broad deletion, encoded/eval shell, environment-secret enumeration, command substitution that defeats inspection, or attempts to operate Tro approval controls.

Prefer `apply_patch`/filesystem adapters for edits. This policy is an initial safe-performance layer, not a claim of OS sandboxing.

### Alternatives considered

| Alternative | Decision | Reason |
|---|---|---|
| Copy OpenClicky's `approval_policy=never` and danger-full-access | Reject | Tro consumes untrusted visual/document content and has a stronger local authority model. Blanket trust would make prompt injection an execution grant. |
| Keep every existing approval and only improve copy | Reject | Does not solve babysitting or the user's failed calendar test. |
| Treat all actions in a task as approved after submission | Reject | A request to read mail must not authorize sending, deleting, purchasing, or operating unrelated resources. |
| Let the agent decide whether approval is needed | Reject | Approval is a host policy decision; model output is untrusted. |
| Remove Agents SDK `needsApproval` | Reject | Its interruption is useful for durable checkpoint/commit and unknown-result recovery even when no user UI is needed. |
| Mark reversible effects non-consequential | Reject | Reversible creation can still duplicate when a result is lost. Consequence controls retry safety, not approval UX. |
| Auto-run every Workspace command when coding mode is selected | Reject | Current shell can access absolute paths/network and is not sandboxed. |
| Infer grants from page/screenshot text | Reject | This converts prompt injection into authority. |

### In scope

- Contract v8 and legacy v2-v7 compatibility.
- Typed action effects and closed resource kinds.
- Deterministic local and backend intent compilers plus optional no-tools semantic compiler.
- User-instruction grant matching and safe-default semantics.
- Hard-confirm effect set and Strict-mode preservation.
- Shared runtime registry fix.
- Local CUA, generic desktop, browser DOM, Workspace, and hosted worker effect normalization.
- Hosted protocol v2 and forward database migration.
- Separation of approval, authorization source, and consequential retry handling.
- UI copy/history/analytics updates without private payloads.
- Policy, integration, recovery, benchmark, and manual calendar tests.
- Feature flag, internal canary, kill switch, and rollback documentation.

## NOT Building

- Hosting Codex app-server or requiring a Codex/ChatGPT account.
- Copying blanket danger-full-access or “never approve” behavior.
- Removing the exact approval UI or accepting conversational “yes” as approval.
- Granting authority from model, page, email, document, screenshot, DOM, terminal, or tool-result text.
- Automatically sending messages/invitations, deleting/archiving, publishing, deploying, merging, purchasing/trading, installing, changing credentials/permissions, or transferring sensitive data.
- Retrying an action whose execution outcome may be unknown.
- A complete OS-level shell sandbox; only a bounded safe-command policy is included.
- Public workflow sharing, policy customization, team-admin approval rules, or per-domain rule builders.
- A new connector/calendar API. Existing structured tools/DOM/CUA execute the effect.
- Rewriting the durable runtime, outcome verifier, CUA driver, or renderer security boundary.
- Migrating legacy task contracts to broader authorization semantics.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/shared/contracts.ts` | UPDATE | Add effect/resource/authorization schemas, policy decision metadata, contract v8, protocol v2 envelope, and legacy union support. |
| `src/main/agent/intent-authorization.ts` | CREATE | Pure deterministic compiler, validator, grant digest, and matcher for local tasks. |
| `src/main/agent/intent-authorization.test.ts` | CREATE | Table-driven trusted-text, safe-default, hard-confirm exclusion, and revision tests. |
| `src/main/agent/action-effect.ts` | CREATE | Pure effect resolution, risk merge, hard-confirm set, and consequence calculation. |
| `src/main/agent/action-effect.test.ts` | CREATE | Monotonic effect/risk and ambiguous-effect tests. |
| `src/main/agent/workspace-command-policy.ts` | CREATE | Safe read/validation/local-mutation/approval/deny classification. |
| `src/main/agent/workspace-command-policy.test.ts` | CREATE | Command-family, destructive, network, path, secret, and shell-syntax matrices. |
| `src/main/agent/task-contract.ts` | UPDATE | Emit v8 with intent contract; update version helpers; preserve legacy behavior. |
| `src/main/agent/task-contract.test.ts` | UPDATE | Assert v8 creation, safe grants, legacy parsing, workspace binding. |
| `src/main/agent/action-risk-classifier.ts` | UPDATE | Delegate to typed effects and preserve visible-context monotonic risk raises. |
| `src/main/agent/action-risk-classifier.test.ts` | UPDATE | Replace broad string-consequence tests with typed effect cases. |
| `src/main/agent/policy.ts` | UPDATE | Apply precedence, match intent grants, and return authorization/approval/consequence separately. |
| `src/main/agent/policy.test.ts` | UPDATE | Full Balanced/Strict/legacy matrix and injection/scope denials. |
| `src/main/agent/action-approval.ts` | UPDATE | Bind typed effect and intent revision into exact digest. |
| `src/main/agent/action-approval.test.ts` | UPDATE | Verify effect/revision changes invalidate approval. |
| `src/main/agent/runtime-tool-registry.ts` | UPDATE | Normalize typed effects for direct, browser, desktop, Workspace, and interaction operations. |
| `src/main/agent/runtime-tool-registry.test.ts` | UPDATE/CREATE | Assert every mutating operation resolves to a non-unknown typed effect. |
| `src/main/agent/cua-semantic-agent-tools.ts` | UPDATE | Replace broad consequence string with typed effect payload and cross-field constraints. |
| `src/main/agent/cua-semantic-agent-tools.test.ts` | UPDATE | Calendar create/invite, send payload, delete, generic submit, stale/opaque cases. |
| `src/main/agent/workspace-agent-tools.ts` | UPDATE | Keep SDK interruption but bypass user UI for policy-authorized patches/commands; preserve exact approval otherwise. |
| `src/main/agent/workspace-agent-tools.test.ts` | UPDATE | Requested edit/test no-prompt cases; delete/install/network/destructive approval or deny cases. |
| `src/main/agent/openai-agents-runtime.ts` | UPDATE | State compact autonomy boundaries once and require typed effects; avoid unnecessary clarification. |
| `src/main/agent/task-runtime.ts` | UPDATE | Store/reevaluate v8 decisions, consume exact grants only for hard-confirm, surface authorization metadata. |
| `src/main/agent/task-runtime.test.ts` | UPDATE | Shared registry regression, revision invalidation, approval lifecycle, legacy behavior. |
| `src/main/agent/execution-coordinator.ts` | UPDATE | Route allowed user-instruction effects directly to one-time execution while preserving observe/verify/no-retry. |
| `src/main/agent/execution-coordinator.test.ts` | UPDATE | Calendar create, invite approval, unknown auto-authorized create, prompt injection, and strict cases. |
| `src/index.ts` | UPDATE | Construct one registry and inject it into TaskRuntime/coordinator/hosted worker. |
| `src/main/application/task-application-service.ts` | UPDATE | Use backend contract projection for hosted submit/restore and revisioned steering. |
| `src/main/application/task-application-service.test.ts` | UPDATE | Hosted canonical contract and restore parity tests. |
| `src/main/application/hosted-task-client.ts` | UPDATE | Parse protocol-v2 intent contract projection on submit/get/list. |
| `src/main/hosted/desktop-worker-protocol.ts` | UPDATE | Protocol v2 catalog/digest with effect metadata independent of consequence. |
| `src/main/hosted/desktop-tool-worker.ts` | UPDATE | Reevaluate typed effect locally; request UI only when required; send consequence/auth metadata to executing transition. |
| `src/main/hosted/desktop-tool-worker.test.ts` | UPDATE | Dedupe, mismatches, auto-authorized consequential effects, exact sends, legacy/protocol failures. |
| `services/api/src/agent-runtime-contracts.mjs` | UPDATE | Protocol v2, intent/effect schemas, public contract projection, execution metadata. |
| `services/api/src/intent-authorization-compiler.mjs` | CREATE | Backend deterministic + optional no-tools compiler and pure validation. |
| `services/api/test/intent-authorization-runtime.test.mjs` | CREATE | Node parity/security/revision tests using shared fixtures. |
| `services/api/src/agent-tool-catalog.mjs` | UPDATE | Replace single static consequential boolean with default effect capabilities; recompute digest. |
| `services/api/src/backend-agent-runtime.mjs` | UPDATE | Carry typed proposed effect through durable interruption; retain `needsApproval: true`. |
| `services/api/src/agent-run-service.mjs` | UPDATE | Compile/store v8, expose sanitized projection, recompile on steering, update encryption AAD/version parsing. |
| `services/api/src/agent-run-worker.mjs` | UPDATE | Register effect/auth metadata and keep unknown consequential block independent of approval. |
| `services/api/src/agent-run-repository.mjs` | UPDATE | Persist/query effect kind, authorization source, intent revision, approval-required, consequential fields transactionally. |
| `services/api/migrations/015_intent_authorization.sql` | CREATE | Forward-only invocation metadata and constraints/indexes; do not rewrite old rows. |
| `services/api/src/desktop-worker-controller.mjs` | UPDATE | Accept/revalidate protocol-v2 executing metadata and expose it to repository. |
| `services/api/src/agent-runtime-http-controller.mjs` | UPDATE | Parse protocol-v2 request and public contract projection. |
| `services/api/src/config.mjs` | UPDATE | Add dedicated intent-authorization flag/canary and accept required protocol v2. |
| `services/api/test/config.test.mjs` | UPDATE | Flag defaults, invalid values, and protocol-v2 tests. |
| `services/api/test/migrate.test.mjs` | UPDATE | Apply migration 015 twice and assert new columns/constraints. |
| `.env.example` | UPDATE | Document disabled-by-default flag, canary list, protocol v2, kill switch. |
| `src/main/analytics/analytics-service.ts` | UPDATE | Count authorization source/effect and unnecessary approval rate with enum-only properties. |
| `src/main/analytics/analytics-service.test.ts` | UPDATE | Assert private target/payload/command fields never reach analytics. |
| `src/renderer/SettingsPage.tsx` | UPDATE | Explain that instruction authorizes requested reversible work in Balanced mode. |
| `src/renderer/App.tsx` | UPDATE | Update task/composer copy and optionally show a noninterrupting authorization summary. |
| `src/renderer/app-language.ts` | UPDATE | Add/update localized source strings used by policy UX. |
| `src/renderer/history.test.ts` | UPDATE | Contract-v8 and authorization history projection. |
| `src/renderer/insights.test.ts` | UPDATE | New enum-only metrics/presentation if exposed. |
| `scripts/agent-reliability-benchmark.mjs` | UPDATE | Add approval rate, unnecessary approval rate, and approvals per verified success gates. |
| `scripts/agent-reliability-benchmark.test.mjs` | UPDATE | Benchmark math/gate tests. |
| `test/fixtures/agent-reliability-scenarios.json` | UPDATE | Add intent-policy, approval, injection, strict, and unknown-result scenarios. |
| `test/fixtures/intent-authorization-cases.json` | CREATE | Shared local/backend parity cases without secrets/private payloads. |
| `docs/security.md` | UPDATE | Explain trusted instruction authority, hard-confirm effects, command limitations, and injection boundary. |
| `docs/architecture.md` | UPDATE | Document contract v8, effect normalization, local/backend ownership, and protocol v2. |
| `docs/computer-use-lifecycle.md` | UPDATE | Document physical-action/effect split and local revalidation. |
| `docs/conversational-task-execution.md` | UPDATE | Document when Tro acts, assumes harmless defaults, asks, or blocks. |
| `docs/agent-runtime-operations.md` | UPDATE | Canary metrics, kill switch, incidents, rollback, and protocol compatibility. |
| `docs/testing/user-instruction-intent-authorization.tdd.md` | CREATE | Record implementation evidence, focused coverage, manual trace, and final gates. |

Some existing files may not require edits after implementation discovers that their current types are already structurally sufficient. Do not create speculative pass-through changes; every changed file must serve a task or test above.

---

## Step-by-Step Tasks

### Task 1: Define effect, authorization, and contract-v8 schemas

- **ACTION**: Add the shared closed vocabularies and versioned contracts before changing behavior.
- **IMPLEMENT**:
  - Add `ActionEffectKindSchema`, `ResourceKindSchema`, `ActionEffectSchema`, `AuthorizationSourceSchema`, `IntentAuthorizationGrantSchema`, and `IntentAuthorizationContractSchema` to `src/shared/contracts.ts`.
  - Add optional/required top-level `effect` to the v8 proposed-action path while preserving legacy action parsing for persisted tasks.
  - Add `AgentTaskContractV8Schema` containing `outcomeContract`, `intentAuthorization`, and an `approvalPolicy.alwaysConfirmEffects` closed list.
  - Add v8 to `TaskContractSchema`; do not change v2-v7 schemas or their approval semantics.
  - Add protocol-v2 hosted invocation fields: `effect`, `intentRevision`, `approvalRequired`, `authorizationSource`, and `consequential`.
  - Bound arrays, strings, and enum counts and use strict objects/superRefine for illegal combinations.
  - Update every schema-version branch/helper to include v8 where its modern fields apply.
- **MIRROR**: `SCHEMA_FIRST_CONTRACT` and existing `OutcomeContractSchema` strict validation.
- **IMPORTS**: `z` from `zod`; reuse `RuntimeToolIdSchema`, `AutonomyModeSchema`, `OutcomeContractSchema`, workspace/activity schemas.
- **GOTCHA**: Never replace v2-v7 in place. History and in-flight tasks must parse with their old exact-approval behavior. Do not put raw targets, paths, recipients, or user text inside authorization grants.
- **VALIDATE**: Focused `task-contract.test.ts` and schema parse tests cover v8 valid/invalid cross-fields, max bounds, duplicate grant IDs, forbidden hard-confirm grants, and legacy fixtures.

### Task 2: Build deterministic intent compilers and parity fixtures

- **ACTION**: Compile bounded grants from authenticated user text in local and hosted runtimes.
- **IMPLEMENT**:
  - Create local `intent-authorization.ts` and backend `intent-authorization-compiler.mjs`.
  - Start with deterministic patterns for create/update/rename/move/comment/Workspace change and safe-default language.
  - Permit an optional model classifier only with trusted user messages, closed enums, no environment context, and `tools: []`.
  - Validate that candidate grants contain only auto-eligible effect kinds/resource kinds; hard-confirm kinds are schema-invalid.
  - Reject authority-like output fields and any compiler result that tries to encode paths, URLs, domains, recipients, credentials, permissions, or limits.
  - Compute a stable contract/grant digest for protocol parity and revision checks.
  - On steering, compile from ordered authenticated user messages only and increment the intent revision; never append assistant/tool/page text.
  - Add `test/fixtures/intent-authorization-cases.json` and run the same cases through TS/Vitest and backend/node:test implementations.
- **MIRROR**: `PURE_AUTHORITY_COMPILER`, `NO_TOOLS_MODEL_COMPILER`, and `test/fixtures/agent-reliability-scenarios.json` shared fixture style.
- **IMPORTS**: Shared contract types/schemas; `createHash` from `node:crypto` where a digest is needed.
- **GOTCHA**: The compiler describes eligible requested effects; it does not itself allow an action. A grant without a matching host-normalized resource/effect is inert. “Make it up” cannot add attendee, recurrence, public visibility, payment, login, or permission grants.
- **VALIDATE**: Parity fixtures produce identical normalized contracts/digests locally and in the API; injection strings embedded in page/tool fields are not accepted as compiler input; hard-confirm grant attempts fail closed.

### Task 3: Normalize typed effects for every executable lane

- **ACTION**: Separate physical action from semantic effect at every registered tool boundary.
- **IMPLEMENT**:
  - Create `action-effect.ts` with pure merge/raise logic and `isHardConfirmEffect`/`isConsequentialEffect` helpers.
  - Update CUA semantic command schema to carry typed effect/resource metadata and cross-field validation.
  - Enforce exact send/invite payload rules: nonempty recipients/attendees force `send_communication`; no recipient list may accompany `communication:none`.
  - Map private calendar save without attendees to `create_resource/calendar_event`; map invitation save to `send_communication/calendar_event`.
  - Map generic or unexplained `submit` to `unknown`, never to safe create.
  - Update runtime registry normalization for browser DOM, desktop control, file write, command, direct app launch, and other mutating operations.
  - Ensure read/observe/navigation effects are `none`; file read must not be consequential.
  - Add `workspace-command-policy.ts` and call it before `workspace_command` can match a grant.
  - Keep visible text/ARIA cues as risk raisers. Stale, opaque, contradictory, missing, or unsupported effect metadata becomes `unknown`.
- **MIRROR**: `MONOTONIC_RISK_CLASSIFIER` and `ModelSurfaceCommandSchema.superRefine` in `cua-semantic-agent-tools.ts:63-133`.
- **IMPORTS**: Shared effect schemas/types, current tool resolution types, `z` for model-tool input schemas.
- **GOTCHA**: A model-proposed safe effect is not authoritative. The host must raise it when payload facts or visible cues show send/delete/payment/login/upload/etc. Never lower a tool default because the model labels it reversible.
- **VALIDATE**: A table test enumerates every mutating registered operation and asserts a known typed effect. Calendar create/invite, comment notification, file create/delete, requested/unexpected overwrite, downloads, and ambiguous submit have explicit cases.

### Task 4: Replace the broad approval gate with the pure intent-aware policy

- **ACTION**: Make `evaluateAction` return an explicit effect, authorization source, approval requirement, and retry consequence.
- **IMPLEMENT**:
  - Preserve the current deny-first checks and approval-loop terminal denial.
  - Resolve the final typed effect, then apply the policy precedence documented above.
  - In v8 Balanced mode, match only auto-eligible effects against the current intent contract and trusted resource scope.
  - In v8 Strict mode, require approval for every mutation/side effect.
  - For v2-v7, retain the existing `HOST_ALWAYS_CONFIRM_ACTIONS` behavior exactly.
  - Return `authorizationSource='routine'` for effect-none actions, `user_instruction` for matched grants, `exact_approval` only after a current exact digest, and `none` otherwise.
  - Compute `consequential` independently from approval.
  - Update action digest to include normalized typed effect and intent revision.
  - Ensure untrusted visible cues can force `needs_approval` but can never create/match a grant.
- **MIRROR**: `POLICY_ORDER_AND_DENY_FIRST`, `EXACT_ONE_USE_APPROVAL`, current `isTargetAdmissible`, and Tro-approval-loop denial.
- **IMPORTS**: New effect and intent matcher helpers; existing contract/action schemas and runtime registry types.
- **GOTCHA**: Do not use action description or arbitrary target string as the primary grant match. Those fields can contain model/untrusted text. Match closed effect/resource plus separately validated trusted task/workspace/surface bindings.
- **VALIDATE**: Full matrix passes for Balanced, Strict, v7 legacy, stale/opaque, missing grant, wrong resource, hard-confirm, and exact-approval paths.

### Task 5: Fix the shared registry and local approval lifecycle

- **ACTION**: Make all local policy checks use the same installed registry and route user-authorized actions without approval-card churn.
- **IMPLEMENT**:
  - Move `TaskRuntime` construction after `CuaService` and `runtimeToolRegistry` creation in `src/index.ts`.
  - Pass `toolRegistry: runtimeToolRegistry` into `new TaskRuntime(...)` and the same object to coordinator/desktop worker.
  - Adjust initialization ordering/listeners without duplicating runtime instances or losing history/activity subscriptions.
  - Update `TaskRuntime.requestApproval` so it is called only for `needs_approval`; keep its defensive reevaluation.
  - Update exact grant consumption to include typed effect/revision and continue single-use/expiry checks.
  - Route `allowed/user_instruction` through the same acting -> dispatch -> observe -> verify sequence as routine actions.
  - Add a regression test where `computer.control` exists only in the injected semantic registry and the complete approval or auto-authorization path succeeds.
- **MIRROR**: Existing `TaskRuntime` constructor injection, request/consume approval defensive reevaluation, and task-update listener registration.
- **IMPORTS**: `RuntimeToolRegistry`, semantic definition factory, existing runtime/coordinator types.
- **GOTCHA**: Initialization reordering must not register task listeners twice or construct CUA before Electron app prerequisites are available. Do not fall back to `defaultRuntimeToolRegistry` inside any authority path after injection.
- **VALIDATE**: The exact reported error no longer occurs. A semantic calendar create reaches dispatch without approval; an invite reaches one approval; unsupported semantic operations remain denied.

### Task 6: Integrate Workspace SDK tools without removing durable checkpoints

- **ACTION**: Let requested safe Workspace work proceed while preserving SDK pause/resume and local safety.
- **IMPLEMENT**:
  - Keep `needsApproval: true` on Agents SDK shell/apply-patch tools so calls remain inspectable interruptions.
  - In the approval callback, normalize the exact patch/command and call host policy.
  - Return SDK approval programmatically for `allowed` policy decisions without creating a user interaction.
  - Create a UI approval only for `needs_approval`; deny for policy `denied`.
  - Auto-authorize create/update/move patches inside the selected workspace when requested; keep delete and unexpected overwrite exact.
  - Apply `WorkspaceCommandPolicy` before intent matching. Allow common read/test/lint/typecheck/build operations; require/deny the risky sets documented above.
  - Preserve canonical root, symlink escape, file/patch size, bounded environment, tool-call budget, abort, and exact command preview behavior.
  - Record authorization source and consequence in the tool outcome/evidence without raw command analytics.
- **MIRROR**: `workspace-agent-tools.ts:449-572`, `workspace-runtime-tool-adapters.ts`, and existing SDK `onApproval` result contracts.
- **IMPORTS**: `evaluateAction`, effect schemas, command policy, existing `createActionPreview` and Workspace validators.
- **GOTCHA**: `needsApproval` is an SDK mechanism, not proof that a human must click. Conversely, policy-allowed shell is not sandboxed; only commands explicitly classified safe may bypass the UI.
- **VALIDATE**: Workspace tests prove requested patch/test no-prompt behavior; delete, install, network/push/deploy, destructive git, secret access, absolute path, and unknown shell syntax do not bypass approval.

### Task 7: Make hosted contract/protocol/persistence intent-aware

- **ACTION**: Make Railway the canonical contract owner and transmit effect/auth metadata without conflating it with consequence.
- **IMPLEMENT**:
  - Bump `AGENT_RUNTIME_PROTOCOL_VERSION` and desktop schema literal to 2; recompute catalog/schema digest.
  - Replace static per-tool `consequential` metadata with supported operations plus default effect capability. The exact invocation carries normalized `effect`, `approvalRequired`, `authorizationSource`, `intentRevision`, and `consequential`.
  - Compile contract v8 in `AgentRunService.submit`; encrypt it with v8 AAD and expose a sanitized contract projection in submit/get/list responses.
  - On steering, compile both outcomes and authorization from ordered authenticated user messages and transactionally revise them.
  - Update `TaskApplicationService` hosted flow to build/restore its local goal from the backend projection, not a separate compiler result.
  - Add migration `015_intent_authorization.sql` with constrained columns on `agent_tool_invocations`: `effect_kind`, `resource_kind`, `authorization_source`, `intent_revision`, `approval_required`; retain `consequential`.
  - Default legacy rows to `unknown`/`none`/approval required where appropriate. Do not rewrite or broaden old authorization.
  - Persist the policy metadata atomically in `registerInvocation` and validate it again in `grantExecution`.
  - Keep protocol-v1 tasks visible/cancellable but require upgrade or legacy exact behavior rather than interpreting them as v2.
- **MIRROR**: `TRANSACTIONAL_INVOCATION_REPOSITORY`, existing encrypted contract/outcome revision flow, schema digest comparison, and forward-only migration style.
- **IMPORTS**: Backend Zod schemas, compiler, `createHash`, existing crypto/repository helpers.
- **GOTCHA**: Changing encrypted contract `schemaVersion` changes AES-GCM AAD. Reads must select the stored contract version; do not attempt to decrypt v7 ciphertext with v8 AAD. Rollout must not strand in-flight protocol-v1 invocations.
- **VALIDATE**: Migration applies idempotently; protocol mismatch is fail-closed; hosted submit/restore yield the same intent digest; steering invalidates old revisions; database rows preserve consequence independent of approval.

### Task 8: Preserve durable Agents SDK interruption and unknown-result semantics

- **ACTION**: Keep reliability benefits while removing unnecessary user interruptions.
- **IMPLEMENT**:
  - Retain `needsApproval: true` on backend catalog tools and `parallelToolCalls: false`.
  - Treat the SDK interruption as a serialized commit point. The backend persists the request; the desktop host decides policy; an allowed action receives the one-time executing transition without user UI.
  - Update `interruptionDetails` to carry/validate typed effect proposal and let desktop normalization raise/fail it.
  - Resume SDK state only after a committed desktop terminal result as today.
  - Keep `consequential && unknown -> blocked` unchanged for both user-approved and instruction-authorized actions.
  - Prevent the agent from issuing another consequential action after an unknown effect.
  - Update system instructions once: direct in-scope reversible work should proceed; use `request_user_input` only for material choices; hard-confirm policy is host-owned.
- **MIRROR**: `backend-agent-runtime.mjs:66-158` and `DURABLE_UNKNOWN_EFFECT_SUPPRESSION`.
- **IMPORTS**: New backend effect schemas; existing `Agent`, `tool`, `RunState`, trace utilities.
- **GOTCHA**: Do not call `state.approve` before the desktop result is durably committed. SDK approval does not mean human approval and must not be logged as such.
- **VALIDATE**: Fault injection after local calendar creation returns `unknown`, blocks, and executes only once. SDK checkpoint/restart tests still pass for both safe and exact-approval effects.

### Task 9: Update user-facing policy UX and privacy-safe history/analytics

- **ACTION**: Explain the simpler model and measure it without exposing private task data.
- **IMPLEMENT**:
  - Change Balanced copy to: the instruction authorizes requested reversible work; Tro asks for communications, deletion, publishing/deploying, money, credentials/permissions, installs, sensitive transfers, or scope expansion.
  - Keep Strict copy explicit about asking before every mutation.
  - Update task-details and composer copy; avoid a new modal/card for instruction-authorized actions.
  - Optionally show one compact task detail such as “Requested reversible work: authorized” using only the contract's closed effect/resource labels.
  - Keep exact approval card content/controls for hard-confirm actions and attendee/recipient details.
  - Add privacy-safe analytics fields: `effect_kind`, `resource_kind`, `authorization_source`, `approval_required`, and counts per task.
  - Compute `approvals_per_verified_success`, `unnecessary_approval_rate`, and `user_intervention_rate` from fixed events.
  - Never emit target, description, text, command, path, URL, recipient, account, screenshot, or tool arguments.
  - Update language mappings/tests for source strings.
- **MIRROR**: Existing Settings autonomy section, exact approval card, and `BEST_EFFORT_PRIVACY_SAFE_ANALYTICS`.
- **IMPORTS**: Shared enums/types only; existing renderer translation helper and analytics schemas.
- **GOTCHA**: Do not claim “fully autonomous” or “no approvals.” Avoid flooding Activity with one authorization event per click. Analytics delivery must not affect policy or task flow.
- **VALIDATE**: Renderer tests assert Balanced/Strict copy and card presence/absence. Analytics tests inspect captured properties and prove private fields are absent.

### Task 10: Add policy, E2E, recovery, and benchmark coverage

- **ACTION**: Turn the desired approval behavior into release-blocking tests and metrics.
- **IMPLEMENT**:
  - Expand unit matrices for compiler, effect resolver, policy, command policy, task runtime, Workspace SDK, CUA semantic tools, hosted worker, backend service/repository, and migrations.
  - Add shared cases for local/backend parity.
  - Add integration scenarios for calendar create with/without attendees, document/spreadsheet edits, file patch/delete, command test/install, prompt injection, Strict mode, steering revision, and unknown effect recovery.
  - Expand reliability fixture and benchmark summary with total approvals, approvals per verified success, unnecessary approvals, and planned/unplanned intervention.
  - Gate candidate rollout on zero false completions, zero duplicate consequential actions, zero hard-confirm bypasses, at least 95% fault recovery, and a material unnecessary-approval reduction.
  - Define an unnecessary approval as an approval requested for an auto-eligible typed effect with a matching current grant and no raised risk. Do not infer it from user denial alone.
  - Record a TDD evidence document with exact commands/results and packaged manual traces.
- **MIRROR**: Existing table-driven Vitest tests, backend `node:test`, reliability benchmark report/gate structure, and prior `docs/testing/*.tdd.md` evidence files.
- **IMPORTS**: Existing test helpers, `assert`, `vitest`, fixture readers; no new test dependency.
- **GOTCHA**: Lower approval count alone is not success. Any hard-confirm bypass, duplicate effect, false completion, or local/backend disagreement fails the candidate.
- **VALIDATE**: All focused suites pass and benchmark candidate meets every gate against a recorded baseline.

### Task 11: Document, canary, package, and roll back safely

- **ACTION**: Ship behind an isolated flag and document operational failure modes.
- **IMPLEMENT**:
  - Add `TROCODE_INTENT_AUTHORIZATION_ENABLED=false` and `TROCODE_INTENT_AUTHORIZATION_CANARY_USERS` to config/example env.
  - Require backend runtime enabled, protocol v2, current desktop schema digest, and canary eligibility before v8 user-instruction authorization is active.
  - When disabled, emit/use v7 exact-approval behavior for new tasks or a documented v8 fail-closed mode; choose one deterministic fallback and test it. Recommended fallback: v7 behavior for new tasks until v8 rollout is enabled.
  - Add internal -> 1% -> 5% -> 25% -> 100% rollout gates to `docs/agent-runtime-operations.md`.
  - Kill switch affects new tasks; existing v8 tasks stay visible/cancellable and retain their stored policy. Never restart them as duplicate v7 tasks.
  - Document protocol upgrade, AAD version, rollback window, stale desktop behavior, metrics, and incident queries.
  - Update architecture, security, CUA lifecycle, and conversational execution docs.
  - Run full check/package plus clean packaged macOS/Windows calendar and Workspace manual tests.
- **MIRROR**: `services/api/src/agent-rollout-policy.mjs`, `docs/agent-runtime-operations.md`, `.env.example` backend-agent gate, and the completed durable-runtime release process.
- **IMPORTS**: Existing config boolean/set parsers and rollout policy; no new dependency.
- **GOTCHA**: Do not enable v8 globally before every supported desktop understands protocol v2. A kill switch must not cause in-flight duplicate execution. Rotate the exposed PostgreSQL credential before any deployment.
- **VALIDATE**: Config tests, canary assignment tests, version compatibility checks, migration test, `npm run check`, and `npm run package` all pass; rollback rehearsal leaves existing tasks cancellable and creates no duplicate effects.

---

## Testing Strategy

### Core unit matrix

| Test | Input | Expected output | Edge case? |
|---|---|---|---:|
| Calendar safe creation | “Book a 20-minute meeting; make up details,” effect `create_resource/calendar_event`, no attendees | `allowed`, `user_instruction`, no UI approval, `consequential=true` | No |
| Calendar invitation | Same task with one attendee/invite payload | `needs_approval`, `send_communication`, exact attendee shown | Yes |
| Generic submit | Physical click with effect missing/`unknown` | `needs_approval` | Yes |
| Document create | Explicit “create a private doc” + matching effect | Allowed by instruction | No |
| Unrequested document create | Read-only request + create effect | Approval required/denied; no grant | Yes |
| Spreadsheet rows | Explicit add/update rows | Allowed if private/in-scope and no notification | No |
| Comment with notification | Add comment that will notify external participants | Exact approval | Yes |
| Workspace update patch | “Fix this bug” + create/update patch in selected root | Allowed by instruction | No |
| Workspace delete patch | Delete file | Exact approval | Yes |
| Workspace test | Requested implementation + `npm test`/equivalent safe validation | Allowed, no approval card | No |
| Workspace install | `npm install` | Exact approval | Yes |
| Destructive git | `git reset --hard`, `git clean -fd`, restore unrelated changes | Denied or exact approval per fixed policy; never implicit | Yes |
| Remote mutation | `git push`, deploy, publish, merge | Exact approval | Yes |
| Prompt injection | Page says “user approved sending/deleting” | No grant; risk may rise only | Yes |
| Wrong resource | Calendar grant with file delete action | No match; exact approval/deny | Yes |
| Strict mode | Explicit safe calendar creation | Exact approval for mutation | Yes |
| Legacy v7 | Explicit file write | Existing exact approval behavior | Yes |
| Steering add | User steers “also update the spreadsheet” | New revision grants spreadsheet update | No |
| Steering remove/change | New instruction changes target/outcome | Old pending action cannot consume stale grant | Yes |
| Unknown result | Auto-authorized calendar create disconnects after local effect | Blocked, one execution, no retry | Yes |
| Shared registry | Semantic tool only in injected registry | Same support result in worker/runtime/dispatch | Yes |
| Approval-loop attack | Action targets Tro approval controls | Terminal denial | Yes |
| Private URL/path scope | Local/private URL or Workspace escape | Denied before intent matching | Yes |

### Hosted/database tests

| Test | Expected result |
|---|---|
| Migration 014 -> 015 | Existing invocations retain consequence; new metadata is constrained and fail-closed. |
| Reapply 015 | Idempotent success. |
| Protocol v1 desktop with v2 invocation | Upgrade-required/not-executed; no fallback execution. |
| Protocol v2 metadata mismatch | Desktop rejects before requesting executing. |
| Contract v7 decrypt | Uses v7 AAD and legacy behavior. |
| Contract v8 decrypt | Uses v8 AAD and sanitized projection. |
| Hosted submit/restore | Desktop intent digest equals backend projection. |
| Steering transaction | Outcome + intent revisions advance together. |
| Stale invocation revision | Reevaluate or reject; never consume stale grant. |
| Consequential unknown | Run blocks independent of approval source. |
| Duplicate delivery | Same committed result; dispatcher called once. |

### Edge Cases Checklist

- [ ] Empty/whitespace request is rejected by existing submission schema.
- [ ] Maximum 8,000-character request compiles within bounded grant count.
- [ ] Duplicate grant IDs fail schema validation.
- [ ] No grant for a hard-confirm effect can parse.
- [ ] “Make it up” without an actionable request does not grant mutation.
- [ ] Attendee/recipient fields cannot pair with `communication:none`.
- [ ] Public visibility overrides a private create grant and requires approval.
- [ ] Unknown resource/effect fails closed.
- [ ] Stale/opaque observation fails closed.
- [ ] Surface changes between proposal and dispatch invalidate exact approval/effect grounding.
- [ ] Steering during pending invocation cannot silently broaden it.
- [ ] Concurrent desktop/API restart does not duplicate effects.
- [ ] Expired invocation and expired exact approval remain non-executable.
- [ ] Workspace symlink/root escape remains denied.
- [ ] Command substitution, eval, encoded shell, privilege escalation, redirection, and absolute paths cannot bypass command policy.
- [ ] Analytics cannot receive commands, paths, URLs, descriptions, recipients, or target text.
- [ ] Strict mode is preserved after app restart.
- [ ] Legacy histories remain readable and do not display misleading “authorized by instruction” labels.
- [ ] Feature-flag disable/rollback creates no duplicate local task.
- [ ] Permission denied, CUA unavailable, logged-out session, and disconnected worker yield honest blocked/not-executed states.

### Manual acceptance trace: reported calendar task

1. Use a clean packaged build with backend runtime and v8 enabled for the internal canary user.
2. Connect computer permissions once through the existing user-owned flow.
3. Open the calendar surface and submit: “Book a 20-minute meeting on my calendar. Make up the details.”
4. Verify Tro does not ask for title/time details and does not show an exact approval card.
5. Verify `application.launch`/observe/control all use the same registry and the “runtime tool operation is unavailable” error does not appear.
6. Verify Tro creates one private event in the active/default calendar with no attendees, recurrence, public visibility, paid room, or new permission.
7. Verify Tro freshly observes/reads the resulting event and only then reports completion.
8. Verify final response states the harmless defaults and explicitly says no attendees were invited.
9. Repeat with “Invite alex@example.com”; verify exactly one approval appears before the invitation-producing action and contains the attendee/event consequence.
10. Deny it; verify no invitation is sent and the task reports the denied/blocked outcome honestly.
11. Approve a fresh retry task; verify one event/invitation and one exact digest consumption.
12. Inject a disconnect after the local save but before the result commit; verify the task blocks as unknown and no second event is created.

---

## Validation Commands

Run focused tests during each task, then the full repository gates.

### Static analysis and Electron/main tests

```bash
npx vitest run \
  src/main/agent/intent-authorization.test.ts \
  src/main/agent/action-effect.test.ts \
  src/main/agent/workspace-command-policy.test.ts \
  src/main/agent/task-contract.test.ts \
  src/main/agent/action-risk-classifier.test.ts \
  src/main/agent/policy.test.ts \
  src/main/agent/action-approval.test.ts \
  src/main/agent/task-runtime.test.ts \
  src/main/agent/execution-coordinator.test.ts \
  src/main/agent/workspace-agent-tools.test.ts \
  src/main/hosted/desktop-tool-worker.test.ts \
  src/main/application/task-application-service.test.ts \
  src/main/analytics/analytics-service.test.ts
```

EXPECT: All focused policy/runtime tests pass with no unhandled approval interactions.

### Backend tests

```bash
npm --prefix services/api test
```

EXPECT: Protocol, compiler, repository, migration, recovery, crypto-version, and HTTP tests pass.

### Migration validation

```bash
node --test services/api/test/migrate.test.mjs
```

EXPECT: Fresh migration and upgrade from 014 to 015 both pass; reapplication is idempotent.

### Reliability benchmark

```bash
npm run agent:benchmark -- --baseline <v7-results.json> --candidate <v8-results.json>
```

EXPECT:

- zero false completions;
- zero duplicate consequential actions;
- zero hard-confirm bypasses;
- recovery rate >= 95% and not below baseline;
- verified completion >= 90% and not below baseline;
- user intervention does not regress;
- unnecessary approval rate and approvals per verified success materially improve.

### Full repository gate

```bash
npm run check
npm run package
```

EXPECT: Typecheck, lint, Vitest, Node tests, API tests, policy/version checks, and Electron packaging all succeed.

### Security/dependency review

```bash
npm audit
npm --prefix services/api audit
git diff --check
git diff --stat
git diff -- src/shared/contracts.ts src/main/agent services/api/src services/api/migrations src/renderer docs .env.example
```

EXPECT: No newly introduced high/critical dependency finding, whitespace error, secret, or unexplained scope change. Review every policy/protocol/migration diff manually.

### Manual packaged validation

- [ ] Calendar private create requires zero exact approvals and verifies one event.
- [ ] Calendar invitation requires one exact approval with exact attendee consequence.
- [ ] Requested document/spreadsheet create/update flows without redundant approval.
- [ ] Send/delete/archive/publish/deploy/merge/purchase/login/permission/install/sensitive transfer still ask.
- [ ] Workspace requested patch plus tests proceeds; delete/install/push/deploy/destructive command does not bypass.
- [ ] Strict mode asks before all mutations.
- [ ] Prompt injection cannot grant authority.
- [ ] Desktop/API restart after safe observation resumes.
- [ ] Disconnect after consequential effect blocks without retry.
- [ ] v7 task history remains readable and exact-approved.
- [ ] Protocol mismatch fails closed.
- [ ] Kill switch/rollback creates no duplicate task/effect.
- [ ] PostHog payload inspection contains only fixed enums/counts.

---

## Acceptance Criteria

- [ ] One shared runtime tool registry is used by TaskRuntime, coordinator, and hosted desktop worker.
- [ ] The reported `Approval cannot be requested ... runtime tool operation is unavailable` path has a regression test and is fixed.
- [ ] New tasks emit contract v8 with a bounded intent-authorization contract.
- [ ] Only authenticated original/steering user text can compile intent grants.
- [ ] Untrusted visible/tool/model content can raise risk but cannot grant authority.
- [ ] Physical actions and semantic effects are distinct and schema validated.
- [ ] A private calendar event explicitly requested by the user can be created without an exact approval in Balanced mode.
- [ ] Adding an attendee/invitation always requires exact approval.
- [ ] Requested reversible document/spreadsheet/file changes can proceed without repeated approval.
- [ ] Workspace commands bypass UI only through the explicit safe-command policy.
- [ ] Send, delete/archive, unexpected overwrite, publish, deploy, merge, money/trade, credentials, OS permission, install, sensitive transfer, scope expansion, and unknown effects always require approval or denial.
- [ ] Strict mode still confirms every mutation/side effect.
- [ ] v2-v7 tasks retain their prior exact-approval behavior.
- [ ] Exact approvals remain action-digest-bound, one-use, expiring, and revalidated.
- [ ] Approval requirement and consequential retry behavior are separate fields everywhere.
- [ ] Instruction-authorized consequential actions with unknown results block and are never retried.
- [ ] Hosted/local contracts and policy fixtures remain in parity.
- [ ] Protocol v2 and migration 015 deploy forward-only and fail closed on incompatible clients.
- [ ] Analytics contain only fixed enums/counts and no private task/action payload.
- [ ] Reliability benchmark has zero hard-confirm bypasses, false completions, and duplicate consequential actions.
- [ ] `npm run check` passes.
- [ ] `npm run package` passes.
- [ ] Packaged calendar and Workspace manual acceptance traces pass.
- [ ] Security/architecture/operations/user-flow documentation matches deployed behavior.

## Completion Checklist

- [ ] Code follows schema-first, pure-policy, repository, and test patterns captured above.
- [ ] Every new schema has positive, negative, bounds, and legacy tests.
- [ ] Every mutating registered tool operation has a typed effect test.
- [ ] Every hard-confirm effect has a no-bypass test.
- [ ] Local/backend parity fixture passes in both test runners.
- [ ] Shared registry instance is verified by identity/integration test, not just construction review.
- [ ] Error handling remains fail-closed and user-facing summaries are bounded.
- [ ] Logs/analytics follow privacy-safe fixed-property conventions.
- [ ] No hardcoded credentials, recipients, paths, domains, or account identifiers.
- [ ] No model/page/tool content enters authorization compilation.
- [ ] Database migration is forward-only and idempotent.
- [ ] Existing dirty-worktree changes from the durable-runtime implementation are preserved.
- [ ] Documentation and `.env.example` are updated.
- [ ] No unrelated runtime rewrite or new dependency is added.
- [ ] Final diff and packaged app are reviewed before rollout.
- [ ] Plan is self-contained; implementation requires no new architecture decision.

---

## Rollout Gates

| Stage | Cohort | Required evidence to advance |
|---|---:|---|
| Disabled | 0% | v7 behavior remains baseline; protocol/migration deployed but unused. |
| Internal | Explicit user IDs | All automated gates; packaged calendar/Workspace tests; no hard-confirm bypass; database credential rotated. |
| 1% | Stable HMAC cohort | >=100 verified side-effect tasks or 7 days; zero duplicates/false completions; approval reduction visible. |
| 5% | Stable HMAC cohort | Recovery >=95%; no security/privacy incident; no local/backend digest disagreement. |
| 25% | Stable HMAC cohort | Approval and intervention improve without completion regression; support review complete. |
| 100% | All compatible desktops | Protocol-v2 adoption meets threshold; rollback rehearsal complete; docs/privacy notice current. |

Kill-switch behavior:

- Stops creating new v8 tasks.
- Does not reinterpret or duplicate in-flight v8 tasks.
- Leaves existing tasks visible and cancellable.
- Preserves persisted policy/effect metadata for incident review.
- Never changes an unknown consequential action to retryable.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Prompt injection is mistaken for user authority | Medium | Critical | Compiler accepts authenticated user messages only; visible/tool content can only raise risk; parity/injection tests block rollout. |
| Typed effect under-classifies a send/delete/payment | Medium | Critical | Host monotonic merge, exact payload cross-field checks, visible cue raisers, unknown fail-closed, hard-confirm bypass benchmark gate. |
| Approval reduction accidentally makes unknown effects retryable | Low | Critical | Separate `approvalRequired` and `consequential`; retain existing unknown block; fault-injection gate. |
| Local/backend compiler or schema drift | Medium | High | Shared fixture, stable digest, backend canonical projection, protocol mismatch rejection. |
| Contract v8 AAD breaks restored encrypted tasks | Medium | High | Store/select schema version; explicit v7/v8 decrypt tests; do not rewrite ciphertext. |
| Protocol v2 strands older desktop builds | Medium | High | Version/digest handshake, canary compatible clients only, v1 tasks remain cancellable, upgrade-required fail closed. |
| Workspace shell bypass is too permissive | Medium | Critical | Pure safe-command policy, no blanket grants, dangerous syntax deny, tests, exact approval fallback, future sandbox separate. |
| Workspace shell bypass is too restrictive | Medium | Medium | Cover common read/test/lint/typecheck/build families, measure approval reasons, expand only with fixtures and security review. |
| Safe defaults create surprising calendar details | Medium | Medium | Harmless-only list, no recipients/recurrence/public/paid fields, final summary reports defaults, exact approval for externality. |
| Steering leaves stale grants active | Medium | High | Revision-bound actions/digests, atomic outcome+intent revision, pending invocation reevaluation. |
| Registry initialization reorder loses listeners/state | Low | High | One construction point, identity regression test, startup/history/activity tests. |
| Approval telemetry leaks private content | Low | High | Enum-only analytics schema and captured-payload tests; no target/description/arguments. |
| Lower approvals hide poorer completion | Medium | High | Gate on verified completion, false completion, recovery, duplicates, intervention, and approval metrics together. |
| Exposed database credential is reused | Medium | Critical | Rotate before deployment and verify repository/log history contains no credential. |

---

## Notes

- The desired OpenClicky-like quality is the intent-first experience, not its blanket danger-full-access configuration.
- “User instruction is policy” means “the instruction is bounded authority for the reversible effect it names,” not “everything the agent later decides is approved.”
- An instruction grant is broader than one exact click but narrower than a task-wide capability: it is closed effect + resource kind + trusted task scope + current revision.
- Exact action approval remains the right design for the narrow external/destructive/costly/privacy/permission set.
- Agents SDK interruptions should remain because they create a reliable persisted boundary around tool calls. Tro can approve that internal continuation programmatically after local policy and execution without displaying a human prompt.
- Consequential is a recovery/idempotency property. Approval required is a user-authority property. Never collapse them again.
- The calendar trace is the first acceptance test because it simultaneously checks intent compilation, safe defaults, semantic CUA effect typing, shared registry wiring, user-approval suppression, execution, and verification.
- Prefer structured calendar/document/browser/Workspace tools when available; use CUA for the last mile. Policy must be consistent across both routes.
- Do not modify or discard unrelated dirty-worktree changes. This plan was produced against the in-progress completed durable-runtime implementation, not a clean `origin/main` checkout.
