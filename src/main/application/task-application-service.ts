import { randomUUID } from 'node:crypto';

import {
  AgentTaskContractV11Schema,
  CancelTaskRequestSchema,
  RespondToInteractionRequestSchema,
  StartTaskRequestSchema,
  SteerTaskRequestSchema,
  SubmitTaskRequestSchema,
  type ActivityContext,
  type LocalGuidanceStartJournal,
  type ClassroomSessionProjection,
  type TaskRoute,
  type TaskSnapshot,
} from '../../shared/contracts';
import type { TrustedToolExecutionContext } from '../agent/runtime-tool-registry';
import { shouldObserveInitialScreenContext } from '../agent/screen-context-policy';
import type { TaskRuntime } from '../agent/task-runtime';
import type { AgentRuntimeAdapter } from '../agent-runtime/agent-runtime-adapter';
import type { EncryptedAgentStateStore } from '../agent-runtime/encrypted-agent-state-store';
import type { CoachRuntimeStart } from '../coach/coach-contracts';
import type { CoachRuntime } from '../coach/coach-runtime';
import type { ActivityContextService } from '../knowledge/activity-context-service';
import type { ActivityProgressReporter } from '../knowledge/activity-progress-reporter';
import type { ClassroomBroadcastDraftService } from '../knowledge/classroom-broadcast-draft-service';
import type { ClassroomSessionService } from '../knowledge/classroom-session-service';
import type { TeacherClassroomContextService } from '../knowledge/teacher-classroom-context-service';
import type { WorkCheckContextService } from '../knowledge/work-check-context-service';
import type { WorkspaceSelectionService } from '../workspace/workspace-selection-service';

import { routeTaskRequest } from './task-request-router';

const DEFAULT_LIMITS = {
  maxImages: 20,
  maxMicroUsd: 5_000_000,
  maxMinutes: 30,
  maxModelSamples: 40,
  maxToolCalls: 30,
} as const;

interface TaskApplicationServiceOptions {
  workChecks?: Pick<WorkCheckContextService, 'bind' | 'release'>;
  onTaskCancelled?: (taskId: string) => void;
  teacherClassroomContext?: TeacherClassroomContextService;
  broadcastDrafts?: ClassroomBroadcastDraftService;
  activityContextService?: Pick<ActivityContextService, 'create' | 'inspect'>;
  activityProgressReporter?: Pick<ActivityProgressReporter, 'bind' | 'fail'>;
  classroomSessionService?: Pick<ClassroomSessionService, 'activeStudentAttemptId' | 'latestDirective' | 'onChange'>;
  coachRuntime?: Pick<CoachRuntime, 'cancel' | 'shutdown' | 'start'>;
  currentOwnerId?(): Promise<string>;
  fastCoachEnabled?: boolean;
  localRuntime?: AgentRuntimeAdapter;
  state?: EncryptedAgentStateStore;
  workspaceSelectionService?: Pick<WorkspaceSelectionService, 'resolve'>;
}

export class TaskApplicationService {
  private readonly executionContexts = new Map<string, TrustedToolExecutionContext>();
  private readonly inheritedClassroomTasks = new Set<string>();
  private reservation: string | null = null;
  private readonly routes = new Map<string, TaskRoute>();

  constructor(
    private readonly runtime: TaskRuntime,
    private readonly options: TaskApplicationServiceOptions = {},
  ) {
    options.classroomSessionService?.onChange((session) => {
      this.cancelInvalidClassroomTasks(session);
    });
  }

  async submitAndStart(input: unknown): Promise<TaskSnapshot> {
    const token = randomUUID();
    if (this.reservation)
      throw new Error('Another task is starting. Please try again.');
    if (
      [...this.routes.keys()].some(
        (id) =>
          !['completed', 'failed', 'cancelled', 'blocked'].includes(
            this.runtime.getSnapshot(id).phase,
          ),
      )
    )
      throw new Error(
        'Finish or stop the current task before starting another.',
      );
    this.reservation = token;
    try {
      return await this.submitOrdinary(input);
    } finally {
      this.releaseReservation(token);
    }
  }

