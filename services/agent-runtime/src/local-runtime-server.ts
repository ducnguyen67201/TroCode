import {
  RunContext,
  RunState,
  type AgentInputItem,
  type RunToolApprovalItem,
} from '@openai/agents';

import { AgentGraphFactory } from './agent-graph.js';
import { DEFAULT_AGENT_MODEL, graphVersion } from './config.js';
import {
  turnMessageIdentity,
  type LocalAgentRunContext,
  type TurnIdentity,
} from './host-backed-session.js';
import { childRequestId, type HostBridge } from './host-bridge.js';
import {
  LOCAL_AGENT_CAPABILITIES,
  LOCAL_AGENT_PROTOCOL_DIGEST,
  LOCAL_AGENT_PROTOCOL_VERSION,
  LOCAL_AGENT_ROOT_ID,
  LOCAL_AGENT_SDK_VERSION,
  type LocalAgentHostMessage,
  type LocalTurnEventKind,
  type PendingToolResumeDisposition,
} from './protocol.js';
import { injectRuntimeInstructions, prefetchedInitialTurnInput } from './runtime-model-input.js';
import { ToolOutcomeUnknownError, ToolSurfaceFactory } from './tool-adapter.js';
import {
  EphemeralCredentialStore,
  type ModelRequestDiagnostic,
  UserOpenAIClientFactory,
} from './user-openai-client.js';

export { prefetchedInitialTurnInput } from './runtime-model-input.js';

interface ActiveTurn {
  readonly controller: AbortController;
  readonly steering: string[];
}

interface PendingToolResumeState {
  approve(interruption: RunToolApprovalItem): void;
  reject(
    interruption: RunToolApprovalItem,
    options: { message: string },
  ): void;
}

const RESTARTED_PENDING_TOOL_MESSAGE =
  'The application restarted before this tool ran. Re-check the current state, then request the tool again only if it is still needed.';
const RESTARTED_OBSERVATION_MESSAGE =
  'The saved observation is stale after the application restarted. Capture a fresh observation before requesting another grounded action.';

/** A pre-restart interruption is known not to have run, but its host context is stale. */
export function rejectPendingToolAfterRestart(
  state: PendingToolResumeState,
  interruption: RunToolApprovalItem,
): void {
  state.reject(interruption, { message: RESTARTED_PENDING_TOOL_MESSAGE });
}

export function applyPendingToolResume(
  state: PendingToolResumeState,
  interruption: RunToolApprovalItem,
  disposition: PendingToolResumeDisposition,
  markForReplay: () => void,
): void {
  if (disposition === 'reobserve') {
    state.reject(interruption, { message: RESTARTED_OBSERVATION_MESSAGE });
    return;
  }
  if (disposition === 'recheck') {
    rejectPendingToolAfterRestart(state, interruption);
    return;
  }
  markForReplay();
  state.approve(interruption);
}

export class LocalRuntimeServer {
  private apiBaseUrl = '';
  private readonly credential = new EphemeralCredentialStore();
  private graphFactory: AgentGraphFactory | null = null;
  private initialized = false;
  private readonly turns = new Map<string, ActiveTurn>();

  constructor(
    private readonly bridge: HostBridge,
    private readonly onShutdown: () => void = () => undefined,
  ) {
    bridge.on('message', (message: LocalAgentHostMessage) => void this.handle(message));
    bridge.on('protocol-error', () => this.fatal('invalid_protocol_message', 'The host sent an invalid runtime message.'));
  }

  private async handle(message: LocalAgentHostMessage): Promise<void> {
    try {
      switch (message.kind) {
        case 'runtime.initialize':
          this.initialize(message);
          return;
        case 'runtime.validateCatalog':
          this.requireInitialized();
          this.validateCatalog(message);
          return;
        case 'runtime.replaceCredential':
          this.requireInitialized();
          this.credential.replace(message.credential);
          return;
        case 'runtime.clearCredential':
          this.credential.clear();
          return;
        case 'turn.start':
        case 'turn.resume':
          this.requireInitialized();
          await this.runTurn(message);
          return;
        case 'turn.steer': {
          const active = this.turns.get(message.threadId);
          if (!active) throw new Error('inactive_turn');
          active.steering.push(message.instruction);
          return;
        }
        case 'turn.cancel':
          this.turns.get(message.threadId)?.controller.abort(new Error(message.reason));
          return;
        case 'runtime.shutdown':
          this.credential.clear();
          for (const active of this.turns.values()) active.controller.abort(new Error('shutdown'));
          this.onShutdown();
          return;
        default:
          return;
      }
    } catch (error) {
      this.fatal('runtime_command_failed', safeMessage(error));
    }
  }

