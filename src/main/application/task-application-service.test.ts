import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type {
  ActivityContext,
  ClassroomSessionProjection,
  LocalGuidanceStartJournal,
  TaskSnapshot,
} from '../../shared/contracts';
import { TaskRuntime } from '../agent/task-runtime';
import { classroomFixture } from '../knowledge/classroom-broadcast.fixture';
import { workCheckFixture } from '../knowledge/work-check.fixture';

import { TaskApplicationService } from './task-application-service';

function localDependencies() {
  const localRuntime = {
    kind: 'local' as const,
    cancel: vi.fn(),
    health: vi.fn(() => null),
    initialize: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
    start: vi.fn(async (_input: unknown) => {
      void _input;
    }),
    steer: vi.fn(),
  };
  const state = {
    updateClassroomState: vi.fn(async () => undefined),
    create: vi.fn(async (ownerId: string, snapshot: TaskSnapshot) => {
      void ownerId;
      void snapshot;
    }),
    findLatestCoachProgress: vi.fn(async () => null),
    listActive: vi.fn(async (): Promise<Array<{ snapshot: TaskSnapshot }>> => []),
  };
  const coachRuntime = {
    cancel: vi.fn(),
    shutdown: vi.fn(async () => undefined),
    start: vi.fn(async (_input: unknown) => { void _input; }),
  };
  return { coachRuntime, localRuntime, state };
}

const CLASSROOM_ATTEMPT_ID = '00000000-0000-4000-8000-000000000001';
const CLASSROOM_ACTIVITY_VERSION_ID = '00000000-0000-4000-8000-000000000002';
const CLASSROOM_ACTIVITY: ActivityContext = {
  attemptId: CLASSROOM_ATTEMPT_ID,
  workSessionId: '00000000-0000-4000-8000-000000000003',
  activityVersionId: CLASSROOM_ACTIVITY_VERSION_ID,
  runId: '00000000-0000-4000-8000-000000000004',
  space: { id: '00000000-0000-4000-8000-000000000005', name: 'Scratch class' },
  activity: {
    title: 'Click to increase score',
    objective: 'Build a score interaction.',
    instructions: 'Follow the Scratch tutorial one step at a time.',
    launchTarget: 'current_surface',
    guidancePolicy: { answerReveal: 'allowed', hintMode: 'guided', maxHintLevel: 3 },
    criteria: [],
    completionPolicy: {
      requiresSubmission: false,
      requiresFacilitatorConfirmation: false,
    },
    sessionPolicy: { allowedOrigins: [], allowRoomJoin: true },
  },
  purpose: 'help',
  currentDirective: null,
  insightPolicy: 'explicit_and_operational',
  insightPolicyVersion: '1',
  policyAcknowledged: true,
  sourceCatalog: [],
  priorProgress: { completedCriterionIds: [], sessionCount: 0, summary: 'Just started.' },
};

function classroomDependencies() {
  let onChange: ((session: ClassroomSessionProjection | null) => void) | null = null;
  const classroomSessionService = {
    activeStudentAttemptId: vi.fn(() => CLASSROOM_ATTEMPT_ID),
    latestDirective: vi.fn(() => null),
    onChange: vi.fn((listener: (session: ClassroomSessionProjection | null) => void) => {
      onChange = listener;
      return () => undefined;
    }),
  };
  const activityContextService = {
    inspect: vi.fn(async () => ({
      definition: { launchTarget: 'current_surface' },
    })),
    create: vi.fn(async () => CLASSROOM_ACTIVITY),
  };
  return {
    activityContextService,
    classroomSessionService,
    publishSession: (session: ClassroomSessionProjection | null) => onChange?.(session),
  };
}

