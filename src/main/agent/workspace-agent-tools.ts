import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import {
  applyDiff,
  applyPatchTool,
  shellTool,
  type ApplyPatchOperation,
  type ApplyPatchTool,
  type Editor,
  type Shell,
  type ShellAction,
  type ShellOutputResult,
  type ShellTool,
} from '@openai/agents';

import type { ProposedAction } from '../../shared/contracts';

import { createActionPreview } from './action-preview-policy';
import type { AgentRuntimeCallbacks } from './agent-runtime';

const MAX_COMMANDS = 8;
const MAX_COMMAND_LENGTH = 8_000;
const MAX_DIFF_LENGTH = 100_000;
const MAX_FILE_LENGTH = 5 * 1024 * 1024;
const MAX_OUTPUT_LENGTH = 100_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 30_000;

const COMMAND_ENVIRONMENT_ALLOWLIST = [
  'APPDATA',
  'COMSPEC',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOCALAPPDATA',
  'LOGNAME',
  'PATH',
  'PATHEXT',
  'SHELL',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
  'WINDIR',
] as const;

export interface WorkspaceAgentToolBundle {
  close(): Promise<void>;
  tools: Array<ShellTool | ApplyPatchTool>;
}

export interface WorkspaceAgentToolOptions {
  callbacks: AgentRuntimeCallbacks;
  maxToolCalls: number;
  request?: string;
  root: string;
  signal?: AbortSignal;
  taskId?: string;
}

class WorkspaceToolBudget {
  private completed = 0;

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('Workspace tool-call limit must be a positive integer.');
    }
  }

  consume(): void {
    if (this.completed >= this.limit) {
      throw new Error('The task reached its workspace tool-call limit.');
    }
    this.completed += 1;
  }
}

function withinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value ?? fallback)));
}

function commandEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of COMMAND_ENVIRONMENT_ALLOWLIST) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

function shellInvocation(command: string): {
  executable: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
} {
  if (process.platform === 'win32') {
    return {
      executable: process.env.COMSPEC?.trim() || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${command}"`],
      windowsVerbatimArguments: true,
    };
  }
  return {
    executable: process.env.SHELL?.trim() || '/bin/sh',
    args: ['-lc', command],
  };
}

function appendBounded(current: string, chunk: Buffer | string, limit: number): string {
  if (current.length >= limit) return current;
  return (current + chunk.toString()).slice(0, limit);
}

function signalProcessTree(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
): void {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    }
  }
  child.kill(signal);
}

interface ActiveShellProcess {
  done: Promise<void>;
  terminate(): void;
}

function validateShellAction(action: ShellAction): {
  commands: string[];
  maxOutputLength: number;
  timeoutMs: number;
} {
  if (
    action.commands.length < 1 ||
    action.commands.length > MAX_COMMANDS ||
    action.commands.some(
      (command) =>
        !command.trim() || command.length > MAX_COMMAND_LENGTH || command.includes('\0'),
    )
  ) {
    throw new Error('Workspace shell commands must be nonempty and bounded.');
  }
  return {
    commands: action.commands,
    maxOutputLength: boundedInteger(
      action.maxOutputLength,
      MAX_OUTPUT_LENGTH,
      MAX_OUTPUT_LENGTH,
    ),
    timeoutMs: boundedInteger(
      action.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
  };
}

export class WorkspaceShell implements Shell {
  private readonly children = new Set<ActiveShellProcess>();

  constructor(
    private readonly root: string,
    private readonly signal?: AbortSignal,
    private readonly consumeToolCall: () => void = () => undefined,
  ) {}

  async run(action: ShellAction): Promise<{ output: ShellOutputResult[]; maxOutputLength: number }> {
    const validated = validateShellAction(action);
    this.consumeToolCall();
    const output: ShellOutputResult[] = [];
    for (const command of validated.commands) {
      if (this.signal?.aborted) throw new Error('Workspace command was cancelled.');
      output.push(
        await this.runCommand(
          command,
          validated.timeoutMs,
          validated.maxOutputLength,
        ),
      );
    }
    return { maxOutputLength: validated.maxOutputLength, output };
  }

  async close(): Promise<void> {
    const active = [...this.children];
    for (const child of active) child.terminate();
    await Promise.all(active.map((child) => child.done));
  }

  private runCommand(
    command: string,
    timeoutMs: number,
    maxOutputLength: number,
  ): Promise<ShellOutputResult> {
    return new Promise<ShellOutputResult>((resolve) => {
      const invocation = shellInvocation(command);
      const child = spawn(invocation.executable, invocation.args, {
        cwd: this.root,
        detached: process.platform !== 'win32',
        env: commandEnvironment(process.env),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      let terminationRequested = false;
      let forceTimer: NodeJS.Timeout | undefined;
      let resolveDone: () => void = () => undefined;
      const done = new Promise<void>((resolveDonePromise) => {
        resolveDone = resolveDonePromise;
      });

      const finish = (result: ShellOutputResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceTimer) clearTimeout(forceTimer);
        this.signal?.removeEventListener('abort', cancel);
        this.children.delete(active);
        resolveDone();
        resolve(result);
      };
      const terminate = (): void => {
        if (terminationRequested) return;
        terminationRequested = true;
        signalProcessTree(child, 'SIGTERM');
        forceTimer = setTimeout(() => signalProcessTree(child, 'SIGKILL'), 500);
      };
      const cancel = (): void => terminate();
      const active: ActiveShellProcess = { done, terminate };
      this.children.add(active);
      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout = appendBounded(stdout, chunk, maxOutputLength);
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr = appendBounded(stderr, chunk, maxOutputLength);
      });
      child.once('error', (error) => {
        finish({
          stdout,
          stderr: appendBounded(stderr, error.message, maxOutputLength),
          outcome: { type: 'exit', exitCode: null },
        });
      });
      child.once('close', (code) => {
        finish({
          stdout,
          stderr,
          outcome: timedOut
            ? { type: 'timeout' }
            : { type: 'exit', exitCode: code },
        });
      });
      this.signal?.addEventListener('abort', cancel, { once: true });
    });
  }
}