  private initialize(message: Extract<LocalAgentHostMessage, { kind: 'runtime.initialize' }>): void {
    if (
      message.expected.protocolVersion !== LOCAL_AGENT_PROTOCOL_VERSION ||
      message.expected.protocolDigest !== LOCAL_AGENT_PROTOCOL_DIGEST ||
      message.expected.sdkVersion !== LOCAL_AGENT_SDK_VERSION ||
      message.expected.graphVersion !== graphVersion([], DEFAULT_AGENT_MODEL)
    ) {
      throw new Error('runtime_version_mismatch');
    }
    const supported = new Set<string>(LOCAL_AGENT_CAPABILITIES);
    if (message.requiredCapabilities.some((capability) => !supported.has(capability))) {
      throw new Error('runtime_capability_mismatch');
    }
    this.apiBaseUrl = message.apiBaseUrl;
    this.graphFactory = new AgentGraphFactory(
      new UserOpenAIClientFactory(() => this.apiBaseUrl, this.credential),
    );
    this.initialized = true;
    this.bridge.send({
      kind: 'runtime.ready',
      requestId: message.requestId,
      runtime: {
        protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION,
        protocolDigest: LOCAL_AGENT_PROTOCOL_DIGEST,
        sdkVersion: LOCAL_AGENT_SDK_VERSION,
        graphVersion: graphVersion([], DEFAULT_AGENT_MODEL),
        capabilities: [...LOCAL_AGENT_CAPABILITIES],
      },
    });
  }

  private validateCatalog(
    message: Extract<LocalAgentHostMessage, { kind: 'runtime.validateCatalog' }>,
  ): void {
    const result = new ToolSurfaceFactory().inspect(
      message.tools,
      message.catalogDigest,
    );
    this.bridge.send({
      kind: 'runtime.catalogValidated',
      requestId: message.requestId,
      ...result,
    });
  }