describe('TaskApplicationService', () => {
  it('routes a verified teacher voice request to the SDK without forced initial observation', async () => {
    const f = classroomFixture();
    const { coachRuntime, localRuntime, state } = localDependencies();
    const selectionId = randomUUID();
    const resolve = vi.fn(async () => f.binding);
    const service = new TaskApplicationService(new TaskRuntime(), {
      coachRuntime,
      currentOwnerId: async () => 'teacher',
      localRuntime,
      state: state as never,
      fastCoachEnabled: true,
      teacherClassroomContext: { resolve } as never,
    });
    const task = await service.submitAndStart({ text: 'Explain Assignment 1 to the class.', requestedMode: 'auto', screenContext: 'required', teacherClassroomSelectionId: selectionId });
    expect(resolve).toHaveBeenCalledWith(selectionId);
    expect(task.goal).toMatchObject({ route: 'agent', activity: null });
    expect(coachRuntime.start).not.toHaveBeenCalled();
    expect(localRuntime.start).toHaveBeenCalledWith(expect.objectContaining({ executionContext: expect.objectContaining({ teacherClassroom: f.binding }) }));
    expect(localRuntime.start.mock.calls[0]?.[0]).not.toHaveProperty('requiredInitialTool');
    expect(state.updateClassroomState).toHaveBeenCalled();
  });

  it('shares admission between ordinary tasks and student explanations without preemption', async () => {
    const { coachRuntime, localRuntime, state } = localDependencies();
    const service = new TaskApplicationService(new TaskRuntime(), { coachRuntime, currentOwnerId: async () => 'student', localRuntime, state: state as never });
    const reservation = randomUUID();
    service.reserveClassroomExplanation(reservation);
    await expect(service.submitAndStart({ text: 'Open Chrome.' })).rejects.toThrow('starting');
    service.releaseReservation(randomUUID());
    expect(service.isDeviceBusy()).toBe(true);
    service.releaseReservation(reservation);
    const task = await service.submitAndStart({ text: 'Open Chrome.', requestedMode: 'agent' });
    expect(() => service.reserveClassroomExplanation(randomUUID())).toThrow('Finish or stop');
    expect(localRuntime.cancel).not.toHaveBeenCalled();
    service.finish(task.taskId);
    expect(service.isDeviceBusy()).toBe(false);
  });

  it('uses the claimed work session in Coach even with fast Coach disabled, without starting Help', async () => {
    const f = classroomFixture();
    const { coachRuntime, localRuntime, state } = localDependencies();
    const classroom = classroomDependencies();
    const reporter = { bind: vi.fn(), fail: vi.fn() };
    const service = new TaskApplicationService(new TaskRuntime(), {
      coachRuntime, localRuntime, state: state as never, currentOwnerId: async () => 'student', fastCoachEnabled: false,
      activityContextService: classroom.activityContextService as never,
      activityProgressReporter: reporter as never,
    });
    const taskId = randomUUID();
    const request = { taskId, clientStartId: randomUUID(), clientInstanceId: randomUUID(), contextMode: 'text_only' as const };
    const activity = { ...CLASSROOM_ACTIVITY, purpose: 'work' as const };
    const claim = { ...request, id: randomUUID(), broadcastId: f.broadcast.id, sessionId: f.binding.sessionId, anchorAttemptId: f.session.attemptId, attemptId: activity.attemptId, activityVersionId: activity.activityVersionId, workSessionId: activity.workSessionId, status: 'accepted' as const, revision: 0, createdAt: new Date().toISOString(), ownedByThisRequest: true };
    const journal: LocalGuidanceStartJournal = { ownerId: 'student', anchorAttemptId: f.session.attemptId, broadcastId: f.broadcast.id, request, claim, phase: 'dispatching', modelRequests: 0, observations: 0, startedAt: claim.createdAt, report: null };
    service.reserveClassroomExplanation(taskId);
    const task = await service.submitClassroomExplanation(activity, journal, { guidanceId: claim.id, broadcastId: f.broadcast.id, teacherInstruction: 'Explain the loop.', contextMode: 'text_only', language: 'vi', startedAt: claim.createdAt, expiresAt: new Date(Date.now() + 600_000).toISOString(), modelRequests: 0, observations: 0 });
    expect(task.goal).toMatchObject({ route: 'coach', workspace: null, activity: { purpose: 'work', workSessionId: activity.workSessionId } });
    expect(coachRuntime.start).toHaveBeenCalledWith(expect.objectContaining({ requiresObservation: false, activity }));
    expect(localRuntime.start).not.toHaveBeenCalled();
    expect(classroom.activityContextService.create).not.toHaveBeenCalled();
    expect(reporter.bind).not.toHaveBeenCalled();
  });

  it('fails closed when the local Agents SDK runtime is not configured', async () => {
    const service = new TaskApplicationService(new TaskRuntime());

    await expect(service.submitAndStart({ text: 'Open Chrome.' })).rejects.toThrow(
      'Local task persistence is not configured',
    );
  });

  it('persists local authority before starting the SDK turn', async () => {
    const runtime = new TaskRuntime();
    const { localRuntime, state } = localDependencies();
    const order: string[] = [];
    state.create.mockImplementation(async () => { order.push('persist'); });
    localRuntime.start.mockImplementation(async () => { order.push('start'); });
    const service = new TaskApplicationService(runtime, {
      currentOwnerId: async () => 'owner-1',
      localRuntime,
      state: state as never,
    });

    const snapshot = await service.submitAndStart({
      executionProfile: 'everyday',
      text: 'Create a calendar event.',
    });

    expect(order).toEqual(['persist', 'start']);
    expect(snapshot).toMatchObject({
      phase: 'planning',
      goal: { route: 'agent', runtimeKind: 'openai_agents_sdk', schemaVersion: 11 },
      runtimeResume: { kind: 'local_agents_sdk' },
    });
    expect(localRuntime.start).toHaveBeenCalledWith(expect.objectContaining({
      threadId: snapshot.taskId,
      request: 'Create a calendar event.',
    }));
    expect(localRuntime.start.mock.calls[0]?.[0]).not.toHaveProperty(
      'requiredInitialTool',
    );
  });

  it('starts visible how-to requests in Coach and never starts Heavy Agent', async () => {
    const runtime = new TaskRuntime();
    const { coachRuntime, localRuntime, state } = localDependencies();
    const service = new TaskApplicationService(runtime, {
      coachRuntime,
      currentOwnerId: async () => 'owner-1',
      localRuntime,
      state: state as never,
    });

    const snapshot = await service.submitAndStart({
      executionProfile: 'everyday',
      text: 'Làm sao làm bài tập Scratch này?',
    });

    expect(coachRuntime.start).toHaveBeenCalledWith(expect.objectContaining({
      taskId: snapshot.taskId,
      requiresObservation: true,
    }));
    expect(localRuntime.start).not.toHaveBeenCalled();
  });

  it('forces screen observation for voice Task context despite an imperfect transcript', async () => {
    const runtime = new TaskRuntime();
    const { coachRuntime, localRuntime, state } = localDependencies();
    const service = new TaskApplicationService(runtime, {
      coachRuntime,
      currentOwnerId: async () => 'owner-1',
      localRuntime,
      state: state as never,
    });

    const snapshot = await service.submitAndStart({
      executionProfile: 'everyday',
      screenContext: 'required',
      text: 'Làm sao để làm khỏi tập scratch?',
    });

    expect(coachRuntime.start).toHaveBeenCalledWith(expect.objectContaining({
      taskId: snapshot.taskId,
      requiresObservation: true,
    }));
    expect(localRuntime.start).not.toHaveBeenCalled();
  });

  it('passes the same trusted classroom Activity context to either selected lane', async () => {
    const coach = localDependencies();
    const coachClassroom = classroomDependencies();
    const coachService = new TaskApplicationService(new TaskRuntime(), {
      activityContextService: coachClassroom.activityContextService as never,
      classroomSessionService: coachClassroom.classroomSessionService as never,
      coachRuntime: coach.coachRuntime,
      currentOwnerId: async () => 'owner-1',
      localRuntime: coach.localRuntime,
      state: coach.state as never,
    });

    await coachService.submitAndStart({ activityIntent: 'help', text: 'Chỉ em cách làm.' });
    expect(coach.coachRuntime.start).toHaveBeenCalledWith(expect.objectContaining({
      activity: CLASSROOM_ACTIVITY,
    }));
    expect(coach.localRuntime.start).not.toHaveBeenCalled();

    const agent = localDependencies();
    const agentClassroom = classroomDependencies();
    const agentService = new TaskApplicationService(new TaskRuntime(), {
      activityContextService: agentClassroom.activityContextService as never,
      classroomSessionService: agentClassroom.classroomSessionService as never,
      coachRuntime: agent.coachRuntime,
      currentOwnerId: async () => 'owner-1',
      localRuntime: agent.localRuntime,
      state: agent.state as never,
    });

    await agentService.submitAndStart({
      activityIntent: 'help',
      requestedMode: 'agent',
      text: 'Làm giúp em bước này.',
    });
    expect(agent.localRuntime.start).toHaveBeenCalledWith(expect.objectContaining({
      executionContext: expect.objectContaining({ activity: CLASSROOM_ACTIVITY }),
    }));
    expect(agent.coachRuntime.start).not.toHaveBeenCalled();
  });

  it('cancels inherited Coach work when classroom authority disappears', async () => {
    const runtime = new TaskRuntime();
    const { coachRuntime, localRuntime, state } = localDependencies();
    const classroom = classroomDependencies();
    const service = new TaskApplicationService(runtime, {
      activityContextService: classroom.activityContextService as never,
      classroomSessionService: classroom.classroomSessionService as never,
      coachRuntime,
      currentOwnerId: async () => 'owner-1',
      localRuntime,
      state: state as never,
    });
    const task = await service.submitAndStart({
      activityIntent: 'help',
      text: 'Hướng dẫn em.',
    });

    classroom.publishSession(null);

    expect(coachRuntime.cancel).toHaveBeenCalledWith(task.taskId);
    expect(runtime.getSnapshot(task.taskId).phase).toBe('cancelled');
  });

  it('uses the kill switch to select only Heavy Agent', async () => {
    const { coachRuntime, localRuntime, state } = localDependencies();
    const service = new TaskApplicationService(new TaskRuntime(), {
      coachRuntime,
      currentOwnerId: async () => 'owner-1',
      fastCoachEnabled: false,
      localRuntime,
      state: state as never,
    });

    const task = await service.submitAndStart({ text: 'Show me how to use Scratch.' });

    expect(task.goal).toMatchObject({ route: 'agent', runtimeKind: 'openai_agents_sdk' });
    expect(localRuntime.start).toHaveBeenCalledOnce();
    expect(coachRuntime.start).not.toHaveBeenCalled();
  });

  it('drops Workspace authority when explicit Coach mode is selected', async () => {
    const { coachRuntime, localRuntime, state } = localDependencies();
    const selectionId = 'bc8d20ad-5a9d-40db-870f-1d0ce0bc59cd';
    const service = new TaskApplicationService(new TaskRuntime(), {
      coachRuntime,
      currentOwnerId: async () => 'owner-1',
      localRuntime,
      state: state as never,
      workspaceSelectionService: {
        resolve: vi.fn(async () => ({
          canonicalPath: '/trusted/workspace',
          displayName: 'workspace',
          selectedAt: '2026-09-01T00:00:00.000Z',
          selectionId,
        })),
      },
    });

    const task = await service.submitAndStart({
      executionProfile: 'workspace',
      requestedMode: 'coach',
      text: 'Explain the idea without doing it.',
      workspaceSelectionId: selectionId,
    });

    expect(task.goal).toMatchObject({
      executionProfile: 'everyday',
      route: 'coach',
      workspace: null,
    });
    expect(coachRuntime.start).toHaveBeenCalledOnce();
    expect(localRuntime.start).not.toHaveBeenCalled();
  });

  it('does not grant screen observation to Workspace requests', async () => {
    const runtime = new TaskRuntime();
    const { localRuntime, state } = localDependencies();
    const selectionId = 'bc8d20ad-5a9d-40db-870f-1d0ce0bc59cd';
    const service = new TaskApplicationService(runtime, {
      currentOwnerId: async () => 'owner-1',
      localRuntime,
      state: state as never,
      workspaceSelectionService: {
        resolve: vi.fn(async () => ({
          canonicalPath: '/trusted/workspace',
          displayName: 'workspace',
          selectedAt: '2026-09-01T00:00:00.000Z',
          selectionId,
        })),
      },
    });

    await service.submitAndStart({
      executionProfile: 'workspace',
      text: 'Explain this file on my screen.',
      workspaceSelectionId: selectionId,
    });

    expect(localRuntime.start.mock.calls[0]?.[0]).not.toHaveProperty(
      'requiredInitialTool',
    );
  });

  it('routes steer and cancel directly to the local runtime', async () => {
    const runtime = new TaskRuntime();
    const { localRuntime, state } = localDependencies();
    const service = new TaskApplicationService(runtime, {
      currentOwnerId: async () => 'owner-1',
      localRuntime,
      state: state as never,
    });
    const task = await service.submitAndStart({
      executionProfile: 'everyday',
      requestedMode: 'agent',
      text: 'Draft a short note.',
    });

    await service.steer({ taskId: task.taskId, instruction: 'Make it warmer.' });
    await service.cancel({ taskId: task.taskId, source: 'stop_button' });

    expect(localRuntime.steer).toHaveBeenCalledWith(task.taskId, 'Make it warmer.');
    expect(localRuntime.cancel).toHaveBeenCalledWith(task.taskId, 'stop_button');
    expect(runtime.getSnapshot(task.taskId).phase).toBe('cancelled');
  });

  it('restores durable Heavy Agent tasks', async () => {
    const runtime = new TaskRuntime();
    const { localRuntime, state } = localDependencies();
    const seedService = new TaskApplicationService(runtime, {
      currentOwnerId: async () => 'owner-1',
      localRuntime,
      state: state as never,
    });
    const snapshot = await seedService.submitAndStart({
      executionProfile: 'everyday',
      requestedMode: 'agent',
      text: 'Continue the task.',
    });
    state.listActive.mockResolvedValue([{ snapshot }]);
    const restoredRuntime = new TaskRuntime();
    const restoredService = new TaskApplicationService(restoredRuntime, {
      currentOwnerId: async () => 'owner-1',
      localRuntime,
      state: state as never,
    });

    await expect(restoredService.restoreLocalTasks()).resolves.toBe(1);
    expect(localRuntime.resume).toHaveBeenCalledWith(
      snapshot.taskId,
      expect.objectContaining({ taskId: snapshot.taskId }),
    );
  });
});

it('forces a dedicated check with fast Coach disabled and binds only private workspace context',async()=>{
  const f=workCheckFixture(); const local=localDependencies(); const runtime=new TaskRuntime();
  const workChecks={bind:vi.fn(),release:vi.fn()};
  const service=new TaskApplicationService(runtime,{
    ...local,state:local.state as never,currentOwnerId:async()=> 'student',fastCoachEnabled:false,
    activityContextService:{inspect:async()=>f.attempt,create:async()=>f.activity} as never,workChecks,
  });
  const task=await service.submitAndStart({text:'Check the work.',activityAttemptId:f.attempt.attemptId,activityIntent:'check',requestedMode:'agent'});
  expect(task.goal).toMatchObject({route:'coach',workspace:null,executionProfile:'everyday',activity:{purpose:'check'}});
  expect(local.localRuntime.start).not.toHaveBeenCalled(); expect(local.coachRuntime.start).toHaveBeenCalledOnce();
  expect(workChecks.bind).toHaveBeenCalledWith(task.taskId,f.activity,null);
  service.finish(task.taskId); expect(workChecks.release).toHaveBeenCalledWith(task.taskId);
});
