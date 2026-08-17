import type {
  CompanionGuidance,
  ProposedAction,
  TaskSnapshot,
} from '../../shared/contracts';
import type { CuaService } from '../cua/cua-service';

import { createActionDigest } from './action-approval';
import type {
  AgentModel,
  AgentToolOutput,
  ResolvedToolInvocation,
  ToolExecutionResult,
} from './agent-contracts';
import { shouldRequestCompletionReview } from './completion-policy';
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
import { taskMaxToolCalls } from './task-contract';
import type { TaskRuntime } from './task-runtime';

interface ExecutionCoordinatorOptions {
  agent: AgentModel;
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
  openExternal?: (url: string) => Promise<void>;
  prepareDesktop?: () => Promise<DesktopObservationCleanup | void>;
  presentAction?: (
    command: DesktopCommand,
    signal: AbortSignal,
    presentation?: DesktopPresentation,
  ) => Promise<GuidancePresentationHandle | void>;
  runtime: TaskRuntime;
  toolDispatcher?: Pick<RuntimeToolDispatcher, 'dispatch'>;
  toolRegistry?: Pick<
    RuntimeToolRegistry,
    'endTask' | 'modelVisibleSpecs' | 'resolve' | 'supports'
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
  invocation: ResolvedToolInvocation;
}

interface HeldInteraction {
  callId: string;
  invocation?: ResolvedToolInvocation;
  resume: 'model_input' | 'desktop_observation';
}

interface ExecutionContext {
  cleanupPromise?: Promise<void>;
  completionReviewRequested: boolean;
  controller: AbortController;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  desktopSessionStarted: boolean;
  initialized: boolean;
  activeGuidance?: GuidancePresentationHandle;
  guidanceCursor: number;
  guidanceHistory: GuidanceHistoryEntry[];
  latestObservation?: DesktopObservation;
  pendingApproval?: HeldApproval;
  pendingInteraction?: HeldInteraction;
  playback: GuidancePlaybackController;
  rerunRequested: boolean;
  resolvedToolCalls: number;
  running?: Promise<void>;
  unknownActionDigests: Set<string>;
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
  private readonly agent: AgentModel;

  private readonly contexts = new Map<string, ExecutionContext>();

  private readonly cua: ExecutionCoordinatorOptions['cua'];

  private readonly dismissPresentation: () => void;

  private readonly guidanceAutoAdvanceMs?: number;

  private readonly onGuidancePlaybackChange: NonNullable<
    ExecutionCoordinatorOptions['onGuidancePlaybackChange']
  >;

  private readonly onGuidanceWaitEnd: NonNullable<
    ExecutionCoordinatorOptions['onGuidanceWaitEnd']
  >;

  private readonly onGuidanceWaitStart: NonNullable<
    ExecutionCoordinatorOptions['onGuidanceWaitStart']
  >;

  private readonly prepareDesktop: () => Promise<DesktopObservationCleanup | void>;

  private readonly presentAction: NonNullable<
    ExecutionCoordinatorOptions['presentAction']
  >;

  private readonly runtime: TaskRuntime;

  private readonly toolDispatcher: Pick<RuntimeToolDispatcher, 'dispatch'>;

  private readonly toolRegistry: Pick<
    RuntimeToolRegistry,
    'endTask' | 'modelVisibleSpecs' | 'resolve' | 'supports'
  >;

  constructor({
    agent,
    cua,
    dismissPresentation = () => undefined,
    guidanceAutoAdvanceMs,
    onGuidancePlaybackChange = () => undefined,
    onGuidanceWaitEnd = () => undefined,
    onGuidanceWaitStart = () => undefined,
    openExternal = async () => {
      throw new Error('URL navigation is not configured.');
    },
    prepareDesktop = async () => undefined,
    presentAction = async () => undefined,
    runtime,
    toolDispatcher,
    toolRegistry = defaultRuntimeToolRegistry,
  }: ExecutionCoordinatorOptions) {
    this.agent = agent;
    this.cua = cua;
    this.dismissPresentation = dismissPresentation;
    this.guidanceAutoAdvanceMs = guidanceAutoAdvanceMs;
    this.onGuidancePlaybackChange = onGuidancePlaybackChange;
    this.onGuidanceWaitEnd = onGuidanceWaitEnd;
    this.onGuidanceWaitStart = onGuidanceWaitStart;
    this.prepareDesktop = prepareDesktop;
    this.presentAction = presentAction;
    this.runtime = runtime;
    this.toolRegistry = toolRegistry;
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
    this.kick(taskId);
    return this.runtime.getSnapshot(taskId);
  }