  private async runTurn(
    message: Extract<LocalAgentHostMessage, { kind: 'turn.start' | 'turn.resume' }>,
  ): Promise<void> {
    if (this.turns.has(message.threadId)) throw new Error('thread_already_active');
    if (message.agentId !== LOCAL_AGENT_ROOT_ID || message.parentAgentId || message.delegationId) {
      throw new Error('unsupported_agent_graph');
    }
    if (message.graphVersion !== graphVersion(message.tools, message.model)) {
      throw new Error('graph_version_mismatch');
    }
    const controller = new AbortController();
    const active: ActiveTurn = { controller, steering: [] };
    this.turns.set(message.threadId, active);
    const identity: TurnIdentity = {
      agentId: message.agentId,
      delegationId: message.delegationId,
      graphVersion: message.graphVersion,
      parentAgentId: message.parentAgentId,
      threadId: message.threadId,
      turnId: message.turnId,
    };
    const context: LocalAgentRunContext = { bridge: this.bridge, identity, signal: controller.signal };
    let checkpointRevision = message.kind === 'turn.resume' ? message.checkpointRevision : 0;
    let completedRunTurns = 0;
    let runBudget = message.maxTurns;
    let continuations = 0;
    try {
      const factory = this.requireGraphFactory();
      const graph = await factory.create(
        {
          agentTurnId: message.agentTurnId,
          graphVersion: message.graphVersion,
          model: message.model,
          requiredInitialTool: message.requiredInitialTool,
          taskId: message.threadId,
          toolCatalogDigest: message.toolCatalogDigest,
          tools: message.tools,
        },
        context,
        (diagnostic) => this.modelRequestEvent(identity, diagnostic),
      );
      this.event(identity, 'lifecycle', 'The local Agents SDK started the turn.');
      let nextInput:
        | string
        | AgentInputItem[]
        | RunState<LocalAgentRunContext, typeof graph.agent>;
      if (message.kind === 'turn.resume') {
        const restored = await RunState.fromStringWithContext(
          graph.agent,
          message.checkpoint,
          new RunContext(context),
        );
        if (message.pendingCallId) {
          if (!message.pendingToolDisposition) {
            throw new Error('pending_tool_disposition_missing');
          }
          const interruption = restored.getInterruptions().find((candidate) =>
            candidate.rawItem.type === 'function_call' && candidate.rawItem.callId === message.pendingCallId,
          );
          if (!interruption) throw new Error('pending_checkpoint_interruption_missing');
          applyPendingToolResume(
            restored,
            interruption,
            message.pendingToolDisposition,
            () => {
              const pending = graph.toolSurface.resolve(interruption);
              graph.toolSurface.markCheckpointed(pending);
            },
          );
          if (message.pendingToolDisposition === 'replay') {
            active.steering.push(
              'The application restarted. Use the durable pending tool result, then observe current state before requesting another computer action.',
            );
          }
          this.event(
            identity,
            'lifecycle',
            message.pendingToolDisposition === 'replay'
              ? 'The app is reconciling a pending tool with its durable invocation journal.'
              : message.pendingToolDisposition === 'reobserve'
                ? 'The app restarted; the agent must capture a fresh observation.'
                : 'The app restarted before a pending tool ran; the agent must re-check current state.',
          );
        } else if (message.pendingToolDisposition) {
          throw new Error('unexpected_pending_tool_disposition');
        }
        nextInput = restored;
      } else {
        nextInput = message.prefetchedInitialToolResult
          ? prefetchedInitialTurnInput(
              message.request,
              message.prefetchedInitialToolResult,
            )
          : message.request;
      }

      for (;;) {
        const result = await factory.runner.run(graph.agent, nextInput, {
          callModelInputFilter: async ({ modelData }) =>
            injectRuntimeInstructions(modelData, active.steering.splice(0)),
          context,
          maxTurns: runBudget,
          session: graph.session,
          signal: controller.signal,
          stream: true,
        });
        for await (const event of result) {
          if (
            event.type !== 'raw_model_stream_event' ||
            event.data.type !== 'output_text_delta'
          ) continue;
          for (let offset = 0; offset < event.data.delta.length; offset += 2_000) {
            this.event(identity, 'assistant_delta', event.data.delta.slice(offset, offset + 2_000));
          }
        }
        await result.completed;
        if (result.interruptions.length === 0) {
          const output = boundedFinalOutput(result.finalOutput);
          checkpointRevision = await this.commitCheckpoint(
            identity,
            checkpointRevision,
            result.state.toString(),
            null,
          );
          const pendingCompletion = graph.toolSurface.pendingCompletion();
          if (pendingCompletion.length > 0) {
            // Includes turns restored from a durable checkpoint, not just model
            // requests emitted by this process since it started.
            completedRunTurns += result.state.toJSON().currentTurn;
            if (continuations >= 2 || completedRunTurns >= message.maxTurns) {
              this.terminal(identity, 'failed', output, 'task_completion_unverified',
                `The task ended without confirmed completion from ${pendingCompletion.join(', ')}.`);
              return;
            }
            continuations++;
            runBudget = message.maxTurns - completedRunTurns;
            // A terminal RunState cannot accept addInput. The SDK session owns
            // the existing history; send only the new continuation instruction.
            nextInput = `The task is not complete: ${pendingCompletion.join(', ')} has not confirmed completion. Inspect the latest tool results and current screen, correct the target or handle intermediate UI, and continue toward the goal. Do not repeat an uncertain operation. Use the required completion tool only after its postconditions are satisfied.`;
            this.event(identity, 'lifecycle', 'The task postcondition is still unverified; continuing from existing tool history.');
            continue;
          }
          this.terminal(identity, 'completed', output, null, 'The local agent completed the turn.');
          return;
        }
        if (result.interruptions.length !== 1) throw new Error('parallel_tool_interruption_not_supported');
        const interruption = result.interruptions[0];
        if (!interruption) throw new Error('missing_sdk_interruption');
        const pending = graph.toolSurface.resolve(interruption);
        this.event(identity, 'tool_requested', `The agent requested ${pending.modelName}.`, {
          callId: pending.callId,
          operation: pending.operation,
          toolId: pending.toolId,
        });
        checkpointRevision = await this.commitCheckpoint(
          identity,
          checkpointRevision,
          result.state.toString(),
          pending.callId,
        );
        graph.toolSurface.markCheckpointed(pending);
        result.state.approve(interruption);
        nextInput = result.state;
      }
    } catch (error) {
      if (error instanceof ToolOutcomeUnknownError) {
        this.terminal(identity, 'unknown', null, 'tool_outcome_unknown', error.message);
      } else if (controller.signal.aborted) {
        this.terminal(identity, 'cancelled', null, 'cancelled', 'The local agent turn was cancelled.');
      } else {
        this.terminal(identity, 'failed', null, classifyCode(error), safeMessage(error));
      }
    } finally {
      this.turns.delete(message.threadId);
    }
  }