  private async submitOrdinary(input: unknown): Promise<TaskSnapshot> {
    const request = SubmitTaskRequestSchema.parse(input);
    if (!this.options.state || !this.options.currentOwnerId) {
      throw new Error('Local task persistence is not configured.');
    }
    if (request.teacherClassroomSelectionId && request.activityAttemptId)
      throw new Error(
        'Teacher selection cannot be combined with a student Activity.',
      );
    const teacherClassroom =
      request.teacherClassroomSelectionId && request.requestedMode === 'auto'
        ? await this.options.teacherClassroomContext?.resolve(
            request.teacherClassroomSelectionId,
          )
        : null;
    if (
      request.teacherClassroomSelectionId &&
      request.requestedMode === 'auto' &&
      !teacherClassroom
    )
      throw new Error('Teacher classroom tools are unavailable.');
    const joinedAttemptId = this.options.classroomSessionService?.activeStudentAttemptId() ?? null;
    const activityAttemptId = teacherClassroom
      ? null
      : (request.activityAttemptId ?? joinedAttemptId);
    if (!activityAttemptId && request.activityIntent !== 'work') {
      throw new Error('Join an active class before using Help or Check.');
    }
    const attempt = activityAttemptId
      ? await this.options.activityContextService?.inspect(activityAttemptId)
      : null;
    if (activityAttemptId && !attempt) throw new Error('This assigned Activity is unavailable.');
    const isCheck = Boolean(attempt && request.activityIntent === 'check');
    if (isCheck && attempt && !['assigned','in_progress','blocked'].includes(attempt.state)) throw new Error('This assignment is waiting for review or no longer active.');
    const executionProfile = attempt?.definition.launchTarget === 'workspace'
      ? 'workspace'
      : activityAttemptId ? 'everyday' : request.executionProfile;
    const workspace = request.workspaceSelectionId
      ? await this.options.workspaceSelectionService?.resolve(request.workspaceSelectionId)
      : null;
    if (executionProfile === 'workspace' && !workspace) {
      throw new Error('Select a trusted workspace before starting Workspace mode.');
    }
    if (executionProfile !== 'workspace' && workspace) {
      throw new Error('This Activity does not grant Workspace authority.');
    }
    const routeDecision = teacherClassroom
      ? { route: 'agent' as const, requiresObservation: false }
      : (this.fastCoachEnabled() || isCheck)
      ? routeTaskRequest({
          activityLaunchTarget: attempt?.definition.launchTarget ?? null,
          executionProfile,
          intent: request.activityIntent,
          requestedMode: request.requestedMode,
          screenContext: request.screenContext,
          text: request.text,
        })
      : { route: 'agent' as const, requiresObservation: false };
    if (routeDecision.route === 'agent' && !this.options.localRuntime) {
      throw new Error('The local Agents SDK runtime is not configured.');
    }
    if (routeDecision.route === 'coach' && !this.options.coachRuntime) {
      throw new Error('Tro Coach is not configured.');
    }
    const ownerId = await this.options.currentOwnerId();
    const priorProgress = routeDecision.route === 'coach' && attempt
      ? await this.options.state.findLatestCoachProgress(
          ownerId,
          attempt.attemptId,
          attempt.activityVersionId,
        )
      : null;
    const taskId = randomUUID();
    const activity = attempt
      ? await this.options.activityContextService?.create(
          attempt,
          taskId,
          attempt.definition.launchTarget,
          request.activityIntent,
          joinedAttemptId === activityAttemptId
            ? (this.options.classroomSessionService?.latestDirective() ?? null)
            : null,
        )
      : null;
    if (activityAttemptId && !activity) throw new Error('Could not create the Activity Work Session.');
    if (activity) this.options.activityProgressReporter?.bind(taskId, activity.workSessionId);

    const authorityExecutionProfile = routeDecision.route === 'coach'
      ? 'everyday'
      : executionProfile;
    const authority = AgentTaskContractV11Schema.parse({
      schemaVersion: 11,
      id: randomUUID(),
      originalRequest: request.text,
      runtimeKind: routeDecision.route === 'coach' ? 'coach' : 'openai_agents_sdk',
      route: routeDecision.route,
      executionProfile: authorityExecutionProfile,
      workspace: routeDecision.route === 'coach' ? null : (workspace ?? null),
      activity: activity ?? null,
      coachProgress: priorProgress,
      limits: DEFAULT_LIMITS,
    });
    try {
      if (isCheck && activity) this.options.workChecks?.bind(taskId, activity, workspace ?? null);
      const snapshot = this.runtime.submit(
        { ...request, activityAttemptId, executionProfile },
        { authority, taskId },
      );
      await this.options.state.create(ownerId, snapshot);
      if (teacherClassroom)
        await this.options.state.updateClassroomState(
          ownerId,
          taskId,
          (state) => ({ ...state, teacherClassroom }),
        );
      const started = this.runtime.start({ taskId });
      const executionContext: TrustedToolExecutionContext = {
        teacherClassroom,
        activity: authority.activity,
        executionProfile: authority.executionProfile,
        taskId,
        workspace: authority.workspace,
      };
      this.executionContexts.set(taskId, executionContext);
      this.routes.set(taskId, routeDecision.route);
      if (activity && joinedAttemptId === activityAttemptId) {
        this.inheritedClassroomTasks.add(taskId);
      }
      if (routeDecision.route === 'coach') {
        await this.options.coachRuntime!.start({
          taskId,
          request: request.text,
          activity: authority.activity,
          requiresObservation: routeDecision.requiresObservation,
          priorProgress,
        });
      } else {
        await this.options.localRuntime!.start({
          executionContext,
          maxTurns: authority.limits.maxModelSamples,
          request: request.text,
          ...(!teacherClassroom &&
          authority.executionProfile !== 'workspace' &&
            (authority.activity?.activity.launchTarget === 'current_surface' ||
              shouldObserveInitialScreenContext(request.text, request.screenContext))
              ? {
                  requiredInitialTool: {
                    modelName: 'observe_context',
                    arguments: {
                      operation: 'observe',
                      scope: 'auto',
                      reason: 'Ground the response in the current visible context.',
                      query: null,
                      observationId: null,
                      region: null,
                    },
                  },
                }
              : {}
          ),
          threadId: taskId,
        });
      }
      return started;
    } catch (error) {
      this.options.workChecks?.release(taskId);
      this.executionContexts.delete(taskId);
      this.inheritedClassroomTasks.delete(taskId);
      this.routes.delete(taskId);
      try {
        const snapshot = this.runtime.getSnapshot(taskId);
        if (!['completed', 'failed', 'cancelled', 'blocked'].includes(snapshot.phase)) {
          this.runtime.complete(taskId, {
            status: 'failed',
            finalOutput: null,
            message: error instanceof Error
              ? error.message
              : 'The local agent could not start.',
          });
        }
      } catch {
        // Persistence or authority validation may fail before a task exists.
      }
      await this.options.activityProgressReporter?.fail(taskId);
      throw error;
    }
  }

