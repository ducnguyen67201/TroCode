import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import type { Readable, Writable } from 'node:stream';

import type { z } from 'zod';

import { createCodexEnvironment } from './codex-environment';
import {
  CodexInitializeResponseSchema,
  CodexMethodEnvelopeSchema,
  CodexResponseEnvelopeSchema,
  type CodexMethodEnvelope,
  type CodexRequestId,
} from './codex-protocol';

const MAX_JSONL_LINE_BYTES = 1_000_000;
const MAX_PENDING_REQUESTS = 64;
const MAX_STDERR_BYTES = 64_000;

interface PendingRequest {
  reject(error: Error): void;
  resolve(value: unknown): void;
}

export interface CodexChildProcess extends EventEmitter {
  stderr: Readable;
  stdin: Writable;
  stdout: Readable;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface CodexProcessFactory {
  (
    executable: string,
    args: readonly string[],
    options: SpawnOptions,
  ): CodexChildProcess;
}

export interface CodexAppServerClientOptions {
  appCodexHome: string;
  environment?: NodeJS.ProcessEnv;
  executable: string;
  processFactory?: CodexProcessFactory;
}

export interface CodexAppServerClientLike {
  close(): Promise<void>;
  notify(method: string, params?: unknown): Promise<void>;
  on(event: 'failure', listener: (error: Error) => void): this;
  on(
    event: 'notification' | 'request',
    listener: (event: unknown) => void,
  ): this;
  request<T>(method: string, params: unknown, schema: z.ZodType<T>): Promise<T>;
  respond(id: CodexRequestId, result: unknown): Promise<void>;
  respondError(
    id: CodexRequestId,
    code: number,
    message: string,
  ): Promise<void>;
  start(): Promise<void>;
}

export class CodexProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexProtocolError';
  }
}

