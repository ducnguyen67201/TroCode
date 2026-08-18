import { describe, expect, it } from 'vitest';

import { TaskContractSchema } from '../../shared/contracts';

import {
  createTaskContract,
  HOST_APPROVAL_POLICY,
  legacyTaskBehavior,
  taskApprovalMode,
  taskMaxModelSamples,
  taskMaxToolCalls,
} from './task-contract';

describe('task contract', () => {
  it('creates a host-owned v5 contract with cost ceilings and immutable mode', () => {
    const contract = createTaskContract(
      'Create a simple beat in GarageBand.',
      'fully_approved',
    );

    expect(contract).toMatchObject({
      schemaVersion: 5,
      approvalMode: 'fully_approved',
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
    expect(taskApprovalMode(contract)).toBe('fully_approved');
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
    expect(taskApprovalMode(parsed)).toBe('ask_every_time');
  });

  it('rejects malformed or unknown future contract versions', () => {
    expect(() =>
      TaskContractSchema.parse({
        schemaVersion: 6,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        originalRequest: 'Complete a future task',
        approvalPolicy: { alwaysConfirm: [] },
        limits: { maxMinutes: 10, maxToolCalls: 12 },
      }),
    ).toThrow();
  });

  it('treats persisted v3 and v4 contracts as Ask mode', () => {
    for (const goal of [
      TaskContractSchema.parse({
        schemaVersion: 3,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        originalRequest: 'Complete a v3 task.',
        approvalPolicy: { alwaysConfirm: ['send'] },
        limits: { maxMinutes: 10, maxToolCalls: 12 },
      }),
      TaskContractSchema.parse({
        schemaVersion: 4,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        originalRequest: 'Complete a v4 task.',
        approvalPolicy: { alwaysConfirm: ['send'] },
        limits: {
          maxImages: 20,
          maxMicroUsd: 500_000,
          maxMinutes: 10,
          maxModelSamples: 40,
          maxToolCalls: 30,
        },
      }),
    ]) {
      expect(taskApprovalMode(goal)).toBe('ask_every_time');
    }
  });
});
