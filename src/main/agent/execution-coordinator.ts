import type {
  CompanionGuidance,
  ProposedAction,
  TaskSnapshot,
} from '../../shared/contracts';
import type { CuaService } from '../cua/cua-service';

import { createActionDigest } from './action-approval';
import type {
  AgentToolCall,
  AgentToolOutput,
  ResolvedToolInvocation,
  ToolExecutionResult,
} from './agent-contracts';
import type { AgentRuntime, AgentRuntimeActivity } from './agent-runtime';
import {
  StaticAgentRuntimeFactory,
  type AgentRuntimeFactory,
} from './agent-runtime-factory';
import { decideCompletionReview } from './completion-policy';
import {
  mapScreenshotPointToDesktop,
  type DesktopCommand,
  type DesktopObservation,
} from './execution-contracts';
import { GuidancePlaybackController } from './guidance-playback';
import { evaluateAction } from './policy';
import { RuntimeToolDispatcher } from './runtime-tool-dispatcher';
import {
  defaultRuntimeToolRegistry,
  type DesktopControlToolInput,
  type GuidanceToolInput,
  type InteractionToolInput,
  type OpenUrlToolInput,
  type RuntimeToolRegistry,
} from './runtime-tool-registry';
import { taskMaxModelSamples, taskMaxToolCalls } from './task-contract';
import { TaskInteractionBroker } from './task-interaction-broker';
import type { TaskRuntime } from './task-runtime';
import { ToolExecutionBroker } from './tool-execution-broker';

interface ExecutionCoordinatorOptions {
  agent?: AgentRuntime;
  agentRuntimeFactory?: Pick<AgentRuntimeFactory, 'forContract'>;
  cua: Pick<
    CuaService,
    | 'startTaskSession'
    | 'observe'
    | 'executeCommand'
    | 'endTaskSession'
    | 'getStatus'
  >;
  dismissPresentation?: () => void;
  guidanceAutoAdvanceMs?: number;
  onGuidanceWaitEnd?: (taskId: string) => void;
  onGuidanceWaitStart?: (
    taskId: string,
  ) => CompanionGuidance['shortcuts'] | undefined;
  onGuidancePlaybackChange?: (taskId: string, paused: boolean) => void;
  onActivity?: (taskId: string, activity: AgentRuntimeActivity) => void;
  openExternal?: (url: string) => Promise<void>;
  prepareDesktop?: () => Promise<DesktopObservationCleanup | void>;
  prepareObservation?: (
    observation: DesktopObservation,
  ) => DesktopObservation;
  presentAction?: (
    command: DesktopCommand,
    signal: AbortSignal,
    presentation?: DesktopPresentation,
  ) => Promise<GuidancePresentationHandle | void>;
  runtime: TaskRuntime;
  toolDispatcher?: Pick<RuntimeToolDispatcher, 'dispatch'>;
  toolExecutionBroker?: ToolExecutionBroker;
  toolRegistry?: Pick<
    RuntimeToolRegistry,
    'endTask' | 'modelVisibleSpecs' | 'preview' | 'resolve' | 'supports'
  >;
}

type DesktopObservationCleanup = () => Promise<void> | void;

export interface DesktopPresentation {
  message?: string;
  screenPoint?: { x: number; y: number };
  shortcuts?: CompanionGuidance['shortcuts'];
  taskId?: string;
  target?: string;
}

export interface GuidancePresentationHandle {
  cancel(): void;
  completion: Promise<unknown>;
}

interface GuidanceHistoryEntry {
  command: DesktopCommand;
  presentation: DesktopPresentation;
}

interface HeldApproval {
  invocation?: ResolvedToolInvocation;
}

interface ExecutionContext {
  agent?: AgentRuntime;
  approvalPreviews: Map<string, ResolvedToolInvocation>;
  cleanupPromise?: Promise<void>;
  completionReviewRequested: boolean;
  controller: AbortController;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  desktopSessionStarted: boolean;
  initialized: boolean;
  activeGuidance?: GuidancePresentationHandle;
  guidanceCursor: number;
  guidanceHistory: GuidanceHistoryEntry[];
  idleBoundary?: Promise<void>;
  imagesCaptured: number;
  latestObservation?: DesktopObservation;
  markIdle?: () => void;
  pendingApproval?: HeldApproval;
  pendingInteraction: boolean;
  playback: GuidancePlaybackController;
  resolvedToolCalls: number;
  modelSamples: number;
  running?: Promise<void>;
}

const TERMINAL_PHASES: ReadonlySet<TaskSnapshot['phase']> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

