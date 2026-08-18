import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  CodexAppServerClient,
  CodexProtocolError,
  type CodexChildProcess,
  type CodexProcessFactory,
} from './codex-app-server-client';

class FakeCodexProcess extends EventEmitter implements CodexChildProcess {
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly kill = vi.fn(() => true);
}

function setupClient() {
  const child = new FakeCodexProcess();
  const calls: Array<{
    args: readonly string[];
    environment: NodeJS.ProcessEnv | undefined;
    executable: string;
  }> = [];
  let outbound = '';
  child.stdin.on('data', (chunk: Buffer) => {
    outbound += chunk.toString('utf8');
    const lines = outbound.split('\n');
    outbound = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      const message = JSON.parse(line) as {
        id?: number;
        method?: string;
      };
      if (message.method === 'initialize' && message.id !== undefined) {
        child.stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: {
              codexHome: '/tmp/trocode-codex-home',
              platformFamily: 'unix',
              platformOs: 'macos',
              userAgent: 'codex-cli/0.146.0',
            },
          })}\n`,
        );
      }
    }
  });
  const processFactory: CodexProcessFactory = (executable, args, options) => {
    calls.push({ args, environment: options.env, executable });
    return child;
  };
  const client = new CodexAppServerClient({
    appCodexHome: '/tmp/trocode-codex-home',
    environment: { PATH: '/usr/bin', TROCODE_SECRET: 'must-not-leak' },
    executable: '/usr/local/bin/codex',
    processFactory,
  });
  return { calls, child, client };
}

describe('CodexAppServerClient', () => {
  it('spawns an explicit bounded stdio server and completes initialization', async () => {
    const { calls, client } = setupClient();
    await client.start();

    expect(calls).toEqual([
      expect.objectContaining({
        args: ['app-server', '--stdio', '--strict-config'],
        executable: '/usr/local/bin/codex',
        environment: expect.objectContaining({
          CODEX_HOME: '/tmp/trocode-codex-home',
        }),
      }),
    ]);
    expect(calls[0]?.environment).not.toHaveProperty('TROCODE_SECRET');
    await client.close();
  });

  it('accepts fragmented JSONL notifications', async () => {
    const { child, client } = setupClient();
    const notification = vi.fn();
    client.on('notification', notification);
    await client.start();

    child.stdout.write('{"method":"warning","params":{"threadId":null,');
    child.stdout.write('"message":"Check config."}}\n');

    expect(notification).toHaveBeenCalledWith({
      method: 'warning',
      params: { message: 'Check config.', threadId: null },
    });
    await client.close();
  });

  it.each([
    ['malformed JSONL', Buffer.from('{not-json}\n')],
    ['an oversized line', Buffer.alloc(1_000_001, 0x78)],
  ])('fails closed on %s', async (_case, payload) => {
    const { child, client } = setupClient();
    const failure = vi.fn();
    client.on('failure', failure);
    await client.start();

    child.stdout.write(payload);

    expect(failure).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects duplicate server request IDs', async () => {
    const { child, client } = setupClient();
    const failure = vi.fn();
    client.on('failure', failure);
    await client.start();
    const request = `${JSON.stringify({
      id: 'approval-1',
      method: 'item/fileChange/requestApproval',
      params: {},
    })}\n`;

    child.stdout.write(request);
    child.stdout.write(request);

    expect(failure).toHaveBeenCalledWith(expect.any(CodexProtocolError));
  });

  it('rejects duplicate or unknown client response IDs', async () => {
    const { child, client } = setupClient();
    const failure = vi.fn();
    client.on('failure', failure);
    await client.start();

    child.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);

    expect(failure).toHaveBeenCalledWith(expect.any(CodexProtocolError));
  });

  it('caps concurrent client requests', async () => {
    const { client } = setupClient();
    client.on('failure', vi.fn());
    await client.start();
    const pending = Array.from({ length: 64 }, (_, index) =>
      client
        .request(`test/request/${index}`, {}, z.object({}).passthrough())
        .catch(() => undefined),
    );

    await expect(
      client.request('test/request/overflow', {}, z.object({})),
    ).rejects.toThrow('pending request limit');

    await client.close();
    await Promise.all(pending);
  });

  it('rejects pending requests when the process exits and never restarts it', async () => {
    const { calls, child, client } = setupClient();
    client.on('failure', vi.fn());
    await client.start();
    const pending = client.request(
      'thread/start',
      {},
      z.object({ thread: z.object({ id: z.string() }) }),
    );

    child.emit('exit', 1, null);

    await expect(pending).rejects.toThrow('exited unexpectedly');
    expect(calls).toHaveLength(1);
  });
});
