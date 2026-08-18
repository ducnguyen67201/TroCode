import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import type { AgentRuntimeStart } from '../agent/agent-runtime';
import { createTaskContract } from '../agent/task-contract';

import type {
  CodexAppServerClientLike,
} from './codex-app-server-client';
import { CodexAppServerRuntime } from './codex-app-server-runtime';
import type { CodexRequestId } from './codex-protocol';

class FakeCodexClient extends EventEmitter implements CodexAppServerClientLike {
  readonly close = vi.fn(async () => undefined);
  readonly notify = vi.fn(async () => undefined);
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly responses: Array<{ id: CodexRequestId; result: unknown }> = [];
  readonly errors: Array<{ code: number; id: CodexRequestId; message: string }> = [];
  readonly start = vi.fn(async () => undefined);

  async request<T>(
    method: string,
    params: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    this.requests.push({ method, params });
    const response =
      method === 'thread/start' || method === 'thread/resume'
        ? { thread: { id: 'thread-1' } }
        : method === 'turn/start'
          ? { turn: { id: 'turn-1' } }
          : method === 'turn/steer'
            ? { turnId: 'turn-1' }
            : {};
    return schema.parse(response);
  }

  async respond(id: CodexRequestId, result: unknown): Promise<void> {
    this.responses.push({ id, result });
  }

  async respondError(
    id: CodexRequestId,
    code: number,
    message: string,
  ): Promise<void> {
    this.errors.push({ code, id, message });
  }
}

const workspace = {
  selectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  canonicalPath: '/tmp/project',
  displayName: 'project',
  selectedAt: '2026-08-18T00:00:00.000Z',
};

function setup(callbacks: Partial<AgentRuntimeStart['callbacks']> = {}) {
  const client = new FakeCodexClient();
  const runtime = new CodexAppServerRuntime({
    appCodexHome: '/tmp/trocode-codex-home',
    clientFactory: () => client,
    locator: {
      locate: vi.fn(async () => ({
        available: true,
        executable: '/usr/local/bin/codex',
        runtimeVersion: '0.146.0',
        summary: 'Ready.',
      })),
    },
  });
  const input: AgentRuntimeStart = {
    callbacks: {
      beforeModel: () => [],
      executeTool: vi.fn(async () => 'unused'),
      ...callbacks,
    },
    contract: createTaskContract('Fix the tests.', {
      executionProfile: 'workspace',
      workspace,
    }),
    maxTurns: 20,
    request: 'Fix the tests.',
    taskId: 'task-1',
    tools: [],
  };
  return { client, input, runtime };
}

function emitCompleted(client: FakeCodexClient, status = 'completed'): void {
  client.emit('notification', {
    method: 'turn/completed',
    params: {
      threadId: 'thread-1',
      turn: { id: 'turn-1', status, error: null },
    },
  });
}