  reserveClassroomExplanation(taskId: string): void {
    if (
      this.reservation ||
      [...this.routes.keys()].some(
        (id) =>
          !['completed', 'failed', 'cancelled', 'blocked'].includes(
            this.runtime.getSnapshot(id).phase,
          ),
      )
    )
      throw new Error(
        'Finish or stop the current task, then start the explanation.',
      );
    this.reservation = taskId;
  }
  isDeviceBusy(): boolean {
    return (
      Boolean(this.reservation) ||
      [...this.routes.keys()].some(
        (id) =>
          !['completed', 'failed', 'cancelled', 'blocked'].includes(
            this.runtime.getSnapshot(id).phase,
          ),
      )
    );
  }
  releaseReservation(taskId: string): void {
    if (this.reservation === taskId) this.reservation = null;
  }
  async submitClassroomExplanation(
    activity: ActivityContext,
    journal: LocalGuidanceStartJournal,
    explanation: NonNullable<CoachRuntimeStart['explanation']>,
  ): Promise<TaskSnapshot> {
    const taskId = journal.request.taskId;
    if (
      this.reservation !== taskId ||
      !journal.claim ||
      journal.phase !== 'dispatching'
    )
      throw new Error('Explanation admission is unavailable.');
    if (
      !this.options.coachRuntime ||
      !this.options.state ||
      !this.options.currentOwnerId
    )
      throw new Error('Coach is unavailable.');
    if ((await this.options.currentOwnerId()) !== journal.ownerId)
      throw new Error('Account changed.');
    const request = `Explain Assignment — ${activity.activity.title}`;
    const priorProgress = await this.options.state.findLatestCoachProgress(
      journal.ownerId,
      activity.attemptId,
      activity.activityVersionId,
    );
    const authority = AgentTaskContractV11Schema.parse({
      schemaVersion: 11,
      id: randomUUID(),
      originalRequest: request,
      runtimeKind: 'coach',
      route: 'coach',
      executionProfile: 'everyday',
      workspace: null,
      activity,
      coachProgress: priorProgress,
      limits: {
        ...DEFAULT_LIMITS,
        maxMinutes: 10,
        maxModelSamples: 8,
        maxImages: 16,
        maxToolCalls: 1,
      },
    });
    const snapshot = this.runtime.submit(
      {
        text: request,
        requestedMode: 'coach',
        executionProfile: 'everyday',
        activityAttemptId: activity.attemptId,
        activityIntent: 'work',
        screenContext:
          explanation.contextMode === 'text_only' ? 'disabled' : 'auto',
      },
      { authority, taskId },
    );
    await this.options.state.create(journal.ownerId, snapshot);
    await this.options.state.updateClassroomState(
      journal.ownerId,
      taskId,
      (current) => ({ ...current, studentGuidance: journal }),
    );
    this.executionContexts.set(taskId, {
      activity,
      executionProfile: 'everyday',
      taskId,
      workspace: null,
    });
    this.routes.set(taskId, 'coach');
    const started = this.runtime.start({ taskId });
    try {
      await this.options.coachRuntime.start({
        taskId,
        request,
        activity,
        requiresObservation: explanation.contextMode === 'screen_if_permitted',
        priorProgress,
        explanation,
      });
      this.releaseReservation(taskId);
      return started;
    } catch (error) {
      this.finish(taskId);
      this.runtime.complete(taskId, {
        status: 'failed',
        finalOutput: null,
        message: 'Could not start the explanation.',
      });
      throw error;
    }
  }

