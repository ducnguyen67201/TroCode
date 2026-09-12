import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_MODEL, graphVersion } from '../src/config.js';
import type { HostBridge } from '../src/host-bridge.js';
import {
  applyPendingToolResume,
  LocalRuntimeServer,
  prefetchedInitialTurnInput,
  rejectPendingToolAfterRestart,
} from '../src/local-runtime-server.js';
import {
  LOCAL_AGENT_CAPABILITIES,
  LOCAL_AGENT_PROTOCOL_DIGEST,
  LOCAL_AGENT_PROTOCOL_VERSION,
  LOCAL_AGENT_ROOT_ID,
  LOCAL_AGENT_SDK_VERSION,
  type LocalAgentChildMessage,
  type LocalAgentHostMessage,
} from '../src/protocol.js';
import type { ModelRequestDiagnosticSink } from '../src/user-openai-client.js';

class FakeBridge extends EventEmitter {
  readonly sent: LocalAgentChildMessage[] = [];

  send(message: LocalAgentChildMessage): void {
    this.sent.push(message);
  }
}

it.each([
  { finishOn: 2, budget: 5, expectedRuns: 2, status: 'completed' },
  { finishOn: 99, budget: 5, expectedRuns: 3, status: 'failed' },
  { finishOn: 99, budget: 1, expectedRuns: 1, status: 'failed' },
])('continues incomplete runs with shared history and bounded budget: $status/$budget', async ({ finishOn, budget, expectedRuns, status }) => {
  const bridge = new FakeBridge();
  let sequence = 0;
  Reflect.set(bridge, 'nextSequence', () => ++sequence);
  Reflect.set(bridge, 'request', async () => ({ kind: 'checkpoint.commit.result', checkpointRevision: sequence }));
  const server = new LocalRuntimeServer(bridge as unknown as HostBridge);
  let requests = 0;
  let diagnostic!: ModelRequestDiagnosticSink;
  const session = {};
  const run = vi.fn(async (...args: unknown[]) => {
    expect(args).toHaveLength(3);
    requests++;
    diagnostic({ event: 'model_request_started', agentTurnId: 'turn', taskId: 'task', clientRequestId: `request-${requests}`, serverRequestId: null, durationMs: null, inputItemCount: null, model: null, status: null, toolChoice: null, toolCount: null });
    return { async *[Symbol.asyncIterator]() { yield { type: 'ignored' }; }, completed: Promise.resolve(), interruptions: [], finalOutput: 'Narrative response', state: { toString: () => 'checkpoint', toJSON: () => ({ currentTurn: 1 }) } };
  });
  Reflect.set(server, 'graphFactory', { runner: { run }, create: async (_input: unknown, _context: unknown, sink: ModelRequestDiagnosticSink) => {
    diagnostic = sink;
    return { agent: {}, session, toolSurface: { pendingCompletion: () => requests >= finishOn ? [] : ['finish_task'] } };
  } });
  await Reflect.get(server, 'runTurn').call(server, { kind: 'turn.start', agentId: LOCAL_AGENT_ROOT_ID, parentAgentId: null, delegationId: null,
    threadId: randomUUID(), turnId: randomUUID(), graphVersion: graphVersion([], DEFAULT_AGENT_MODEL), tools: [], model: DEFAULT_AGENT_MODEL, maxTurns: budget, request: 'Open and explain.' });
  expect(run).toHaveBeenCalledTimes(expectedRuns);
  for (let index = 0; index < expectedRuns; index++) {
    expect(run.mock.calls[index]?.[2]).toMatchObject({ session, maxTurns: budget - index });
    if (index > 0) expect(run.mock.calls[index]?.[1]).toContain('Do not repeat an uncertain operation');
  }
  expect(bridge.sent.find((message) => message.kind === 'turn.terminal')).toMatchObject({ status });
});

