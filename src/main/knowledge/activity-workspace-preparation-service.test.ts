import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ActivityWorkspacePreparationService } from './activity-workspace-preparation-service';

const ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function attempt() {
  return {
    definition: {
      title: 'Loop debugging',
      launchTarget: 'workspace' as const,
    },
  };
}

describe('ActivityWorkspacePreparationService', () => {
  it('checksum-verifies starter files, creates a new tree, and returns opaque Workspace authority', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'trocode-starter-parent-'));
    const bytes = Buffer.from('print("starter")');
    let registeredPath = '';
    try {
      const service = new ActivityWorkspacePreparationService(
        {
          getAttempt: vi.fn(async () => attempt() as never),
          starterFiles: vi.fn(async () => ({ files: [{
            byteSize: bytes.byteLength,
            download: { expiresInSeconds: 120, url: 'https://objects.example/starter' },
            mediaType: 'text/plain' as const,
            relativePath: 'src/main.py',
            sha256: createHash('sha256').update(bytes).digest('hex'),
            sourceVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          }] })),
        },
        {
          selectTrustedParent: vi.fn(async () => parent),
          registerTrustedDirectory: vi.fn(async (candidate: string) => {
            registeredPath = candidate;
            return {
              displayName: path.basename(candidate),
              runtime: { available: true, runtimeVersion: null, summary: 'ready' },
              selectedAt: '2026-08-19T00:00:00.000Z',
              selectionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            };
          }),
        },
        vi.fn(async () => new Response(bytes, { status: 200 })) as typeof fetch,
      );
      const workspace = await service.prepare(ATTEMPT_ID);
      expect(workspace).not.toHaveProperty('canonicalPath');
      await expect(readFile(path.join(registeredPath, 'src', 'main.py'), 'utf8'))
        .resolves.toBe('print("starter")');
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });

  it('rejects traversal and removes the staging directory', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'trocode-starter-parent-'));
    try {
      const bytes = Buffer.from('unsafe');
      const service = new ActivityWorkspacePreparationService(
        {
          getAttempt: vi.fn(async () => attempt() as never),
          starterFiles: vi.fn(async () => ({ files: [{
            byteSize: bytes.byteLength,
            download: { expiresInSeconds: 120, url: 'https://objects.example/starter' },
            mediaType: 'text/plain' as const,
            relativePath: '../escape.py',
            sha256: createHash('sha256').update(bytes).digest('hex'),
            sourceVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          }] })),
        },
        {
          selectTrustedParent: vi.fn(async () => parent),
          registerTrustedDirectory: vi.fn(),
        },
        vi.fn(async () => new Response(bytes, { status: 200 })) as typeof fetch,
      );
      await expect(service.prepare(ATTEMPT_ID)).rejects.toThrow('invalid path');
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });
});
