import { describe, expect, it, vi } from 'vitest';

import type { HostedTaskRecord } from '../../shared/contracts';
import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';
import { compileIntentAuthorization } from '../agent/intent-authorization';
import { compileOutcomeContract } from '../agent/outcome-contract';
import { TaskRuntime } from '../agent/task-runtime';

import { TaskApplicationService } from './task-application-service';

describe('TaskApplicationService', () => {
  it('owns submit-before-start ordering and resumes interactions', async () => {
    const order: string[] = [];
    const runtime = {
      submit: vi.fn(() => {
        order.push('submit');
        return { taskId: 'task-1' };
      }),
      respondToInteraction: vi.fn(() => ({ taskId: 'task-1' })),
    } as unknown as TaskRuntime;
    const execution = {
      resume: vi.fn(),
      start: vi.fn(() => {
        order.push('start');
        return { taskId: 'task-1', phase: 'planning' };
      }),
    } as unknown as TaskExecutionCoordinator;
    const service = new TaskApplicationService(runtime, execution);

    await expect(
      service.submitAndStart({ text: 'Do useful work.' }),
    ).resolves.toMatchObject({ phase: 'planning' });
    expect(order).toEqual(['submit', 'start']);
    expect(runtime.submit).toHaveBeenCalledWith(
      {
        activityAttemptId: null,
        executionProfile: 'everyday',
        text: 'Do useful work.',
        workspaceSelectionId: null,
      },
      {
        activity: null,
        autonomyMode: 'balanced',
        executionProfile: 'everyday',
        runtimeKind: 'openai_agents',
        taskId: expect.any(String),
        workspace: null,
      },
    );
    service.respond({ taskId: 'task-1' });
    expect(execution.resume).toHaveBeenCalledWith('task-1');
  });

  it('resolves a trusted Workspace identity before compiling the contract', async () => {
    const workspace = {
      selectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      canonicalPath: '/tmp/project',
      displayName: 'project',
      selectedAt: '2026-08-18T00:00:00.000Z',
    };
    const runtime = {
      submit: vi.fn(() => ({ taskId: 'task-workspace' })),
    } as unknown as TaskRuntime;
    const execution = {
      start: vi.fn(() => ({ taskId: 'task-workspace', phase: 'planning' })),
    } as unknown as TaskExecutionCoordinator;
    const resolve = vi.fn(async () => workspace);
    const service = new TaskApplicationService(runtime, execution, {
      appPreferencesService: {
        get: vi.fn(async () => ({
          appLanguage: 'en' as const,
          autonomyMode: 'strict' as const,
          muteSystemAudioWhileSpeaking: false,
          primaryLanguage: 'en' as const,
        })),
      },
      workspaceSelectionService: { resolve },
    });

    await service.submitAndStart({
      executionProfile: 'workspace',
      text: 'Fix the tests.',
      workspaceSelectionId: workspace.selectionId,
    });

    expect(resolve).toHaveBeenCalledWith(workspace.selectionId);
    expect(runtime.submit).toHaveBeenCalledWith(
      expect.objectContaining({ activityAttemptId: null, executionProfile: 'workspace' }),
      expect.objectContaining({
        activity: null,
        autonomyMode: 'strict',
        runtimeKind: 'openai_agents',
        taskId: expect.any(String),
        workspace,
      }),
    );
  });

  it('creates the hosted Work Session before compiling a trusted Activity contract', async () => {
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const taskId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const activity = { workSessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
    const order: string[] = [];
    const inspect = vi.fn(async () => ({
      attemptId,
      definition: { launchTarget: 'current_surface' as const },
    }));
    const create = vi.fn(async (_attempt, allocatedTaskId) => {
      order.push('create');
      expect(allocatedTaskId).toMatch(/[0-9a-f-]{36}/u);
      return activity;
    });
    const bind = vi.fn();
    const runtime = {
      submit: vi.fn((_request, options) => {
        order.push('submit');
        return { taskId: options.taskId };
      }),
    } as unknown as TaskRuntime;
    const execution = {
      start: vi.fn(({ taskId: allocatedTaskId }) => ({ taskId: allocatedTaskId, phase: 'planning' })),
    } as unknown as TaskExecutionCoordinator;
    const service = new TaskApplicationService(runtime, execution, {
      activityContextService: { create, inspect } as never,
      activityProgressReporter: { bind },
    });
    const result = await service.submitAndStart({
      activityAttemptId: attemptId,
      text: 'Why does this fail?',
    });
    expect(result.phase).toBe('planning');
    expect(inspect).toHaveBeenCalledWith(attemptId);
    expect(order).toEqual(['create', 'submit']);
    expect(bind).toHaveBeenCalledWith(result.taskId, activity.workSessionId);
    expect(result.taskId).not.toBe(taskId);
  });

  it('uses the backend v8 projection as the local hosted task authority', async () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    const outcomeContract = compileOutcomeContract('Create a calendar event.');
    const intentAuthorization = compileIntentAuthorization('Create a calendar event.');
    const runtime = {
      submit: vi.fn(() => ({ taskId })),
      start: vi.fn(() => ({ taskId, phase: 'planning', goal: null })),
    } as unknown as TaskRuntime;
    const execution = {} as TaskExecutionCoordinator;
    const submit = vi.fn(async (input: {
      clientTaskId: string;
      taskId: string;
      request: string;
    }) => ({
      id: '22222222-2222-4222-8222-222222222222',
      taskId: input.taskId,
      clientTaskId: input.clientTaskId,
      request: input.request,
      executionProfile: 'everyday' as const,
      workspaceSelectionId: null,
      state: 'queued' as const,
      protocolVersion: 2,
      runVersion: 1,
      outcomeRevision: 1,
      contractSchemaVersion: 8 as const,
      autonomyMode: 'balanced' as const,
      outcomeContract,
      intentAuthorization,
      publicSummary: 'Queued.',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
    }));
    const service = new TaskApplicationService(runtime, execution, {
      hostedTaskClient: {
        submit,
        subscribe: vi.fn(async () => undefined),
      } as never,
      useHostedRuntime: () => true,
    });

    await service.submitAndStart({ text: 'Create a calendar event.' });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ autonomyMode: 'balanced', taskId: expect.any(String) }),
    );
    expect(runtime.submit).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Create a calendar event.' }),
      expect.objectContaining({
        intentAuthorization,
        outcomeContract,
        autonomyMode: 'balanced',
      }),
    );
  });

  it('refreshes the backend authority projection after hosted steering', async () => {
    const runtime = new TaskRuntime({ intentAuthorizationEnabled: false });
    const outcomeContract = compileOutcomeContract('Create a calendar event.');
    const intentAuthorization = compileIntentAuthorization(
      'Create a calendar event.',
    );
    let record: HostedTaskRecord | undefined;
    const submit = vi.fn(async (input: {
      clientTaskId: string;
      taskId: string;
      request: string;
    }) => {
      const created = {
        id: '22222222-2222-4222-8222-222222222222',
        taskId: input.taskId,
        clientTaskId: input.clientTaskId,
        request: input.request,
        executionProfile: 'everyday' as const,
        workspaceSelectionId: null,
        state: 'queued' as const,
        protocolVersion: 2,
        runVersion: 1,
        outcomeRevision: 1,
        contractSchemaVersion: 8 as const,
        autonomyMode: 'balanced' as const,
        outcomeContract,
        intentAuthorization,
        publicSummary: 'Queued.',
        createdAt: '2026-08-21T00:00:00.000Z',
        updatedAt: '2026-08-21T00:00:00.000Z',
      };
      record = created;
      return created;
    });
    const get = vi.fn(async () => {
      if (!record) throw new Error('Expected a submitted hosted record.');
      return {
        ...record,
        outcomeRevision: 2,
        outcomeContract: { ...outcomeContract, revision: 2 },
        intentAuthorization: compileIntentAuthorization(
          'Create a calendar event. Also create a document.',
          { revision: 2 },
        ),
        updatedAt: '2026-08-21T00:01:00.000Z',
      };
    });
    const steer = vi.fn(async () => undefined);
    const service = new TaskApplicationService(
      runtime,
      {} as TaskExecutionCoordinator,
      {
        hostedTaskClient: {
          get,
          steer,
          submit,
          subscribe: vi.fn(async () => undefined),
        } as never,
        useHostedRuntime: () => true,
      },
    );
    const started = await service.submitAndStart({
      text: 'Create a calendar event.',
    });
    const revised = await service.steer({
      taskId: started.taskId,
      instruction: 'Also create a document.',
    });

    expect(steer).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
    expect(revised.goal).toMatchObject({
      schemaVersion: 8,
      intentAuthorization: { revision: 2 },
      outcomeContract: { revision: 2 },
    });
  });
});
