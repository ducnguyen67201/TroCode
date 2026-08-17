# Plan: General-Purpose GPT-Led Desktop Agent

## Summary

Replace the deterministic keyword-based domain and capability router with a thin GPT intent compiler and a host-owned runtime tool registry. TroCode will understand requests in any supported language, choose from tools that are actually available, guide or operate arbitrary desktop applications (including music applications), and preserve concrete approval, target, freshness, cancellation, and execution-limit controls.

The first delivery makes music and other domains work through browser navigation, visual guidance, and CUA desktop control. It deliberately does not claim native music generation: producing an audio file without operating an installed or browser-based music application requires a later music-provider adapter registered through the same tool interface.

## User Story

As a TroCode user, I want to describe almost any outcome in natural language and let GPT choose the available tools, so that I can receive answers, visual guidance, or autonomous desktop help without knowing TroCode's internal domain or capability vocabulary.

## Problem → Solution

A brittle English keyword router classifies the request into domains and capabilities, and those guesses become hard authorization gates → GPT compiles only the task behavior and intended outcome, the runtime advertises real tools, and the host evaluates each concrete proposed action according to its consequence and target.

## Metadata

- **Complexity**: XL
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 22-28 files
- **Recommended Delivery**: Implement as four mergeable gates in one branch: contracts, intent compilation, tool execution, then UX/migration.

---

## Product Boundary

### “Mostly everything” means

- Answer general questions using the planner's reasoning.
- Point to and explain visible UI in any application.
- Operate visible desktop and browser applications using click, double-click, type, hotkey, scroll, drag, and HTTPS navigation.
- Continue a task conversationally when information is missing.
- Work across languages without adding language-specific keyword lists.
- Allow future direct tools—filesystem, terminal, connectors, image, audio, and music generation—to register without changing goal classification.

### It does not mean

- Claiming success when the necessary application, account, hardware, or provider is unavailable.
- Bypassing operating-system permissions, authentication, CAPTCHA, DRM, or application restrictions.
- Shipping a bundled music-generation provider in this change.
- Giving GPT raw Electron IPC, raw CUA access, secrets, or authority to approve its own actions.
- Automatically retrying an action whose completion is unknown.

### Music examples covered by this plan

1. “Open Spotify and play lo-fi music” uses browser/desktop tools.
2. “Show me how to make a beat in GarageBand” uses non-clicking visual guidance.
3. “Create a 16-bar beat in GarageBand” uses desktop actions, including drag and hotkeys, and asks for material artistic choices only when necessary.
4. “Export and upload the song” requires exact approval for the concrete write/upload consequence.
5. “Generate an MP3 from this prompt” uses a future registered music-generation provider; without one, TroCode explains that the tool is unavailable instead of pretending it completed the task.

---

## UX Design

### Before

~~~
┌──────────────────────────────────────────────┐
│ Describe the outcome                         │
│ [Mở mail và đọc cho tôi mail gần nhất]       │
│                              [Compile goal]  │
├──────────────────────────────────────────────┤
│ Mixed · 1 capability in scope                │
│ Scope: conversation                          │
│ BLOCKED: browser is outside the goal grant   │
└──────────────────────────────────────────────┘
~~~

### After

~~~
┌──────────────────────────────────────────────┐
│ What should we accomplish?                   │
│ [Mở mail và đọc cho tôi mail gần nhất]       │
│                                  [Start]     │
├──────────────────────────────────────────────┤
│ Working · Reading your latest email          │
│ Using: Desktop control                       │
│ Step 1/30: Opening the mail application      │
│                                              │
│ Approval appears only for a concrete         │
│ consequential action such as Send or Delete. │
└──────────────────────────────────────────────┘
~~~

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Task submission | “Compile goal” invokes a keyword router | “Start” invokes GPT intent compilation | Compilation sees only the user request, never screenshot content |
| Live task summary | Domain, mode, and capability count | Objective, current tool, and current action | Do not expose internal authorization labels |
| Tool selection | Capabilities guessed from request text | Available tools supplied by the trusted runtime | Unavailable tools are not offered to GPT |
| Ordinary navigation | May be blocked by a missed keyword | Allowed when the concrete tool/action policy admits it | HTTPS and runtime availability remain enforced |
| Guidance | Enabled by keyword-derived guide mode | Enabled by GPT intent and the guidance tool | Pointing remains non-mutating |
| Consequential action | Exact approval | Exact approval | Preserve the existing digest, expiry, re-observation, and one-use behavior |
| Unsupported request | Often fails as a capability denial | GPT asks for a missing choice or reports an unavailable tool | Never claim unavailable functionality |
| History | Shows capabilities and interaction mode | Shows objective, behavior, tools used, and outcome | Legacy snapshots remain readable |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---:|---|
| P0 | src/shared/contracts.ts | 1-104, 194-249 | Current GoalSpec, action, and task snapshot schemas that need versioned migration |
| P0 | src/main/agent/goal-router.ts | 178-361 | Keyword classification being replaced |
| P0 | src/main/agent/responses-planner.ts | 155-165, 222-374, 403-476, 532-720 | Existing GPT instructions, function tools, typed parsing, fallback, timeout, and logging |
| P0 | src/main/agent/execution-contracts.ts | 37-214, 266-334 | Desktop command and decision validation plus action normalization |
| P0 | src/main/agent/execution-coordinator.ts | 275-605, 650-710 | Observe-plan-policy-execute loop, freshness checks, unknown-outcome stop, and cleanup |
| P0 | src/main/agent/policy.ts | 16-71 | Current capability/domain denial and approval decision |
| P0 | src/main/agent/task-runtime.ts | 90-190, 341-575, 625-690 | Submission, immutable lifecycle transitions, approval handling, and task updates |
| P1 | src/main/cua/cua-service.ts | 235-479 | CUA observation and command dispatch |
| P1 | src/main/agent/action-approval.ts | 8-30 | Exact normalized action digest to preserve |
| P1 | src/main/agent/desktop-planner.ts | all | Planner interface and step input |
| P1 | src/main/agent/goal-machine.ts | 15-110 | Pure transition table that should remain unchanged unless compilation becomes asynchronous |
| P1 | src/index.ts | 111-180, 829-850 | Main-process service construction and IPC wiring |
| P1 | src/main/ipc/register-ipc.ts | 55-87, 205-239, 319-337 | Trusted renderer and task API boundary |
| P1 | src/shared/desktop-api.ts | 30-104 | Narrow renderer API contract |
| P1 | src/preload.ts | 118-170, 234-257 | Input/output parsing at the preload boundary |
| P1 | src/renderer/App.tsx | 340-380, 859-950, 1078-1188, 1409-1424, 1677-1758 | Goal presentation, input routing, auto-start, and approval UI |
| P1 | src/main/history/task-history-store.ts | 77-158 | JSONB snapshots and the need for backward-compatible parsing |
| P1 | src/renderer/history.ts | 1-62 | Capability/mode fields consumed by History |
| P1 | src/main/analytics/analytics-service.ts | 169-188 | Domain/capability analytics that must be replaced without logging task contents |
| P2 | docs/architecture.md | 70-104 | Current declared planner/host boundary |
| P2 | docs/computer-use-lifecycle.md | all | Lifecycle invariants and evaluation checklist |
| P2 | docs/security.md | 1-45 | Trust boundary and consequential-action requirements |
| P2 | node_modules/@trycua/cua-driver/dist/native/cua_driver_contract.d.ts | 300-318 | Installed CUA DragInput fields: from/to coordinates, duration, steps, button, modifiers |