  private async commitCheckpoint(
    identity: TurnIdentity,
    expectedRevision: number,
    checkpoint: string,
    pendingCallId: string | null,
  ): Promise<number> {
    const active = this.turns.get(identity.threadId);
    if (!active) throw new Error('inactive_turn');
    const requestId = childRequestId();
    const response = await this.bridge.request({
      ...turnMessageIdentity(this.bridge, identity),
      requestId,
      kind: 'checkpoint.commit',
      checkpoint,
      expectedRevision,
      pendingCallId,
      protocolDigest: LOCAL_AGENT_PROTOCOL_DIGEST,
      sdkVersion: LOCAL_AGENT_SDK_VERSION,
    }, { signal: active.controller.signal });
    if (response.kind !== 'checkpoint.commit.result') throw new Error('unexpected_checkpoint_response');
    return response.checkpointRevision;
  }

  private event(
    identity: TurnIdentity,
    event: LocalTurnEventKind,
    summary: string,
    data: Record<string, unknown> | null = null,
  ): void {
    this.bridge.send({
      ...turnMessageIdentity(this.bridge, identity),
      kind: 'turn.event',
      event,
      summary,
      data,
    });
  }

  private modelRequestEvent(
    identity: TurnIdentity,
    diagnostic: ModelRequestDiagnostic,
  ): void {
    const requestId = diagnostic.serverRequestId ?? diagnostic.clientRequestId;
    const status = diagnostic.status === null ? '' : `${diagnostic.status}; `;
    const choice = diagnostic.toolChoice ? `${diagnostic.toolChoice}; ` : '';
    const elapsed = diagnostic.durationMs === null
      ? ''
      : ` in ${Math.round(diagnostic.durationMs)} ms`;
    const summary = diagnostic.event === 'model_request_started'
      ? `Model request started (${choice}request ${requestId}).`
      : diagnostic.event === 'model_request_completed'
        ? `Model request completed${elapsed} (${status}request ${requestId}).`
      : diagnostic.event === 'model_request_rejected'
          ? `Model request rejected${elapsed} (${status}request ${requestId}).`
        : `Model request failed before a response was received (request ${requestId}).`;
    this.event(identity, diagnostic.event, summary, {
      agentTurnId: diagnostic.agentTurnId,
      clientRequestId: diagnostic.clientRequestId,
      durationMs: diagnostic.durationMs,
      inputItemCount: diagnostic.inputItemCount,
      model: diagnostic.model,
      serverRequestId: diagnostic.serverRequestId,
      status: diagnostic.status,
      taskId: diagnostic.taskId,
      toolChoice: diagnostic.toolChoice,
      toolCount: diagnostic.toolCount,
    });
  }

  private terminal(
    identity: TurnIdentity,
    status: 'completed' | 'failed' | 'cancelled' | 'unknown',
    finalOutput: string | null,
    errorCode: string | null,
    message: string,
  ): void {
    this.bridge.send({
      ...turnMessageIdentity(this.bridge, identity),
      kind: 'turn.terminal',
      status,
      finalOutput,
      errorCode,
      message: message.slice(0, 1_000),
    });
  }

  private fatal(code: string, message: string): void {
    this.bridge.send({ kind: 'runtime.fatal', requestId: childRequestId(), code, message: message.slice(0, 1_000) });
  }

  private requireInitialized(): void {
    if (!this.initialized) throw new Error('runtime_not_initialized');
  }

  private requireGraphFactory(): AgentGraphFactory {
    if (!this.graphFactory) throw new Error('runtime_not_initialized');
    return this.graphFactory;
  }
}

function boundedFinalOutput(value: unknown): string {
  const output = typeof value === 'string' ? value.trim() : JSON.stringify(value);
  if (!output) throw new Error('empty_agent_output');
  return output.slice(0, 8_000);
}

function safeMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'The local agent runtime could not continue.';
  return error.message.replace(/Bearer\s+\S+/giu, 'Bearer [redacted]').slice(0, 1_000);
}

function classifyCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('graph_version')) return 'graph_version_mismatch';
  if (message.includes('session')) return 'session_conflict';
  return 'internal_runtime_error';
}
