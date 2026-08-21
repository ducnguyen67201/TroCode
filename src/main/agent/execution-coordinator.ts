import type {
  AppLanguage,
  CompanionGuidance,
  ProposedAction,
  TaskMessage,
  TaskSnapshot,
} from '../../shared/contracts';
import type { ApplicationSurfaceVerifier } from '../application/application-surface-verifier';
import type {
  LaunchableApplication,
  ApplicationLaunchReceipt,
} from '../application/desktop-application-launcher';
import type { CuaService } from '../cua/cua-service';

import { createActionDigest } from './action-approval';
import { resolveActionEffect, unknownActionEffect } from './action-effect';
import {
  createActionPreview,
  type ActionPreview,
} from './action-preview-policy';
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
import {
  decideCompletionReview,
  requestUsesCurrentSurfaceContext,
  requestsVisibleContextAction,
  shouldCaptureInitialDesktopObservation,
} from './completion-policy';
import type {
  ObserveSurfaceToolInput,
  PrepareBrowserAccessToolInput,
  SurfaceControlToolInput,
} from './cua-semantic-agent-tools';
import {
  mapScreenshotRegionToDesktop,
  mapScreenshotPointToDesktop,
  type DesktopCommand,
  type DesktopObservation,
} from './execution-contracts';
import { GuidancePlaybackController } from './guidance-playback';
import { createCompletionDecision } from './outcome-verifier';
import { evaluateAction, type PolicyDecision } from './policy';
import {
  RuntimeToolDispatcher,
  type RuntimeToolExecutionAdapter,
} from './runtime-tool-dispatcher';
import {
  defaultRuntimeToolRegistry,
  type DesktopControlToolInput,
  type GuidanceToolInput,
  type InteractionToolInput,
  type OpenApplicationToolInput,
  type OpenUrlToolInput,
  type RuntimeToolRegistry,
} from './runtime-tool-registry';
import { taskMaxModelSamples, taskMaxToolCalls } from './task-contract';
import { TaskInteractionBroker } from './task-interaction-broker';
import type { TaskRuntime } from './task-runtime';
import { ToolExecutionBroker } from './tool-execution-broker';
import {
  advanceWalkthrough,
  createWalkthroughState,
  evaluateWalkthroughTool,
  parseWalkthroughCompletion,
  WALKTHROUGH_COMPLETION_INSTRUCTION,
  WALKTHROUGH_RECOVERY_INSTRUCTION,
  walkthroughModelInstruction,
  type WalkthroughState,
} from './walkthrough-policy';

interface ExecutionCoordinatorOptions {
  actionPreviewLanguage?: () => AppLanguage | Promise<AppLanguage>;
  additionalToolAdapters?: readonly RuntimeToolExecutionAdapter[];
  approvalObservationMatches?: (
    approved: DesktopObservation,
    current: DesktopObservation,
    command: DesktopCommand,
  ) => boolean;
  agent?: AgentRuntime;
  agentRuntimeFactory?: Pick<AgentRuntimeFactory, 'forContract'>;
  cua: Pick<
    CuaService,
    | 'startTaskSession'
    | 'observe'
    | 'observeCurrentSurface'
    | 'inspectSurfaceRegion'
    | 'executeCommand'
    | 'executeSurfaceCommand'
    | 'prepareBrowserAccess'
    | 'revalidateSurfaceAction'
    | 'endTaskSession'
    | 'getStatus'
  >;
  dismissPresentation?: () => void;
  guidanceAutoAdvanceMs?: number;
  observationTimeoutMs?: number;
  onGuidanceWaitEnd?: (taskId: string) => void;
  onGuidanceWaitStart?: (
    taskId: string,
  ) => CompanionGuidance['shortcuts'] | undefined;
  onGuidancePlaybackChange?: (taskId: string, paused: boolean) => void;
  onActivity?: (taskId: string, activity: AgentRuntimeActivity) => void;
  onDesktopControlChange?: (
    taskId: string,
    active: boolean,
  ) => Promise<void> | void;
  applicationSurfaceVerifier?: Pick<ApplicationSurfaceVerifier, 'verify'>;
  openApplication?: (
    application: LaunchableApplication,
  ) => Promise<ApplicationLaunchReceipt>;
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
  presentActionPreview?: (
    preview: ActionPreview,
    signal: AbortSignal,
  ) => Promise<boolean>;
  runtime: TaskRuntime;
  toolDispatcher?: Pick<RuntimeToolDispatcher, 'dispatch'>;
  toolExecutionBroker?: ToolExecutionBroker;
  toolRegistry?: Pick<
    RuntimeToolRegistry,
    'endTask' | 'modelVisibleSpecs' | 'preview' | 'resolve' | 'supports'
  >;
}