## External Documentation

No external research is required for this implementation. It uses the established OpenAI Responses request pattern already implemented in GptResponsesPlanner and the installed CUA 0.19.3 contract. The installed SDK declaration confirms that drag is available; no package upgrade is required.

---

## Unified Discovery Table

| Category | File:Lines | Pattern | Key Evidence |
|---|---|---|---|
| Similar implementation | src/main/agent/responses-planner.ts:532-720 | Dependency-injected GPT service with bounded response, fallback model, timeout, and Zod parsing | GptResponsesPlanner already performs typed function selection |
| Naming | src/main/agent/desktop-planner.ts:13-38 | PascalCase interfaces/classes, noun contracts, verb methods | DesktopPlanner.start/decide/end and PlannerStepInput |
| Error handling | src/main/agent/execution-coordinator.ts:599-605 | Convert unknown exceptions into a terminal runtime failure unless aborted | Runtime owns user-visible failure state |
| Logging | src/main/agent/responses-planner.ts:629-655 | Namespaced event plus bounded JSON metadata | planner decision.accepted and model.fallback |
| Type definitions | src/shared/contracts.ts:1-104 | Zod schema first, inferred TypeScript type later | GoalSpecSchema and ProposedActionSchema |
| Test pattern | src/main/agent/responses-planner.test.ts:16-31, 59-145 | Fake Responses envelopes and injected fetch | Tests assert tool list, model, screenshot, and normalized decision |
| Configuration | .env.example:1-3 | Runtime model IDs in environment variables | Primary and fallback planner models |
| Dependencies | package.json | Existing zod, Electron, React, and CUA are sufficient | No new package required |
| Entry point | src/renderer/App.tsx:1078-1148 → preload.ts:118-170 → register-ipc.ts:205-239 | Renderer submits typed input through a narrow IPC API | submit/respond/steer stay separate |
| Data flow | src/main/agent/execution-coordinator.ts:275-605 | Serialized observe → decide → policy → execute → verify loop | One fresh model decision per changing screen |
| State changes | src/main/agent/task-runtime.ts:666-690 | Immutable snapshots plus EventEmitter task updates | Every lifecycle move produces one validated TaskEvent |
| Contracts | src/main/agent/execution-contracts.ts:105-198 | Discriminated decisions and semantic command validation | Invalid command/intent combinations fail before execution |
| Architecture | docs/architecture.md:74-85 | Model proposes; host executes and approves | Preserve this boundary while removing keyword authority |

---

## Patterns to Mirror

### SCHEMA_FIRST_BOUNDARY

SOURCE: src/shared/contracts.ts:48-77

~~~ts
export const ProposedActionSchema = z.object({
  action: SensitiveActionSchema.or(z.enum([...safeActions])),
  description: z.string().min(1),
  target: z.string().optional(),
  parameters: z.record(z.string(), boundedValueSchema).optional(),
});
~~~

Define runtime contracts with Zod and infer exported TypeScript types from them. Parse at model, IPC, history, and execution boundaries.

### DEPENDENCY_INJECTED_SERVICE

SOURCE: src/main/agent/responses-planner.ts:547-562

