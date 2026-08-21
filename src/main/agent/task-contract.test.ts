import { describe, expect, it } from 'vitest';

import {
  HOST_ALWAYS_CONFIRM_EFFECTS,
  TaskContractSchema,
} from '../../shared/contracts';

import {
  createTaskContract,
  HOST_APPROVAL_POLICY,
  legacyTaskBehavior,
  taskMaxModelSamples,
  taskMaxToolCalls,
} from './task-contract';

describe('task contract', () => {
  it('creates a host-owned v8 Everyday contract with outcomes and bounded intent grants', () => {
    const contract = createTaskContract('Create a simple beat in GarageBand.');

    expect(contract).toMatchObject({
      schemaVersion: 8,
      activity: null,
      autonomyMode: 'balanced',
      executionProfile: 'everyday',
      originalRequest: 'Create a simple beat in GarageBand.',
      runtimeKind: 'openai_agents',
      workspace: null,
      outcomeContract: {
        schemaVersion: 1,
        revision: 1,
        completionMode: 'all_required',
      },
      approvalPolicy: { alwaysConfirmEffects: HOST_ALWAYS_CONFIRM_EFFECTS },
      limits: {
        maxImages: 20,
        maxMicroUsd: 500_000,
        maxMinutes: 10,
        maxModelSamples: 40,
        maxToolCalls: 30,
      },
    });
    expect(contract).not.toHaveProperty('behavior');
    expect(contract).not.toHaveProperty('capabilities');
    expect(contract.intentAuthorization).toMatchObject({
      schemaVersion: 1,
      revision: 1,
      source: 'user_instruction',
    });
    expect(taskMaxToolCalls(contract)).toBe(30);
    expect(taskMaxModelSamples(contract)).toBe(40);
    expect(
      TaskContractSchema.safeParse({
        ...contract,
        approvalPolicy: { alwaysConfirmEffects: ['send_communication'] },
      }).success,
    ).toBe(false);
  });

  it('normalizes persisted v1 into the legacy v2 branch', () => {
    const parsed = TaskContractSchema.parse({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      originalRequest: 'Research the subject for me',
      domain: 'research',
      interactionMode: 'mixed',
      objective: 'Research the subject',
      successCriteria: [
        { description: 'Return findings', verifier: 'Findings are present' },
      ],
      capabilities: ['browser', 'conversation'],
      scope: { allowedApps: [], allowedDomains: [], allowedPaths: [] },
      approvals: { alwaysConfirm: ['send'] },
      limits: { maxMinutes: 15, maxSteps: 12 },
    });

    expect(parsed).toMatchObject({
      schemaVersion: 2,
      behavior: 'act',
      approvalPolicy: {
        alwaysConfirm: expect.arrayContaining(['send', 'delete', 'purchase']),
      },
    });
    expect(legacyTaskBehavior(parsed)).toBe('act');
    expect(taskMaxToolCalls(parsed)).toBe(12);
  });

  it('rejects malformed or unknown future contract versions', () => {
    expect(() =>
      TaskContractSchema.parse({
        schemaVersion: 9,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        originalRequest: 'Complete a future task',
        approvalPolicy: { alwaysConfirm: [] },
        limits: { maxMinutes: 10, maxToolCalls: 12 },
      }),
    ).toThrow();
  });

  it('binds Workspace mode to the backend SDK and a trusted canonical root', () => {
    const workspace = {
      selectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      canonicalPath: '/tmp/project',
      displayName: 'project',
      selectedAt: '2026-08-18T00:00:00.000Z',
    };
    expect(
      createTaskContract('Fix the tests.', {
        executionProfile: 'workspace',
        workspace,
      }),
    ).toMatchObject({
      schemaVersion: 8,
      activity: null,
      executionProfile: 'workspace',
      runtimeKind: 'openai_agents',
      workspace,
    });
    expect(() =>
      createTaskContract('Fix the tests.', {
        executionProfile: 'workspace',
      }),
    ).toThrow('trusted workspace');
  });

  it('keeps persisted v7 contracts readable with their legacy approval policy', () => {
    const parsed = TaskContractSchema.parse({
      schemaVersion: 7,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      originalRequest: 'Create a document.',
      runtimeKind: 'openai_agents',
      executionProfile: 'everyday',
      autonomyMode: 'balanced',
      workspace: null,
      activity: null,
      outcomeContract: {
        schemaVersion: 1,
        revision: 1,
        completionMode: 'all_required',
        criteria: [
          {
            id: 'assistant-output',
            description: 'Return an answer.',
            required: true,
            verifier: { kind: 'assistant_output', constraints: [] },
          },
        ],
      },
      approvalPolicy: { alwaysConfirm: HOST_APPROVAL_POLICY },
      limits: {
        maxImages: 20,
        maxMicroUsd: 500_000,
        maxMinutes: 10,
        maxModelSamples: 40,
        maxToolCalls: 30,
      },
    });
    expect(parsed.schemaVersion).toBe(7);
  });
});