function approvalConsequence(action: ProposedAction): string {
  const declaredConsequence = action.parameters?.declaredConsequence;
  const displayConsequence =
    typeof declaredConsequence === 'string'
      ? declaredConsequence
      : action.action;
  switch (displayConsequence) {
    case 'send': {
      const recipients = action.parameters?.recipients;
      const recipientText = Array.isArray(recipients)
        ? recipients.join(', ')
        : recipients;
      return recipientText
        ? 'This will send the exact displayed message to ' + recipientText + '.'
        : 'This will send the exact displayed message.';
    }
    case 'submit':
      return 'This will submit the displayed form and may be difficult to reverse.';
    case 'login':
      return 'This will continue an authenticated workflow in the displayed account.';
    case 'purchase':
      return 'This may create a financial charge.';
    case 'delete':
      return 'This may permanently remove the displayed item.';
    case 'upload':
      return 'This will upload the displayed file to the selected service.';
    case 'download':
      return 'This will download the displayed item to this computer.';
    case 'install':
      return 'This will install software on this computer.';
    case 'run_command':
      return 'This will run the displayed command on this computer.';
    case 'write_file':
      return 'This will write the displayed content to a local file.';
    default:
      return 'This will perform: ' + action.description;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown execution failure.';
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError');
}

function executionStoppedError(): Error {
  const error = new Error('Task execution stopped at a host boundary.');
  error.name = 'AbortError';
  return error;
}

function toolIdentity(invocation: ResolvedToolInvocation): {
  toolId: ResolvedToolInvocation['toolId'];
  operation: string;
} {
  return { toolId: invocation.toolId, operation: invocation.operation };
}

function progressCompleted(snapshot: TaskSnapshot): number {
  const progress = snapshot.progress;
  if (!progress) return 0;
  return 'kind' in progress ? progress.completed : progress.currentStep;
}

function observationOutput(
  callId: string,
  observation: DesktopObservation,
  summary: string,
): AgentToolOutput {
  const description = JSON.stringify({
    status: 'confirmed',
    summary,
    observationId: observation.observationId,
    capturedAt: observation.capturedAt,
    degraded: observation.degraded,
    text: observation.text,
    structuredState: observation.structuredState,
  });
  if (!observation.screenshot) return { callId, output: description };

  return {
    callId,
    output: [
      { type: 'input_text', text: description },
      {
        type: 'input_image',
        image_url:
          'data:' +
          observation.screenshot.mimeType +
          ';base64,' +
          observation.screenshot.dataBase64,
        detail: 'original',
      },
    ],
  };
}

function resultOutput(
  callId: string,
  result: ToolExecutionResult,
  observation?: DesktopObservation,
): AgentToolOutput {
  const description = JSON.stringify({
    status: result.status,
    summary: result.summary,
    ...(observation
      ? {
          observationId: observation.observationId,
          capturedAt: observation.capturedAt,
          degraded: observation.degraded,
          text: observation.text,
          structuredState: observation.structuredState,
        }
      : {}),
  });
  const imageDataUrl =
    result.imageDataUrl ??
    (observation?.screenshot
      ? 'data:' +
        observation.screenshot.mimeType +
        ';base64,' +
        observation.screenshot.dataBase64
      : undefined);
  if (!imageDataUrl) return { callId, output: description };
  return {
    callId,
    output: [
      { type: 'input_text', text: description },
      { type: 'input_image', image_url: imageDataUrl, detail: 'original' },
    ],
  };
}

function presentationFor(
  invocation: ResolvedToolInvocation,
  observation: DesktopObservation | undefined,
): { command: DesktopCommand; presentation: DesktopPresentation } | null {
  if (invocation.kind === 'desktop') {
    const input = invocation.input as DesktopControlToolInput;
    const command = input.command;
    const point =
      command.kind === 'click' ||
      command.kind === 'point' ||
      command.kind === 'scroll'
        ? mapScreenshotPointToDesktop(command, observation?.coordinateSpace)
        : undefined;
    return {
      command,
      presentation: {
        message: input.description,
        ...(point ? { screenPoint: point } : {}),
        ...(input.target ? { target: input.target } : {}),
      },
    };
  }
  if (invocation.kind === 'guidance') {
    const input = invocation.input as GuidanceToolInput;
    const command: DesktopCommand = { kind: 'point', x: input.x, y: input.y };
    return {
      command,
      presentation: {
        message: input.description,
        screenPoint: mapScreenshotPointToDesktop(
          command,
          observation?.coordinateSpace,
        ),
        ...(input.target ? { target: input.target } : {}),
      },
    };
  }
  return null;
}

export class TaskExecutionCoordinator {
  private readonly agentRuntimeFactory: Pick<AgentRuntimeFactory, 'forContract'>;

  private readonly contexts = new Map<string, ExecutionContext>();

  private readonly cua: ExecutionCoordinatorOptions['cua'];

  private readonly dismissPresentation: () => void;

  private readonly guidanceAutoAdvanceMs?: number;

  private readonly onGuidancePlaybackChange: NonNullable<
    ExecutionCoordinatorOptions['onGuidancePlaybackChange']
  >;

  private readonly onActivity: NonNullable<ExecutionCoordinatorOptions['onActivity']>;

  private readonly onGuidanceWaitEnd: NonNullable<
    ExecutionCoordinatorOptions['onGuidanceWaitEnd']
  >;

  private readonly onGuidanceWaitStart: NonNullable<
    ExecutionCoordinatorOptions['onGuidanceWaitStart']
  >;

  private readonly interactions = new TaskInteractionBroker();

  private readonly prepareDesktop: () => Promise<DesktopObservationCleanup | void>;

  private readonly prepareObservation: (
    observation: DesktopObservation,
  ) => DesktopObservation;

  private readonly presentAction: NonNullable<
    ExecutionCoordinatorOptions['presentAction']
  >;

  private readonly runtime: TaskRuntime;

  private readonly toolDispatcher: Pick<RuntimeToolDispatcher, 'dispatch'>;

  private readonly toolExecutionBroker: ToolExecutionBroker;

  private readonly toolRegistry: Pick<
    RuntimeToolRegistry,
    'endTask' | 'modelVisibleSpecs' | 'preview' | 'resolve' | 'supports'
  >;

  constructor({
    agent,
    agentRuntimeFactory,
    cua,
    dismissPresentation = () => undefined,
    guidanceAutoAdvanceMs,
    onGuidancePlaybackChange = () => undefined,
    onActivity = () => undefined,
    onGuidanceWaitEnd = () => undefined,
    onGuidanceWaitStart = () => undefined,
    openExternal = async () => {
      throw new Error('URL navigation is not configured.');
    },
    prepareDesktop = async () => undefined,
    prepareObservation = (observation) => observation,
    presentAction = async () => undefined,
    runtime,
    toolDispatcher,
    toolExecutionBroker,
    toolRegistry = defaultRuntimeToolRegistry,
  }: ExecutionCoordinatorOptions) {
    if (!agentRuntimeFactory && !agent) {
      throw new Error('TaskExecutionCoordinator requires an agent runtime factory.');
    }
    this.agentRuntimeFactory =
      agentRuntimeFactory ?? new StaticAgentRuntimeFactory(agent as AgentRuntime);
    this.cua = cua;
    this.dismissPresentation = dismissPresentation;
    this.guidanceAutoAdvanceMs = guidanceAutoAdvanceMs;
    this.onGuidancePlaybackChange = onGuidancePlaybackChange;
    this.onActivity = onActivity;
    this.onGuidanceWaitEnd = onGuidanceWaitEnd;
    this.onGuidanceWaitStart = onGuidanceWaitStart;
    this.prepareDesktop = prepareDesktop;
    this.prepareObservation = prepareObservation;
    this.presentAction = presentAction;
    this.runtime = runtime;
    this.toolRegistry = toolRegistry;
    this.toolExecutionBroker =
      toolExecutionBroker ?? new ToolExecutionBroker(toolRegistry);
    this.toolDispatcher =
      toolDispatcher ??
      new RuntimeToolDispatcher([
        {
          id: 'browser.navigate',
          execute: async (invocation) => {
            const input = invocation.input as OpenUrlToolInput;
            await openExternal(input.url);
            return {
              status: 'confirmed',
              summary: 'The browser accepted the HTTPS navigation request.',
            };
          },
        },
        {
          id: 'desktop.control',
          execute: (invocation, context) => {
            const input = invocation.input as DesktopControlToolInput;
            return cua.executeCommand(
              context.taskId,
              input.command,
              context.signal,
            );
          },
        },
        {
          id: 'task.guidance',
          execute: (invocation, context) => {
            const input = invocation.input as GuidanceToolInput;
            return cua.executeCommand(
              context.taskId,
              { kind: 'point', x: input.x, y: input.y },
              context.signal,
            );
          },
        },
      ]);
  }

  start(input: unknown): TaskSnapshot {
    const snapshot = this.runtime.start(input);
    if (!snapshot.goal) throw new Error('Task has no agent contract.');
    const context = this.contextFor(snapshot.taskId);
    if (!context.deadlineTimer) {
      context.deadlineTimer = setTimeout(
        () => this.reachDeadline(snapshot.taskId),
        snapshot.goal.limits.maxMinutes * 60_000,
      );
    }
    this.kick(snapshot.taskId);
    return this.runtime.getSnapshot(snapshot.taskId);
  }

  resume(taskId: string): TaskSnapshot {
    const snapshot = this.runtime.getSnapshot(taskId);
    if (TERMINAL_PHASES.has(snapshot.phase)) return snapshot;
    const context = this.contexts.get(taskId);
    if (context?.pendingApproval && snapshot.phase !== 'awaiting_approval') {
      this.armIdleBoundary(context);
      this.interactions.release(taskId, 'approval');
    } else if (
      context?.pendingInteraction &&
      snapshot.phase !== 'awaiting_input'
    ) {
      this.armIdleBoundary(context);
      this.interactions.release(taskId, 'input');
    } else if (!context?.running) {
      this.kick(taskId);
    }
    return this.runtime.getSnapshot(taskId);
  }

  cancel(input: unknown): TaskSnapshot {
    const snapshot = this.runtime.cancel(input);
    const context = this.contexts.get(snapshot.taskId);
    context?.activeGuidance?.cancel();
    this.interactions.cancel(snapshot.taskId);
    context?.controller.abort();
    this.onGuidanceWaitEnd(snapshot.taskId);
    this.dismissPresentation();
    this.cleanupAfterRun(snapshot.taskId, context);
    return snapshot;
  }

  cancelActiveTasks(): TaskSnapshot[] {
    return [...this.contexts.keys()].flatMap((taskId) => {
      const snapshot = this.runtime.getSnapshot(taskId);
      if (TERMINAL_PHASES.has(snapshot.phase)) return [];
      return [this.cancel({ taskId })];
    });
  }

  async steer(input: unknown): Promise<TaskSnapshot> {
    const snapshot = this.runtime.steer(input);
    const context = this.contexts.get(snapshot.taskId);
    if (context?.agent?.steer) {
      for (const instruction of this.runtime.takeSteering(snapshot.taskId)) {
        await context.agent.steer(snapshot.taskId, instruction.instruction);
      }
    }
    this.kick(snapshot.taskId);
    return this.runtime.getSnapshot(snapshot.taskId);
  }

  toggleGuidancePause(taskId: string): boolean {
    const context = this.contexts.get(taskId);
    if (!context) return false;
    const paused = context.playback.togglePause();
    this.onGuidancePlaybackChange(taskId, paused);
    return paused;
  }

  nextGuidance(taskId: string): void {
    this.contexts.get(taskId)?.playback.next();
  }

  previousGuidance(taskId: string): void {
    this.contexts.get(taskId)?.playback.back();
  }

  async waitForIdle(taskId: string): Promise<void> {
    const context = this.contexts.get(taskId);
    if (context?.idleBoundary) await context.idleBoundary;
  }

  async shutdown(): Promise<void> {
    const taskIds = [...this.contexts.keys()];
    this.cancelActiveTasks();
    await Promise.allSettled(taskIds.map((taskId) => this.cleanup(taskId)));
  }

  private contextFor(taskId: string): ExecutionContext {
    const existing = this.contexts.get(taskId);
    if (existing) return existing;
    const context: ExecutionContext = {
      approvalPreviews: new Map(),
      completionReviewRequested: false,
      controller: new AbortController(),
      desktopSessionStarted: false,
      initialized: false,
      guidanceCursor: -1,
      guidanceHistory: [],
      imagesCaptured: 0,
      playback: new GuidancePlaybackController(this.guidanceAutoAdvanceMs),
      resolvedToolCalls: 0,
      modelSamples: 0,
      pendingInteraction: false,
    };
    this.contexts.set(taskId, context);
    return context;
  }

  private kick(taskId: string): void {
    const context = this.contextFor(taskId);
    if (context.controller.signal.aborted) return;
    if (context.running) return;
    this.armIdleBoundary(context);
    context.running = this.run(taskId, context)
      .catch((error: unknown) => {
        if (isAbort(error, context.controller.signal)) return;
        const snapshot = this.runtime.getSnapshot(taskId);
        if (!TERMINAL_PHASES.has(snapshot.phase)) {
          this.onActivity(taskId, {
            kind: 'run_failed',
            summary: 'The agent run stopped with an error.',
          });
          if (
            error &&
            typeof error === 'object' &&
            'status' in error &&
            error.status === 402
          ) {
            this.runtime.block(taskId, errorMessage(error), [
              'Review the remaining budget before starting a narrower task.',
            ]);
          } else {
            this.runtime.fail(taskId, errorMessage(error));
          }
        }
      })
      .finally(async () => {
        context.markIdle?.();
        context.running = undefined;
        const snapshot = this.runtime.getSnapshot(taskId);
        if (TERMINAL_PHASES.has(snapshot.phase) || snapshot.phase === 'blocked') {
          await this.cleanup(taskId);
        }
      });
  }

  private armIdleBoundary(context: ExecutionContext): void {
    let marked = false;
    context.idleBoundary = new Promise<void>((resolve) => {
      context.markIdle = () => {
        if (marked) return;
        marked = true;
        resolve();
      };
    });
  }

  private async run(taskId: string, context: ExecutionContext): Promise<void> {
    const signal = context.controller.signal;
    const snapshot = this.runtime.getSnapshot(taskId);
    if (!snapshot.goal) throw new Error('Task has no agent contract.');
    if (snapshot.goal.schemaVersion !== 5) {
      throw new Error('Persisted legacy tasks cannot be resumed after the runtime cutover.');
    }
    if (context.initialized) return;
    context.initialized = true;
    const agent = this.agentRuntimeFactory.forContract(snapshot.goal);
    context.agent = agent;
    this.onActivity(taskId, {
      kind: 'run_started',
      summary: 'Agent started.',
    });

    const beforeModel = (): string[] => {
      const current = this.runtime.getSnapshot(taskId);
      if (TERMINAL_PHASES.has(current.phase) || current.phase === 'blocked') {
        throw executionStoppedError();
      }
      if (!current.goal) throw new Error('Task has no agent contract.');
      if (context.modelSamples >= taskMaxModelSamples(current.goal)) {
        this.runtime.block(taskId, 'The task reached its model-sample limit.', [
          'Provide a narrower request or start a new task.',
        ]);
        throw executionStoppedError();
      }
      this.runtime.recordModelSampling(taskId);
      context.modelSamples += 1;
      return this.runtime
        .takeSteering(taskId)
        .map((steering) => steering.instruction);
    };

    const executeTool = async (
      call: Parameters<RuntimeToolRegistry['resolve']>[0],
    ): Promise<AgentToolOutput['output']> => {
      const current = this.runtime.getSnapshot(taskId);
      if (!current.goal) throw new Error('Task has no agent contract.');
      let invocation: ResolvedToolInvocation;
      let decision: ReturnType<typeof evaluateAction>;
      try {
        const resolved = this.toolExecutionBroker.resolve({
          call,
          completedToolCalls: progressCompleted(current),
          goal: current.goal,
          maxToolCalls: taskMaxToolCalls(current.goal),
          taskId,
          latestObservation: context.latestObservation,
        });
        invocation = resolved.invocation;
        decision = resolved.decision;
      } catch (error) {
        if (errorMessage(error).includes('tool-call limit')) {
          this.runtime.block(taskId, 'The task reached its tool-call limit.', [
            'Provide a narrower request or start a new task.',
          ]);
        } else {
          this.runtime.resumePlanning(
            taskId,
            'Rejected an invalid or unavailable model tool call.',
          );
        }
        return JSON.stringify({
          status: 'not_executed',
          summary: errorMessage(error),
        });
      }
      context.resolvedToolCalls += 1;
      this.onActivity(taskId, {
        kind: 'tool_started',
        summary: `Using ${invocation.modelName}.`,
        tool: { name: invocation.modelName, status: 'running' },
      });
      const output = await this.handleInvocation(
        taskId,
        context,
        invocation,
        decision,
      );
      this.onActivity(taskId, {
        kind: 'tool_completed',
        summary: `${invocation.modelName} finished.`,
        tool: { name: invocation.modelName, status: 'completed' },
      });
      return output;
    };

    const previewApproval = (
      call: Parameters<RuntimeToolRegistry['preview']>[0],
    ): boolean => {
      const current = this.runtime.getSnapshot(taskId);
      if (!current.goal) throw new Error('Task has no agent contract.');
      const preview = this.toolExecutionBroker.preview({
        call,
        goal: current.goal,
        latestObservation: context.latestObservation,
        taskId,
      });
      context.approvalPreviews.set(call.callId, preview.invocation);
      return preview.decision.status === 'needs_approval';
    };

    let finalOutput = await agent.runTask({
      callbacks: {
        beforeModel,
        executeTool,
        needsApproval: previewApproval,
        requestApproval: (request) =>
          this.requestRuntimeApproval(taskId, context, request),
        requestInput: (request) =>
          this.requestRuntimeInput(taskId, context, request),
        resolveToolApproval: (call) =>
          this.resolveSdkToolApproval(taskId, context, call),
        setRuntimeResumeMetadata: (metadata) => {
          this.runtime.setRuntimeResumeMetadata(taskId, metadata);
        },
      },
      contract: snapshot.goal,
      maxTurns: taskMaxModelSamples(snapshot.goal),
      request: snapshot.request,
      resumeMetadata: snapshot.runtimeResume,
      emitActivity: (activity) => this.onActivity(taskId, activity),
      signal,
      taskId,
      tools: this.toolRegistry.modelVisibleSpecs(),
    });
    const reviewDecision = decideCompletionReview({
      request: snapshot.request,
      resolvedToolCalls: context.resolvedToolCalls,
    });
    if (
      agent.kind === 'openai_agents' &&
      !context.completionReviewRequested &&
      reviewDecision.required
    ) {
      context.completionReviewRequested = true;
      this.runtime.resumePlanning(
        taskId,
        'Reviewing the candidate completion against the full request.',
      );
      finalOutput = await agent.continueTask(
        taskId,
        [
          'Trusted host completion checkpoint: re-read the original request and tool-result history.',
          'Verify every requested outcome is grounded by available evidence.',
          'If anything remains, call the next tool. Otherwise return only the final user-facing answer.',
        ].join('\n'),
        signal,
      );
    }
    const current = this.runtime.getSnapshot(taskId);
    if (!TERMINAL_PHASES.has(current.phase) && current.phase !== 'blocked') {
      this.runtime.complete(taskId, finalOutput);
      this.onActivity(taskId, {
        kind: 'run_completed',
        summary: 'Agent completed.',
      });
    }
  }

  private async handleInvocation(
    taskId: string,
    context: ExecutionContext,
    invocation: ResolvedToolInvocation,
    decision?: ReturnType<typeof evaluateAction>,
  ): Promise<AgentToolOutput['output']> {
    switch (invocation.kind) {
      case 'observe':
        return this.handleObservation(taskId, context, invocation);
      case 'interaction':
        return this.handleInteraction(taskId, context, invocation);
      case 'desktop':
      case 'direct':
      case 'guidance':
        return this.handleAction(taskId, context, invocation, decision);
    }
  }

  private async handleObservation(
    taskId: string,
    context: ExecutionContext,
    invocation: ResolvedToolInvocation,
  ): Promise<AgentToolOutput['output']> {
    try {
      const observation = await this.captureObservation(
        taskId,
        context,
        'Capturing the desktop requested by the model.',
      );
      this.runtime.recordToolResult(
        taskId,
        'Captured a fresh desktop observation.',
        toolIdentity(invocation),
      );
      this.runtime.resumePlanning(
        taskId,
        'Returned the observation result to the model.',
      );
      return observationOutput(
        invocation.callId,
        observation,
        'Fresh desktop observation captured.',
      ).output;
    } catch (error) {
      if (isAbort(error, context.controller.signal)) throw error;
      const status = await this.cua.getStatus();
      if (status.state !== 'ready' || !status.available) {
        const wait = this.interactions.wait(
          taskId,
          'input',
          context.controller.signal,
        );
        context.pendingInteraction = true;
        this.runtime.requestInput({
          taskId,
          prompt:
            'This step needs optional computer access. Connect the computer, or continue without it.',
          choices: [
            { id: 'connect_computer', label: 'Connect computer' },
            { id: 'continue_without', label: 'Continue without computer access' },
          ],
        });
        context.markIdle?.();
        await wait;
        const snapshot = this.runtime.getSnapshot(taskId);
        const answer = [...snapshot.messages]
          .reverse()
          .find((message) => message.role === 'user')?.text;
        context.pendingInteraction = false;
        if (!answer) {
          throw new Error('The interaction resumed without a user answer.');
        }
        if (answer.toLocaleLowerCase().includes('without')) {
          this.runtime.resumePlanning(
            taskId,
            'Continued without the optional computer tool.',
          );
          return JSON.stringify({
            status: 'not_executed',
            summary: 'The user chose to continue without computer access.',
          });
        }
        return this.handleObservation(taskId, context, invocation);
      }
      this.runtime.beginVerification(
        taskId,
        'Desktop observation was not available.',
        true,
        toolIdentity(invocation),
      );
      this.runtime.resumePlanning(
        taskId,
        'Returned the observation result to the model.',
      );
      return JSON.stringify({
        status: 'failed',
        summary: errorMessage(error),
      });
    }
  }

  private async handleInteraction(
    taskId: string,
    context: ExecutionContext,
    invocation: ResolvedToolInvocation,
  ): Promise<AgentToolOutput['output']> {
    const input = invocation.input as InteractionToolInput;
    const answer = await this.requestRuntimeInput(taskId, context, {
      prompt: input.prompt,
      ...(input.choices ? { choices: input.choices } : {}),
    });
    return JSON.stringify({ status: 'confirmed', answer });
  }

  private async requestRuntimeInput(
    taskId: string,
    context: ExecutionContext,
    request: { choices?: string[]; prompt: string },
  ): Promise<string> {
    context.activeGuidance?.cancel();
    context.activeGuidance = undefined;
    this.onGuidanceWaitEnd(taskId);
    this.dismissPresentation();
    const wait = this.interactions.wait(
      taskId,
      'input',
      context.controller.signal,
    );
    context.pendingInteraction = true;
    this.runtime.requestInput({
      taskId,
      prompt: request.prompt,
      ...(request.choices
        ? {
            choices: request.choices.map((label, index) => ({
              id: String(index + 1),
              label,
            })),
          }
        : {}),
    });
    context.markIdle?.();
    await wait;
    const snapshot = this.runtime.getSnapshot(taskId);
    const answer = [...snapshot.messages]
      .reverse()
      .find((message) => message.role === 'user')?.text;
    context.pendingInteraction = false;
    if (!answer) throw new Error('The interaction resumed without a user answer.');
    this.runtime.resumePlanning(taskId, 'Returned the user answer to the model.');
    return answer;
  }

  private async resolveSdkToolApproval(
    taskId: string,
    context: ExecutionContext,
    call: AgentToolCall,
  ): Promise<boolean> {
    const snapshot = this.runtime.getSnapshot(taskId);
    if (!snapshot.goal) throw new Error('Approval requires a task contract.');
    const preview = context.approvalPreviews.get(call.callId) ??
      this.toolExecutionBroker.preview({
        call,
        goal: snapshot.goal,
        latestObservation: context.latestObservation,
        taskId,
      }).invocation;
    context.approvalPreviews.delete(call.callId);
    if (!preview.action) {
      throw new Error('The SDK requested approval for a non-action tool call.');
    }
    return this.requestExactApproval(
      taskId,
      context,
      {
        action: preview.action,
        consequence: approvalConsequence(preview.action),
        prompt: preview.action.description,
      },
      preview,
    );
  }

  private async requestRuntimeApproval(
    taskId: string,
    context: ExecutionContext,
    request: {
      action: ProposedAction;
      consequence: string;
      prompt: string;
    },
  ): Promise<boolean> {
    const approved = await this.requestExactApproval(
      taskId,
      context,
      request,
    );
    if (approved) {
      this.runtime.consumeApprovalGrant({ taskId, action: request.action });
      this.runtime.resumePlanning(
        taskId,
        'Returned the one-use approval to the workspace runtime.',
      );
    }
    return approved;
  }

  private async requestExactApproval(
    taskId: string,
    context: ExecutionContext,
    request: {
      action: ProposedAction;
      consequence: string;
      prompt: string;
    },
    invocation?: ResolvedToolInvocation,
  ): Promise<boolean> {
    context.activeGuidance?.cancel();
    context.activeGuidance = undefined;
    this.onGuidanceWaitEnd(taskId);
    this.dismissPresentation();
    const wait = this.interactions.wait(
      taskId,
      'approval',
      context.controller.signal,
    );
    context.pendingApproval = invocation ? { invocation } : {};
    this.runtime.requestApproval({ taskId, ...request });
    this.onActivity(taskId, {
      kind: 'approval_required',
      summary: request.prompt,
    });
    context.markIdle?.();
    await wait;
    const snapshot = this.runtime.getSnapshot(taskId);
    context.pendingApproval = undefined;
    const approved =
      snapshot.approvalGrant?.actionDigest ===
      createActionDigest(request.action);
    if (!approved) {
      this.runtime.resumePlanning(
        taskId,
        'Returned the approval denial to the active runtime.',
      );
    }
    return approved;
  }

  private async handleAction(
    taskId: string,
    context: ExecutionContext,
    invocation: ResolvedToolInvocation,
    previewDecision?: ReturnType<typeof evaluateAction>,
  ): Promise<AgentToolOutput['output']> {
    const action = invocation.action;
    if (!action) {
      this.runtime.resumePlanning(taskId, 'Rejected a malformed model tool call.');
      return JSON.stringify({
        status: 'not_executed',
        summary: 'This tool call did not produce a policy-checkable action.',
      });
    }

    const snapshot = this.runtime.getSnapshot(taskId);
    if (!snapshot.goal) throw new Error('Tool action requires a task contract.');
    const policy =
      previewDecision ?? evaluateAction(snapshot.goal, action, this.toolRegistry);
    if (policy.status === 'denied') {
      if (policy.terminal) {
        this.runtime.block(taskId, policy.summary, policy.nextActions);
      } else {
        this.runtime.resumePlanning(taskId, 'Denied a tool call at the host boundary.');
      }
      return JSON.stringify({ status: 'denied', summary: policy.summary });
    }
    if (policy.status === 'needs_approval') {
      if (
        snapshot.approvalGrant?.actionDigest !== createActionDigest(action)
      ) {
        const approved = await this.requestExactApproval(
          taskId,
          context,
          {
            action,
            consequence: approvalConsequence(action),
            prompt: action.description,
          },
          invocation,
        );
        if (!approved) {
          return JSON.stringify({
            status: 'denied',
            summary: 'The user denied this exact action.',
          });
        }
      }
      context.pendingApproval = { invocation };
      return this.resumeHeldApproval(taskId, context);
    }

    this.runtime.beginAllowedAction(taskId, action);
    return this.dispatchAction(taskId, context, invocation, false);
  }

  private async resumeHeldApproval(
    taskId: string,
    context: ExecutionContext,
  ): Promise<AgentToolOutput['output']> {
    const held = context.pendingApproval;
    if (!held?.invocation) {
      throw new Error('The approval resumed without a held action.');
    }
    const invocation = held.invocation;
    const snapshot = this.runtime.getSnapshot(taskId);
    if (!snapshot.approvalGrant) {
      context.pendingApproval = undefined;
      this.runtime.resumePlanning(taskId, 'Returned the approval denial to the model.');
      return JSON.stringify({
        status: 'denied',
        summary: 'The user denied this exact action.',
      });
    }

    const input = invocation.input as Partial<DesktopControlToolInput>;
    if (invocation.kind === 'desktop' && input.observationFingerprint) {
      const current = await this.captureObservation(
        taskId,
        context,
        'Checking that the approved desktop state is still current.',
      );
      this.runtime.beginVerification(
        taskId,
        'Validated the current desktop before using approval.',
      );
      if (current.fingerprint !== input.observationFingerprint) {
        this.runtime.discardApprovalGrant(
          taskId,
          'The screen changed after approval; the held action was not executed.',
        );
        context.pendingApproval = undefined;
        this.runtime.block(
          taskId,
          'The screen changed after approval, so the action was not executed and TroCode stopped before requesting approval again.',
          [
            'Return to the target application, confirm the intended action is still visible, then start a new request.',
          ],
        );
        return resultOutput(
          invocation.callId,
          {
            status: 'not_executed',
            summary:
              'The screen changed after approval. Re-observe and propose a fresh action.',
          },
          current,
        ).output;
      }
      this.runtime.resumePlanning(taskId, 'Approval state validation finished.');
    }

    this.runtime.consumeApprovalGrant({
      taskId,
      action: invocation.action,
    });
    context.pendingApproval = undefined;
    return this.dispatchAction(taskId, context, invocation, true);
  }

  private async dispatchAction(
    taskId: string,
    context: ExecutionContext,
    invocation: ResolvedToolInvocation,
    approvedConsequentialAction: boolean,
  ): Promise<AgentToolOutput['output']> {
    const signal = context.controller.signal;
    let guidanceEntry: GuidanceHistoryEntry | undefined;
    if (invocation.kind === 'desktop' || invocation.kind === 'guidance') {
      await this.ensureDesktopSession(taskId, context);
      const presentation = presentationFor(invocation, context.latestObservation);
      if (presentation) {
        const desktopPresentation =
          invocation.kind === 'guidance'
            ? {
                ...presentation.presentation,
                shortcuts: this.onGuidanceWaitStart(taskId),
                taskId,
              }
            : presentation.presentation;
        const handle = await this.presentAction(
          presentation.command,
          signal,
          desktopPresentation,
        );
        if (invocation.kind === 'guidance') {
          guidanceEntry = {
            command: presentation.command,
            presentation: desktopPresentation,
          };
          context.activeGuidance = handle ?? undefined;
        }
      }
    }

    if (
      invocation.toolId === 'browser.navigate' &&
      invocation.operation === 'open_url'
    ) {
      context.latestObservation = undefined;
    }

    let result: ToolExecutionResult;
    try {
      result = await this.toolDispatcher.dispatch(invocation, { taskId, signal });
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      result = { status: 'failed', summary: errorMessage(error) };
    }

    let observation: DesktopObservation | undefined;
    let verificationUnavailable = false;
    if (invocation.kind === 'desktop') {
      try {
        observation = await this.captureObservation(
          taskId,
          context,
          'Capturing the desktop after the dispatched action.',
        );
      } catch (error) {
        if (isAbort(error, signal)) throw error;
        verificationUnavailable = true;
        result = {
          status: 'unknown',
          summary:
            result.summary +
            ' A fresh verification screenshot was unavailable: ' +
            errorMessage(error),
        };
      }
    }

    if (result.status === 'unknown' && invocation.action) {
      this.toolExecutionBroker.markUnknown(taskId, invocation.action);
    }
    if (invocation.kind === 'guidance') {
      const input = invocation.input as GuidanceToolInput;
      this.runtime.recordGuidance(taskId, input.description);
    }
    this.runtime.recordToolResult(
      taskId,
      result.summary,
      toolIdentity(invocation),
    );
    const output = resultOutput(invocation.callId, result, observation).output;
    if (guidanceEntry) {
      context.guidanceHistory.push(guidanceEntry);
      if (context.guidanceHistory.length > 50) context.guidanceHistory.shift();
      context.guidanceCursor = context.guidanceHistory.length - 1;
      await this.waitForGuidance(taskId, context);
    }
    if (result.status === 'unknown' && approvedConsequentialAction) {
      this.runtime.block(
        taskId,
        'A consequential action has an unknown outcome. TroCode will not retry it or dispatch another consequential action in this task.',
        ['Inspect the target application before starting a new task.'],
      );
      return output;
    }
    if (verificationUnavailable) {
      this.runtime.block(
        taskId,
        'TroCode could not capture the fresh desktop state required after the action, so it stopped before another model step.',
        ['Inspect the target application before starting a new task.'],
      );
      return output;
    }
    this.runtime.resumePlanning(taskId, 'Returned the tool result to the model.');
    return output;
  }

  private async waitForGuidance(
    taskId: string,
    context: ExecutionContext,
  ): Promise<void> {
    const signal = context.controller.signal;
    try {
      while (!signal.aborted) {
        const handle = context.activeGuidance;
        const navigation = await context.playback.wait(
          signal,
          handle?.completion ?? Promise.resolve(),
        );
        if (navigation === 'back' && context.guidanceCursor <= 0) continue;

        handle?.cancel();
        context.activeGuidance = undefined;
        if (
          navigation === 'next' &&
          context.guidanceCursor >= context.guidanceHistory.length - 1
        ) {
          return;
        }
        context.guidanceCursor += navigation === 'back' ? -1 : 1;
        const entry = context.guidanceHistory[context.guidanceCursor];
        if (!entry) continue;
        context.activeGuidance =
          (await this.presentAction(
            entry.command,
            signal,
            entry.presentation,
          )) ?? undefined;
      }
    } finally {
      context.activeGuidance?.cancel();
      context.activeGuidance = undefined;
      this.onGuidanceWaitEnd(taskId);
      this.dismissPresentation();
    }
  }

  private async captureObservation(
    taskId: string,
    context: ExecutionContext,
    summary: string,
  ): Promise<DesktopObservation> {
    const snapshot = this.runtime.getSnapshot(taskId);
    if (!snapshot.goal) throw new Error('Task has no agent contract.');
    const maxImages =
      snapshot.goal.schemaVersion === 4 || snapshot.goal.schemaVersion === 5
        ? snapshot.goal.limits.maxImages
        : 20;
    if (context.imagesCaptured >= maxImages) {
      this.runtime.block(taskId, 'The task reached its image-evidence limit.', [
        'Provide a narrower request or start a new task.',
      ]);
      throw executionStoppedError();
    }
    await this.ensureDesktopSession(taskId, context);
    this.runtime.beginObservation(taskId, summary);
    const cleanup = await this.prepareDesktop();
    try {
      const observation = this.prepareObservation(
        await this.cua.observe(taskId, context.controller.signal),
      );
      context.imagesCaptured += 1;
      context.latestObservation = observation;
      return observation;
    } finally {
      await cleanup?.();
    }
  }

  private async ensureDesktopSession(
    taskId: string,
    context: ExecutionContext,
  ): Promise<void> {
    if (context.desktopSessionStarted) return;
    await this.cua.startTaskSession(taskId, context.controller.signal);
    context.desktopSessionStarted = true;
  }

  private reachDeadline(taskId: string): void {
    const context = this.contexts.get(taskId);
    if (!context) return;
    const snapshot = this.runtime.getSnapshot(taskId);
    if (TERMINAL_PHASES.has(snapshot.phase)) return;
    context.activeGuidance?.cancel();
    context.controller.abort();
    this.onGuidanceWaitEnd(taskId);
    this.runtime.block(taskId, 'The task reached its time limit.', [
      'Provide a narrower request or start a new task.',
    ]);
    this.dismissPresentation();
    this.cleanupAfterRun(taskId, context);
  }

  private cleanupAfterRun(
    taskId: string,
    context: ExecutionContext | undefined,
  ): void {
    const running = context?.running;
    if (running) {
      void running.finally(() => this.cleanup(taskId));
      return;
    }
    void this.cleanup(taskId);
  }

  private async cleanup(taskId: string): Promise<void> {
    const context = this.contexts.get(taskId);
    if (!context) return;
    context.cleanupPromise ??= (async () => {
      if (context.deadlineTimer) clearTimeout(context.deadlineTimer);
      context.activeGuidance?.cancel();
      context.activeGuidance = undefined;
      this.onGuidanceWaitEnd(taskId);
      this.dismissPresentation();
      if (context.desktopSessionStarted) await this.cua.endTaskSession(taskId);
      await context.agent?.end(taskId);
      this.toolExecutionBroker.endTask(taskId);
      this.contexts.delete(taskId);
    })();
    await context.cleanupPromise;
  }
}
