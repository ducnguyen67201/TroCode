import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createWorkspaceRuntimeToolAdapters } from './workspace-runtime-tool-adapters';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('workspace runtime tool adapters', () => {
  it('writes, reads, and hashes a relative file inside the trusted root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'trocode-hosted-workspace-'));
    temporaryDirectories.push(root);
    const adapter = createWorkspaceRuntimeToolAdapters().find(
      (candidate) => candidate.id === 'workspace.filesystem',
    );
    if (!adapter) throw new Error('Workspace filesystem adapter is missing.');

    const result = await adapter.execute(
      {
        action: {
          action: 'write_file',
          description: 'Write example.',
          operation: 'write_file',
          toolId: 'workspace.filesystem',
        },
        callId: 'call-write',
        input: { content: 'export const value = 1;\n', path: 'src/example.ts', root },
        kind: 'direct',
        modelName: 'workspace_filesystem',
        operation: 'write_file',
        toolId: 'workspace.filesystem',
      },
      { signal: new AbortController().signal, taskId: randomUUID() },
    );

    expect(result.status).toBe('confirmed');
    expect(await readFile(path.join(root, 'src/example.ts'), 'utf8')).toBe(
      'export const value = 1;\n',
    );
    expect(result.data?.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('reports a nonzero command as failed with bounded output', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'trocode-hosted-workspace-'));
    temporaryDirectories.push(root);
    const adapter = createWorkspaceRuntimeToolAdapters().find(
      (candidate) => candidate.id === 'workspace.terminal',
    );
    if (!adapter) throw new Error('Workspace terminal adapter is missing.');

    const result = await adapter.execute(
      {
        action: {
          action: 'run_command',
          description: 'Run command.',
          operation: 'run_command',
          toolId: 'workspace.terminal',
        },
        callId: 'call-command',
        input: {
          command: `${JSON.stringify(process.execPath)} -e "process.exit(7)"`,
          root,
          timeoutMs: 5_000,
        },
        kind: 'direct',
        modelName: 'workspace_terminal',
        operation: 'run_command',
        toolId: 'workspace.terminal',
      },
      { signal: new AbortController().signal, taskId: randomUUID() },
    );

    expect(result.status).toBe('failed');
    expect(result.data?.exitCode).toBe(7);
  });
});