export class CodexAppServerClient
  extends EventEmitter
  implements CodexAppServerClientLike
{
  private child?: CodexChildProcess;

  private closing = false;

  private initialized = false;

  private nextRequestId = 1;

  private readonly pending = new Map<CodexRequestId, PendingRequest>();

  private readonly seenServerRequestIds = new Set<CodexRequestId>();

  private stderrBytes = 0;

  private stdoutBuffer = Buffer.alloc(0);

  constructor(private readonly options: CodexAppServerClientOptions) {
    super();
  }

  async start(): Promise<void> {
    if (this.initialized) return;
    if (this.child) throw new Error('Codex app-server is already starting.');
    await mkdir(this.options.appCodexHome, { recursive: true, mode: 0o700 });
    const processFactory: CodexProcessFactory =
      this.options.processFactory ??
      ((executable, args, options) =>
        spawn(executable, [...args], options) as ChildProcessWithoutNullStreams);
    const child = processFactory(
      this.options.executable,
      ['app-server', '--stdio', '--strict-config'],
      {
        env: createCodexEnvironment(
          this.options.environment ?? process.env,
          this.options.appCodexHome,
        ),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.child = child;
    child.stdout.on('data', (chunk: Buffer) => this.acceptStdout(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderrBytes = Math.min(
        MAX_STDERR_BYTES,
        this.stderrBytes + chunk.byteLength,
      );
    });
    child.once('error', (error) => {
      this.child = undefined;
      this.initialized = false;
      this.fail(error, !this.closing);
    });
    child.once('exit', (code, signal) => {
      const summary = this.closing
        ? 'Codex app-server closed.'
        : `Codex app-server exited unexpectedly (${code ?? signal ?? 'unknown'}).`;
      this.child = undefined;
      this.initialized = false;
      this.fail(new Error(summary), !this.closing);
      this.emit('exit', { code, signal, unexpected: !this.closing });
    });

    try {
      await this.request(
        'initialize',
        {
          clientInfo: {
            name: 'trocode',
            title: 'TroCode',
            version: '0.1.1',
          },
          capabilities: { experimentalApi: true },
        },
        CodexInitializeResponseSchema,
      );
      await this.notify('initialized');
      this.initialized = true;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async request<T>(
    method: string,
    params: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    if (!this.child) throw new Error('Codex app-server is not running.');
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      throw new CodexProtocolError('Codex pending request limit reached.');
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        reject,
        resolve: (value) => resolve(schema.parse(value)),
      });
    });
    try {
      await this.writeLine({ id, method, params });
    } catch (error) {
      this.pending.delete(id);
      throw error;
    }
    return response;
  }

  notify(method: string, params?: unknown): Promise<void> {
    return this.writeLine({ method, ...(params === undefined ? {} : { params }) });
  }

  async respond(id: CodexRequestId, result: unknown): Promise<void> {
    this.seenServerRequestIds.delete(id);
    await this.writeLine({ id, result });
  }

  async respondError(
    id: CodexRequestId,
    code: number,
    message: string,
  ): Promise<void> {
    this.seenServerRequestIds.delete(id);
    await this.writeLine({
      id,
      error: { code, message: message.slice(0, 2_000) },
    });
  }

  async close(): Promise<void> {
    if (!this.child) return;
    this.closing = true;
    this.child.kill('SIGTERM');
    this.child = undefined;
    this.initialized = false;
    this.fail(new Error('Codex app-server closed.'), false);
  }

  private acceptStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    let newline = this.stdoutBuffer.indexOf(0x0a);
    while (newline >= 0) {
      const line = this.stdoutBuffer.subarray(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      if (line.byteLength > MAX_JSONL_LINE_BYTES) {
        this.protocolFailure('Codex JSONL line exceeded the byte limit.');
        return;
      }
      if (line.byteLength > 0) this.acceptLine(line.toString('utf8'));
      newline = this.stdoutBuffer.indexOf(0x0a);
    }
    if (this.stdoutBuffer.byteLength > MAX_JSONL_LINE_BYTES) {
      this.protocolFailure('Codex JSONL line exceeded the byte limit.');
    }
  }

  private acceptLine(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      this.protocolFailure('Codex app-server emitted malformed JSONL.');
      return;
    }

    const response = CodexResponseEnvelopeSchema.safeParse(value);
    if (response.success) {
      const pending = this.pending.get(response.data.id);
      if (!pending) {
        this.protocolFailure('Codex returned an unknown or duplicate response ID.');
        return;
      }
      this.pending.delete(response.data.id);
      if (response.data.error) {
        pending.reject(new Error(response.data.error.message));
      } else {
        try {
          pending.resolve(response.data.result);
        } catch (error) {
          pending.reject(
            error instanceof Error ? error : new CodexProtocolError('Invalid Codex response.'),
          );
          this.protocolFailure('Codex returned a response with an invalid result.');
        }
      }
      return;
    }

    const envelope = CodexMethodEnvelopeSchema.safeParse(value);
    if (!envelope.success) {
      this.protocolFailure('Codex app-server emitted an invalid protocol envelope.');
      return;
    }
    if (envelope.data.id !== undefined) {
      if (this.seenServerRequestIds.has(envelope.data.id)) {
        this.protocolFailure('Codex emitted a duplicate server request ID.');
        return;
      }
      this.seenServerRequestIds.add(envelope.data.id);
      if (this.seenServerRequestIds.size > MAX_PENDING_REQUESTS) {
        this.protocolFailure('Codex server request limit reached.');
        return;
      }
      this.emit('request', envelope.data);
    } else {
      this.emit('notification', envelope.data satisfies CodexMethodEnvelope);
    }
  }

  private async writeLine(value: unknown): Promise<void> {
    const child = this.child;
    if (!child || child.stdin.destroyed) {
      throw new Error('Codex app-server input is unavailable.');
    }
    const serialized = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(serialized) > MAX_JSONL_LINE_BYTES) {
      throw new CodexProtocolError('Codex outbound JSONL line exceeded the byte limit.');
    }
    if (!child.stdin.write(serialized, 'utf8')) await once(child.stdin, 'drain');
  }

  private protocolFailure(message: string): void {
    const child = this.child;
    this.child = undefined;
    this.initialized = false;
    this.closing = true;
    child?.kill('SIGTERM');
    this.fail(new CodexProtocolError(message));
  }

  private fail(error: Error, emitFailure = true): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.seenServerRequestIds.clear();
    if (emitFailure) this.emit('failure', error);
  }
}
