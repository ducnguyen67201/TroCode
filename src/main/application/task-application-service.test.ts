import { describe, expect, it, vi } from 'vitest';

import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';
import type { TaskRuntime } from '../agent/task-runtime';

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
});