export class WorkspaceEditor implements Editor {
  constructor(
    private readonly root: string,
    private readonly consumeToolCall: () => void = () => undefined,
  ) {}

  async createFile(
    operation: Extract<ApplyPatchOperation, { type: 'create_file' }>,
  ): Promise<{ output: string }> {
    this.validateDiff(operation.diff);
    this.consumeToolCall();
    const target = await this.resolvePath(operation.path);
    await mkdir(path.dirname(target), { recursive: true });
    await this.assertResolvedParent(target);
    const content = applyDiff('', operation.diff, 'create');
    this.validateFileLength(content);
    await writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
    return { output: `Created ${operation.path}.` };
  }

  async updateFile(
    operation: Extract<ApplyPatchOperation, { type: 'update_file' }>,
  ): Promise<{ output: string }> {
    this.validateDiff(operation.diff);
    this.consumeToolCall();
    const source = await this.resolveExistingFile(operation.path);
    const current = await readFile(source, 'utf8');
    this.validateFileLength(current);
    const next = applyDiff(current, operation.diff);
    this.validateFileLength(next);
    if (!operation.moveTo) {
      await writeFile(source, next, 'utf8');
      return { output: `Updated ${operation.path}.` };
    }

    const destination = await this.resolvePath(operation.moveTo);
    if (destination === source) {
      await writeFile(source, next, 'utf8');
      return { output: `Updated ${operation.path}.` };
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await this.assertResolvedParent(destination);
    await writeFile(destination, next, { encoding: 'utf8', flag: 'wx' });
    await unlink(source);
    return { output: `Updated ${operation.path} and moved it to ${operation.moveTo}.` };
  }

  async deleteFile(
    operation: Extract<ApplyPatchOperation, { type: 'delete_file' }>,
  ): Promise<{ output: string }> {
    this.consumeToolCall();
    const target = await this.resolveExistingFile(operation.path);
    await unlink(target);
    return { output: `Deleted ${operation.path}.` };
  }

  async displayPath(candidate: string): Promise<string> {
    return this.resolvePath(candidate);
  }

  private async resolveExistingFile(candidate: string): Promise<string> {
    const target = await this.resolvePath(candidate);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('Workspace edits require a regular file inside the selected root.');
    }
    const canonical = await realpath(target);
    if (!withinRoot(this.root, canonical)) {
      throw new Error('Workspace file path escapes the selected root.');
    }
    return target;
  }

  private async resolvePath(candidate: string): Promise<string> {
    if (!candidate.trim() || candidate.length > 4_096 || candidate.includes('\0')) {
      throw new Error('Workspace file path is invalid.');
    }
    const target = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(this.root, candidate);
    if (!withinRoot(this.root, target)) {
      throw new Error('Workspace file path escapes the selected root.');
    }
    await this.assertResolvedParent(target);
    return target;
  }