  start(input: unknown): TaskSnapshot {
    const request = StartTaskRequestSchema.parse(input);
    return this.runtime.getSnapshot(request.taskId);
  }

  async cancel(input: unknown): Promise<TaskSnapshot> {
    const request = CancelTaskRequestSchema.parse(input);
    await this.options.broadcastDrafts?.cancelTask(request.taskId);
    if (this.routes.get(request.taskId) === 'coach') {
      this.options.coachRuntime?.cancel(request.taskId);
    } else {
      this.options.localRuntime?.cancel(request.taskId, request.source);
    }
    this.executionContexts.delete(request.taskId);
    this.inheritedClassroomTasks.delete(request.taskId);
    this.routes.delete(request.taskId);
    const cancelled = this.runtime.cancel(request);
    this.options.onTaskCancelled?.(request.taskId);
    return cancelled;
  }

  async cancelActiveTasks(): Promise<void> {
    for (const taskId of this.executionContexts.keys()) {
      if (this.routes.get(taskId) === 'coach') this.options.coachRuntime?.cancel(taskId);
      else this.options.localRuntime?.cancel(taskId, 'shutdown');
    }
  }

  respond(input: unknown): TaskSnapshot {
    return this.runtime.respondToInteraction(RespondToInteractionRequestSchema.parse(input));
  }

