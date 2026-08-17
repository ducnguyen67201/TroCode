import { describe, expect, it } from 'vitest';

import { TaskContractSchema } from '../../shared/contracts';

import { createTaskContract, HOST_APPROVAL_POLICY } from './task-contract';

describe('task contract', () => {
  it('keeps approval policy and limits host-owned', () => {
    const contract = createTaskContract('Create a simple beat in GarageBand.', {
      behavior: 'act',
      objective: 'Create a simple beat in GarageBand.',
      successDescription: 'A playable beat exists in the open project.',
    });

    expect(contract).toMatchObject({
      schemaVersion: 2,
      behavior: 'act',
      approvalPolicy: { alwaysConfirm: HOST_APPROVAL_POLICY },
      limits: { maxMinutes: 10, maxSteps: 30 },
    });
    expect(contract).not.toHaveProperty('domain');
    expect(contract).not.toHaveProperty('capabilities');
  });

  it('normalizes a persisted v1 goal into v2 behavior and approval policy', () => {
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
  });

  it('does not silently coerce an unknown future contract version', () => {
    expect(() =>
      TaskContractSchema.parse({
        schemaVersion: 3,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        originalRequest: 'Complete a future task',
        behavior: 'act',
        objective: 'Complete a future task',
        successCriteria: [
          { description: 'It is complete', verifier: 'Observe completion' },
        ],
        approvalPolicy: { alwaysConfirm: [] },
        limits: { maxMinutes: 10, maxSteps: 12 },
      }),
    ).toThrow();
  });
});