  private async assertResolvedParent(target: string): Promise<void> {
    let current = target;
    for (;;) {
      try {
        const canonical = await realpath(current);
        if (!withinRoot(this.root, canonical)) {
          throw new Error('Workspace file path escapes the selected root.');
        }
        return;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'Workspace file path escapes the selected root.'
        ) {
          throw error;
        }
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = path.dirname(current);
        if (parent === current) throw error;
        current = parent;
      }
    }
  }

  private validateDiff(diff: string): void {
    if (!diff || diff.length > MAX_DIFF_LENGTH || diff.includes('\0')) {
      throw new Error('Workspace patch is empty or exceeds the supported size.');
    }
  }

  private validateFileLength(content: string): void {
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_LENGTH) {
      throw new Error('Workspace file exceeds the supported edit size.');
    }
  }
}

function approvalRequester(callbacks: AgentRuntimeCallbacks) {
  return async (request: {
    action: ProposedAction;
    consequence: string;
    prompt: string;
  }): Promise<boolean> => {
    if (!callbacks.requestApproval) return false;
    return callbacks.requestApproval(request);
  };
}

function patchDescription(operation: ApplyPatchOperation): string {
  switch (operation.type) {
    case 'create_file':
      return `Create workspace file ${operation.path}.`;
    case 'update_file':
      return operation.moveTo
        ? `Update workspace file ${operation.path} and move it to ${operation.moveTo}.`
        : `Update workspace file ${operation.path}.`;
    case 'delete_file':
      return `Delete workspace file ${operation.path}.`;
  }
}

export function createWorkspaceAgentTools(
  options: WorkspaceAgentToolOptions,
): WorkspaceAgentToolBundle {
  const budget = new WorkspaceToolBudget(options.maxToolCalls);
  const consumeToolCall = () => budget.consume();
  const shell = new WorkspaceShell(options.root, options.signal, consumeToolCall);
  const editor = new WorkspaceEditor(options.root, consumeToolCall);
  const requestApproval = approvalRequester(options.callbacks);
  const approvalPrompt = (action: ProposedAction): string =>
    options.request
      ? createActionPreview({
          action,
          request: options.request,
          taskId: options.taskId ?? 'workspace',
        }).message
      : action.description;

  const tools: Array<ShellTool | ApplyPatchTool> = [
    shellTool({
      environment: { type: 'local' },
      shell,
      needsApproval: true,
      onApproval: async (_context, item) => {
        if (item.rawItem.type !== 'shell_call') {
          return { approve: false, reason: 'Malformed workspace shell request.' };
        }
        const validated = validateShellAction(item.rawItem.action);
        const action: ProposedAction = {
          action: 'run_command',
          description:
            validated.commands.length === 1
              ? `Run workspace command: ${validated.commands[0]}`
              : `Run ${validated.commands.length} workspace commands.`,
          target: options.root,
          parameters: {
            commands: validated.commands,
            declaredConsequence: 'run_command',
          },
        };
        const approve = await requestApproval({
          action,
          consequence:
            'This runs the displayed command exactly once in a local system shell. It starts in the selected workspace but can access other local files and the network.',
          prompt: approvalPrompt(action),
        });
        return approve
          ? { approve: true }
          : { approve: false, reason: 'The user denied this command.' };
      },
    }),
    applyPatchTool({
      editor,
      needsApproval: true,
      onApproval: async (_context, item) => {
        if (item.rawItem.type !== 'apply_patch_call') {
          return { approve: false, reason: 'Malformed workspace patch request.' };
        }
        const operation = item.rawItem.operation;
        const target = await editor.displayPath(operation.path).catch(() => null);
        const moveTarget =
          operation.type === 'update_file' && operation.moveTo
            ? await editor.displayPath(operation.moveTo).catch(() => null)
            : undefined;
        if (!target || moveTarget === null) {
          return { approve: false, reason: 'The patch escapes the selected workspace.' };
        }
        const parameters: NonNullable<ProposedAction['parameters']> = {
          declaredConsequence:
            operation.type === 'delete_file' ? 'delete' : 'write_file',
          operation: operation.type,
          ...(operation.type === 'delete_file' ? {} : { diff: operation.diff }),
          ...(operation.type === 'update_file' && operation.moveTo
            ? { moveTo: operation.moveTo }
            : {}),
        };
        const action: ProposedAction = {
          action: operation.type === 'delete_file' ? 'delete' : 'write_file',
          description: patchDescription(operation),
          target,
          parameters,
        };
        const approve = await requestApproval({
          action,
          consequence:
            operation.type === 'delete_file'
              ? 'This deletes the displayed file once.'
              : 'This applies the displayed patch once inside the selected workspace.',
          prompt: approvalPrompt(action),
        });
        return approve
          ? { approve: true }
          : { approve: false, reason: 'The user denied this patch.' };
      },
    }),
  ];

  return {
    tools,
    close: () => shell.close(),
  };
}
