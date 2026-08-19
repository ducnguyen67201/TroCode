import type { DriverAuthorizationRequest } from '@trycua/cua-driver';
import { describe, expect, it } from 'vitest';

import { CuaAuthorizationBroker } from './cua-authorization-broker';

const actions = { allow: 0, deny: 1, cancel: 2 } as const;

function request(overrides: Partial<DriverAuthorizationRequest> = {}) {
  return {
    schema: '1',
    nonce: 'nonce',
    generation: 1n,
    daemonInstance: 'daemon',
    permissionMode: 'standard',
    adapterId: 'browser',
    riskClass: 'r2',
    publicSession: 'task',
    transportSession: 'transport',
    resourceJson: JSON.stringify({ pid: 42, window_id: 7 }),
    humanSummary: 'private',
    expiresUnixMs: 2_000n,
    requestDigest: 'exact-digest',
    ...overrides,
  } satisfies DriverAuthorizationRequest;
}

describe('CuaAuthorizationBroker', () => {
  it('denies by default and returns the exact request digest', async () => {
    const broker = new CuaAuthorizationBroker(actions, () => 1_000);
    await expect(broker.authorize(request())).resolves.toEqual({
      action: actions.deny,
      requestDigest: 'exact-digest',
    });
  });

  it('allows one exact armed resource and consumes the grant', async () => {
    const broker = new CuaAuthorizationBroker(actions, () => 1_000);
    broker.arm({
      expiresUnixMs: 2_000,
      publicSession: 'task',
      matchesResource: (resource) =>
        (resource as { pid?: number }).pid === 42,
    });
    await expect(broker.authorize(request())).resolves.toEqual({
      action: actions.allow,
      requestDigest: 'exact-digest',
    });
    await expect(broker.authorize(request())).resolves.toMatchObject({
      action: actions.deny,
    });
  });

  it('denies mismatched, expired, malformed, and cancelled requests', async () => {
    const broker = new CuaAuthorizationBroker(actions, () => 3_000);
    broker.arm({
      expiresUnixMs: 2_000,
      publicSession: 'task',
      matchesResource: () => true,
    });
    await expect(broker.authorize(request())).resolves.toMatchObject({
      action: actions.deny,
    });

    const malformed = new CuaAuthorizationBroker(actions, () => 1_000);
    malformed.arm({
      expiresUnixMs: 2_000,
      publicSession: 'task',
      matchesResource: () => true,
    });
    await expect(
      malformed.authorize(request({ resourceJson: '{' })),
    ).resolves.toMatchObject({ action: actions.deny });

    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      malformed.authorize(request(), { signal: cancelled.signal }),
    ).resolves.toMatchObject({ action: actions.cancel });
  });
});