  cancel(input: unknown): TaskSnapshot {
    const snapshot = this.runtime.cancel(input);
    const context = this.contexts.get(snapshot.taskId);
    context?.activeGuidance?.cancel();
    context?.controller.abort();
    this.onGuidanceWaitEnd(snapshot.taskId);
    this.dismissPresentation();
    void this.cleanup(snapshot.taskId);
    return snapshot;
  }

  cancelActiveTasks(): TaskSnapshot[] {
    return [...this.contexts.keys()].flatMap((taskId) => {
      const snapshot = this.runtime.getSnapshot(taskId);
      if (TERMINAL_PHASES.has(snapshot.phase)) return [];
      return [this.cancel({ taskId })];
    });
  }

  steer(input: unknown): TaskSnapshot {
    const snapshot = this.runtime.steer(input);
    this.kick(snapshot.taskId);
    return snapshot;
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
    const running = this.contexts.get(taskId)?.running;
    if (running) await running;
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
      completionReviewRequested: false,
      controller: new AbortController(),
      desktopSessionStarted: false,
      initialized: false,
      guidanceCursor: -1,
      guidanceHistory: [],
      playback: new GuidancePlaybackController(this.guidanceAutoAdvanceMs),
      rerunRequested: false,
      resolvedToolCalls: 0,
      unknownActionDigests: new Set<string>(),
    };
    this.contexts.set(taskId, context);
    return context;
  }

  private kick(taskId: string): void {
    const context = this.contextFor(taskId);
    if (context.controller.signal.aborted) return;
    if (context.running) {
      context.rerunRequested = true;
      return;
    }
    context.rerunRequested = false;
    context.running = this.run(taskId, context)
      .catch((error: unknown) => {
        if (isAbort(error, context.controller.signal)) return;
        const snapshot = this.runtime.getSnapshot(taskId);
        if (!TERMINAL_PHASES.has(snapshot.phase)) {
          this.runtime.fail(taskId, errorMessage(error));
        }
      })
      .finally(async () => {
        context.running = undefined;
        const snapshot = this.runtime.getSnapshot(taskId);
        if (TERMINAL_PHASES.has(snapshot.phase)) {
          await this.cleanup(taskId);
        } else if (context.rerunRequested) {
          queueMicrotask(() => this.kick(taskId));
        }
      });
  }

  private async run(taskId: string, context: ExecutionContext): Promise<void> {
    const signal = context.controller.signal;
    let snapshot = this.runtime.getSnapshot(taskId);
    if (!snapshot.goal) throw new Error('Task has no agent contract.');

    if (!context.initialized) {
      await this.agent.start(taskId, snapshot.request, signal);
      context.initialized = true;
    }

    if (context.pendingInteraction) {
      if (snapshot.phase === 'awaiting_input') return;
      const heldInteraction = context.pendingInteraction;
      const answer = [...snapshot.messages]
        .reverse()
        .find((message) => message.role === 'user')?.text;
      if (!answer) throw new Error('The interaction resumed without a user answer.');
      context.pendingInteraction = undefined;
      if (
        heldInteraction.resume === 'desktop_observation' &&
        heldInteraction.invocation
      ) {
        if (answer.toLocaleLowerCase().includes('without')) {
          this.agent.appendToolOutput(taskId, {
            callId: heldInteraction.callId,
            output: JSON.stringify({
              status: 'not_executed',
              summary: 'The user chose to continue without computer access.',
            }),
          });
          this.runtime.resumePlanning(
            taskId,
            'Continued without the optional computer tool.',
          );
        } else {
          const paused = await this.handleObservation(
            taskId,
            context,
            heldInteraction.invocation,
          );
          if (paused) return;
        }
      } else {
        this.agent.appendToolOutput(taskId, {
          callId: heldInteraction.callId,
          output: JSON.stringify({ status: 'confirmed', answer }),
        });
        this.runtime.resumePlanning(taskId, 'Returned the user answer to the model.');
      }
    }

    if (context.pendingApproval) {
      if (snapshot.phase === 'awaiting_approval') return;
      await this.resumeHeldApproval(taskId, context);
      snapshot = this.runtime.getSnapshot(taskId);
      if (snapshot.phase === 'awaiting_approval') return;
    }

    while (!signal.aborted) {
      snapshot = this.runtime.getSnapshot(taskId);
      if (TERMINAL_PHASES.has(snapshot.phase) || snapshot.phase === 'blocked') {
        return;
      }
      if (snapshot.pendingInteraction) return;
      if (!snapshot.goal) throw new Error('Task has no agent contract.');
      if (progressCompleted(snapshot) >= taskMaxToolCalls(snapshot.goal)) {
        this.runtime.block(taskId, 'The task reached its tool-call limit.', [
          'Provide steering to narrow the task or start a new task.',
        ]);
        await this.cleanup(taskId);
        return;
      }

      for (const steering of this.runtime.takeSteering(taskId)) {
        this.agent.appendUserMessage(taskId, steering.instruction);
      }
      this.runtime.recordModelSampling(taskId);
      const turn = await this.agent.sample(
        taskId,
        this.toolRegistry.modelVisibleSpecs(),
        signal,
      );
      if (turn.kind === 'assistant_message') {
        if (
          !context.completionReviewRequested &&
          shouldRequestCompletionReview({
            request: snapshot.request,
            resolvedToolCalls: context.resolvedToolCalls,
          })
        ) {
          context.completionReviewRequested = true;
          this.agent.requestCompletionReview(taskId);
          this.runtime.resumePlanning(
            taskId,
            'Reviewing the candidate completion against the full request.',
          );
          continue;
        }
        this.runtime.complete(taskId, turn.text);
        return;
      }

      let invocation: ResolvedToolInvocation;
      try {
        invocation = this.toolRegistry.resolve(turn.call, {
          taskId,
          latestObservation: context.latestObservation,
        });
      } catch (error) {
        this.agent.appendToolOutput(taskId, {
          callId: turn.call.callId,
          output: JSON.stringify({
            status: 'not_executed',
            summary: errorMessage(error),
          }),
        });
        this.runtime.resumePlanning(
          taskId,
          'Rejected an invalid or unavailable model tool call.',
        );
        continue;
      }
      context.resolvedToolCalls += 1;

      const shouldPause = await this.handleInvocation(taskId, context, invocation);
      if (shouldPause) return;
    }
  }

  private async handleInvocation(
    taskId: string,
    context: ExecutionContext,
    invocation: ResolvedToolInvocation,
  ): Promise<boolean> {
    switch (invocation.kind) {
      case 'observe':
        return this.handleObservation(taskId, context, invocation);
      case 'interaction':
        this.handleInteraction(taskId, context, invocation);
        return true;
      case 'desktop':
      case 'direct':
      case 'guidance':
        return this.handleAction(taskId, context, invocation);
    }
  }

  private async handleObservation(
    taskId: string,
    context: ExecutionContext,
    invocation: ResolvedToolInvocation,
  ): Promise<boolean> {
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
      this.agent.appendToolOutput(
        taskId,
        observationOutput(
          invocation.callId,
          observation,
          'Fresh desktop observation captured.',
        ),
      );
    } catch (error) {
      if (isAbort(error, context.controller.signal)) throw error;
      const status = await this.cua.getStatus();
      if (status.state !== 'ready' || !status.available) {
        context.pendingInteraction = {
          callId: invocation.callId,
          invocation,
          resume: 'desktop_observation',
        };
        this.runtime.requestInput({
          taskId,
          prompt:
            'This step needs optional computer access. Connect the computer, or continue without it.',
          choices: [
            { id: 'connect_computer', label: 'Connect computer' },
            { id: 'continue_without', label: 'Continue without computer access' },
          ],
        });
        return true;
      }
      this.runtime.beginVerification(
        taskId,
        'Desktop observation was not available.',
        true,
        toolIdentity(invocation),
      );
      this.agent.appendToolOutput(taskId, {
        callId: invocation.callId,
        output: JSON.stringify({
          status: 'failed',
          summary: errorMessage(error),
        }),
      });
    }
    this.runtime.resumePlanning(taskId, 'Returned the observation result to the model.');
    return false;
  }

  private handleInteraction(
    taskId: string,
    context: ExecutionContext,
    invocation: ResolvedToolInvocation,
  ): void {
    context.activeGuidance?.cancel();
    context.activeGuidance = undefined;
    this.onGuidanceWaitEnd(taskId);
    this.dismissPresentation();
    const input = invocation.input as InteractionToolInput;
    context.pendingInteraction = {
      callId: invocation.callId,
      resume: 'model_input',
    };
    this.runtime.requestInput({
      taskId,
      prompt: input.prompt,
      ...(input.choices
        ? {
            choices: input.choices.map((label, index) => ({
              id: String(index + 1),
              label,
            })),
          }
        : {}),
    });
  }

  private async handleAction(
    taskId: string,
    context: ExecutionContext,
    invocation: ResolvedToolInvocation,
  ): Promise<boolean> {
    const action = invocation.action;
    if (!action) {
      this.agent.appendToolOutput(taskId, {
        callId: invocation.callId,
        output: JSON.stringify({
          status: 'not_executed',
          summary: 'This tool call did not produce a policy-checkable action.',
        }),
      });
      this.runtime.resumePlanning(taskId, 'Rejected a malformed model tool call.');
      return false;
    }

    const digest = createActionDigest(action);
    if (context.unknownActionDigests.has(digest)) {
      this.agent.appendToolOutput(taskId, {
        callId: invocation.callId,
        output: JSON.stringify({
          status: 'not_executed',
          summary:
            'This exact action previously had an unknown outcome and will not be repeated.',
        }),
      });
      this.runtime.resumePlanning(taskId, 'Prevented an exact repeat after an unknown outcome.');
      return false;
    }

    const snapshot = this.runtime.getSnapshot(taskId);
    if (!snapshot.goal) throw new Error('Tool action requires a task contract.');
    const policy = evaluateAction(snapshot.goal, action, this.toolRegistry);
    if (policy.status === 'denied') {
      this.agent.appendToolOutput(taskId, {
        callId: invocation.callId,
        output: JSON.stringify({ status: 'denied', summary: policy.summary }),
      });
      if (policy.terminal) {
        this.runtime.block(taskId, policy.summary, policy.nextActions);
        await this.cleanup(taskId);
        return true;
      }
      this.runtime.resumePlanning(taskId, 'Denied a tool call at the host boundary.');
      return false;
    }
    if (policy.status === 'needs_approval') {
      context.activeGuidance?.cancel();
      context.activeGuidance = undefined;
      this.onGuidanceWaitEnd(taskId);
      this.dismissPresentation();
      context.pendingApproval = { invocation };
      this.runtime.requestApproval({
        taskId,
        action,
        prompt: action.description,
        consequence: approvalConsequence(action),
      });
      return true;
    }

    this.runtime.beginAllowedAction(taskId, action);
    await this.dispatchAction(taskId, context, invocation, false);
    return false;
  }

  private async resumeHeldApproval(
    taskId: string,
    context: ExecutionContext,
  ): Promise<void> {
    const held = context.pendingApproval;
    if (!held) return;
    const snapshot = this.runtime.getSnapshot(taskId);
    if (!snapshot.approvalGrant) {
      this.agent.appendToolOutput(taskId, {
        callId: held.invocation.callId,
        output: JSON.stringify({
          status: 'denied',
          summary: 'The user denied this exact action.',
        }),
      });
      context.pendingApproval = undefined;
      this.runtime.resumePlanning(taskId, 'Returned the approval denial to the model.');
      return;
    }

    const input = held.invocation.input as Partial<DesktopControlToolInput>;
    if (held.invocation.kind === 'desktop' && input.observationFingerprint) {
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
        this.agent.appendToolOutput(
          taskId,
          resultOutput(
            held.invocation.callId,
            {
              status: 'not_executed',
              summary:
                'The screen changed after approval. Re-observe and propose a fresh action.',
            },
            current,
          ),
        );
        context.pendingApproval = undefined;
        this.runtime.block(
          taskId,
          'The screen changed after approval, so the action was not executed and TroCode stopped before requesting approval again.',
          [
            'Return to the target application, confirm the intended action is still visible, then start a new request.',
          ],
        );
        await this.cleanup(taskId);
        return;
      }
      this.runtime.resumePlanning(taskId, 'Approval state validation finished.');
    }

    this.runtime.consumeApprovalGrant({
      taskId,
      action: held.invocation.action,
    });
    context.pendingApproval = undefined;
    await this.dispatchAction(taskId, context, held.invocation, true);
  }

  private async dispatchAction(
    taskId: string,
    context: ExecutionContext,
    invocation: ResolvedToolInvocation,
    approvedConsequentialAction: boolean,
  ): Promise<void> {
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
    if (invocation.kind === 'desktop') {
      try {
        observation = await this.captureObservation(
          taskId,
          context,
          'Capturing the desktop after the dispatched action.',
        );
      } catch (error) {
        if (isAbort(error, signal)) throw error;
        result = {
          status: result.status,
          summary:
            result.summary +
            ' A fresh verification screenshot was unavailable: ' +
            errorMessage(error),
        };
      }
    }

    if (result.status === 'unknown' && invocation.action) {
      context.unknownActionDigests.add(createActionDigest(invocation.action));
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
    this.agent.appendToolOutput(
      taskId,
      resultOutput(invocation.callId, result, observation),
    );
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
      await this.cleanup(taskId);
      return;
    }
    this.runtime.resumePlanning(taskId, 'Returned the tool result to the model.');
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
    await this.ensureDesktopSession(taskId, context);
    this.runtime.beginObservation(taskId, summary);
    const cleanup = await this.prepareDesktop();
    try {
      const observation = await this.cua.observe(taskId, context.controller.signal);
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
      await this.agent.end(taskId);
      this.toolRegistry.endTask(taskId);
      this.contexts.delete(taskId);
    })();
    await context.cleanupPromise;
  }
}