type ExecutionAuthorizationMetadata = Pick<
  PolicyDecision,
  | 'effect'
  | 'authorizationSource'
  | 'approvalRequired'
  | 'consequential'
>;

type DesktopObservationCleanup = () => Promise<void> | void;

export function billableUserTurnIds(
  messages: readonly Pick<TaskMessage, 'kind' | 'messageId' | 'role'>[],
): string[] {
  return messages
    .filter(
      (message) =>
        message.role === 'user' &&
        (message.kind === 'request' ||
          message.kind === 'answer' ||
          message.kind === 'steering'),
    )
    .map((message) => message.messageId);
}

export interface DesktopPresentation {
  kind?: 'action_preview' | 'guidance';
  language?: 'en' | 'vi';
  message?: string;
  screenPoint?: { x: number; y: number };
  screenRegion?: { height: number; width: number; x: number; y: number };
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
  walkthrough: WalkthroughState;
}

const TERMINAL_PHASES: ReadonlySet<TaskSnapshot['phase']> = new Set([
  'completed',
  'failed',
  'cancelled',
]);
const DEFAULT_OBSERVATION_TIMEOUT_MS = 15_000;

function approvalConsequence(action: ProposedAction): string {
  const effect = resolveActionEffect(action);
  if (
    effect.kind === 'send_communication' &&
    effect.resourceKind === 'calendar_event'
  ) {
    const attendees = action.parameters?.attendees;
    const attendeeText = Array.isArray(attendees)
      ? attendees.join(', ')
      : attendees;
    return attendeeText
      ? `This will send a calendar invitation to ${attendeeText}.`
      : 'This will send a calendar invitation.';
  }
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

function actionDigestFor(
  snapshot: TaskSnapshot,
  action: ProposedAction,
): string {
  return createActionDigest(
    action,
    snapshot.goal?.schemaVersion === 8
      ? snapshot.goal.intentAuthorization.revision
      : null,
  );
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

async function runWithOperationTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal,
  timeoutMs: number,
  label: string,
): Promise<T> {
  if (parentSignal.aborted) throw executionStoppedError();
  const controller = new AbortController();
  let rejectForParentAbort: (error: Error) => void = () => undefined;
  const parentAbort = new Promise<never>((_resolve, reject) => {
    rejectForParentAbort = reject;
  });
  const handleParentAbort = (): void => {
    controller.abort(parentSignal.reason);
    rejectForParentAbort(executionStoppedError());
  };
  parentSignal.addEventListener('abort', handleParentAbort, { once: true });
  const timeout = new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs} ms.`);
      error.name = 'OperationTimeoutError';
      reject(error);
      controller.abort(error);
    }, timeoutMs);
    controller.signal.addEventListener(
      'abort',
      () => clearTimeout(timer),
      { once: true },
    );
  });

  try {
    return await Promise.race([
      operation(controller.signal),
      timeout,
      parentAbort,
    ]);
  } finally {
    parentSignal.removeEventListener('abort', handleParentAbort);
    if (!controller.signal.aborted) controller.abort();
  }
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
    route: observation.route,
    surface: observation.surface,
    elements: observation.elements,
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
  const resultObservation = observation ?? result.observation;
  const serializedData = result.data ? JSON.stringify(result.data) : '';
  const description = JSON.stringify({
    status: result.status,
    summary: result.summary,
    ...(serializedData.length > 0 && serializedData.length <= 12_000
      ? { data: result.data }
      : {}),
    ...(resultObservation
      ? {
          observationId: resultObservation.observationId,
          capturedAt: resultObservation.capturedAt,
          degraded: resultObservation.degraded,
          route: resultObservation.route,
          surface: resultObservation.surface,
          elements: resultObservation.elements,
          text: resultObservation.text,
          structuredState: resultObservation.structuredState,
        }
      : {}),
  });
  const imageDataUrl =
    result.imageDataUrl ??
    (resultObservation?.screenshot
      ? 'data:' +
        resultObservation.screenshot.mimeType +
        ';base64,' +
        resultObservation.screenshot.dataBase64
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

function outputStatus(output: AgentToolOutput['output']): string | undefined {
  const text =
    typeof output === 'string'
      ? output
      : output.find((item) => item.type === 'input_text')?.text;
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as { status?: unknown };
    return typeof parsed.status === 'string' ? parsed.status : undefined;
  } catch {
    return undefined;
  }
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
        ...(input.region
          ? {
              screenRegion: mapScreenshotRegionToDesktop(
                input.region,
                observation?.coordinateSpace,
              ),
            }
          : {}),
        ...(input.target ? { target: input.target } : {}),
      },
    };
  }
  return null;
}

function actionTargetPresentationFor(
  invocation: ResolvedToolInvocation,
  observation: DesktopObservation | undefined,
): Pick<DesktopPresentation, 'screenPoint' | 'screenRegion'> {
  const presentation = presentationFor(invocation, observation)?.presentation;
  if (presentation?.screenPoint) {
    const screenPoint = presentation.screenPoint;
    return {
      screenPoint,
      screenRegion: presentation.screenRegion ?? {
        x: screenPoint.x - 32,
        y: screenPoint.y - 24,
        width: 64,
        height: 48,
      },
    };
  }
  if (invocation.kind !== 'surface') return {};
  const input = invocation.input as Partial<SurfaceControlToolInput>;
  const element = observation?.elements?.find(
    (candidate) => candidate.ref === input.publicRef,
  );
  if (!element?.bounds) return {};
  const screenRegion = element.bounds;
  return {
    screenPoint: {
      x: Math.round(screenRegion.x + screenRegion.width / 2),
      y: Math.round(screenRegion.y + screenRegion.height / 2),
    },
    screenRegion,
  };
}

export class TaskExecutionCoordinator {
  private readonly actionPreviewLanguage: NonNullable<
    ExecutionCoordinatorOptions['actionPreviewLanguage']
  >;

  private readonly approvalObservationMatches: NonNullable<
    ExecutionCoordinatorOptions['approvalObservationMatches']
  >;

  private readonly agentRuntimeFactory: Pick<AgentRuntimeFactory, 'forContract'>;

  private readonly contexts = new Map<string, ExecutionContext>();

  private readonly cua: ExecutionCoordinatorOptions['cua'];

  private readonly dismissPresentation: () => void;

  private readonly guidanceAutoAdvanceMs?: number;

  private readonly onGuidancePlaybackChange: NonNullable<
    ExecutionCoordinatorOptions['onGuidancePlaybackChange']
  >;

  private readonly observationTimeoutMs: number;

  private readonly onActivity: NonNullable<ExecutionCoordinatorOptions['onActivity']>;

  private readonly onDesktopControlChange: NonNullable<
    ExecutionCoordinatorOptions['onDesktopControlChange']
  >;

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

  private readonly presentActionPreview: NonNullable<
    ExecutionCoordinatorOptions['presentActionPreview']
  >;

  private readonly runtime: TaskRuntime;

  private readonly toolDispatcher: Pick<RuntimeToolDispatcher, 'dispatch'>;

  private readonly toolExecutionBroker: ToolExecutionBroker;

  private readonly toolRegistry: Pick<
    RuntimeToolRegistry,
    'endTask' | 'modelVisibleSpecs' | 'preview' | 'resolve' | 'supports'
  >;

  constructor({
    actionPreviewLanguage = () => 'en',
    additionalToolAdapters = [],
    agent,
    agentRuntimeFactory,
    approvalObservationMatches = (approved, current) =>
      approved.fingerprint === current.fingerprint,
    cua,
    applicationSurfaceVerifier = {
      verify: async () => ({
        status: 'unknown' as const,
        summary: 'Trusted application-surface verification is not configured.',
      }),
    },
    dismissPresentation = () => undefined,
    guidanceAutoAdvanceMs,
    observationTimeoutMs = DEFAULT_OBSERVATION_TIMEOUT_MS,
    onGuidancePlaybackChange = () => undefined,
    onActivity = () => undefined,
    onDesktopControlChange = () => undefined,
    onGuidanceWaitEnd = () => undefined,
    onGuidanceWaitStart = () => undefined,
    openApplication = async () => {
      throw new Error('Application launch is not configured.');
    },
    openExternal = async () => {
      throw new Error('URL navigation is not configured.');
    },
    prepareDesktop = async () => undefined,
    prepareObservation = (observation) => observation,
    presentAction = async () => undefined,
    presentActionPreview = async () => true,
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
    this.actionPreviewLanguage = actionPreviewLanguage;
    this.approvalObservationMatches = approvalObservationMatches;
    this.cua = cua;
    this.dismissPresentation = dismissPresentation;
    this.guidanceAutoAdvanceMs = guidanceAutoAdvanceMs;
    this.observationTimeoutMs = observationTimeoutMs;
    this.onGuidancePlaybackChange = onGuidancePlaybackChange;
    this.onActivity = onActivity;
    this.onDesktopControlChange = onDesktopControlChange;
    this.onGuidanceWaitEnd = onGuidanceWaitEnd;
    this.onGuidanceWaitStart = onGuidanceWaitStart;
    this.prepareDesktop = prepareDesktop;
    this.prepareObservation = prepareObservation;
    this.presentAction = presentAction;
    this.presentActionPreview = presentActionPreview;
    this.runtime = runtime;
    this.toolRegistry = toolRegistry;
    this.toolExecutionBroker =
      toolExecutionBroker ?? new ToolExecutionBroker(toolRegistry);
    this.toolDispatcher =
      toolDispatcher ??
      new RuntimeToolDispatcher([
        {
          id: 'desktop.observe',
          execute: async (_invocation, context) => ({
            status: 'confirmed',
            summary: 'Captured a fresh desktop observation.',
            observation: await cua.observe(context.taskId, context.signal),
          }),
        },
        {
          id: 'computer.observe',
          execute: async (invocation, context) => {
            const input = invocation.input as ObserveSurfaceToolInput;
            if (invocation.operation === 'inspect_surface_region') {
              if (!input.observationId || !input.region) {
                throw new Error(
                  'Original-resolution inspection requires a current observation and region.',
                );
              }
              const crop = cua.inspectSurfaceRegion(
                context.taskId,
                input.observationId,
                input.region,
              );
              return {
                status: 'confirmed',
                summary: `Captured a ${crop.width} by ${crop.height} original-resolution crop.`,
                data: {
                  crop: {
                    height: crop.height,
                    observationId: crop.observationId,
                    region: crop.region,
                    width: crop.width,
                  },
                },
                imageDataUrl: crop.dataUrl,
              };
            }
            const observation =
              await cua.observeCurrentSurface(
                context.taskId,
                { query: input.query },
                context.signal,
              ) ?? await cua.observe(context.taskId, context.signal);
            return {
              status: 'confirmed',
              summary: 'Captured a fresh application-surface observation.',
              observation,
            };
          },
        },
        {
          id: 'application.launch',
          execute: async (invocation, context) => {
            const input = invocation.input as OpenApplicationToolInput;
            const receipt = await openApplication(input.application);
            const snapshot = runtime.getSnapshot(context.taskId);
            const criterion =
              snapshot.goal && (snapshot.goal.schemaVersion === 7 || snapshot.goal.schemaVersion === 8)
                ? snapshot.goal.outcomeContract.criteria.find(
                    (candidate) =>
                      candidate.verifier.kind === 'application_surface' &&
                      candidate.verifier.application === input.application,
                  )
                : undefined;
            if (!criterion) {
              return {
                status: 'unknown',
                summary:
                  'The launch was accepted, but the current contract has no trusted application-surface verifier.',
              };
            }
            const verification = await applicationSurfaceVerifier.verify(
              context.taskId,
              criterion.id,
              receipt,
              context.signal,
            );
            if (verification.evidence) {
              runtime.recordOutcomeEvidence(context.taskId, verification.evidence);
            }
            return {
              status: verification.status,
              summary: verification.summary,
              ...(verification.evidence
                ? {
                    data: {
                      applicationSurfaceEvidence: {
                        observationFingerprint:
                          verification.evidence.observationFingerprint,
                        observationId: verification.evidence.observationId,
                      },
                    },
                  }
                : {}),
            };
          },
        },
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
          id: 'computer.control',
          execute: (invocation, context) => {
            const input = invocation.input as SurfaceControlToolInput;
            return cua.executeSurfaceCommand(
              context.taskId,
              input.observationId,
              input.command,
              context.signal,
            );
          },
        },
        {
          id: 'browser.prepare',
          execute: (invocation, context) => {
            const input = invocation.input as PrepareBrowserAccessToolInput;
            return cua.prepareBrowserAccess(
              context.taskId,
              input.observationId,
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
        ...additionalToolAdapters,
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

  async dispatchHostedTool(
    invocation: ResolvedToolInvocation,
    context: { signal: AbortSignal; taskId: string },
  ): Promise<ToolExecutionResult> {
    if (
      invocation.toolId === 'desktop.observe' ||
      invocation.toolId === 'desktop.control' ||
      invocation.toolId === 'computer.observe' ||
      invocation.toolId === 'computer.control' ||
      invocation.toolId === 'browser.prepare'
    ) {
      await this.cua.startTaskSession(context.taskId, context.signal);
    }
    return this.toolDispatcher.dispatch(invocation, context);
  }

  async endHostedTask(taskId: string): Promise<void> {
    await this.cua.endTaskSession(taskId);
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
    const walkthrough = createWalkthroughState(
      this.runtime.getSnapshot(taskId).request,
    );
    const context: ExecutionContext = {
      approvalPreviews: new Map(),
      completionReviewRequested: false,
      controller: new AbortController(),
      desktopSessionStarted: false,
      initialized: false,
      guidanceCursor: -1,
      guidanceHistory: [],
      imagesCaptured: 0,
      playback: new GuidancePlaybackController(this.guidanceAutoAdvanceMs, {
        autoAdvance: !walkthrough.enabled,
      }),
      resolvedToolCalls: 0,
      modelSamples: 0,
      pendingInteraction: false,
      walkthrough,
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
    if (snapshot.goal.schemaVersion !== 7 && snapshot.goal.schemaVersion !== 8) {
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
      const steering = this.runtime
        .takeSteering(taskId)
        .map((steering) => steering.instruction);
      const walkthroughInstruction = walkthroughModelInstruction(
        context.walkthrough,
      );
      return walkthroughInstruction
        ? [walkthroughInstruction, ...steering]
        : steering;
    };

    const currentBillableUserTurnIds = (): string[] =>
      billableUserTurnIds(this.runtime.getSnapshot(taskId).messages);

    const executeTool = async (
      call: Parameters<RuntimeToolRegistry['resolve']>[0],
    ): Promise<AgentToolOutput['output']> => {
      const current = this.runtime.getSnapshot(taskId);
      if (!current.goal) throw new Error('Task has no agent contract.');
      const walkthroughDecision = evaluateWalkthroughTool(
        context.walkthrough,
        call.name,
      );
      if (!walkthroughDecision.allowed) {
        this.runtime.resumePlanning(
          taskId,
          'Rejected a tool call that skipped the walkthrough sequence.',
        );
        return JSON.stringify({
          status: 'not_executed',
          summary: walkthroughDecision.summary,
        });
      }
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
      if (outputStatus(output) === 'confirmed') {
        context.walkthrough = advanceWalkthrough(
          context.walkthrough,
          call.name,
        );
      }
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
      try {
        const preview = this.toolExecutionBroker.preview({
          call,
          goal: current.goal,
          latestObservation: context.latestObservation,
          taskId,
        });
        context.approvalPreviews.set(call.callId, preview.invocation);
        return preview.decision.status === 'needs_approval';
      } catch {
        context.approvalPreviews.delete(call.callId);
        return false;
      }
    };

    if (
      snapshot.goal.executionProfile !== 'workspace' &&
      !context.walkthrough.enabled &&
      (snapshot.goal.activity?.activity.launchTarget === 'current_surface' ||
        shouldCaptureInitialDesktopObservation(snapshot.request))
    ) {
      const semanticObservationAvailable = this.toolRegistry
        .modelVisibleSpecs()
        .some((tool) => tool.name === 'observe_surface');
      await executeTool({
        arguments: JSON.stringify(
          semanticObservationAvailable
            ? {
                reason: 'Ground the first model response in the current surface.',
                query: null,
              }
            : {
                reason: 'Ground the first model response in the current desktop.',
              },
        ),
        callId: `host-initial-observation:${taskId}`,
        name: semanticObservationAvailable ? 'observe_surface' : 'observe_desktop',
      });
    }

    let finalOutput = await agent.runTask({
      callbacks: {
        billableUserTurnIds: currentBillableUserTurnIds,
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
      ...(context.latestObservation
        ? { initialObservation: context.latestObservation }
        : {}),
      request: snapshot.request,
      resumeMetadata: snapshot.runtimeResume,
      emitActivity: (activity) => this.onActivity(taskId, activity),
      signal,
      taskId,
      tools: this.toolRegistry.modelVisibleSpecs({
        goal: snapshot.goal,
        taskId,
        latestObservation: context.latestObservation,
      }),
    });
    if (context.walkthrough.enabled && context.walkthrough.completedSteps === 0) {
      this.runtime.resumePlanning(
        taskId,
        'Rejected an upfront answer because this task requires visible guidance.',
      );
      finalOutput = await agent.continueTask(
        taskId,
        WALKTHROUGH_RECOVERY_INSTRUCTION,
        signal,
      );
      if (context.walkthrough.completedSteps === 0) {
        this.runtime.block(
          taskId,
          'Tro could not start the requested interactive walkthrough.',
          ['Try again with the target exercise or application visible.'],
        );
        return;
      }
    }
    if (context.walkthrough.enabled) {
      this.runtime.resumePlanning(
        taskId,
        'Checking that the interactive walkthrough is actually complete.',
      );
      const checkpointOutput = await agent.continueTask(
        taskId,
        WALKTHROUGH_COMPLETION_INSTRUCTION,
        signal,
      );
      const recap = parseWalkthroughCompletion(checkpointOutput);
      if (!recap) {
        this.runtime.block(
          taskId,
          'Tro could not verify a concise walkthrough completion.',
          ['Continue the walkthrough or try again with the target still visible.'],
        );
        return;
      }
      finalOutput = recap;
    } else {
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
        const visibleContextCheckpoint =
          context.latestObservation &&
          requestUsesCurrentSurfaceContext(snapshot.request)
            ? [
                'The request refers to the trusted visible computer observation. Do not claim the user failed to supply the screen, content, assignment, or screenshot.',
                'If the needed details are behind a clearly routine, reversible control such as tutorial Next, expand, a tab, or scrolling, call the appropriate computer tool to reveal and inspect them before asking the user.',
                'If safe inspection still cannot reveal the task, describe what you actually inspected and ask one specific question instead of requesting the same screen again.',
              ]
            : [];
        const visibleActionCheckpoint =
          context.latestObservation &&
          requestsVisibleContextAction(snapshot.request)
            ? [
                'The user delegated visible work, so a description or generic instructions alone are not completion. If a relevant routine, reversible visible action can advance the task, call the appropriate computer tool now and continue while the path remains clear.',
                'Do not ask for confirmation for routine reversible progress. The host will independently require approval for consequential actions.',
                'If interface manipulation is unnecessary because the observed task can be completed directly, return the completed result instead.',
              ]
            : [];
        finalOutput = await agent.continueTask(
          taskId,
          [
            'Trusted host completion checkpoint: re-read the original request and tool-result history.',
            'Verify every requested outcome is grounded by available evidence.',
            ...visibleContextCheckpoint,
            ...visibleActionCheckpoint,
            'If anything remains, call the next tool. Otherwise return only the final user-facing answer.',
          ].join('\n'),
          signal,
        );
      }
    }
    const current = this.runtime.getSnapshot(taskId);
    if (!TERMINAL_PHASES.has(current.phase) && current.phase !== 'blocked') {
      if (
        !current.goal ||
        (current.goal.schemaVersion !== 7 && current.goal.schemaVersion !== 8) ||
        !current.outcomes
      ) {
        throw new Error('Current task has no outcome contract for completion.');
      }
      this.runtime.complete(
        taskId,
        createCompletionDecision(
          current.goal.outcomeContract,
          current.outcomes.evidence,
          finalOutput,
        ),
      );
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
      case 'surface':
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
        invocation.toolId === 'computer.observe'
          ? 'Reading the current application surface requested by the model.'
          : 'Capturing the desktop requested by the model.',
        invocation.toolId === 'computer.observe' ? 'surface' : 'desktop',
        invocation.toolId === 'computer.observe'
          ? (invocation.input as { query?: string }).query
          : undefined,
      );
      this.runtime.recordToolResult(
        taskId,
        observation.route === 'desktop_vision'
          ? 'Captured a fresh desktop observation.'
          : 'Read a fresh semantic surface observation.',
        toolIdentity(invocation),
      );
      this.runtime.resumePlanning(
        taskId,
        'Returned the observation result to the model.',
      );
      return observationOutput(
        invocation.callId,
        observation,
        observation.route === 'desktop_vision'
          ? 'Fresh desktop observation captured.'
          : 'Fresh current-surface context captured.',
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
      actionDigestFor(snapshot, request.action);
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
        snapshot.approvalGrant?.actionDigest !== actionDigestFor(snapshot, action)
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
    return this.dispatchAction(taskId, context, invocation, policy);
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
      const approvedObservation =
        context.latestObservation?.fingerprint === input.observationFingerprint
          ? context.latestObservation
          : undefined;
      const current = await this.captureObservation(
        taskId,
        context,
        'Checking that the approved desktop state is still current.',
        'desktop',
      );
      this.runtime.beginVerification(
        taskId,
        'Validated the current desktop before using approval.',
      );
      if (
        !approvedObservation ||
        !input.command ||
        !this.approvalObservationMatches(
          approvedObservation,
          current,
          input.command,
        )
      ) {
        this.runtime.discardApprovalGrant(
          taskId,
          'The screen changed after approval; the held action was not executed.',
        );
        context.pendingApproval = undefined;
        this.runtime.block(
          taskId,
          'The screen changed after approval, so the action was not executed and Tro stopped before requesting approval again.',
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

    if (invocation.kind === 'surface') {
      const surfaceInput = invocation.input as Partial<SurfaceControlToolInput> &
        Partial<PrepareBrowserAccessToolInput>;
      if (surfaceInput.observationId) {
        const validation = await this.cua.revalidateSurfaceAction(
          taskId,
          surfaceInput.observationId,
          surfaceInput.publicRef,
          context.controller.signal,
        );
        if (validation.currentObservation.screenshot) {
          context.imagesCaptured += 1;
        }
        context.latestObservation = validation.currentObservation;
        if (!validation.rebound) {
          this.runtime.discardApprovalGrant(
            taskId,
            'The semantic target changed after approval; the held action was not executed.',
          );
          context.pendingApproval = undefined;
          this.runtime.block(
            taskId,
            'The target changed after approval, so the action was not executed.',
            ['Review the current application and start a new request.'],
          );
          return resultOutput(
            invocation.callId,
            {
              status: 'not_executed',
              summary:
                'The approved semantic target changed. Re-observe and propose a fresh action.',
            },
            validation.currentObservation,
          ).output;
        }
      }
    }

    this.runtime.consumeApprovalGrant({
      taskId,
      action: invocation.action,
    });
    context.pendingApproval = undefined;
    const approvedPolicy = snapshot.goal && invocation.action
      ? evaluateAction(snapshot.goal, invocation.action, this.toolRegistry)
      : undefined;
    const authorization: ExecutionAuthorizationMetadata = approvedPolicy
      ? {
          effect: approvedPolicy.effect,
          authorizationSource: 'exact_approval',
          approvalRequired: true,
          consequential: approvedPolicy.consequential,
        }
      : {
          effect: unknownActionEffect(),
          authorizationSource: 'exact_approval',
          approvalRequired: true,
          consequential: true,
        };
    return this.dispatchAction(taskId, context, invocation, authorization);
  }

  private async dispatchAction(
    taskId: string,
    context: ExecutionContext,
    invocation: ResolvedToolInvocation,
    authorization: ExecutionAuthorizationMetadata,
  ): Promise<AgentToolOutput['output']> {
    const signal = context.controller.signal;
    let guidanceEntry: GuidanceHistoryEntry | undefined;
    if (invocation.kind === 'guidance') {
      await this.ensureDesktopSession(taskId, context);
      const presentation = presentationFor(invocation, context.latestObservation);
      if (presentation) {
        const desktopPresentation = {
          ...presentation.presentation,
          shortcuts: this.onGuidanceWaitStart(taskId),
          taskId,
        };
        const handle = await this.presentAction(
          presentation.command,
          signal,
          desktopPresentation,
        );
        if (!handle) {
          const summary =
            'The guidance overlay was unavailable, so this walkthrough step was not shown.';
          this.onGuidanceWaitEnd(taskId);
          this.dismissPresentation();
          this.runtime.block(taskId, summary, [
            'Open Tro to review the result, then try the walkthrough again.',
          ]);
          return resultOutput(invocation.callId, {
            status: 'not_executed',
            summary,
          }).output;
        }
        guidanceEntry = {
          command: presentation.command,
          presentation: desktopPresentation,
        };
        context.activeGuidance = handle;
      }
    }

    if (invocation.action && invocation.kind !== 'guidance') {
      const snapshot = this.runtime.getSnapshot(taskId);
      const presentation = actionTargetPresentationFor(
        invocation,
        context.latestObservation,
      );
      const preview = createActionPreview({
        action: invocation.action,
        ...(context.latestObservation
          ? {
              context: [
                context.latestObservation.surface?.application,
                context.latestObservation.surface?.title,
                context.latestObservation.surface?.url,
                context.latestObservation.text,
              ]
                .filter(Boolean)
                .join(' '),
            }
          : {}),
        preferredLanguage: await this.actionPreviewLanguage(),
        request: snapshot.request,
        ...(presentation.screenPoint
          ? { screenPoint: presentation.screenPoint }
          : {}),
        ...(presentation.screenRegion
          ? { screenRegion: presentation.screenRegion }
          : {}),
        taskId,
      });
      let presented = false;
      try {
        presented = await this.presentActionPreview(preview, signal);
      } catch (error) {
        if (isAbort(error, signal)) throw error;
      }
      if (!presented) {
        const summary =
          'The action preview was unavailable, so Tro did not perform the action.';
        this.runtime.block(taskId, summary, [
          'Open Tro and retry after the companion is available.',
        ]);
        return resultOutput(invocation.callId, {
          status: 'not_executed',
          summary,
        }).output;
      }
    }

    if (
      (invocation.toolId === 'browser.navigate' &&
        invocation.operation === 'open_url') ||
      (invocation.toolId === 'application.launch' &&
        invocation.operation === 'launch')
    ) {
      context.latestObservation = undefined;
    }

    if (invocation.kind !== 'guidance') {
      this.runtime.registerToolEffectObligation(
        taskId,
        toolIdentity(invocation),
        invocation.action?.description ??
          `Complete ${invocation.toolId}.${invocation.operation}.`,
      );
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
    if (invocation.kind === 'surface' && result.observation) {
      observation = result.observation;
      if (observation.screenshot) context.imagesCaptured += 1;
      context.latestObservation = observation;
    } else if (invocation.kind === 'desktop') {
      try {
        observation = await this.captureObservation(
          taskId,
          context,
          'Capturing the desktop after the dispatched action.',
          'desktop',
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
    if (invocation.kind !== 'guidance') {
      this.runtime.recordToolOutcomeEvidence(
        taskId,
        toolIdentity(invocation),
        result.status,
        result.summary,
      );
    }
    const eventGoal = this.runtime.getSnapshot(taskId).goal;
    const authorizationEvent = eventGoal?.schemaVersion === 8
      ? {
          effectKind: authorization.effect.kind,
          resourceKind: authorization.effect.resourceKind,
          authorizationSource: authorization.authorizationSource,
          approvalRequired: authorization.approvalRequired,
          consequential: authorization.consequential,
        }
      : {};
    this.runtime.recordToolResult(
      taskId,
      result.summary,
      {
        ...toolIdentity(invocation),
        ...authorizationEvent,
      },
    );
    const output = resultOutput(invocation.callId, result, observation).output;
    if (guidanceEntry) {
      context.guidanceHistory.push(guidanceEntry);
      if (context.guidanceHistory.length > 50) context.guidanceHistory.shift();
      context.guidanceCursor = context.guidanceHistory.length - 1;
      await this.waitForGuidance(taskId, context);
    }
    if (result.status === 'unknown' && authorization.consequential) {
      this.runtime.block(
        taskId,
        'A consequential action has an unknown outcome. Tro will not retry it or dispatch another consequential action in this task.',
        ['Inspect the target application before starting a new task.'],
      );
      return output;
    }
    if (verificationUnavailable) {
      this.runtime.block(
        taskId,
        'Tro could not capture the fresh desktop state required after the action, so it stopped before another model step.',
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
    mode: 'surface' | 'desktop' = 'desktop',
    query?: string,
  ): Promise<DesktopObservation> {
    const snapshot = this.runtime.getSnapshot(taskId);
    if (!snapshot.goal) throw new Error('Task has no agent contract.');
    const maxImages =
      snapshot.goal.schemaVersion === 4 || snapshot.goal.schemaVersion === 5 || snapshot.goal.schemaVersion === 6 || snapshot.goal.schemaVersion === 7 || snapshot.goal.schemaVersion === 8
        ? snapshot.goal.limits.maxImages
        : 20;
    await this.ensureDesktopSession(taskId, context);
    this.runtime.beginObservation(taskId, summary);
    if (mode === 'surface') {
      const semanticObservation = await runWithOperationTimeout(
        (signal) =>
          this.cua.observeCurrentSurface(
            taskId,
            {
              allowScreenshot: context.imagesCaptured < maxImages,
              ...(query ? { query } : {}),
            },
            signal,
          ),
        context.controller.signal,
        this.observationTimeoutMs,
        'Semantic surface observation',
      );
      if (semanticObservation) {
        const observation = this.prepareObservation(semanticObservation);
        if (observation.screenshot) context.imagesCaptured += 1;
        context.latestObservation = observation;
        return observation;
      }
    }
    if (context.imagesCaptured >= maxImages) {
      this.runtime.block(taskId, 'The task reached its image-evidence limit.', [
        'Provide a narrower request or start a new task.',
      ]);
      throw executionStoppedError();
    }
    const cleanup = await this.prepareDesktop();
    try {
      const observation = this.prepareObservation(
        await runWithOperationTimeout(
          (signal) => this.cua.observe(taskId, signal),
          context.controller.signal,
          this.observationTimeoutMs,
          'Desktop observation',
        ),
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
    try {
      await this.onDesktopControlChange(taskId, true);
    } catch {
      // The persistent status overlay is best-effort and cannot block CUA.
    }
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
      try {
        if (context.desktopSessionStarted) {
          await this.cua.endTaskSession(taskId);
        }
        await context.agent?.end(taskId);
        this.toolExecutionBroker.endTask(taskId);
        this.contexts.delete(taskId);
      } finally {
        if (context.desktopSessionStarted) {
          try {
            await this.onDesktopControlChange(taskId, false);
          } catch {
            // Session cleanup cannot be blocked by a presentation failure.
          }
        }
      }
    })();
    await context.cleanupPromise;
  }
}