describe('LocalRuntimeServer', () => {
  it('rejects a checkpointed tool that never ran so the model re-checks current state', () => {
    const reject = vi.fn();
    const interruption = {
      rawItem: {
        type: 'function_call',
        callId: 'call-before-restart',
        name: 'control_surface',
        arguments: JSON.stringify({ observationId: randomUUID() }),
      },
    };

    rejectPendingToolAfterRestart({ reject } as never, interruption as never);

    expect(reject).toHaveBeenCalledOnce();
    expect(reject).toHaveBeenCalledWith(interruption, {
      message: expect.stringMatching(/re-check the current state/i),
    });
  });

  it('replays a dispatched pending tool through the durable invocation journal', () => {
    const approve = vi.fn();
    const markForReplay = vi.fn();
    const reject = vi.fn();
    const interruption = { rawItem: { type: 'function_call', callId: 'call-1' } };

    applyPendingToolResume(
      { approve, reject } as never,
      interruption as never,
      'replay',
      markForReplay,
    );

    expect(markForReplay).toHaveBeenCalledOnce();
    expect(approve).toHaveBeenCalledWith(interruption);
    expect(reject).not.toHaveBeenCalled();
  });

  it('requires a fresh observation instead of replaying a stale observation binding', () => {
    const approve = vi.fn();
    const markForReplay = vi.fn();
    const reject = vi.fn();
    const interruption = { rawItem: { type: 'function_call', callId: 'observe-1' } };

    applyPendingToolResume(
      { approve, reject } as never,
      interruption as never,
      'reobserve',
      markForReplay,
    );

    expect(reject).toHaveBeenCalledWith(interruption, {
      message: expect.stringMatching(/fresh observation/i),
    });
    expect(markForReplay).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it('releases process lifetime only after an explicit runtime shutdown', async () => {
    const bridge = new FakeBridge();
    const onShutdown = vi.fn();
    new LocalRuntimeServer(bridge as unknown as HostBridge, onShutdown);

    bridge.emit('message', {
      kind: 'runtime.shutdown',
      requestId: randomUUID(),
    } satisfies LocalAgentHostMessage);

    await vi.waitFor(() => expect(onShutdown).toHaveBeenCalledOnce());
  });

  it('reports invalid turn preflight as a fatal protocol command', async () => {
    const bridge = new FakeBridge();
    new LocalRuntimeServer(bridge as unknown as HostBridge);
    const expectedGraphVersion = graphVersion([], DEFAULT_AGENT_MODEL);
    bridge.emit('message', {
      kind: 'runtime.initialize',
      requestId: randomUUID(),
      apiBaseUrl: 'https://api.example.com',
      requiredCapabilities: ['sessions', 'compaction'],
      expected: {
        protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION,
        protocolDigest: LOCAL_AGENT_PROTOCOL_DIGEST,
        sdkVersion: LOCAL_AGENT_SDK_VERSION,
        graphVersion: expectedGraphVersion,
        capabilities: [...LOCAL_AGENT_CAPABILITIES],
      },
    } satisfies LocalAgentHostMessage);
    bridge.emit('message', {
      kind: 'turn.start',
      requestId: randomUUID(),
      threadId: randomUUID(),
      turnId: randomUUID(),
      agentId: LOCAL_AGENT_ROOT_ID,
      parentAgentId: null,
      delegationId: null,
      graphVersion: 'f'.repeat(64),
      sequence: 1,
      agentTurnId: randomUUID(),
      request: 'Inspect the current application.',
      requiredInitialTool: null,
      prefetchedInitialToolResult: null,
      model: DEFAULT_AGENT_MODEL,
      maxTurns: 4,
      toolCatalogDigest: 'a'.repeat(64),
      tools: [],
    } satisfies LocalAgentHostMessage);

    await vi.waitFor(() => {
      expect(bridge.sent).toContainEqual(expect.objectContaining({
        kind: 'runtime.fatal',
        code: 'runtime_command_failed',
        message: 'graph_version_mismatch',
      }));
    });
  });

  it('places a trusted prefetched observation in the first model input', () => {
    const input = prefetchedInitialTurnInput('Help with this Scratch task.', {
      status: 'completed',
      summary: 'Captured the current screen.',
      data: {
        observation: {
          observationId: '0f157354-9ed4-4dc8-a1fa-9020f13a7710',
          text: 'Scratch tutorial is visible.',
        },
      },
      imageDataUrl: 'data:image/png;base64,aW1hZ2U=',
    });

    expect(input).toEqual([expect.objectContaining({
      role: 'user',
      content: expect.arrayContaining([
        { type: 'input_text', text: 'Help with this Scratch task.' },
        expect.objectContaining({
          type: 'input_image',
          image: 'data:image/png;base64,aW1hZ2U=',
        }),
      ]),
    })]);
    expect(JSON.stringify(input)).toContain('Trusted host initial observation');
    expect(JSON.stringify(input)).toContain('0f157354-9ed4-4dc8-a1fa-9020f13a7710');
  });

  it('quarantines SDK-incompatible tools individually during catalog startup validation', async () => {
    const bridge = new FakeBridge();
    new LocalRuntimeServer(bridge as unknown as HostBridge);
    const expectedGraphVersion = graphVersion([], DEFAULT_AGENT_MODEL);
    bridge.emit('message', {
      kind: 'runtime.initialize',
      requestId: randomUUID(),
      apiBaseUrl: 'https://api.example.com',
      requiredCapabilities: ['sessions', 'compaction', 'catalogValidation'],
      expected: {
        protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION,
        protocolDigest: LOCAL_AGENT_PROTOCOL_DIGEST,
        sdkVersion: LOCAL_AGENT_SDK_VERSION,
        graphVersion: expectedGraphVersion,
        capabilities: [...LOCAL_AGENT_CAPABILITIES],
      },
    } satisfies LocalAgentHostMessage);
    const requestId = randomUUID();
    bridge.emit('message', {
      kind: 'runtime.validateCatalog',
      requestId,
      catalogDigest: 'a'.repeat(64),
      tools: [
        {
          toolId: 'cua.valid_action',
          modelName: 'valid_action',
          description: 'Valid action.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: [],
          },
          operations: ['valid_action'],
          driverCatalogDigest: 'b'.repeat(64),
        },
        {
          toolId: 'cua.rewritten_action',
          modelName: 'rewritten_action',
          description: 'Would require an SDK rewrite.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { value: { type: 'string' } },
            required: [],
          },
          operations: ['rewritten_action'],
          driverCatalogDigest: 'b'.repeat(64),
        },
      ],
    } satisfies LocalAgentHostMessage);

    await vi.waitFor(() => {
      expect(bridge.sent).toContainEqual({
        kind: 'runtime.catalogValidated',
        requestId,
        acceptedModelNames: ['valid_action'],
        rejected: [
          expect.objectContaining({ modelName: 'rewritten_action' }),
        ],
      });
    });
  });
});
