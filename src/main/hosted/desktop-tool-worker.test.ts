import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { RuntimeToolRegistry } from '../agent/runtime-tool-registry';
import { createTaskContract } from '../agent/task-contract';

import { DesktopToolWorker } from './desktop-tool-worker';
import { HOSTED_AGENT_TOOL_SCHEMA_DIGEST } from './desktop-worker-protocol';

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 2,
    schemaDigest: HOSTED_AGENT_TOOL_SCHEMA_DIGEST,
    invocationId: randomUUID(),
    runId: randomUUID(),
    callId: 'call-1',
    toolId: 'application.launch',
    operation: 'launch',
    effect: {
      kind: 'none',
      resourceKind: null,
      reversibility: 'none',
      externality: 'local',
      communication: 'none',
      overwrite: 'none',
      sensitiveDataTransfer: false,
    },
    intentRevision: 1,
    approvalRequired: false,
    authorizationSource: 'routine',
    consequential: false,
    input: { application: 'chrome', reason: 'Open Chrome.' },
    obligations: [],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe('DesktopToolWorker', () => {
  it('rejects an expired envelope before asking to execute', async () => {
    const commitResult = vi.fn(async () => undefined);
    const requestExecuting = vi.fn(async () => true);
    const input = envelope({ expiresAt: new Date(Date.now() - 1).toISOString() });
    const goal = createTaskContract('Open Chrome.');
    const worker = new DesktopToolWorker({
      commitResult,
      dispatcher: { dispatch: vi.fn() },
      goalProvider: () => goal,
      registry: new RuntimeToolRegistry(),
      requestExecuting,
      taskIdProvider: () => goal.id,
    });

    const result = await worker.handle(input);

    expect(result.status).toBe('not_executed');
    expect(requestExecuting).not.toHaveBeenCalled();
    expect(commitResult).toHaveBeenCalledOnce();
  });

  it('returns the same committed result for duplicate delivery', async () => {
    const commitResult = vi.fn(async () => undefined);
    const dispatch = vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'Chrome is visible.',
      data: {
        applicationSurfaceEvidence: {
          observationFingerprint: 'a'.repeat(64),
          observationId: randomUUID(),
        },
      },
    }));
    const input = envelope();
    const goal = createTaskContract('Open Chrome.');
    const worker = new DesktopToolWorker({
      commitResult,
      dispatcher: { dispatch },
      goalProvider: () => goal,
      registry: new RuntimeToolRegistry(),
      requestExecuting: vi.fn(async () => true),
      taskIdProvider: () => goal.id,
    });

    const first = await worker.handle(input);
    const second = await worker.handle(input);

    expect(second).toEqual(first);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(commitResult).toHaveBeenCalledTimes(2);
  });

  it('upgrades an approved sensitive desktop action before execution', async () => {
    const requestExecuting = vi.fn(async () => true);
    const goal = createTaskContract('Send the visible message.');
    const observationId = randomUUID();
    const worker = new DesktopToolWorker({
      approvalProvider: vi.fn(async () => true),
      commitResult: vi.fn(async () => undefined),
      dispatcher: {
        dispatch: vi.fn(async () => ({ status: 'confirmed' as const, summary: 'Sent.' })),
      },
      goalProvider: () => goal,
      latestObservationProvider: () => ({
        capturedAt: new Date().toISOString(),
        coordinateSpace: {
          screenHeight: 1_000,
          screenWidth: 1_000,
          screenshotHeight: 1_000,
          screenshotWidth: 1_000,
        },
        degraded: false,
        fingerprint: 'a'.repeat(64),
        observationId,
        route: 'desktop_vision',
        taskId: goal.id,
        text: 'A send button is visible.',
      }),
      registry: new RuntimeToolRegistry(),
      requestExecuting,
      taskIdProvider: () => goal.id,
    });
    const result = await worker.handle(envelope({
      toolId: 'desktop.control',
      operation: 'click',
      effect: {
        kind: 'send_communication',
        resourceKind: 'email',
        reversibility: 'reversible',
        externality: 'external',
        communication: 'send',
        overwrite: 'none',
        sensitiveDataTransfer: false,
      },
      approvalRequired: true,
      authorizationSource: 'none',
      consequential: true,
      input: {
        observationId,
        observationFingerprint: 'a'.repeat(64),
        consequence: 'send',
        description: 'Send the visible message.',
        target: 'Send button',
        sendPayload: {
          account: 'sender@example.com',
          attachments: null,
          body: 'Hello.',
          recipients: ['recipient@example.com'],
          subject: 'Update',
          threadId: null,
        },
        command: { kind: 'click', x: 500, y: 500, button: 'left', count: 1 },
      },
    }));
    expect(result).toMatchObject({ status: 'confirmed', summary: 'Sent.' });
    expect(requestExecuting).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        approvalRequired: true,
        authorizationSource: 'exact_approval',
        consequential: true,
        intentRevision: 1,
      }),
    );
  });

  it('commits an instruction-authorized Workspace effect without user approval', async () => {
    const goal = createTaskContract('Update the workspace file.', {
      executionProfile: 'workspace',
      workspace: {
        selectionId: '11111111-1111-4111-8111-111111111111',
        canonicalPath: '/tmp/project',
        displayName: 'project',
        selectedAt: '2026-08-21T00:00:00.000Z',
      },
    });
    const approvalProvider = vi.fn(async () => true);
    const requestExecuting = vi.fn(async () => true);
    const worker = new DesktopToolWorker({
      approvalProvider,
      commitResult: vi.fn(async () => undefined),
      dispatcher: {
        dispatch: vi.fn(async () => ({ status: 'confirmed' as const, summary: 'Updated.' })),
      },
      goalProvider: () => goal,
      registry: new RuntimeToolRegistry(),
      requestExecuting,
      taskIdProvider: () => goal.id,
    });
    const result = await worker.handle(envelope({
      toolId: 'workspace.filesystem',
      operation: 'write_file',
      effect: {
        kind: 'workspace_write',
        resourceKind: 'workspace_file',
        reversibility: 'reversible',
        externality: 'local',
        communication: 'none',
        overwrite: 'requested',
        sensitiveDataTransfer: false,
      },
      approvalRequired: true,
      authorizationSource: 'none',
      consequential: true,
      input: { path: 'src/example.ts', content: 'export {};' },
    }));

    expect(result.status).toBe('confirmed');
    expect(approvalProvider).not.toHaveBeenCalled();
    expect(requestExecuting).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        approvalRequired: false,
        authorizationSource: 'user_instruction',
        consequential: true,
      }),
    );
  });
});
