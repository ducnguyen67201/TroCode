import { describe, expect, it } from 'vitest';

import { TaskContractSchema } from '../../shared/contracts';

import {
  createTaskContract,
  HOST_APPROVAL_POLICY,
  legacyTaskBehavior,
  taskMaxModelSamples,
  taskMaxToolCalls,
} from './task-contract';

describe('task contract', () => {
  it('creates a host-owned v4 contract with cost ceilings and no semantic grants', () => {
    const contract = createTaskContract('Create a simple beat in GarageBand.');

    expect(contract).toMatchObject({
      schemaVersion: 4,
      originalRequest: 'Create a simple beat in GarageBand.',
      approvalPolicy: { alwaysConfirm: HOST_APPROVAL_POLICY },
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
    expect(taskMaxToolCalls(contract)).toBe(30);
    expect(taskMaxModelSamples(contract)).toBe(40);
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
        schemaVersion: 5,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        originalRequest: 'Complete a future task',
        approvalPolicy: { alwaysConfirm: [] },
        limits: { maxMinutes: 10, maxToolCalls: 12 },
      }),
    ).toThrow();
  });
});
