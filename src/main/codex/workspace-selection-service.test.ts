import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { WorkspaceSelectionService } from './workspace-selection-service';

describe('WorkspaceSelectionService', () => {
  it('canonicalizes a host-picked directory and resolves only its opaque selection ID', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'trocode-workspace-'));
    try {
      const service = new WorkspaceSelectionService(
        { pickDirectory: vi.fn(async () => directory) },
        {
          locate: vi.fn(async () => ({
            available: true,
            executable: process.execPath,
            runtimeVersion: '0.146.0',
            summary: 'Ready.',
          })),
        },
        () => new Date('2026-08-18T00:00:00.000Z'),
      );

      const selection = await service.select();
      expect(selection).toMatchObject({
        displayName: path.basename(directory),
        runtime: { available: true, runtimeVersion: '0.146.0' },
      });
      expect(selection).not.toHaveProperty('canonicalPath');
      if (!selection) throw new Error('Expected a selected workspace.');
      await expect(service.resolve(selection.selectionId)).resolves.toMatchObject({
        canonicalPath: await realpath(directory),
      });
      await expect(
        service.resolve('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      ).rejects.toThrow('no longer trusted');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('does not open the picker when the exact runtime is unavailable', async () => {
    const pickDirectory = vi.fn(async () => '/tmp/project');
    const service = new WorkspaceSelectionService(
      { pickDirectory },
      {
        locate: vi.fn(async () => ({
          available: false,
          executable: null,
          runtimeVersion: null,
          summary: 'Install the supported Codex CLI.',
        })),
      },
    );

    await expect(service.select()).rejects.toThrow('supported Codex CLI');
    expect(pickDirectory).not.toHaveBeenCalled();
  });
});
