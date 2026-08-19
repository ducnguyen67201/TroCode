import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeCallbacks } from './agent-runtime';
import {
  createWorkspaceAgentTools,
  WorkspaceEditor,
  WorkspaceShell,
} from './workspace-agent-tools';

function callbacks(
  requestApproval: NonNullable<AgentRuntimeCallbacks['requestApproval']>,
): AgentRuntimeCallbacks {
  return {
    billableUserTurnIds: () => [],
    beforeModel: () => [],
    executeTool: async () => '',
    requestApproval,
  };
}

describe('WorkspaceEditor', () => {
  it('applies bounded create, update, move, and delete operations inside the root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'trocode-editor-'));
    try {
      const canonicalRoot = await realpath(root);
      const editor = new WorkspaceEditor(canonicalRoot);
      await editor.createFile({
        type: 'create_file',
        path: 'src/example.txt',
        diff: '+hello',
      });
      await expect(readFile(path.join(root, 'src/example.txt'), 'utf8')).resolves.toBe(
        'hello',
      );

      await editor.updateFile({
        type: 'update_file',
        path: 'src/example.txt',
        diff: '@@\n-hello\n+world',
        moveTo: 'src/renamed.txt',
      });
      await expect(readFile(path.join(root, 'src/renamed.txt'), 'utf8')).resolves.toBe(
        'world',
      );
      await expect(readFile(path.join(root, 'src/example.txt'), 'utf8')).rejects.toThrow();

      await editor.deleteFile({ type: 'delete_file', path: 'src/renamed.txt' });
      await expect(readFile(path.join(root, 'src/renamed.txt'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects lexical paths outside the selected root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'trocode-editor-'));
    try {
      const editor = new WorkspaceEditor(await realpath(root));
      await expect(
        editor.createFile({
          type: 'create_file',
          path: '../outside.txt',
          diff: '+blocked',
        }),
      ).rejects.toThrow('escapes the selected root');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects paths that leave the selected root through a symlink', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'trocode-editor-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'trocode-outside-'));
    try {
      await symlink(outside, path.join(root, 'linked'));
      const editor = new WorkspaceEditor(await realpath(root));
      await expect(
        editor.createFile({
          type: 'create_file',
          path: 'linked/outside.txt',
          diff: '+blocked',
        }),
      ).rejects.toThrow('escapes the selected root');
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });
});

describe('WorkspaceShell', () => {
  it('runs a bounded command from the selected workspace with provider secrets removed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'trocode-shell-'));
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'must-not-leak';
    try {
      const canonicalRoot = await realpath(root);
      const shell = new WorkspaceShell(canonicalRoot);
      const command = `${JSON.stringify(process.execPath)} -e "process.stdout.write(process.cwd() + '|' + String(process.env.OPENAI_API_KEY))"`;
      const result = await shell.run({ commands: [command] });
      expect(result.output).toEqual([
        {
          stdout: `${canonicalRoot}|undefined`,
          stderr: '',
          outcome: { type: 'exit', exitCode: 0 },
        },
      ]);
      await shell.close();
    } finally {
      if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
      await rm(root, { force: true, recursive: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'escalates a timed-out command that ignores termination',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'trocode-shell-'));
      try {
        const shell = new WorkspaceShell(await realpath(root));
        const startedAt = Date.now();
        const result = await shell.run({
          commands: ["trap '' TERM; while :; do sleep 1; done"],
          timeoutMs: 100,
        });
        expect(result.output[0]?.outcome).toEqual({ type: 'timeout' });
        expect(Date.now() - startedAt).toBeLessThan(2_000);
        await shell.close();
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );
});

describe('createWorkspaceAgentTools', () => {
  it('binds shell approval to the full bounded command list', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'trocode-tools-'));
    const requestApproval = vi.fn(async () => true);
    const bundle = createWorkspaceAgentTools({
      callbacks: callbacks(requestApproval),
      maxToolCalls: 5,
      root: await realpath(root),
    });
    try {
      const shell = bundle.tools.find((tool) => tool.type === 'shell');
      expect(shell?.onApproval).toBeTypeOf('function');
      await expect(
        shell?.onApproval?.(
          {} as never,
          {
            rawItem: {
              type: 'shell_call',
              callId: 'call-1',
              action: { commands: ['npm test', 'git status --short'] },
            },
          } as never,
        ),
      ).resolves.toEqual({ approve: true });
      expect(requestApproval).toHaveBeenCalledWith({
        action: {
          action: 'run_command',
          description: 'Run 2 workspace commands.',
          target: await realpath(root),
          parameters: {
            commands: ['npm test', 'git status --short'],
            declaredConsequence: 'run_command',
          },
        },
        consequence:
          'This runs the displayed command exactly once in a local system shell. It starts in the selected workspace but can access other local files and the network.',
        prompt: 'Run 2 workspace commands.',
      });
    } finally {
      await bundle.close();
      await rm(root, { force: true, recursive: true });
    }
  });

  it('adds a learning reason to a classroom workspace approval', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'trocode-tools-'));
    const requestApproval = vi.fn(async () => false);
    const bundle = createWorkspaceAgentTools({
      callbacks: callbacks(requestApproval),
      maxToolCalls: 5,
      request: 'Help me debug this programming assignment.',
      root: await realpath(root),
      taskId: 'classroom-task',
    });
    try {
      const shell = bundle.tools.find((tool) => tool.type === 'shell');
      await shell?.onApproval?.(
        {} as never,
        {
          rawItem: {
            type: 'shell_call',
            callId: 'call-classroom',
            action: { commands: ['npm test'] },
          },
        } as never,
      );

      expect(requestApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringMatching(/^Next: .* Why: /u),
        }),
      );
    } finally {
      await bundle.close();
      await rm(root, { force: true, recursive: true });
    }
  });

  it('binds patch approval to the full diff and rejects an escaping move target', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'trocode-tools-'));
    const requestApproval = vi.fn(async () => true);
    const canonicalRoot = await realpath(root);
    const bundle = createWorkspaceAgentTools({
      callbacks: callbacks(requestApproval),
      maxToolCalls: 5,
      root: canonicalRoot,
    });
    try {
      const patch = bundle.tools.find((tool) => tool.type === 'apply_patch');
      expect(patch?.onApproval).toBeTypeOf('function');
      await expect(
        patch?.onApproval?.(
          {} as never,
          {
            rawItem: {
              type: 'apply_patch_call',
              callId: 'call-2',
              status: 'in_progress',
              operation: {
                type: 'update_file',
                path: 'src/example.ts',
                diff: '@@\n-old\n+new',
                moveTo: 'src/renamed.ts',
              },
            },
          } as never,
        ),
      ).resolves.toEqual({ approve: true });
      expect(requestApproval).toHaveBeenCalledWith({
        action: {
          action: 'write_file',
          description:
            'Update workspace file src/example.ts and move it to src/renamed.ts.',
          target: path.join(canonicalRoot, 'src/example.ts'),
          parameters: {
            declaredConsequence: 'write_file',
            operation: 'update_file',
            diff: '@@\n-old\n+new',
            moveTo: 'src/renamed.ts',
          },
        },
        consequence:
          'This applies the displayed patch once inside the selected workspace.',
        prompt:
          'Update workspace file src/example.ts and move it to src/renamed.ts.',
      });

      requestApproval.mockClear();
      await expect(
        patch?.onApproval?.(
          {} as never,
          {
            rawItem: {
              type: 'apply_patch_call',
              callId: 'call-3',
              status: 'in_progress',
              operation: {
                type: 'update_file',
                path: 'src/example.ts',
                diff: '@@\n-old\n+new',
                moveTo: '../outside.ts',
              },
            },
          } as never,
        ),
      ).resolves.toEqual({
        approve: false,
        reason: 'The patch escapes the selected workspace.',
      });
      expect(requestApproval).not.toHaveBeenCalled();
    } finally {
      await bundle.close();
      await rm(root, { force: true, recursive: true });
    }
  });

  it('enforces the task workspace tool-call limit before another effect', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'trocode-tools-'));
    const bundle = createWorkspaceAgentTools({
      callbacks: callbacks(async () => true),
      maxToolCalls: 1,
      root: await realpath(root),
    });
    try {
      const patch = bundle.tools.find((tool) => tool.type === 'apply_patch');
      if (!patch || patch.type !== 'apply_patch') {
        throw new Error('Expected the workspace apply_patch tool.');
      }
      await patch.editor.createFile({
        type: 'create_file',
        path: 'first.txt',
        diff: '+first',
      });
      await expect(
        patch.editor.createFile({
          type: 'create_file',
          path: 'second.txt',
          diff: '+second',
        }),
      ).rejects.toThrow('workspace tool-call limit');
      await expect(readFile(path.join(root, 'second.txt'), 'utf8')).rejects.toThrow();
    } finally {
      await bundle.close();
      await rm(root, { force: true, recursive: true });
    }
  });
});
