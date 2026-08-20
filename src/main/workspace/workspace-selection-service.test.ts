import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { WorkspaceSelectionService } from './workspace-selection-service';

describe('WorkspaceSelectionService', () => {
  it('is backend-backed without a local Codex dependency', async () => {
    const service = new WorkspaceSelectionService({
      pickDirectory: vi.fn(async () => null),
    });

    await expect(service.availability()).resolves.toEqual({
      available: true,
      runtimeVersion: null,
      summary: 'Workspace mode is available through the Tro service.',
    });
  });

  it('canonicalizes a host-picked directory and resolves only its opaque selection ID', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'trocode-workspace-'));
    try {
      const service = new WorkspaceSelectionService(
        { pickDirectory: vi.fn(async () => directory) },
        () => new Date('2026-08-18T00:00:00.000Z'),
      );

      const selection = await service.select();
      expect(selection).toMatchObject({
        displayName: path.basename(directory),
        runtime: { available: true, runtimeVersion: null },
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
});
