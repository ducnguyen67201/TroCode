import { describe, expect, it, vi } from 'vitest';

import {
  CodexRuntimeLocator,
  SUPPORTED_CODEX_VERSION,
} from './codex-runtime-locator';

describe('CodexRuntimeLocator', () => {
  it('accepts only the exact supported version from an absolute executable', async () => {
    const probeVersion = vi.fn(async () => `codex-cli ${SUPPORTED_CODEX_VERSION}`);
    const probeAuthentication = vi.fn(async () => true);
    const locator = new CodexRuntimeLocator({
      appCodexHome: '/tmp/trocode-codex-home',
      environment: { TROCODE_CODEX_PATH: process.execPath },
      probeAuthentication,
      probeVersion,
    });

    await expect(locator.locate()).resolves.toMatchObject({
      available: true,
      runtimeVersion: SUPPORTED_CODEX_VERSION,
    });
    expect(probeVersion).toHaveBeenCalledOnce();
    expect(probeAuthentication).toHaveBeenCalledWith(
      process.execPath,
      '/tmp/trocode-codex-home',
    );
  });

  it('keeps Workspace unavailable until app-scoped Codex authentication is ready', async () => {
    const locator = new CodexRuntimeLocator({
      appCodexHome: '/tmp/trocode-codex-home',
      environment: { TROCODE_CODEX_PATH: process.execPath },
      probeAuthentication: vi.fn(async () => false),
      probeVersion: vi.fn(async () => `codex-cli ${SUPPORTED_CODEX_VERSION}`),
    });

    await expect(locator.locate()).resolves.toMatchObject({
      available: false,
      runtimeVersion: SUPPORTED_CODEX_VERSION,
      summary: expect.stringContaining('CODEX_HOME'),
    });
  });

  it('fails closed for relative paths and version drift', async () => {
    await expect(
      new CodexRuntimeLocator({
        appCodexHome: '/tmp/trocode-codex-home',
        environment: { TROCODE_CODEX_PATH: './codex' },
        probeAuthentication: vi.fn(async () => true),
        probeVersion: vi.fn(),
      }).locate(),
    ).resolves.toMatchObject({ available: false, executable: null });

    await expect(
      new CodexRuntimeLocator({
        appCodexHome: '/tmp/trocode-codex-home',
        environment: { TROCODE_CODEX_PATH: process.execPath },
        probeAuthentication: vi.fn(async () => true),
        probeVersion: vi.fn(async () => 'codex-cli 0.145.0'),
      }).locate(),
    ).resolves.toMatchObject({
      available: false,
      runtimeVersion: '0.145.0',
    });
  });
});
