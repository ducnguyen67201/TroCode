import { createHash } from 'node:crypto';

import type {
  RuntimeToolExecutionAdapter,
} from './runtime-tool-dispatcher';
import type {
  WorkspaceFilesystemToolInput,
  WorkspaceTerminalToolInput,
} from './runtime-tool-registry';
import { WorkspaceEditor, WorkspaceShell } from './workspace-agent-tools';

const MAX_RETURNED_FILE_CHARACTERS = 100_000;

export function createWorkspaceRuntimeToolAdapters(): RuntimeToolExecutionAdapter[] {
  return [
    {
      id: 'workspace.filesystem',
      execute: async (invocation) => {
        const input = invocation.input as WorkspaceFilesystemToolInput;
        const editor = new WorkspaceEditor(input.root);
        if (invocation.operation === 'read_file') {
          const content = await editor.readTextFile(input.path);
          const truncated = content.length > MAX_RETURNED_FILE_CHARACTERS;
          return {
            status: 'confirmed',
            summary: truncated
              ? `Read ${input.path}; the returned content was bounded.`
              : `Read ${input.path}.`,
            data: {
              content: content.slice(0, MAX_RETURNED_FILE_CHARACTERS),
              path: input.path,
              sha256: createHash('sha256').update(content).digest('hex'),
              truncated,
            },
          };
        }
        if (invocation.operation !== 'write_file' || input.content === undefined) {
          return {
            status: 'not_executed',
            summary: 'The workspace file operation did not match its input.',
          };
        }
        await editor.replaceTextFile(input.path, input.content);
        const verified = await editor.readTextFile(input.path);
        const expectedDigest = createHash('sha256').update(input.content).digest('hex');
        const actualDigest = createHash('sha256').update(verified).digest('hex');
        return {
          status: expectedDigest === actualDigest ? 'confirmed' : 'unknown',
          summary: expectedDigest === actualDigest
            ? `Wrote and verified ${input.path}.`
            : `Wrote ${input.path}, but deterministic verification did not match.`,
          data: {
            path: input.path,
            sha256: actualDigest,
          },
        };
      },
    },
    {
      id: 'workspace.terminal',
      execute: async (invocation, context) => {
        const input = invocation.input as WorkspaceTerminalToolInput;
        if (invocation.operation !== 'run_command') {
          return {
            status: 'not_executed',
            summary: 'The workspace terminal operation was not allowlisted.',
          };
        }
        const shell = new WorkspaceShell(input.root, context.signal);
        try {
          const result = await shell.run({
            commands: [input.command],
            maxOutputLength: 100_000,
            timeoutMs: input.timeoutMs,
          });
          const output = result.output[0];
          if (!output) {
            return {
              status: 'unknown',
              summary: 'The workspace command returned no execution result.',
            };
          }
          const confirmed =
            output.outcome.type === 'exit' && output.outcome.exitCode === 0;
          const exitCode = output.outcome.type === 'exit'
            ? output.outcome.exitCode
            : null;
          return {
            status: confirmed ? 'confirmed' : 'failed',
            summary: confirmed
              ? 'Workspace command completed successfully.'
              : output.outcome.type === 'timeout'
                ? 'Workspace command reached its timeout.'
                : `Workspace command failed with exit code ${String(exitCode)}.`,
            data: {
              exitCode,
              stderr: output.stderr,
              stdout: output.stdout,
            },
          };
        } finally {
          await shell.close();
        }
      },
    },
  ];
}