~~~ts
constructor({
  credentialStore,
  environmentApiKey = process.env.OPENAI_API_KEY,
  fallbackModel = process.env.TROCODE_PLANNER_FALLBACK_MODEL,
  fetchImpl = fetch,
  model = process.env.TROCODE_PLANNER_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ResponsesPlannerOptions) {
  // Store normalized dependencies.
}
~~~

The intent compiler and tool registry must accept injected dependencies so unit tests do not require network or native tools.

### PURE_IMMUTABLE_TRANSITION

SOURCE: src/main/agent/goal-machine.ts:84-110

~~~ts
export function transitionTask(snapshot, nextPhase, details) {
  if (!canTransition(snapshot.phase, nextPhase)) throw new Error(...);
  return {
    ...snapshot,
    phase: nextPhase,
    updatedAt: timestamp,
    lastEvent,
  };
}
~~~

Do not put network calls in lifecycle transition functions. A submission service orchestrates the async compiler and applies its parsed result through TaskRuntime methods.

### ERROR_HANDLING

SOURCE: src/main/agent/responses-planner.ts:522-529, 641-655

~~~ts
function errorSummary(value: unknown): string {
  if (value instanceof z.ZodError) {
    return value.issues.slice(0, 6).map(...).join('; ');
  }
  return value instanceof Error ? value.message.slice(0, 600) : 'Unknown error.';
}
~~~

Bound model and provider error text. Do not log raw provider bodies, screenshots, transcripts, credentials, or tool parameters.

### LOGGING_PATTERN

SOURCE: src/main/agent/responses-planner.ts:629-632

~~~ts
console.info(
  '[planner] decision.accepted',
  JSON.stringify({ taskId, model, kind: decision.kind }),
);
~~~

New events should follow namespace.event-name with small structured metadata: taskId, compiler/planner model, toolId, operation, result status, and fallback reason.

### EXACT_APPROVAL

SOURCE: src/main/agent/action-approval.ts:18-30

~~~ts
return createHash('sha256')
  .update(JSON.stringify(normalizedAction))
  .digest('hex');
~~~

The v2 digest must cover action type, tool ID, operation, target, and every normalized consequential parameter. It must change when any dispatch-relevant value changes.

### TEST_STRUCTURE

SOURCE: src/main/agent/responses-planner.test.ts:16-31, 59-145

~~~ts
function functionResponse(name: string, argumentsValue: unknown): Response {
  return new Response(JSON.stringify({
    status: 'completed',
    output: [{ type: 'function_call', name, arguments: JSON.stringify(argumentsValue) }],
  }), { status: 200 });
}
~~~

Use Vitest, injected fakes, deterministic Responses envelopes, and assertions against the exact tool catalog and normalized host decision.

### NARROW_IPC

SOURCE: src/main/ipc/register-ipc.ts:205-208 and src/preload.ts:118-124

~~~ts
const request = SubmitTaskRequestSchema.parse(input);
const response = await ipcRenderer.invoke(IPC_CHANNELS.submitTask, request);
return TaskSnapshotSchema.parse(response);
~~~

Do not expose tool registry mutation, raw tool execution, CUA, or model calls to the renderer.

---

## Strategic Design

### Approach

1. Replace keyword classification with a model-backed TaskIntentCompiler that sees only the original user request and returns one structured result: compile or clarify.
2. Merge the model result with host-owned fixed approval rules and budgets to create TaskContract v2. The model cannot set approvals, limits, credentials, or available tools.
3. Add a RuntimeToolRegistry in the trusted main process. Registered adapters advertise availability and planner schemas, validate model arguments, normalize a ProposedAction, and execute it.
4. Register the existing desktop/CUA and HTTPS browser executors first. Add CUA drag so creative and music software can be operated realistically.
5. Change policy from “capability string was granted” to “tool exists, operation is valid, target is admissible, and consequence is allowed or exactly approved.”
6. Keep the existing task lifecycle, fresh-observation checks, exact approvals, one-action loop, cancellation, and unknown-outcome stop behavior.

### Task Contract v2

The new active contract should contain:

~~~ts
type TaskContract = {
  schemaVersion: 2;
  id: string;
  originalRequest: string;
  objective: string;
  behavior: 'answer' | 'guide' | 'act';
  successCriteria: Array<{
    description: string;
    verifier: string;
  }>;
  approvalPolicy: {
    alwaysConfirm: SensitiveAction[];
  };
  limits: {
    maxSteps: number;
    maxMinutes: number;
  };
};
~~~

Rules:

- GPT supplies objective, behavior, success description, and clarification needs.
- The host supplies schemaVersion, ID, approvalPolicy, and limits.
- There is no domain field.
- There is no request-derived capability grant.
- Resource hints from GPT may guide planning but are not authorization and should not be persisted as grants.
- Legacy GoalSpec JSON is normalized into TaskContract v2 when history is parsed.

### Intent Compiler Result

~~~ts
type TaskIntentCompilerResult =
  | {
      kind: 'compiled';
      behavior: 'answer' | 'guide' | 'act';
      objective: string;
      successDescription: string;
    }
  | {
      kind: 'clarification';
      prompt: string;
      choices?: string[];
    };
~~~

Compiler instructions:

- Understand the user's language directly; do not use keyword lists.
- “How do I…” and equivalent guidance should not become autonomous mutation.
- Imperative requests such as opening, playing, creating, editing, or organizing should become act.
- General questions become answer.
- Ask only when behavior or the requested outcome is materially ambiguous.
- Never infer approvals or claim a tool exists.
- Never see screenshots, webpages, or other untrusted content during compilation.

### Runtime Tool Registry

~~~ts
interface RuntimeToolAdapter<TInput> {
  readonly id: string;
  availability(): ToolAvailability;
  plannerTool(): ResponsesFunctionTool;
  parseAction(argumentsValue: unknown, context: ToolParseContext): ProposedToolAction;
  execute(action: ProposedToolAction, context: ToolExecutionContext): Promise<ToolOutcome>;
}
~~~

Registry responsibilities:

- Reject duplicate tool IDs.
- Return only available tools to the planner.
- Parse every function call with the selected adapter.
- Never accept an executor or operation that was not advertised for that turn.
- Normalize action details before policy evaluation and approval hashing.
- Dispatch only an action that already passed policy.
- Provide bounded, non-sensitive tool metadata for UI and analytics.

Initial adapters:

| Tool ID | Planner purpose | Execution |
|---|---|---|
| desktop.control | Click, point, type, hotkey, scroll, and drag visible UI | Existing CuaService |
| browser.navigate | Open a public HTTPS URL | Electron shell.openExternal |
| task.guidance | Return ordered non-mutating visual teaching points | Existing host-owned guidance playback |

Planner-owned meta tools remain separate:

- request_user_input
- complete_task
- block_task

Future adapters such as filesystem, terminal, calendar, image generation, or music generation register through this interface. Their presence is runtime configuration, not a phrase inferred from the user's request.

### Proposed Tool Action

~~~ts
type ProposedToolAction = {
  action: SafeAction | SensitiveAction;
  toolId: string;
  operation: string;
  description: string;
  target?: string;
  parameters?: Record<string, string | string[]>;
  observationId?: string;
};
~~~

The adapter, not GPT alone, determines which action values are legal for each operation. Direct tools derive consequence from the operation. Desktop pointer operations retain semantic intent validation because a coordinate alone cannot reveal whether a visible button sends, deletes, or purchases.

### Concrete Host Policy

Policy evaluation order:

1. Parse the normalized action.
2. Confirm toolId was advertised and is still available.
3. Confirm operation belongs to that adapter.
4. For visual actions, require the current observation ID.
5. Validate concrete target rules:
   - HTTPS only for browser navigation.
   - Deny file, javascript, data, custom, localhost, loopback, link-local, and private-network navigation unless a future explicit local-resource grant exists.
   - Do not put screenshot/private text into query parameters.
6. Determine consequence:
   - safe/reversible: answer, guide, observe, public navigation, point, ordinary click, type, keypress, scroll, drag;
   - exact approval: login, send, submit, upload, delete, purchase, install, run command, write/overwrite file, publish/share/export with external effect.
7. If approval is needed, hash the complete normalized dispatch payload.
8. Execute once, then observe and verify.
9. If completion is unknown, stop without retry.

The policy must not deny an action because GPT used a domain label or because a language-specific word was absent.

### Alternatives Considered

| Alternative | Decision | Reason |
|---|---|---|
| Add more English/Vietnamese keywords | Reject | Every new language and domain recreates the same false-negative problem |
| Grant every existing capability string | Reject | Keeps dead labels, hides unavailable executors, and provides no meaningful action safety |
| Give GPT raw CUA or Electron IPC | Reject | Breaks renderer/main isolation, typed validation, cancellation, and exact approvals |
| Use only the existing monolithic desktop action function | Reject | Cannot add direct music/filesystem/connector tools without expanding a central enum forever |
| Replace CUA with an OpenAI-hosted computer-use executor | Reject for this phase | Existing CUA owns local OS permission identity and execution evidence; GPT should reason while the signed host executes |
| Add a dedicated music API now | Defer | The requested architecture should be general first; provider choice, billing, output rights, and storage need their own product decision |

### Scope

- GPT-backed multilingual behavior/objective compilation.
- Backward-compatible TaskContract v2.
- Runtime tool registry with desktop, browser, and guidance adapters.
- Removal of domain/capability authorization.
- CUA drag command.
- Concrete action policy and v2 approval digest.
- Planner, coordinator, runtime, IPC wiring, UI, history, analytics, docs, and tests.

### NOT Building

- A bundled music-generation provider.
- Direct filesystem, terminal, mail, calendar, or cloud connector adapters.
- Plugin installation UI or third-party OAuth.
- Accessibility-element execution; coordinates remain the current fallback.
- Autonomous background execution without visible cancellation.
- Multiple parallel actions or parallel tool calls.
- A migration that rewrites existing PostgreSQL JSONB rows in place.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| src/shared/contracts.ts | UPDATE | Add TaskContract v2, tool/action schemas, and legacy preprocessors |
| src/main/agent/goal-router.ts | DELETE after migration | Remove deterministic domain/capability keyword authority |
| src/main/agent/goal-router.test.ts | REPLACE | Replace keyword tests with intent compiler and contract tests |
| src/main/agent/task-intent-compiler.ts | CREATE | Interface plus GPT Responses compiler implementation |
| src/main/agent/task-intent-compiler.test.ts | CREATE | Multilingual, ambiguity, fallback, timeout, and invalid-output tests |
| src/main/agent/task-contract.ts | CREATE | Pure host merge of compiler result with fixed policy and budgets |
| src/main/agent/task-contract.test.ts | CREATE | Host ownership and legacy normalization tests |
| src/main/agent/task-submission-service.ts | CREATE | Orchestrate async compilation without putting network effects in TaskRuntime |
| src/main/agent/task-submission-service.test.ts | CREATE | Submit/clarify/fail lifecycle tests |
| src/main/agent/tool-registry.ts | CREATE | Adapter registration, availability, parsing, and dispatch |
| src/main/agent/tool-registry.test.ts | CREATE | Duplicate, unavailable, unknown-call, and dispatch tests |
| src/main/agent/execution-contracts.ts | UPDATE | Replace capability with toolId/operation and add drag |
| src/main/agent/execution-contracts.test.ts | UPDATE | Validate generic tool actions, legacy actions, and drag mapping |
| src/main/agent/desktop-planner.ts | UPDATE | Accept TaskContract and available tool catalog |
| src/main/agent/responses-planner.ts | UPDATE | Dynamic registered tools, generalized instructions, no domain/capability gating |
| src/main/agent/responses-planner.test.ts | UPDATE | Assert multilingual task intent and runtime tool catalog |
| src/main/agent/policy.ts | UPDATE | Evaluate concrete tool, operation, target, and consequence |
| src/main/agent/policy.test.ts | UPDATE | Remove capability-grant tests and add target/consequence tests |
| src/main/agent/action-approval.ts | UPDATE | Hash toolId and operation; support legacy action parsing |
| src/main/agent/action-approval.test.ts | UPDATE | Verify every dispatch field changes the digest |
| src/main/agent/task-runtime.ts | UPDATE | Add pure create/apply-compiled-intent/initial-clarification methods |
| src/main/agent/task-runtime.test.ts | UPDATE | Test asynchronous orchestration boundaries and preserved approvals |
| src/main/agent/execution-coordinator.ts | UPDATE | Use registry dispatch and behavior rather than capability checks |
| src/main/agent/execution-coordinator.test.ts | UPDATE | General music/browser/guide flows, unavailable tools, approvals, and unknown outcomes |
| src/main/cua/cua-service.ts | UPDATE | Execute typed drag through installed CUA DragInput |
| src/main/cua/cua-service.test.ts | UPDATE | Assert drag dispatch and outcome handling |
| src/index.ts | UPDATE | Construct compiler, submission service, adapters, registry, and coordinator |
| src/main/ipc/register-ipc.ts | UPDATE | Route submit and initial clarification through submission service |
| src/main/ipc/register-ipc.test.ts | UPDATE | Preserve trusted sender/auth/membership boundaries with async submission |
| src/shared/desktop-api.ts | UPDATE if TaskSnapshot contract changes | Keep renderer surface narrow; do not expose registry execution |
| src/preload.ts | UPDATE if schemas change | Parse TaskContract v2 and legacy-normalized snapshots |
| src/renderer/App.tsx | UPDATE | Remove domain/capability UI and show objective/tool/action |
| src/renderer/history.ts | UPDATE | Derive history from v2 objective/behavior/tools used |
| src/renderer/history.test.ts | UPDATE | Cover v2 and legacy history |
| src/main/analytics/analytics-service.ts | UPDATE | Replace domain/capability properties with behavior/tool/action metadata |
| src/main/analytics/analytics-service.test.ts | UPDATE | Ensure task text, parameters, and targets never enter analytics |
| docs/architecture.md | UPDATE | Document intent compiler and runtime registry |
| docs/computer-use-lifecycle.md | UPDATE | Replace capability policy with concrete tool/action policy |
| docs/conversational-task-execution.md | UPDATE | Document general planner behavior and future adapters |
| docs/security.md | UPDATE | Clarify model reasoning versus host authority |
| README.md | UPDATE | Describe domain-agnostic behavior and honest music boundary |

No SQL migration is required because snapshots are JSONB. Compatibility is handled at schema parsing time.

---

## Step-by-Step Tasks

### Task 1: Establish the domain-agnostic evaluation matrix

- **ACTION**: Write failing tests that describe the desired behavior before changing production code.
- **IMPLEMENT**:
  - Add English and Vietnamese cases for answer, guide, and act.
  - Include the exact regression “Mở mail và đọc cho tôi mail gần nhất.”
  - Add music cases for Spotify playback, GarageBand guidance, and GarageBand action.
  - Assert no case depends on domain or capability labels.
  - Add sensitive variants: send email, delete a file, upload/export a song.
- **MIRROR**: Table-driven request loops in src/main/agent/goal-router.test.ts:39-55 and injected planner responses in responses-planner.test.ts.
- **IMPORTS**: Vitest describe/expect/it/vi, compiler and contract types.
- **GOTCHA**: Test behavior and proposed tools, not exact English wording generated by GPT.
- **VALIDATE**: New tests fail against the keyword router for the expected reasons.

### Task 2: Introduce TaskContract v2 and backward-compatible parsing

- **ACTION**: Replace active domain/capability fields with behavior, objective, host policy, and limits.
- **IMPLEMENT**:
  - Add schemaVersion: 2.
  - Add TaskBehaviorSchema and TaskContractSchema.
  - Preserve the exported GoalSpec name temporarily as a type alias only if it materially reduces migration risk; new code should use TaskContract.
  - Move the current GoalSpec shape into LegacyGoalSpecSchema.
  - Preprocess legacy stored goals into v2:
    - map interactionMode answer/guide/act directly;
    - map mixed to act for imperative historical tasks only for presentation, never resume historical execution;
    - preserve originalRequest, objective, successCriteria, and limits;
    - use the fixed current approval baseline;
    - discard legacy domain, capabilities, and resource grants from active authorization.
  - Preprocess legacy ProposedAction capability into toolId for history display/digest compatibility.
- **MIRROR**: Zod schemas and superRefine patterns in src/shared/contracts.ts:48-104 and 206-249.
- **IMPORTS**: zod, existing action/task schemas.
- **GOTCHA**: TaskHistorySchema parses stored JSONB on every load. Removing fields without preprocessing would make all existing history fall back to session-only mode.
- **VALIDATE**: Parse new v2 snapshots and representative pre-change snapshots; serialize only v2 for new tasks.

### Task 3: Build the GPT task intent compiler

- **ACTION**: Create a model-backed compiler that returns compiled intent or clarification.
- **IMPLEMENT**:
  - Use the existing Responses endpoint, credentials, primary/fallback model settings, timeout, maximum response size, safety identifier, store:false, required single function call, and parallel_tool_calls:false.
  - Define strict compile_task_intent and request_task_clarification functions.
  - Send only the user request and primary language preference if available.
  - Never send screenshots, history beyond the current clarification exchange, available secrets, or tool results.
  - Parse output with TaskIntentCompilerResultSchema.
  - Retry only by switching once from the configured primary model to fallback after invalid/non-auth failures, matching GptResponsesPlanner.
  - Log compiler.intent-accepted and compiler.model-fallback with bounded metadata.
- **MIRROR**: GptResponsesPlanner constructor, request, errorSummary, model fallback, and abort handling in src/main/agent/responses-planner.ts:516-720.
- **IMPORTS**: createHash, zod, VoiceCredentialStore or a renamed shared ModelCredentialStore.
- **GOTCHA**: A compiler model must not return approval rules, capability grants, limits, tool IDs, or execution commands.
- **VALIDATE**: Unit tests cover Vietnamese, music, ambiguous requests, invalid response, 401/403, timeout, abort, response-size limit, and fallback.

### Task 4: Add async submission orchestration while keeping runtime transitions pure

- **ACTION**: Add TaskSubmissionService and split synchronous TaskRuntime.submit responsibilities.
- **IMPLEMENT**:
  - TaskRuntime.createTask parses input, creates idle/interpreting state, and emits the initial event.
  - TaskRuntime.applyCompiledIntent takes parsed compiler output, calls pure createTaskContract, and moves to ready.
  - TaskRuntime.requestInitialClarification creates the existing clarification interaction.
  - TaskSubmissionService.submit orchestrates create → compile → apply/clarify.
  - TaskSubmissionService.respondToInteraction recompiles only pre-goal clarification answers; runtime task-scoped answers still resume the execution coordinator.
  - Compiler failures move the task to failed with a bounded message; they do not silently fall back to keyword routing.
  - Update IPC routing to await the service.
- **MIRROR**: TaskRuntime immutable move/record methods and register-ipc trusted/membership boundary.
- **IMPORTS**: SubmitTaskRequestSchema, RespondToInteractionRequestSchema, TaskIntentCompiler, TaskRuntime.
- **GOTCHA**: Avoid double-emitting or auto-starting an interpreting snapshot. Renderer auto-start remains phase === ready only.
- **VALIDATE**: Tests prove valid submit becomes ready, ambiguous submit becomes clarifying, clarification becomes ready, compiler failure becomes failed, and stale clarification IDs remain rejected.

### Task 5: Implement the trusted runtime tool registry

- **ACTION**: Create adapter and registry contracts, then register current tools.
- **IMPLEMENT**:
  - Add RuntimeToolAdapter, ToolAvailability, ProposedToolAction, ToolOutcome, and bounded planner function definition types.
  - Registry registration rejects duplicate IDs and malformed schemas.
  - listAvailablePlannerTools returns only adapters currently available.
  - parseFunctionCall verifies the function was advertised for that planner turn and delegates Zod parsing to the adapter.
  - dispatch requires a prior normalized policy decision token or an internal coordinator-only method; the renderer receives no registry API.
  - Implement desktop.control, browser.navigate, and task.guidance adapters.
  - Keep request/complete/block as planner meta tools rather than executable adapters.
- **MIRROR**: DesktopPlanner interface injection and CuaService private execution surface.
- **IMPORTS**: zod, execution contracts, CuaService types, Electron shell callback type.
- **GOTCHA**: Do not store mutable native handles or secrets in planner descriptors. Tool availability can change between planning and dispatch and must be rechecked.
- **VALIDATE**: Unit tests cover duplicate ID, unavailable tool omission, unadvertised call rejection, invalid arguments, availability change, one dispatch, and abort propagation.

### Task 6: Generalize planner decisions and add drag

- **ACTION**: Replace the monolithic capability-bearing action with adapter-defined tools.
- **IMPLEMENT**:
  - Remove capability from ActionArgumentsSchema, DesktopActionDecisionSchema, planner input JSON, and system instructions.
  - Add toolId and operation to normalized actions.
  - Give the planner the current TaskContract plus registry tool definitions.
  - Offer guidance for guide behavior, executable tools for act behavior, and answer/ask/complete/block for answer behavior.
  - Generalize instructions so music, creative, productivity, and other domains are examples rather than special modes.
  - Add drag with normalized from/to points, left button default, bounded duration, bounded steps, and optional modifiers.
  - Map both drag endpoints from normalized model coordinates into screenshot pixels exactly once.
  - Preserve stale observation rejection.
- **MIRROR**: Existing ActionArgumentsSchema, mapActionToScreenshot, and DesktopStepDecisionSchema parsing.
- **IMPORTS**: RuntimeToolRegistry catalog, TaskContract, coordinate mapping helpers.
- **GOTCHA**: For dynamic UI, allow only one mutating tool action before re-observation. Do not turn a model response into a prerecorded multi-action script.
- **VALIDATE**: Planner tests assert exact available functions, no capability enum, multilingual decisions, drag coordinate mapping, tool omission when unavailable, and no parallel calls.

### Task 7: Replace capability policy with concrete action policy

- **ACTION**: Rewrite evaluateAction around tool/operation/target/consequence.
- **IMPLEMENT**:
  - Remove goal.capabilities membership denial.
  - Remove keyword-derived allowedDomains authority.
  - Validate advertised tool and operation through registry state.
  - Add pure public HTTPS target validation, including private-address and unsafe-scheme rejection.
  - Retain the fixed host approval set independent of user keywords.
  - Require exact approval for sensitive actions regardless of compiler or planner wording.
  - For direct adapters, derive action consequence from the operation.
  - For desktop click/keypress, retain command-intent agreement and require structured payloads for send/upload/purchase and other supported sensitive effects.
  - Update approval digest normalization to include toolId and operation.
- **MIRROR**: Pure PolicyDecision return shape in src/main/agent/policy.ts and createActionDigest normalization.
- **IMPORTS**: TaskContract, ProposedToolAction, registry availability snapshot, URL/IP validation helpers.
- **GOTCHA**: The model must not bypass approval by labeling a Send button as click_element. Keep and expand intent/command/payload validation; plan future accessibility-element consequence detection as a separate hardening task.
- **VALIDATE**: Tests cover safe navigation, unsafe schemes/private targets, unknown tools, unavailable tools, every sensitive action, mislabeled sensitive pointer actions, and digest changes.

### Task 8: Route execution through adapters and extend CUA

- **ACTION**: Make TaskExecutionCoordinator dispatch through RuntimeToolRegistry and implement CUA drag.
- **IMPLEMENT**:
  - Keep CUA observation, GPT decision, stale ID check, policy, approval, execute, verify, and re-observe order.
  - Replace the open_url/otherwise switch with registry dispatch.
  - Keep companion presentation for point/click/drag endpoints.
  - Add CuaService drag dispatch using DragInput.new with fromX/fromY/toX/toY, Desktop scope, task session, durationMs, steps, button, and modifiers.
  - Preserve ActionEffect mapping and unknown-outcome no-retry semantics.
  - Add toolId/operation to action.outcome logs without logging parameters.
  - Registry cleanup must not own CUA task-session cleanup; coordinator remains the task lifecycle owner.
- **MIRROR**: execution-coordinator.ts:540-605 and 650-710; cua-service.ts:322-470.
- **IMPORTS**: RuntimeToolRegistry, ProposedToolAction, installed CUA DragInput/ClickButton.
- **GOTCHA**: A drag has two coordinate pairs. Map model → screenshot once in planner; CUA receives screenshot pixels without a second scale conversion.
- **VALIDATE**: Coordinator and CUA tests cover confirmed drag, refused move, unknown drag, abort, presentation order, fresh re-observation, and single dispatch.

### Task 9: Wire services through main and IPC

- **ACTION**: Construct and inject the compiler, submission service, registry, adapters, and coordinator.
- **IMPLEMENT**:
  - Build model credential dependency once and share it without exposing the key.
  - Register desktop/browser/guidance adapters in src/index.ts.
  - Pass registry/catalog to planner and coordinator.
  - Pass TaskSubmissionService to registerIpcHandlers.
  - Keep submit/respond/start/cancel/steer as the only renderer task mutations.
  - Preserve authenticated sender and active membership checks.
  - Preserve shutdown order: abort coordinator, end CUA sessions, then stop native runtime.
- **MIRROR**: Main-process construction in src/index.ts:111-180 and service injection in register-ipc.ts:27-53.
- **IMPORTS**: New compiler, contract factory, submission service, registry, adapters.
- **GOTCHA**: Initial clarification responses and running-task clarification responses take different paths; do not accidentally resume a coordinator that has not started.
- **VALIDATE**: IPC tests verify auth, membership, trusted frame, async submit, initial clarification, running response, and absence of raw tool execution channels.

### Task 10: Replace capability UX, history, and analytics

- **ACTION**: Present useful execution state instead of internal domain grants.
- **IMPLEMENT**:
  - Change “Compile goal” to “Start”.
  - Remove domain/mode/capability counts and tags from LiveTaskRail.
  - Show objective, behavior label only when helpful, current tool display name, current operation description, and progress.
  - Keep exact approval UI unchanged except field labels tool/operation replace capability.
  - Update examples with multilingual and music tasks.
  - Update HistoryEntry to show behavior and tools used; normalize legacy goals.
  - Replace analytics capability_count/domain/requires_computer_use with behavior, tool_id, operation, and outcome status.
  - Never emit request text, target, parameters, filenames, URLs, screenshots, or model output to analytics.
- **MIRROR**: App error handling in sendInput, static rendering tests in SettingsPage.test.ts, and analytics privacy assertions.
- **IMPORTS**: TaskContract, safe task event metadata.
- **GOTCHA**: Tool details may contain private document names or URLs. UI can show task-local descriptions; analytics must use fixed IDs only.
- **VALIDATE**: Renderer tests show no capability tags, approvals remain visible, legacy history renders, and analytics serialization excludes private values.

### Task 11: Update documentation and run release-level verification

- **ACTION**: Align architecture/security documentation and execute all checks.
- **IMPLEMENT**:
  - Update process diagrams: TaskIntentCompiler and RuntimeToolRegistry replace Goal Router and capability policy.
  - Document that runtime availability is not user authorization.
  - Document the first-party tool set and future adapter contract.
  - Document the music boundary honestly.
  - Update evaluation set with multilingual and cross-domain tasks.
  - Remove claims that domains/capabilities establish execution authority.
- **MIRROR**: Existing architecture and lifecycle documents.
- **IMPORTS**: N/A.
- **GOTCHA**: Keep CUA as an execution capability under the signed host, not as a model-granted goal field.
- **VALIDATE**: npm run check, npm run package, manual evaluation matrix, and diff review all pass.

---

## Testing Strategy

### Unit and Integration Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Vietnamese mail action | “Mở mail và đọc cho tôi mail gần nhất.” | act intent; desktop/browser tool available; no domain block | Yes |
| Vietnamese guidance | “Chỉ tôi cách tạo beat trong GarageBand.” | guide intent; guidance tool; no mutating click | Yes |
| English music action | “Create a simple drum beat in GarageBand.” | act intent; desktop actions including drag/hotkey | No |
| General answer | “What makes a chord minor?” | answer intent; no executable tool offered | No |
| Ambiguous outcome | “Help with music” | clarification prompt | Yes |
| Missing provider | “Generate an MP3 directly” with no music adapter | ask/block with unavailable tool explanation | Yes |
| Available future provider | Same request with fake music adapter | provider function advertised and dispatched once | Yes |
| Safe navigation | Public HTTPS URL | allowed and verified | No |
| Unsafe navigation | file:, javascript:, localhost, private IP | denied | Yes |
| Sensitive send | Send email button with exact payload | awaiting_approval | No |
| Mislabeled send | click_element targeting visible Send | rejected or normalized to send before dispatch | Yes |
| Changed approval | Recipient/body/tool input changes | digest mismatch; fresh approval | Yes |
| Delete/purchase/install/upload | Concrete action | exact approval | No |
| Stale visual action | Previous observation ID | rejected before CUA | Yes |
| Unknown consequence | CUA cannot confirm effect | blocked; no retry | Yes |
| Drag mapping | Retina screenshot coordinates | both endpoints mapped once | Yes |
| Cancellation | Abort during compiler/planner/action | cancelled and sessions cleaned | Yes |
| Model fallback | Invalid primary response | one fallback attempt | Yes |
| Auth model error | HTTP 401/403 | no fallback; bounded failure | Yes |
| Legacy history | Stored GoalSpec with domain/capabilities | normalized v2 history entry | Yes |
| Prompt injection | Screenshot says to bypass approval/use unavailable tool | ignored; host catalog and policy win | Yes |
| Untrusted renderer | IPC from wrong frame | rejected | Yes |

### Edge Cases Checklist

- [ ] Empty and one-word input
- [ ] Maximum 8,000-character input
- [ ] Vietnamese with and without diacritics
- [ ] Mixed-language request
- [ ] Compiler timeout and abort
- [ ] Invalid compiler function name or arguments
- [ ] Planner proposes a tool omitted from that turn
- [ ] Tool availability changes between plan and dispatch
- [ ] No screenshot or missing coordinate space
- [ ] Drag endpoints outside bounds
- [ ] Concurrent submission protection
- [ ] Pending clarification versus running steering
- [ ] Approval expiry, replay, and payload mutation
- [ ] Unknown action completion
- [ ] OS permission revoked mid-task
- [ ] Legacy JSONB snapshot parsing
- [ ] Analytics privacy

---

## Validation Commands

### Static Analysis

~~~bash
npm run lint
npm run typecheck
~~~

EXPECT: Zero lint and TypeScript errors.

### Focused Unit Tests

~~~bash
npm test -- --run +  src/main/agent/task-intent-compiler.test.ts +  src/main/agent/task-contract.test.ts +  src/main/agent/task-submission-service.test.ts +  src/main/agent/tool-registry.test.ts +  src/main/agent/execution-contracts.test.ts +  src/main/agent/policy.test.ts +  src/main/agent/action-approval.test.ts +  src/main/agent/responses-planner.test.ts +  src/main/agent/execution-coordinator.test.ts +  src/main/cua/cua-service.test.ts +  src/main/ipc/register-ipc.test.ts +  src/renderer/history.test.ts
~~~

EXPECT: All focused tests pass.

### Full Test Suite

~~~bash
npm run check
~~~

EXPECT: Lint, typecheck, and all Vitest files pass.

### Package Validation

~~~bash
npm run package
~~~

EXPECT: Electron Forge produces the current-platform application without exposing native CUA assets or secrets incorrectly.

### Diff Validation

~~~bash
git diff --check
git status --short
~~~

EXPECT: No whitespace errors. Existing unrelated user changes remain preserved.

### Manual Validation

- [ ] Submit “Mở mail và đọc cho tôi mail gần nhất.” and confirm it opens/reads without a domain or capability denial.
- [ ] Submit “Open Spotify and play lo-fi music” and confirm normal visible actions proceed.
- [ ] Submit “Show me how to make a beat in GarageBand” and confirm TroCode points/explains without clicking.
- [ ] Submit “Create a 16-bar beat in GarageBand” and confirm click/type/hotkey/drag actions re-observe between steps.
- [ ] Attempt Send, Delete, Upload, Purchase, and Install; confirm exact approval appears with concrete fields.
- [ ] Change an approved payload before dispatch; confirm approval is invalidated.
- [ ] Revoke CUA permission mid-task; confirm safe failure and cleanup.
- [ ] Ask for an unavailable direct MP3 generator; confirm TroCode reports the missing tool rather than claiming completion.
- [ ] Open History containing tasks created before this migration.
- [ ] Press Escape during planning, observation, and action; confirm cancellation.

---

## Acceptance Criteria

- [ ] No production execution decision depends on DOMAIN_TERMS, ACT_TERMS, GUIDE_PREFIXES, ANSWER_PREFIXES, or request-derived capability lists.
- [ ] The deterministic keyword Goal Router is removed from active task compilation.
- [ ] GPT compiles behavior/objective from multilingual input before receiving untrusted screen content.
- [ ] Host code—not GPT—sets approval rules and limits.
- [ ] Planner receives only tools currently available from RuntimeToolRegistry.
- [ ] A proposed unadvertised or unavailable tool is rejected before execution.
- [ ] Capability is removed from active ProposedAction and approval policy.
- [ ] Ordinary in-scope desktop operations are not blocked by missing domain labels.
- [ ] Consequential actions still require exact, expiring, one-use approval.
- [ ] CUA drag is supported and both endpoints are mapped exactly once.
- [ ] Every mutating visual action uses a fresh observation and is followed by re-observation.
- [ ] Unknown consequential outcomes are never automatically retried.
- [ ] Music applications can be guided or operated through the desktop tool.
- [ ] Missing direct music generation is reported honestly.
- [ ] Existing task history remains readable without rewriting database rows.
- [ ] Renderer remains sandboxed and receives no raw tool, CUA, model, or IPC handle.
- [ ] Analytics contains fixed tool/action IDs only and no private task content.
- [ ] All validation commands pass.

## Completion Checklist

- [ ] Code follows discovered Zod, service injection, logging, and Vitest patterns.
- [ ] Network effects remain outside pure lifecycle transitions.
- [ ] Error messages are bounded and provider response bodies are not logged.
- [ ] Tool registry is main-process-only.
- [ ] Approval hashing includes all dispatch-relevant fields.
- [ ] No hardcoded language vocabulary is added as a fallback.
- [ ] No new package is introduced unnecessarily.
- [ ] Documentation and examples reflect general-purpose behavior.
- [ ] Existing user work in the dirty/staged worktree is preserved.
- [ ] Plan can be implemented without additional codebase discovery.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| GPT misclassifies answer/guide/act | Medium | Medium | Strict compiler schema, clarification result, evaluation matrix, and compiler-only view of user text |
| Model labels a sensitive desktop click as ordinary | Medium | High | Keep intent-command validation, structured sensitive payloads, exact approval, and add accessibility-based consequence detection in later hardening |
| Broad browser navigation enables unsafe local targets | Medium | High | HTTPS-only public target policy; deny private/local/special schemes |
| Tool registry becomes an untyped plugin escape hatch | Medium | High | Adapter-owned Zod schemas, main-process registration only, advertised-turn token, no renderer registry mutation |
| Async compilation complicates lifecycle | Medium | Medium | Submission service orchestrates effects; TaskRuntime transitions stay pure |
| Legacy history fails parsing | Medium | Medium | Schema preprocessor and fixture tests; no in-place database rewrite |
| Extra compiler call adds latency/cost | High | Low | Low reasoning effort, small token budget, compiler result caching only within task clarification, measure latency |
| Desktop-only music work is fragile | High | Medium | Add drag, re-observe every action, ask on ambiguity, never claim a direct generator exists |
| “Mostly everything” creates product overpromising | High | High | Display available tools, provide honest unavailable-tool outcomes, document provider boundaries |

## Notes

- The architecture audit found a wrapper regression at the tool-selection/policy layer: GPT understood the task, but keyword-generated capability authority blocked it.
- The fix is not “remove all safeguards.” It is to attach safeguards to concrete actions and targets.
- Computer use is a runtime executor. It should not be a phrase-derived goal permission.
- Domain labels may remain temporarily in legacy parsing or historical analytics migration code, but they must not influence new execution.
- The registry is the extensibility point for future music generation. A later adapter should define provider choice, credentials, cost confirmation, output format, storage location, licensing metadata, and exact write/upload consequences.

