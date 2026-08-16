import type { TaskSnapshot } from '../../shared/contracts';
import type { CuaService } from '../cua/cua-service';

import {
  mapScreenshotPointToDesktop,
  proposedActionForDecision,
  type DesktopActionDecision,
  type DesktopActionOutcome,
  type DesktopCommand,
  type DesktopCoordinateSpace,
  type DesktopObservation,
} from './execution-contracts';
import { evaluateAction } from './policy';
import type {
  DesktopPlanner,
  PlannerGuidancePoint,
} from './realtime-planner';
import type { TaskRuntime } from './task-runtime';

interface ExecutionCoordinatorOptions {
  cua: Pick<
    CuaService,
    'startTaskSession' | 'observe' | 'executeCommand' | 'endTaskSession'
  >;
  now?: () => Date;
  openExternal?: (url: string) => Promise<void>;
  planner: DesktopPlanner;
  pointGrounder?: (
    decision: DesktopActionDecision,
    observation: DesktopObservation,
    signal: AbortSignal,
  ) => Promise<DesktopPointGrounding | null>;
  prepareDesktop?: () => Promise<DesktopObservationCleanup | void>;
  presentAction?: (
    command: DesktopCommand,
    signal: AbortSignal,
    presentation?: DesktopPresentation,
  ) => Promise<void>;
  runtime: TaskRuntime;
}

export interface DesktopPointGrounding {
  matchedText: string;
  point: { x: number; y: number };
  source: string;
}

type DesktopObservationCleanup = () => Promise<void> | void;

export interface DesktopPresentation {
  message?: string;
  screenPoint?: { x: number; y: number };
  target?: string;
}

interface ExecutionContext {
  controller: AbortController;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  guidancePoints: PlannerGuidancePoint[];
  initialized: boolean;
  previousOutcome?: DesktopActionOutcome;
  running?: Promise<void>;
  startedAt: Date;
}

const TERMINAL_PHASES: ReadonlySet<TaskSnapshot['phase']> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

