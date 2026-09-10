import {
  utilityProcess,
  type ForkOptions,
  type UtilityProcess,
} from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { z } from 'zod';

import {
  DEFAULT_AGENT_MODEL,
  graphVersion,
} from '../../../services/agent-runtime/src/config';
import {
  LOCAL_AGENT_CAPABILITIES,
  LOCAL_AGENT_PROTOCOL_DIGEST,
  LOCAL_AGENT_PROTOCOL_VERSION,
  LOCAL_AGENT_ROOT_ID,
  LOCAL_AGENT_SDK_VERSION,
  LocalAgentChildMessageSchema,
  LocalAgentHostMessageSchema,
  type LocalAgentCapability,
  type LocalAgentChildMessage,
  type LocalAgentHostMessage,
  type LocalRuntimeCatalogValidation,
  type LocalRuntimeToolSpec,
  type LocalToolExecutionResult,
  type PendingToolResumeDisposition,
  type RequiredInitialToolCall,
} from '../../../services/agent-runtime/src/protocol';
import { digest } from '../../../services/agent-runtime/src/serialization';
import type { ResolvedToolInvocation, ToolExecutionResult } from '../agent/agent-contracts';
import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';
import type {
  RuntimeToolRegistry,
  ToolResolutionContext,
  TrustedToolExecutionContext,
} from '../agent/runtime-tool-registry';

import type { EncryptedAgentStateStore } from './encrypted-agent-state-store';
import type { LocalInvocation } from './local-agent-state';
import { normalizeLocalToolResult } from './local-tool-result';
import { withTimeout } from './runtime-timeout';

export { normalizeLocalToolResult } from './local-tool-result';













const AgentTurnResponseSchema = z.object({ id: z.string().uuid() }).passthrough();
const RUNTIME_READY_TIMEOUT_MS = 15_000;
const REQUIRED_RUNTIME_CAPABILITIES = [
  'sessions',
  'compaction',
  'catalogValidation',
] as const satisfies readonly LocalAgentCapability[];

export interface LocalTurnStart {
  executionContext: TrustedToolExecutionContext;
  maxTurns: number;
  model?: string;
  request: string;
  requiredInitialTool?: RequiredInitialToolCall;
  threadId: string;
}

export interface LocalRuntimeTerminal {
  modelRequestCount?: number;
  errorCode: string | null;
  finalOutput: string | null;
  message: string;
  status: 'completed' | 'failed' | 'cancelled' | 'unknown';
  threadId: string;
  turnId: string;
}

export interface AgentRuntimeAdapter {
  readonly kind: 'local';
  cancel(threadId: string, reason: 'stop_button' | 'focused_escape' | 'replacement' | 'sign_out' | 'shutdown'): void;
  initialize(): Promise<void>;
  resume(threadId: string, executionContext: TrustedToolExecutionContext): Promise<void>;
  start(input: LocalTurnStart): Promise<void>;
  steer(threadId: string, instruction: string): void;
  shutdown(): Promise<void>;
}

interface ActiveTurn {
  readonly modelRequests: Set<string> | null;
  readonly agentTurnId: string;
  readonly catalog: { digest: string; tools: LocalRuntimeToolSpec[] };
  readonly controller: AbortController;
  executionContext: GroundedToolExecutionContext;
  readonly graphVersion: string;
  readonly model: string;
  requiredInitialTool: RequiredInitialToolCall | null;
  readonly turnId: string;
}

type GroundedToolExecutionContext = TrustedToolExecutionContext &
  Pick<ToolResolutionContext, 'latestObservation'>;

export interface LocalAgentRuntimeOptions {
  accessTokenProvider(): Promise<string>;
  apiBaseUrl: string;
  coordinator: Pick<TaskExecutionCoordinator, 'dispatchTool' | 'endTask'>;
  forkUtilityProcess?: (
    modulePath: string,
    args?: string[],
    options?: ForkOptions,
  ) => UtilityProcess;
  isPackaged: boolean;
  onEvent?(message: Extract<LocalAgentChildMessage, { kind: 'turn.event' }>): void;
  onTerminal?(terminal: LocalRuntimeTerminal): Promise<void> | void;
  repositoryRoot: string;
  resourcesPath: string;
  runtimeReadyTimeoutMs?: number;
  state: EncryptedAgentStateStore;
  tools: RuntimeToolRegistry;
  beforeTool?(taskId: string, invocation: ResolvedToolInvocation): Promise<void>;
}