  async steer(input: unknown): Promise<TaskSnapshot> {
    const request = SteerTaskRequestSchema.parse(input);
    if (this.routes.get(request.taskId) === 'coach') {
      throw new Error('Start a new request to change what Tro Coach is teaching.');
    }
    this.options.localRuntime?.steer(request.taskId, request.instruction);
    return this.runtime.steer(request);
  }

  executionContext(taskId: string): TrustedToolExecutionContext | undefined {
    return this.executionContexts.get(taskId);
  }

  async restoreLocalTasks(): Promise<number> {
    if (!this.options.state || !this.options.localRuntime || !this.options.currentOwnerId) return 0;
    const states = await this.options.state.listActive(await this.options.currentOwnerId());
    let restored = 0;
    for (const state of states) {
      const goal = state.snapshot.goal;
      if (!goal || (goal.schemaVersion === 11 && goal.route === 'coach')) {
        this.runtime.restore(state.snapshot);
        this.runtime.complete(state.snapshot.taskId, {
          status: 'failed',
          finalOutput: null,
          message: 'Restart Coach to capture fresh screen context.',
        });
        continue;
      }
      this.runtime.restore(state.snapshot);
      const executionContext: TrustedToolExecutionContext = {
        activity: goal.activity,
        executionProfile: goal.executionProfile,
        taskId: state.snapshot.taskId,
        workspace: goal.workspace,
      };
      executionContext.teacherClassroom = state.teacherClassroom;
      this.executionContexts.set(state.snapshot.taskId, executionContext);
      this.routes.set(state.snapshot.taskId, 'agent');
      try {
        if (state.teacherClassroom) {
          if (!this.options.teacherClassroomContext)
            throw new Error('Teacher context cannot be restored.');
          await this.options.teacherClassroomContext.verify(
            state.teacherClassroom,
          );
        }
        await this.options.localRuntime.resume(state.snapshot.taskId, executionContext);
        restored += 1;
      } catch (error) {
        this.runtime.complete(state.snapshot.taskId, {
          status: 'failed', finalOutput: null,
          message: error instanceof Error ? error.message : 'The local checkpoint could not be resumed.',
        });
      }
    }
    return restored;
  }

  finish(taskId: string): void {
    this.options.workChecks?.release(taskId);
    this.releaseReservation(taskId);
    this.executionContexts.delete(taskId);
    this.inheritedClassroomTasks.delete(taskId);
    this.routes.delete(taskId);
  }

  private fastCoachEnabled(): boolean {
    return (
      this.options.fastCoachEnabled ?? process.env.TROCODE_FAST_COACH_ENABLED !== 'false'
    );
  }

  private cancelInvalidClassroomTasks(session: ClassroomSessionProjection | null): void {
    for (const [taskId, route] of this.routes) {
      if (!this.inheritedClassroomTasks.has(taskId)) continue;
      const goal = this.runtime.getSnapshot(taskId).goal;
      const activity = goal?.activity;
      if (!activity) continue;
      const invalid =
        !session ||
        session.attemptId !== activity.attemptId ||
        session.activityVersionId !== activity.activityVersionId ||
        session.run.state !== 'open' ||
        ['ready_for_review', 'submitted', 'completed', 'withdrawn'].includes(session.attemptState);
      if (!invalid) continue;
      if (route === 'coach') this.options.coachRuntime?.cancel(taskId);
      else this.options.localRuntime?.cancel(taskId, 'replacement');
      this.routes.delete(taskId);
      this.executionContexts.delete(taskId);
      this.inheritedClassroomTasks.delete(taskId);
      this.runtime.cancel({ taskId, source: 'replacement' });
    }
  }
}
