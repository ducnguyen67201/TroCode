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
        executionProfile: 'everyday',
        text: 'Do useful work.',
        workspaceSelectionId: null,
      },
      {
        autonomyMode: 'balanced',
        executionProfile: 'everyday',
        runtimeKind: 'openai_agents',
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
      expect.objectContaining({ executionProfile: 'workspace' }),
      expect.objectContaining({
        autonomyMode: 'strict',
        runtimeKind: 'codex_app_server',
        workspace,
      }),
    );
  });
});