function approvalConsequence(action: ReturnType<typeof proposedActionForDecision>): string {
  switch (action.action) {
    case 'send': {
      const recipients = action.parameters?.recipients;
      const recipientText = Array.isArray(recipients)
        ? recipients.join(', ')
        : recipients;
      return recipientText
        ? `This will send the exact displayed message to ${recipientText}.`
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
    default:
      return `This will perform: ${action.description}`;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown execution failure.';
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError');
}

function presentationPoint(
  command: DesktopCommand,
  coordinateSpace: DesktopCoordinateSpace | undefined,
): { x: number; y: number } | undefined {
  if (
    command.kind !== 'click' &&
    command.kind !== 'point' &&
    command.kind !== 'scroll'
  ) {
    return undefined;
  }

  return mapScreenshotPointToDesktop(command, coordinateSpace);
}

export class TaskExecutionCoordinator {
  private readonly contexts = new Map<string, ExecutionContext>();

  private readonly cua: ExecutionCoordinatorOptions['cua'];

  private readonly now: () => Date;

  private readonly openExternal: (url: string) => Promise<void>;

  private readonly planner: DesktopPlanner;

  private readonly pointGrounder: NonNullable<
    ExecutionCoordinatorOptions['pointGrounder']
  >;

  private readonly prepareDesktop: () => Promise<DesktopObservationCleanup | void>;

  private readonly presentAction: NonNullable<
    ExecutionCoordinatorOptions['presentAction']
  >;

  private readonly runtime: TaskRuntime;

  constructor({
    cua,
    now = () => new Date(),
    openExternal = async () => {
      throw new Error('URL navigation is not configured.');
    },
    planner,
    pointGrounder = async () => null,
    prepareDesktop = async () => undefined,
    presentAction = async () => undefined,
    runtime,
  }: ExecutionCoordinatorOptions) {
    this.cua = cua;
    this.now = now;
    this.openExternal = openExternal;
    this.planner = planner;
    this.pointGrounder = pointGrounder;
    this.prepareDesktop = prepareDesktop;
    this.presentAction = presentAction;
    this.runtime = runtime;
  }

  start(input: unknown): TaskSnapshot {
    const snapshot = this.runtime.start(input);
    if (!snapshot.goal) throw new Error('Task has no compiled goal.');
    const context: ExecutionContext = {
      controller: new AbortController(),
      guidancePoints: [],
      initialized: false,
      startedAt: this.now(),
    };
    context.deadlineTimer = setTimeout(
      () => this.reachDeadline(snapshot.taskId, context),
      snapshot.goal.limits.maxMinutes * 60_000,
    );
    context.deadlineTimer.unref?.();
    this.contexts.set(snapshot.taskId, context);
    this.kick(snapshot.taskId);
    return snapshot;
  }

  resume(taskId: string): void {
    const context = this.contexts.get(taskId);
    if (!context) return;
    this.kick(taskId);
  }

  cancel(input: unknown): TaskSnapshot {
    const snapshot = this.runtime.cancel(input);
    const taskId = snapshot.taskId;
    const context = this.contexts.get(taskId);
    context?.controller.abort();
    if (context && !context.running) void this.cleanup(taskId, context);
    return snapshot;
  }

  cancelActiveTasks(): TaskSnapshot[] {
    return [...this.contexts.keys()].map((taskId) => this.cancel({ taskId }));
  }

  async waitForIdle(taskId: string): Promise<void> {
    await this.contexts.get(taskId)?.running;
  }

  async shutdown(): Promise<void> {
    const entries = [...this.contexts.entries()];
    for (const [, context] of entries) context.controller.abort();
    await Promise.allSettled(
      entries.map(async ([taskId, context]) => {
        await context.running;
        await this.cleanup(taskId, context);
      }),
    );
  }

  private kick(taskId: string): void {
    const context = this.contexts.get(taskId);
    if (!context || context.running) return;

    context.running = this.run(taskId, context).finally(() => {
      context.running = undefined;
      const snapshot = this.runtime.getSnapshot(taskId);
      if (TERMINAL_PHASES.has(snapshot.phase) || context.controller.signal.aborted) {
        void this.cleanup(taskId, context);
      }
    });
  }

  private async run(taskId: string, context: ExecutionContext): Promise<void> {
    try {
      let snapshot = this.runtime.getSnapshot(taskId);
      if (!snapshot.goal) throw new Error('Task has no compiled goal.');

      if (!context.initialized) {
        await this.cua.startTaskSession(taskId, context.controller.signal);
        await this.planner.start(taskId, snapshot.goal, context.controller.signal);
        context.initialized = true;
      }

      while (!context.controller.signal.aborted) {
        snapshot = this.runtime.getSnapshot(taskId);
        if (TERMINAL_PHASES.has(snapshot.phase)) return;
        if (
          snapshot.phase === 'awaiting_input' ||
          snapshot.phase === 'awaiting_approval'
        ) {
          return;
        }
        if (!snapshot.goal || !snapshot.progress) {
          throw new Error('The running task lost its goal or step budget.');
        }

        const elapsedMs = this.now().getTime() - context.startedAt.getTime();
        if (elapsedMs >= snapshot.goal.limits.maxMinutes * 60_000) {
          this.runtime.block(taskId, 'The task reached its time limit.', [
            'Review the current screen and start a new bounded task if needed.',
          ]);
          return;
        }
        if (snapshot.progress.currentStep >= snapshot.progress.maxSteps) {
          this.runtime.block(taskId, 'The task reached its action limit.', [
            'Review progress before granting another action budget.',
          ]);
          return;
        }

        const steering = this.runtime.takeSteering(taskId);
        snapshot = this.runtime.getSnapshot(taskId);
        if (snapshot.phase === 'blocked' && steering.length > 0) {
          snapshot = this.runtime.resumePlanning(
            taskId,
            'Applying user steering to the blocked task.',
          );
        }

        const restoreDesktopPresentation = await this.prepareDesktop();
        this.runtime.beginObservation(
          taskId,
          'Observing the desktop before the next bounded step.',
        );
        let observation: DesktopObservation;
        try {
          observation = await this.cua.observe(
            taskId,
            context.controller.signal,
          );
        } finally {
          await restoreDesktopPresentation?.();
        }
        snapshot = this.runtime.getSnapshot(taskId);
        const goal = snapshot.goal;
        const progress = snapshot.progress;
        if (!goal || !progress) {
          throw new Error('The running task lost its goal or step budget.');
        }
        let decision = await this.planner.decide(
          taskId,
          {
            goal,
            guidancePoints: context.guidancePoints,
            observation,
            previousOutcome: context.previousOutcome,
            recentMessages: snapshot.messages,
            remainingSteps: Math.max(
              0,
              progress.maxSteps - progress.currentStep,
            ),
            steering,
          },
          context.controller.signal,
        );

        if (decision.kind === 'ask_user') {
          this.runtime.discardApprovalGrant(
            taskId,
            'The approved action is no longer the next step.',
          );
          this.runtime.requestInput({
            taskId,
            prompt: decision.prompt,
            ...(decision.choices
              ? {
                  choices: decision.choices.map((label, index) => ({
                    id: `choice-${index + 1}`,
                    label,
                  })),
                }
              : {}),
          });
          return;
        }
        if (decision.kind === 'blocked') {
          this.runtime.discardApprovalGrant(
            taskId,
            'The approved action is no longer the next step.',
          );
          this.runtime.block(taskId, decision.reason, [
            'Give TroCode a new instruction to re-plan from a safe boundary.',
          ]);
          return;
        }
        if (decision.kind === 'complete') {
          this.runtime.discardApprovalGrant(
            taskId,
            'The task completed without using the approved action.',
          );
          this.runtime.beginVerification(
            taskId,
            'The latest observation satisfies the goal.',
          );
          this.runtime.complete(taskId, decision.summary);
          return;
        }

        if (decision.observationId !== observation.observationId) {
          throw new Error('The model action referenced a stale observation.');
        }

        if (decision.command.kind === 'point') {
          const grounding = await this.pointGrounder(
            decision,
            observation,
            context.controller.signal,
          );
          if (grounding) {
            console.info(
              '[execution] pointer.grounded',
              JSON.stringify({
                taskId,
                source: grounding.source,
                matchedText: grounding.matchedText,
                plannerScreenshotPoint: {
                  x: decision.command.x,
                  y: decision.command.y,
                },
                groundedScreenshotPoint: grounding.point,
              }),
            );
            decision = {
              ...decision,
              command: {
                ...decision.command,
                ...grounding.point,
              },
            };
          }
        }

        if (
          goal.interactionMode === 'answer' ||
          goal.interactionMode === 'guide'
        ) {
          if (decision.command.kind === 'point') {
            // A point command only moves the teaching pointer. It cannot click,
            // type, scroll, navigate, or otherwise mutate the visible surface.
          } else {
            this.runtime.block(
              taskId,
              `${goal.interactionMode} mode does not authorize desktop actions.`,
              [
                'Create an explicit action goal if you want TroCode to operate the desktop.',
              ],
            );
            return;
          }
        }

        if (
          decision.command.kind !== 'open_url' &&
          !goal.capabilities.includes('computer_use')
        ) {
          this.runtime.block(
            taskId,
            'The proposed desktop action requires computer-use capability.',
            ['Review and explicitly expand the goal capability before continuing.'],
          );
          return;
        }

        const action = proposedActionForDecision(decision);
        const policyDecision = evaluateAction(goal, action);
        if (policyDecision.status === 'denied') {
          this.runtime.discardApprovalGrant(
            taskId,
            'The approved action is outside the current plan.',
          );
          this.runtime.block(taskId, policyDecision.summary, policyDecision.nextActions);
          return;
        }

        if (policyDecision.status === 'needs_approval') {
          if (snapshot.approvalGrant) {
            try {
              this.runtime.consumeApprovalGrant({ taskId, action });
            } catch {
              if (this.runtime.getSnapshot(taskId).phase === 'blocked') {
                return;
              }
              this.runtime.discardApprovalGrant(
                taskId,
                'The screen changed, so the old approval cannot be reused.',
              );
              this.runtime.requestApproval({
                taskId,
                action,
                prompt: `Approve this exact action: ${action.description}`,
                consequence: approvalConsequence(action),
              });
              return;
            }
          } else {
            this.runtime.requestApproval({
              taskId,
              action,
              prompt: `Approve this exact action: ${action.description}`,
              consequence: approvalConsequence(action),
            });
            return;
          }
        } else {
          if (snapshot.approvalGrant) {
            this.runtime.discardApprovalGrant(
              taskId,
              'The approved action is no longer the next step.',
            );
          }
          if (decision.command.kind === 'point') {
            this.runtime.recordGuidance(taskId, decision.description);
          }
          this.runtime.beginAllowedAction(taskId, action);
        }

        const screenPoint = presentationPoint(
          decision.command,
          observation.coordinateSpace,
        );
        if (screenPoint && decision.command.kind === 'point') {
          console.info(
            '[execution] pointer.presentation',
            JSON.stringify({
              taskId,
              cuaScreenshotPoint: {
                x: decision.command.x,
                y: decision.command.y,
              },
              overlayScreenPoint: screenPoint,
            }),
          );
        }
        const presentation: DesktopPresentation | undefined =
          decision.command.kind === 'point'
            ? {
                message: decision.description,
                ...(screenPoint ? { screenPoint } : {}),
                ...(decision.guidanceSequence
                  ? {
                      target: `${decision.guidanceSequence.index} / ${decision.guidanceSequence.total} · ${decision.target ?? `Item ${decision.guidanceSequence.index}`}`,
                    }
                  : decision.target
                    ? { target: decision.target }
                    : {}),
              }
            : screenPoint
              ? { screenPoint }
              : undefined;
        const outcome = await this.execute(
          taskId,
          decision.command,
          context.controller.signal,
          presentation,
        );
        context.previousOutcome = outcome;
        console.info(
          '[execution] action.outcome',
          JSON.stringify({
            taskId,
            command: decision.command.kind,
            status: outcome.status,
          }),
        );

        if (outcome.status === 'failed') {
          this.runtime.block(taskId, outcome.summary, [
            'Inspect the screen and give a new instruction before continuing.',
          ]);
          return;
        }

        if (
          decision.command.kind === 'point' &&
          outcome.status === 'confirmed'
        ) {
          context.guidancePoints.push({
            description: decision.description,
            sequenceIndex: decision.guidanceSequence!.index,
            sequenceTotal: decision.guidanceSequence!.total,
            ...(decision.target ? { target: decision.target } : {}),
          });
        }

        this.runtime.beginVerification(taskId, outcome.summary, true);
        if (outcome.status === 'unknown') {
          this.runtime.block(
            taskId,
            `The ${decision.command.kind} outcome is unknown: ${outcome.summary} TroCode will not retry it.`,
            ['Inspect the target application before continuing.'],
          );
          return;
        }
      }
    } catch (error) {
      if (isAbort(error, context.controller.signal)) return;
      const snapshot = this.runtime.getSnapshot(taskId);
      if (!TERMINAL_PHASES.has(snapshot.phase)) {
        this.runtime.fail(taskId, errorMessage(error));
      }
    }
  }

  private async execute(
    taskId: string,
    command: DesktopCommand,
    signal: AbortSignal,
    presentation?: DesktopPresentation,
  ): Promise<DesktopActionOutcome> {
    if (command.kind === 'open_url') {
      await this.openExternal(command.url);
      await this.presentAction(command, signal);
      return {
        status: 'confirmed',
        summary: 'The browser accepted the HTTPS navigation request.',
      };
    }

    if (command.kind === 'point') {
      const [outcome] = await Promise.all([
        this.cua.executeCommand(taskId, command, signal),
        this.presentAction(command, signal, presentation),
      ]);
      return outcome;
    }

    await this.presentAction(command, signal, presentation);
    return this.cua.executeCommand(taskId, command, signal);
  }

  private async cleanup(
    taskId: string,
    context: ExecutionContext,
  ): Promise<void> {
    if (this.contexts.get(taskId) !== context) return;
    this.contexts.delete(taskId);
    if (context.deadlineTimer) clearTimeout(context.deadlineTimer);
    await Promise.allSettled([
      this.planner.end(taskId),
      this.cua.endTaskSession(taskId),
    ]);
  }

  private reachDeadline(taskId: string, context: ExecutionContext): void {
    if (this.contexts.get(taskId) !== context) return;
    const snapshot = this.runtime.getSnapshot(taskId);
    if (!TERMINAL_PHASES.has(snapshot.phase)) {
      const actionWasInFlight = snapshot.phase === 'acting';
      this.runtime.block(
        taskId,
        actionWasInFlight
          ? 'The task timed out during an action, so its outcome is unknown.'
          : 'The task reached its time limit.',
        [
          actionWasInFlight
            ? 'Inspect the target application and do not retry automatically.'
            : 'Review the current screen before starting another bounded task.',
        ],
      );
    }
    context.controller.abort();
    if (!context.running) void this.cleanup(taskId, context);
  }
}