describe('CodexAppServerRuntime', () => {
  it('starts in the canonical root, streams bounded activity, and stores minimal resume metadata', async () => {
    const setRuntimeResumeMetadata = vi.fn();
    const activities: unknown[] = [];
    const { client, input, runtime } = setup({ setRuntimeResumeMetadata });
    input.emitActivity = (activity) => activities.push(activity);
    const running = runtime.runTask(input);
    await vi.waitFor(() =>
      expect(client.requests.some(({ method }) => method === 'turn/start')).toBe(
        true,
      ),
    );

    client.emit('notification', {
      method: 'item/agentMessage/delta',
      params: {
        delta: 'Done.',
        itemId: 'item-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    });
    emitCompleted(client);

    await expect(running).resolves.toBe('Done.');
    expect(client.requests[0]).toMatchObject({
      method: 'thread/start',
      params: {
        approvalPolicy: 'on-request',
        cwd: workspace.canonicalPath,
        runtimeWorkspaceRoots: [workspace.canonicalPath],
        sandbox: 'workspace-write',
      },
    });
    expect(
      client.requests.find(({ method }) => method === 'turn/start'),
    ).toMatchObject({
      params: {
        approvalPolicy: 'on-request',
        cwd: workspace.canonicalPath,
        runtimeWorkspaceRoots: [workspace.canonicalPath],
        sandboxPolicy: {
          networkAccess: false,
          type: 'workspaceWrite',
          writableRoots: [workspace.canonicalPath],
        },
      },
    });
    expect(setRuntimeResumeMetadata).toHaveBeenCalledWith({
      kind: 'codex_app_server',
      runtimeVersion: '0.146.0',
      threadId: 'thread-1',
      workspaceSelectionId: workspace.selectionId,
    });
    expect(activities).toContainEqual({ kind: 'text_delta', textDelta: 'Done.' });
  });

  it('returns exact command approvals for one request and never session approval', async () => {
    const requestApproval = vi.fn(async () => true);
    const { client, input, runtime } = setup({ requestApproval });
    const running = runtime.runTask(input);
    await vi.waitFor(() =>
      expect(client.requests.some(({ method }) => method === 'turn/start')).toBe(
        true,
      ),
    );

    client.emit('request', {
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'npm test',
        cwd: workspace.canonicalPath,
        itemId: 'item-1',
        reason: 'Run the tests.',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    });
    await vi.waitFor(() => expect(client.responses).toHaveLength(1));

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ action: 'run_command' }),
      }),
    );
    expect(client.responses[0]).toEqual({
      id: 'approval-1',
      result: { decision: 'accept' },
    });
    client.emit('notification', {
      method: 'item/agentMessage/delta',
      params: {
        delta: 'Tests passed.',
        itemId: 'item-2',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    });
    emitCompleted(client);
    await expect(running).resolves.toBe('Tests passed.');
  });

  it('resumes only the persisted thread bound to the selected workspace', async () => {
    const { client, input, runtime } = setup();
    input.resumeMetadata = {
      kind: 'codex_app_server',
      runtimeVersion: '0.146.0',
      threadId: 'thread-persisted',
      workspaceSelectionId: workspace.selectionId,
    };

    const running = runtime.runTask(input);
    await vi.waitFor(() =>
      expect(client.requests.some(({ method }) => method === 'turn/start')).toBe(
        true,
      ),
    );

    expect(client.requests[0]).toMatchObject({
      method: 'thread/resume',
      params: {
        cwd: workspace.canonicalPath,
        excludeTurns: true,
        threadId: 'thread-persisted',
      },
    });
    client.emit('notification', {
      method: 'item/agentMessage/delta',
      params: {
        delta: 'Resumed.',
        itemId: 'item-resume',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    });
    emitCompleted(client);
    await expect(running).resolves.toBe('Resumed.');
  });

  it('routes file, permission, and non-secret input requests through host callbacks', async () => {
    const requestApproval = vi.fn(async () => true);
    const requestInput = vi
      .fn(async () => '')
      .mockResolvedValueOnce('Option A')
      .mockResolvedValueOnce('Additional context');
    const { client, input, runtime } = setup({ requestApproval, requestInput });
    const running = runtime.runTask(input);
    await vi.waitFor(() =>
      expect(client.requests.some(({ method }) => method === 'turn/start')).toBe(
        true,
      ),
    );

    client.emit('request', {
      id: 'file-1',
      method: 'item/fileChange/requestApproval',
      params: {
        grantRoot: '/tmp/outside-project',
        itemId: 'item-file',
        reason: 'Write a generated artifact.',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    });
    await vi.waitFor(() => expect(client.responses).toHaveLength(1));

    client.emit('request', {
      id: 'permission-1',
      method: 'item/permissions/requestApproval',
      params: {
        cwd: workspace.canonicalPath,
        itemId: 'item-permission',
        permissions: {
          fileSystem: { read: ['/tmp/shared'] },
          network: { enabled: true },
        },
        reason: 'Read a shared fixture.',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    });
    await vi.waitFor(() => expect(client.responses).toHaveLength(2));

    client.emit('request', {
      id: 'input-1',
      method: 'item/tool/requestUserInput',
      params: {
        itemId: 'item-input',
        questions: [
          {
            header: 'Choice',
            id: 'choice',
            isOther: false,
            isSecret: false,
            options: [{ description: 'Use A.', label: 'Option A' }],
            question: 'Which option?',
          },
          {
            header: 'Context',
            id: 'context',
            isOther: true,
            isSecret: false,
            options: null,
            question: 'Anything else?',
          },
        ],
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    });
    await vi.waitFor(() => expect(client.responses).toHaveLength(3));

    expect(requestApproval).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: expect.objectContaining({
          action: 'write_file',
          target: '/tmp/outside-project',
        }),
      }),
    );
    expect(requestApproval).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: expect.objectContaining({
          action: 'system_permission',
          parameters: expect.objectContaining({
            requestedPermissions: expect.stringContaining('network'),
          }),
        }),
      }),
    );
    expect(client.responses[1]).toEqual({
      id: 'permission-1',
      result: {
        permissions: {
          fileSystem: { read: ['/tmp/shared'] },
          network: { enabled: true },
        },
        scope: 'turn',
        strictAutoReview: true,
      },
    });
    expect(client.responses[2]).toEqual({
      id: 'input-1',
      result: {
        answers: {
          choice: { answers: ['Option A'] },
          context: { answers: ['Additional context'] },
        },
      },
    });

    client.emit('notification', {
      method: 'item/agentMessage/delta',
      params: {
        delta: 'Handled.',
        itemId: 'item-final',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    });
    emitCompleted(client);
    await expect(running).resolves.toBe('Handled.');
  });

  it('interrupts an aborted turn and never starts a replacement turn', async () => {
    const abortController = new AbortController();
    const { client, input, runtime } = setup();
    input.signal = abortController.signal;
    const running = runtime.runTask(input);
    await vi.waitFor(() =>
      expect(client.requests.some(({ method }) => method === 'turn/start')).toBe(
        true,
      ),
    );

    abortController.abort();
    await vi.waitFor(() =>
      expect(client.requests.some(({ method }) => method === 'turn/interrupt')).toBe(
        true,
      ),
    );
    emitCompleted(client, 'interrupted');

    await expect(running).rejects.toThrow('interrupted');
    expect(
      client.requests.filter(({ method }) => method === 'turn/start'),
    ).toHaveLength(1);
  });

  it('rejects secret user-input requests instead of exposing a secret field', async () => {
    const requestInput = vi.fn(async () => 'should not be called');
    const { client, input, runtime } = setup({ requestInput });
    const running = runtime.runTask(input);
    await vi.waitFor(() =>
      expect(client.requests.some(({ method }) => method === 'turn/start')).toBe(
        true,
      ),
    );

    client.emit('request', {
      id: 'secret-1',
      method: 'item/tool/requestUserInput',
      params: {
        itemId: 'item-secret',
        questions: [
          {
            header: 'Password',
            id: 'password',
            isOther: false,
            isSecret: true,
            options: null,
            question: 'Enter a password.',
          },
        ],
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    });

    await expect(running).rejects.toThrow('Secret input is not accepted');
    expect(requestInput).not.toHaveBeenCalled();
    expect(client.errors).toEqual([
      expect.objectContaining({ id: 'secret-1', code: -32602 }),
    ]);
  });

  it('delivers steering to the active turn and rejects a crashed turn without replay', async () => {
    const { client, input, runtime } = setup();
    const running = runtime.runTask(input);
    await vi.waitFor(() =>
      expect(client.requests.some(({ method }) => method === 'turn/start')).toBe(
        true,
      ),
    );

    await expect(runtime.steer('task-1', 'Focus on the parser.')).resolves.toBe(
      'delivered',
    );
    expect(client.requests.at(-1)).toMatchObject({
      method: 'turn/steer',
      params: { expectedTurnId: 'turn-1', threadId: 'thread-1' },
    });
    client.emit('failure', new Error('process exited'));

    await expect(running).rejects.toThrow('not replayed');
    expect(
      client.requests.filter(({ method }) => method === 'turn/start'),
    ).toHaveLength(1);
  });

  it('fails closed when persisted resume metadata belongs to another runtime version', async () => {
    const { input, runtime } = setup();
    input.resumeMetadata = {
      kind: 'codex_app_server',
      runtimeVersion: '0.145.0',
      threadId: 'thread-old',
      workspaceSelectionId: workspace.selectionId,
    };

    await expect(runtime.runTask(input)).rejects.toThrow(
      'does not match the selected Codex version',
    );
  });
});
