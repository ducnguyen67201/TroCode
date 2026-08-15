import { describe, expect, it } from 'vitest';

import type { CuaStatus } from '../../shared/contracts';

import { getCuaModuleSpecifier, shouldAutoConnect } from './cua-service';

describe('getCuaModuleSpecifier', () => {
  it('uses the installed package during development', () => {
    expect(getCuaModuleSpecifier(false, '/unused')).toBe('@trycua/cua-driver');
  });

  it('loads the unpacked dependency island in a packaged app', () => {
    const moduleUrl = getCuaModuleSpecifier(true, '/Applications/TroCode/Resources');

    expect(moduleUrl).toBe(
      'file:///Applications/TroCode/Resources/app.asar.unpacked/cua-runtime/node_modules/@trycua/cua-driver/dist/index.js',
    );
  });
});

describe('shouldAutoConnect', () => {
  const disconnectedStatus: CuaStatus = {
    state: 'disconnected',
    available: false,
    platform: 'darwin',
    permissions: {
      accessibility: true,
      screenRecording: true,
    },
    summary: 'Ready to initialize.',
    nextActions: [],
  };

  it('auto-connects on macOS only after both permissions are granted', () => {
    expect(shouldAutoConnect(disconnectedStatus)).toBe(true);
    expect(
      shouldAutoConnect({
        ...disconnectedStatus,
        permissions: {
          accessibility: true,
          screenRecording: false,
        },
      }),
    ).toBe(false);
    expect(
      shouldAutoConnect({ ...disconnectedStatus, permissions: undefined }),
    ).toBe(false);
  });

  it('auto-connects supported platforms without macOS permission gates', () => {
    expect(
      shouldAutoConnect({ ...disconnectedStatus, platform: 'win32' }),
    ).toBe(true);
    expect(
      shouldAutoConnect({ ...disconnectedStatus, platform: 'linux' }),
    ).toBe(true);
  });

  it('does not reconnect ready, errored, or permission-blocked states', () => {
    for (const state of ['ready', 'error', 'permission_required'] as const) {
      expect(shouldAutoConnect({ ...disconnectedStatus, state })).toBe(false);
    }
  });
});
