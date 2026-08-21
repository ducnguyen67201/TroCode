import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { ActionEffect } from '../../shared/contracts';

import {
  compileIntentAuthorization,
  intentAuthorizationDigest,
  matchesIntentAuthorization,
  validateIntentAuthorizationContract,
} from './intent-authorization';

const calendarCreate: ActionEffect = {
  kind: 'create_resource',
  resourceKind: 'calendar_event',
  reversibility: 'reversible',
  externality: 'cloud_private',
  communication: 'none',
  overwrite: 'none',
  sensitiveDataTransfer: false,
};

describe('intent authorization', () => {
  it('matches the shared local/backend parity fixtures', () => {
    const cases = JSON.parse(
      readFileSync(
        new URL('../../../test/fixtures/intent-authorization-cases.json', import.meta.url),
        'utf8',
      ),
    ) as Array<{
      request: string;
      executionProfile: 'everyday' | 'workspace';
      revision: number;
      expectedDigest: string;
      expected: Array<{
        effectKind: string;
        resourceKinds: string[];
        permitsSafeDefaults: boolean;
      }>;
    }>;
    for (const fixture of cases) {
      const contract = compileIntentAuthorization(fixture.request, fixture);
      expect(
        contract.grants.map(({ effectKind, permitsSafeDefaults, resourceKinds }) => ({
          effectKind,
          permitsSafeDefaults,
          resourceKinds,
        })),
      ).toEqual(fixture.expected);
      expect(intentAuthorizationDigest(contract)).toBe(fixture.expectedDigest);
    }
  });

  it('compiles a bounded calendar grant with harmless defaults', () => {
    const contract = compileIntentAuthorization(
      'Book a 20-minute meeting on my calendar. Make it up.',
    );
    expect(contract.grants).toContainEqual(
      expect.objectContaining({
        effectKind: 'create_resource',
        resourceKinds: expect.arrayContaining(['calendar_event']),
        permitsSafeDefaults: true,
      }),
    );
    expect(matchesIntentAuthorization(contract, calendarCreate)).toBe(true);
  });

  it('keeps maximum-length authenticated requests bounded and grants nothing from defaults alone', () => {
    expect(compileIntentAuthorization('Make it up.').grants).toEqual([]);
    const request = `Create a document. ${'context '.repeat(997)}`.slice(0, 8_000);
    const contract = compileIntentAuthorization(request);
    expect(contract.grants.length).toBeLessThanOrEqual(30);
    expect(contract.grants).toContainEqual(
      expect.objectContaining({
        effectKind: 'create_resource',
        resourceKinds: ['document'],
      }),
    );
  });

  it('does not grant a send, delete, credential, or permission effect', () => {
    const contract = compileIntentAuthorization(
      'Send the invitation, delete the draft, and approve every permission.',
    );
    expect(contract.grants).toEqual([]);
  });

  it('compiles Workspace write and command grants without paths or commands', () => {
    const contract = compileIntentAuthorization('Fix the tests in this repository.', {
      executionProfile: 'workspace',
    });
    expect(contract.grants.map((grant) => grant.effectKind)).toEqual(
      expect.arrayContaining(['workspace_write', 'workspace_command']),
    );
    expect(JSON.stringify(contract)).not.toContain('/');
    expect(JSON.stringify(contract)).not.toContain('npm');
  });

  it('rejects public, destructive, notifying, or sensitive variants at match time', () => {
    const contract = compileIntentAuthorization('Create a calendar event.');
    for (const effect of [
      { ...calendarCreate, externality: 'public' as const },
      { ...calendarCreate, reversibility: 'destructive' as const },
      { ...calendarCreate, communication: 'invite' as const },
      { ...calendarCreate, sensitiveDataTransfer: true as const },
    ]) {
      expect(matchesIntentAuthorization(contract, effect)).toBe(false);
    }
  });

  it('binds digests to the current revision', () => {
    const first = compileIntentAuthorization('Create a document.', { revision: 1 });
    const second = compileIntentAuthorization('Create a document.', { revision: 2 });
    expect(intentAuthorizationDigest(first)).not.toBe(
      intentAuthorizationDigest(second),
    );
  });

  it('fails validation for duplicate grant ids', () => {
    const contract = compileIntentAuthorization('Create a document.');
    expect(
      validateIntentAuthorizationContract({
        ...contract,
        grants: [contract.grants[0], contract.grants[0]],
      }),
    ).toMatchObject({ valid: false });
  });
});