export class LocalAgentRuntime implements AgentRuntimeAdapter {
  readonly kind = 'local' as const;
  private readonly active = new Map<string, ActiveTurn>();
  private child: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readonly childSequences = new Map<string, number>();
  private readonly hostSequences = new Map<string, number>();
  private handshakeRequestId: string | null = null;
  private readonly pendingCatalogValidations = new Map<
    string,
    {
      reject(error: Error): void;
      resolve(result: LocalRuntimeCatalogValidation): void;
    }
  >();
  private readonly pendingDeltas = new Map<string, {
    message: Extract<LocalAgentChildMessage, { kind: 'turn.event' }>;
    text: string;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(private readonly options: LocalAgentRuntimeOptions) {}

  async initialize(): Promise<void> {
    await this.ensureReady(await this.options.accessTokenProvider());
  }

  async validateToolCatalog(
    tools: readonly LocalRuntimeToolSpec[],
    catalogDigest: string,
  ): Promise<LocalRuntimeCatalogValidation> {
    await this.ensureReady(await this.options.accessTokenProvider());
    const requestId = randomUUID();
    const result = new Promise<LocalRuntimeCatalogValidation>((resolve, reject) => {
      this.pendingCatalogValidations.set(requestId, { resolve, reject });
    });
    try {
      this.post({
        kind: 'runtime.validateCatalog',
        requestId,
        catalogDigest,
        tools: [...tools],
      });
      return await withTimeout(
        result,
        this.options.runtimeReadyTimeoutMs ?? RUNTIME_READY_TIMEOUT_MS,
        'The bundled local agent runtime did not validate the tool catalog.',
      );
    } finally {
      this.pendingCatalogValidations.delete(requestId);
    }
  }

  async start(input: LocalTurnStart): Promise<void> {
    if (this.active.has(input.threadId)) {
      throw new Error('The local agent thread already has an active turn.');
    }
    const token = await this.options.accessTokenProvider();
    await this.ensureReady(token);
    const executionContext = { ...input.executionContext };
    const catalog = this.options.tools.freeze(executionContext);
    const model = input.model?.trim() || DEFAULT_AGENT_MODEL;
    const version = graphVersion(catalog.tools, model);
    const turnId = randomUUID();
    const agentTurnId = await this.reserveAgentTurn(input.threadId, turnId, token);
    const active: ActiveTurn = {
      modelRequests: new Set(),
      agentTurnId,
      catalog,
      controller: new AbortController(),
      executionContext,
      graphVersion: version,
      model,
      requiredInitialTool: input.requiredInitialTool ?? null,
      turnId,
    };
    this.active.set(input.threadId, active);
    try {
      const prefetchedInitialToolResult =
        await this.prefetchInitialObservation(input.threadId, active);
      this.post({
        ...this.turnIdentity(input.threadId, active),
        kind: 'turn.start',
        agentTurnId,
        request: input.request,
        requiredInitialTool: active.requiredInitialTool,
        prefetchedInitialToolResult,
        model,
        maxTurns: input.maxTurns,
        toolCatalogDigest: catalog.digest,
        tools: catalog.tools,
      });
    } catch (error) {
      this.active.delete(input.threadId);
      this.options.tools.endTask(input.threadId);
      throw error;
    }
  }

  private async prefetchInitialObservation(
    threadId: string,
    active: ActiveTurn,
  ): Promise<LocalToolExecutionResult | null> {
    const required = active.requiredInitialTool;
    if (required?.modelName !== 'observe_context') return null;

    const callId = `host-observe-${randomUUID()}`;
    this.emitPrefetchedToolLifecycle(
      threadId,
      active,
      'tool_started',
      'Capturing the required initial screen context.',
      callId,
      'computer.observe',
      'observe',
    );
    try {
      const invocation = this.options.tools.resolve(
        {
          arguments: JSON.stringify(required.arguments),
          callId,
          name: required.modelName,
        },
        active.executionContext,
      );
      if (invocation.toolId !== 'computer.observe') return null;
      const result = await this.options.coordinator.dispatchTool(invocation, {
        signal: active.controller.signal,
        taskId: threadId,
      });
      const normalized = normalizeLocalToolResult(result);
      if (normalized.status !== 'completed') {
        this.emitPrefetchedToolLifecycle(
          threadId,
          active,
          'tool_failed',
          normalized.summary,
          callId,
          invocation.toolId,
          invocation.operation,
        );
        return null;
      }
      active.executionContext = executionContextAfterToolResult(
        active.executionContext,
        result,
      );
      active.requiredInitialTool = null;
      this.emitPrefetchedToolLifecycle(
        threadId,
        active,
        'tool_completed',
        normalized.summary,
        callId,
        invocation.toolId,
        invocation.operation,
      );
      return normalized;
    } catch (error) {
      this.emitPrefetchedToolLifecycle(
        threadId,
        active,
        'tool_failed',
        safeError(error),
        callId,
        'computer.observe',
        'observe',
      );
      return null;
    }
  }

  private emitPrefetchedToolLifecycle(
    threadId: string,
    active: ActiveTurn,
    event: 'tool_started' | 'tool_completed' | 'tool_failed',
    summary: string,
    callId: string,
    toolId: string,
    operation: string,
  ): void {
    this.options.onEvent?.({
      ...this.turnIdentity(threadId, active),
      kind: 'turn.event',
      event,
      summary: summary.slice(0, 2_000),
      data: { callId, operation, toolId },
    });
  }

  async resume(threadId: string, executionContext: TrustedToolExecutionContext): Promise<void> {
    if (this.active.has(threadId)) {
      throw new Error('The local agent thread already has an active turn.');
    }
    const token = await this.options.accessTokenProvider();
    await this.ensureReady(token);
    const state = await this.options.state.readThread(threadId);
    if (state.classroomLessonId || executionContext.lesson) throw new Error('Lesson children cannot replay after interruption. Use the lesson controls.');
    const checkpoint = state.checkpoint;
    if (!checkpoint) throw new Error('Local task has no durable SDK checkpoint.');
    const pendingToolDisposition = checkpoint.pendingCallId
      ? pendingToolResumeDisposition(
          await this.options.state.invocation(threadId, checkpoint.pendingCallId),
        )
      : null;
    const groundedExecutionContext = { ...executionContext };
    const catalog = this.options.tools.freeze(groundedExecutionContext);
    const version = graphVersion(catalog.tools, checkpoint.model);
    if (catalog.digest !== checkpoint.toolCatalogDigest || version !== checkpoint.graphVersion) {
      throw new Error('The installed local agent graph changed; this checkpoint cannot be resumed safely.');
    }
    const active: ActiveTurn = {
      modelRequests: null,
      agentTurnId: checkpoint.agentTurnId,
      catalog,
      controller: new AbortController(),
      executionContext: groundedExecutionContext,
      graphVersion: checkpoint.graphVersion,
      model: checkpoint.model,
      requiredInitialTool: checkpoint.requiredInitialTool,
      turnId: randomUUID(),
    };
    this.active.set(threadId, active);
    try {
      this.post({
        ...this.turnIdentity(threadId, active),
        kind: 'turn.resume',
        agentTurnId: checkpoint.agentTurnId,
        model: checkpoint.model,
        maxTurns: state.snapshot.goal?.limits.maxModelSamples ?? 40,
        toolCatalogDigest: catalog.digest,
        tools: catalog.tools,
        checkpoint: checkpoint.state,
        checkpointRevision: checkpoint.revision,
        pendingCallId: checkpoint.pendingCallId,
        pendingToolDisposition,
        requiredInitialTool: checkpoint.requiredInitialTool,
      });
    } catch (error) {
      this.active.delete(threadId);
      this.options.tools.endTask(threadId);
      throw error;
    }
  }

  steer(threadId: string, instruction: string): void {
    const active = this.requireActive(threadId);
    this.post({ ...this.turnIdentity(threadId, active), kind: 'turn.steer', instruction });
  }

  cancel(
    threadId: string,
    reason: 'stop_button' | 'focused_escape' | 'replacement' | 'sign_out' | 'shutdown',
  ): void {
    const active = this.active.get(threadId);
    if (!active) return;
    active.controller.abort(new Error(reason));
    this.post({ ...this.turnIdentity(threadId, active), kind: 'turn.cancel', reason });
  }

  async replaceCredential(): Promise<void> {
    const credential = await this.options.accessTokenProvider();
    if (!this.child) return;
    this.post({ kind: 'runtime.replaceCredential', requestId: randomUUID(), credential });
  }

  clearCredential(): void {
    if (this.child) this.post({ kind: 'runtime.clearCredential', requestId: randomUUID() });
  }

  async shutdown(): Promise<void> {
    if (!this.child) return;
    for (const threadId of this.active.keys()) this.cancel(threadId, 'shutdown');
    this.post({ kind: 'runtime.shutdown', requestId: randomUUID() });
    const child = this.child;
    for (const threadId of this.pendingDeltas.keys()) this.flushAssistantDelta(threadId);
    this.child = null;
    this.handshakeRequestId = null;
    this.rejectCatalogValidations(new Error('The local agent runtime shut down.'));
    child.kill();
  }

  private async ensureReady(credential: string): Promise<void> {
    if (this.child && this.ready) {
      await this.ready;
      this.post({ kind: 'runtime.replaceCredential', requestId: randomUUID(), credential });
      return;
    }
    const entry = this.options.isPackaged
      ? path.join(this.options.resourcesPath, 'agent-runtime', 'dist', 'process-entry.js')
      : path.join(this.options.repositoryRoot, 'services', 'agent-runtime', 'dist', 'process-entry.js');
    const forkUtilityProcess =
      this.options.forkUtilityProcess ?? utilityProcess.fork.bind(utilityProcess);
    const child = forkUtilityProcess(entry, [], {
      cwd: this.options.repositoryRoot,
      env: {},
      serviceName: 'Tro Local Agent Runtime',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    child.on('message', (message) => {
      void this.receive(message).catch((error: unknown) => this.failClosed(asError(error)));
    });
    child.on('exit', (code) => {
      void this.handleExit(child, code).catch((error: unknown) => {
        console.error('[local-agent-runtime]', redact(asError(error).message));
      });
    });
    child.on('spawn', () => {
      const handshakeGraphVersion = graphVersion([], DEFAULT_AGENT_MODEL);
      const requestId = randomUUID();
      this.handshakeRequestId = requestId;
      this.post({
        kind: 'runtime.initialize',
        requestId,
        apiBaseUrl: this.options.apiBaseUrl,
        requiredCapabilities: [...REQUIRED_RUNTIME_CAPABILITIES],
        expected: {
          protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION,
          protocolDigest: LOCAL_AGENT_PROTOCOL_DIGEST,
          sdkVersion: LOCAL_AGENT_SDK_VERSION,
          graphVersion: handshakeGraphVersion,
          capabilities: [...LOCAL_AGENT_CAPABILITIES],
        },
      });
    });
    child.stderr?.on('data', (value: Buffer) => {
      const message = value.toString('utf8').trim();
      if (message) console.error('[local-agent-runtime]', redact(message));
    });
    try {
      await withTimeout(
        this.ready,
        this.options.runtimeReadyTimeoutMs ?? RUNTIME_READY_TIMEOUT_MS,
        'The bundled local agent runtime did not become ready.',
      );
    } catch (error) {
      this.failClosed(asError(error));
      throw error;
    }
    this.post({
      kind: 'runtime.replaceCredential',
      requestId: randomUUID(),
      credential,
    });
  }

  private async receive(input: unknown): Promise<void> {
    const parsed = LocalAgentChildMessageSchema.safeParse(input);
    if (!parsed.success) {
      this.failClosed(new Error('The local agent runtime sent an invalid protocol message.'));
      return;
    }
    const message = parsed.data;
    if ('threadId' in message) {
      const active = this.active.get(message.threadId);
      if (!active || message.turnId !== active.turnId || message.graphVersion !== active.graphVersion) {
        this.failClosed(new Error('The local agent runtime sent a stale turn message.'));
        return;
      }
      const previous = this.childSequences.get(message.turnId) ?? 0;
      if (message.sequence <= previous) {
        this.failClosed(new Error('The local agent runtime repeated a turn sequence.'));
        return;
      }
      this.childSequences.set(message.turnId, message.sequence);
    }
    switch (message.kind) {
      case 'runtime.ready':
        if (
          message.requestId !== this.handshakeRequestId ||
          message.runtime.protocolDigest !== LOCAL_AGENT_PROTOCOL_DIGEST ||
          message.runtime.sdkVersion !== LOCAL_AGENT_SDK_VERSION ||
          message.runtime.graphVersion !== graphVersion([], DEFAULT_AGENT_MODEL) ||
          !REQUIRED_RUNTIME_CAPABILITIES.every((capability) =>
            message.runtime.capabilities.includes(capability),
          )
        ) {
          this.failClosed(new Error('The packaged Agents SDK runtime is incompatible.'));
          return;
        }
        this.handshakeRequestId = null;
        this.readyResolve?.();
        this.readyResolve = null;
        this.readyReject = null;
        return;
      case 'runtime.catalogValidated': {
        const pending = this.pendingCatalogValidations.get(message.requestId);
        if (!pending) {
          this.failClosed(
            new Error('The local agent runtime sent an unexpected catalog validation.'),
          );
          return;
        }
        pending.resolve(message);
        return;
      }
      case 'runtime.fatal':
        this.failClosed(new Error(message.message));
        return;
      case 'turn.event':
        if (message.event === 'model_request_started') {
          this.requireActive(message.threadId).modelRequests?.add(
            typeof message.data?.clientRequestId === 'string' ? message.data.clientRequestId : `sequence:${message.sequence}`,
          );
        }
        if (message.event === 'assistant_delta') {
          this.queueAssistantDelta(message);
        } else {
          this.flushAssistantDelta(message.threadId);
          this.options.onEvent?.(message);
        }
        return;
      case 'session.read':
        await this.sessionRead(message);
        return;
      case 'session.append':
        await this.sessionAppend(message);
        return;
      case 'session.replace':
        await this.sessionReplace(message);
        return;
      case 'checkpoint.commit':
        await this.checkpointCommit(message);
        return;
      case 'tool.execute':
        await this.toolExecute(message);
        return;
      case 'turn.terminal': {
        this.flushAssistantDelta(message.threadId);
        const active = this.requireActive(message.threadId);
        active.controller.abort(new Error('turn_terminal'));
        this.active.delete(message.threadId);
        this.childSequences.delete(message.turnId);
        this.hostSequences.delete(message.turnId);
        this.options.tools.endTask(message.threadId);
        await this.options.coordinator.endTask(message.threadId);
        await this.options.onTerminal?.({
          ...(active.modelRequests ? { modelRequestCount: active.modelRequests.size } : {}),
          errorCode: message.errorCode,
          finalOutput: message.finalOutput,
          message: message.message,
          status: message.status,
          threadId: message.threadId,
          turnId: message.turnId,
        });
        return;
      }
    }
  }

  private async sessionRead(message: Extract<LocalAgentChildMessage, { kind: 'session.read' }>): Promise<void> {
    const session = await this.options.state.readSession(message.threadId, message.limit);
    this.respond(message, { kind: 'session.read.result', responseTo: message.requestId, revision: session.revision, items: session.items });
  }

  private async sessionAppend(message: Extract<LocalAgentChildMessage, { kind: 'session.append' }>): Promise<void> {
    const result = await this.options.state.appendSession(
      message.threadId, message.expectedRevision, message.operationId, message.operationDigest, message.items,
    );
    this.respond(message, { kind: 'session.append.result', responseTo: message.requestId, ...result });
  }

  private async sessionReplace(message: Extract<LocalAgentChildMessage, { kind: 'session.replace' }>): Promise<void> {
    const result = await this.options.state.replaceSession(
      message.threadId, message.expectedRevision, message.operationId, message.operationDigest,
      message.expectedSuffix, message.replacement,
    );
    this.respond(message, { kind: 'session.replace.result', responseTo: message.requestId, ...result });
  }

  private async checkpointCommit(message: Extract<LocalAgentChildMessage, { kind: 'checkpoint.commit' }>): Promise<void> {
    const active = this.requireActive(message.threadId);
    const result = await this.options.state.commitCheckpoint(message.threadId, message.expectedRevision, {
      agentTurnId: active.agentTurnId,
      graphVersion: active.graphVersion,
      model: active.model,
      pendingCallId: message.pendingCallId,
      protocolDigest: message.protocolDigest,
      requiredInitialTool: active.requiredInitialTool,
      sdkVersion: message.sdkVersion,
      state: message.checkpoint,
      toolCatalogDigest: active.catalog.digest,
    });
    this.respond(message, {
      kind: 'checkpoint.commit.result', responseTo: message.requestId,
      checkpointRevision: result.revision, replayed: result.replayed,
    });
  }

  private async toolExecute(message: Extract<LocalAgentChildMessage, { kind: 'tool.execute' }>): Promise<void> {
    const active = this.requireActive(message.threadId);
    const checkpoint = (await this.options.state.readThread(message.threadId)).checkpoint;
    if (!checkpoint || checkpoint.pendingCallId !== message.callId) {
      throw new Error('Tool execution was requested without its durable checkpoint.');
    }
    if (message.catalogDigest !== active.catalog.digest) throw new Error('tool_catalog_mismatch');
    const completesRequiredInitialTool = active.requiredInitialTool !== null;
    if (
      active.requiredInitialTool &&
      (
        active.requiredInitialTool.modelName !== message.modelName ||
        digest(active.requiredInitialTool.arguments) !== digest(message.arguments)
      )
    ) {
      throw new Error('required_initial_tool_mismatch');
    }
    let record = await this.options.state.addInvocation(message.threadId, {
      callId: message.callId,
      idempotencyDigest: message.idempotencyDigest,
      operation: message.operation,
      toolId: message.toolId,
    });
    if (record.result) {
      if (completesRequiredInitialTool) active.requiredInitialTool = null;
      this.emitToolLifecycle(
        message,
        record.result.status === 'completed'
          ? 'tool_completed'
          : record.result.status === 'unknown'
            ? 'tool_unknown'
            : 'tool_failed',
        record.result.summary,
      );
      this.respond(message, { kind: 'tool.execute.result', responseTo: message.requestId, result: record.result });
      return;
    }
    if (record.status === 'executing') {
      if (completesRequiredInitialTool) active.requiredInitialTool = null;
      const unknown: LocalToolExecutionResult = {
        status: 'unknown', summary: 'The app restarted after dispatch, so this action was not repeated.', data: null, imageDataUrl: null,
      };
      record = await this.options.state.transitionInvocation(message.threadId, message.callId, 'executing', 'unknown', unknown);
      this.emitToolLifecycle(message, 'tool_unknown', unknown.summary);
      this.respond(message, { kind: 'tool.execute.result', responseTo: message.requestId, result: record.result ?? unknown });
      return;
    }
    if (active.controller.signal.aborted) {
      const cancelled: LocalToolExecutionResult = {
        status: 'cancelled',
        summary: 'The turn was cancelled before this tool was dispatched.',
        data: null,
        imageDataUrl: null,
      };
      record = await this.options.state.transitionInvocation(
        message.threadId,
        message.callId,
        'checkpointed',
        'cancelled-before-dispatch',
        cancelled,
      );
      this.emitToolLifecycle(message, 'tool_failed', cancelled.summary);
      this.respond(message, {
        kind: 'tool.execute.result',
        responseTo: message.requestId,
        result: record.result ?? cancelled,
      });
      return;
    }
    if (active.executionContext.lesson) {
      try {
        const preview = this.options.tools.preview({ arguments: JSON.stringify(message.arguments), callId: message.callId, name: message.modelName }, active.executionContext);
        if (!this.options.beforeTool) throw new Error('Lesson tool policy is unavailable.');
        await this.options.beforeTool(message.threadId, preview);
      } catch (error) {
        const denied: LocalToolExecutionResult = { status: 'failed', summary: safeError(error), data: null, imageDataUrl: null };
        await this.options.state.transitionInvocation(message.threadId, message.callId, 'checkpointed', 'failed', denied);
        this.respond(message, { kind: 'tool.execute.result', responseTo: message.requestId, result: denied });
        return;
      }
    }
    record = await this.options.state.transitionInvocation(message.threadId, message.callId, 'checkpointed', 'executing');
    if (record.status !== 'executing') throw new Error('invocation_transition_conflict');
    this.emitToolLifecycle(message, 'tool_started', `Executing ${message.modelName}.`);
    let result: LocalToolExecutionResult;
    try {
      const invocation = this.options.tools.resolve({
        arguments: JSON.stringify(message.arguments), callId: message.callId, name: message.modelName,
      }, active.executionContext);
      if (invocation.toolId !== message.toolId || invocation.operation !== message.operation) {
        throw new Error('Tool invocation does not match the frozen catalog.');
      }
      if (completesRequiredInitialTool) active.requiredInitialTool = null;
      const toolResult = await this.options.coordinator.dispatchTool(invocation, {
        signal: active.controller.signal,
        taskId: message.threadId,
      });
      active.executionContext = executionContextAfterToolResult(
        active.executionContext,
        toolResult,
      );
      result = normalizeLocalToolResult(toolResult);
    } catch (error) {
      result = { status: 'unknown', summary: safeError(error), data: null, imageDataUrl: null };
    }
    const journalStatus = result.status === 'completed'
      ? 'completed'
      : result.status === 'failed'
        ? 'failed'
        : result.status === 'cancelled'
          ? 'cancelled-before-dispatch'
          : 'unknown';
    record = await this.options.state.transitionInvocation(
      message.threadId, message.callId, 'executing', journalStatus, result,
    );
    this.emitToolLifecycle(
      message,
      result.status === 'completed'
        ? 'tool_completed'
        : result.status === 'unknown'
          ? 'tool_unknown'
          : 'tool_failed',
      result.summary,
    );
    this.respond(message, { kind: 'tool.execute.result', responseTo: message.requestId, result: record.result ?? result });
  }

  private emitToolLifecycle(
    message: Extract<LocalAgentChildMessage, { kind: 'tool.execute' }>,
    event: 'tool_started' | 'tool_completed' | 'tool_failed' | 'tool_unknown',
    summary: string,
  ): void {
    this.options.onEvent?.({
      kind: 'turn.event',
      requestId: randomUUID(),
      threadId: message.threadId,
      turnId: message.turnId,
      agentId: message.agentId,
      parentAgentId: message.parentAgentId,
      delegationId: message.delegationId,
      graphVersion: message.graphVersion,
      sequence: message.sequence,
      event,
      summary: summary.slice(0, 2_000),
      data: {
        callId: message.callId,
        operation: message.operation,
        toolId: message.toolId,
      },
    });
  }

  private respond(
    message: Extract<LocalAgentChildMessage, { threadId: string }>,
    response: Record<string, unknown> & { kind: LocalAgentHostMessage['kind'] },
  ): void {
    const active = this.requireActive(message.threadId);
    this.post({ ...this.turnIdentity(message.threadId, active), ...response } as LocalAgentHostMessage);
  }

  private queueAssistantDelta(
    message: Extract<LocalAgentChildMessage, { kind: 'turn.event' }>,
  ): void {
    const pending = this.pendingDeltas.get(message.threadId);
    if (pending) {
      pending.text += message.summary;
      pending.message = message;
      if (pending.text.length >= 2_000) this.flushAssistantDelta(message.threadId);
      return;
    }
    this.pendingDeltas.set(message.threadId, {
      message,
      text: message.summary,
      timer: setTimeout(() => this.flushAssistantDelta(message.threadId), 75),
    });
  }

  private flushAssistantDelta(threadId: string): void {
    const pending = this.pendingDeltas.get(threadId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingDeltas.delete(threadId);
    for (let offset = 0; offset < pending.text.length; offset += 2_000) {
      this.options.onEvent?.({
        ...pending.message,
        summary: pending.text.slice(offset, offset + 2_000),
      });
    }
  }

  private turnIdentity(threadId: string, active: ActiveTurn) {
    const sequence = (this.hostSequences.get(active.turnId) ?? 0) + 1;
    this.hostSequences.set(active.turnId, sequence);
    return {
      requestId: randomUUID(),
      threadId,
      turnId: active.turnId,
      agentId: LOCAL_AGENT_ROOT_ID,
      parentAgentId: null,
      delegationId: null,
      graphVersion: active.graphVersion,
      sequence,
    } as const;
  }

  private post(message: LocalAgentHostMessage): void {
    const child = this.child;
    if (!child) throw new Error('The local agent runtime is not running.');
    child.postMessage(LocalAgentHostMessageSchema.parse(message));
  }

  private async reserveAgentTurn(taskId: string, clientTurnId: string, token: string): Promise<string> {
    const response = await fetch(`${this.options.apiBaseUrl.replace(/\/+$/u, '')}/v1/agent-turns`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-trocode-request-id': randomUUID() },
      body: JSON.stringify({ clientTurnId, taskId }),
    });
    if (!response.ok) throw new Error(`Could not reserve the local model turn (${response.status}).`);
    return AgentTurnResponseSchema.parse(await response.json()).id;
  }

  private requireActive(threadId: string): ActiveTurn {
    const active = this.active.get(threadId);
    if (!active) throw new Error('The local agent turn is not active.');
    return active;
  }

  private failClosed(error: Error): void {
    this.readyReject?.(error);
    this.readyResolve = null;
    this.readyReject = null;
    this.rejectCatalogValidations(error);
    this.child?.kill();
  }

  private async handleExit(exitedChild: UtilityProcess, code: number): Promise<void> {
    if (this.child && this.child !== exitedChild) return;
    this.readyReject?.(
      new Error(`The local agent runtime exited before it was ready (${code}).`),
    );
    this.readyResolve = null;
    this.readyReject = null;
    this.child = null;
    this.handshakeRequestId = null;
    this.ready = null;
    this.rejectCatalogValidations(
      new Error(`The local agent runtime exited during catalog validation (${code}).`),
    );
    const active = [...this.active.entries()];
    this.active.clear();
    for (const [threadId, turn] of active) {
      this.flushAssistantDelta(threadId);
      turn.controller.abort(new Error('runtime_process_exited'));
      const checkpoint = (await this.options.state.readThread(threadId)).checkpoint;
      if (checkpoint?.pendingCallId) {
        const invocation = await this.options.state.invocation(threadId, checkpoint.pendingCallId);
        if (invocation?.status === 'executing') {
          const result: LocalToolExecutionResult = {
            status: 'unknown', summary: 'The local runtime exited after tool dispatch; the action was not repeated.', data: null, imageDataUrl: null,
          };
          await this.options.state.transitionInvocation(threadId, checkpoint.pendingCallId, 'executing', 'unknown', result);
        }
      }
      this.options.tools.endTask(threadId);
      await this.options.coordinator.endTask(threadId);
      this.childSequences.delete(turn.turnId);
      this.hostSequences.delete(turn.turnId);
      await this.options.onTerminal?.({
        errorCode: 'runtime_process_exited', finalOutput: null,
        message: `The local agent runtime exited (${code}).`, status: 'failed',
        threadId, turnId: turn.turnId,
      });
    }
  }

  private rejectCatalogValidations(error: Error): void {
    for (const pending of this.pendingCatalogValidations.values()) {
      pending.reject(error);
    }
    this.pendingCatalogValidations.clear();
  }
}

export function executionContextAfterToolResult(
  context: GroundedToolExecutionContext,
  result: ToolExecutionResult,
): GroundedToolExecutionContext {
  return result.observation
    ? { ...context, latestObservation: result.observation }
    : context;
}

export function pendingToolResumeDisposition(
  invocation: LocalInvocation | null,
): PendingToolResumeDisposition {
  if (invocation?.toolId === 'computer.observe') return 'reobserve';
  return !invocation
    || invocation.status === 'checkpointed'
    || invocation.status === 'cancelled-before-dispatch'
    ? 'recheck'
    : 'replay';
}


function safeError(error: unknown): string {
  if (!(error instanceof Error)) return 'The tool result could not be confirmed.';
  return error.message.replace(/Bearer\s+\S+/giu, 'Bearer [redacted]').slice(0, 1_000);
}

function redact(value: string): string { return value.replace(/Bearer\s+\S+/giu, 'Bearer [redacted]'); }

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('The local agent runtime failed.');
}
