import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { AgentGraphFactory } from '../src/agent-graph.js';
import {
  graphVersion,
  modelSettings,
  ROOT_AGENT_DEFINITION,
} from '../src/config.js';
import {
  LOCAL_AGENT_CAPABILITIES,
  LOCAL_AGENT_PROTOCOL_DIGEST,
  LOCAL_AGENT_PROTOCOL_VERSION,
  LOCAL_AGENT_ROOT_ID,
  LOCAL_AGENT_SDK_VERSION,
  LocalAgentChildMessageSchema,
  LocalAgentHostMessageSchema,
  LocalRuntimeCapabilitiesSchema,
  type LocalRuntimeToolSpec,
} from '../src/protocol.js';

const digest = 'a'.repeat(64);

function tool(toolId: string, modelName: string): LocalRuntimeToolSpec {
  return {
    toolId,
    modelName,
    description: `Execute ${modelName}.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    operations: ['execute'],
    driverCatalogDigest: null,
  };
}

describe('local agent protocol and graph', () => {
  it('publishes one stable root agent with future lineage inactive', () => {
    expect(ROOT_AGENT_DEFINITION.agentId).toBe(LOCAL_AGENT_ROOT_ID);
    expect(ROOT_AGENT_DEFINITION.handoffTargets).toEqual([]);
    expect(LOCAL_AGENT_CAPABILITIES).toContain('dynamicTools');
    expect(LOCAL_AGENT_CAPABILITIES).not.toContain('handoffs');
  });

  it('binds graph versions to a sorted fixed tool catalog', () => {
    const left = tool('browser.open', 'open_browser');
    const right = tool('computer.observe', 'observe_computer');

    expect(graphVersion([left, right], 'gpt-test')).toBe(
      graphVersion([right, left], 'gpt-test'),
    );
    expect(graphVersion([left], 'gpt-test')).not.toBe(
      graphVersion([right], 'gpt-test'),
    );
  });

  it('preserves graph identity across the host-to-worker schema boundary', () => {
    // The host appends completion metadata; Zod emits it in schema order.
    const finish = { ...tool('lesson.finish', 'lesson_finish'), completionRequired: true };
    const version = graphVersion([finish], 'gpt-test');
    const parsed = LocalAgentHostMessageSchema.parse(JSON.parse(JSON.stringify({
      kind: 'turn.start', requestId: randomUUID(), threadId: randomUUID(),
      turnId: randomUUID(), agentId: LOCAL_AGENT_ROOT_ID, sequence: 1,
      graphVersion: version, agentTurnId: randomUUID(), request: 'Explain the lesson.',
      requiredInitialTool: null, model: 'gpt-test', maxTurns: 10,
      toolCatalogDigest: digest, tools: [finish],
    })));

    if (parsed.kind !== 'turn.start') throw new Error('missing turn start');
    expect(graphVersion(parsed.tools, parsed.model)).toBe(parsed.graphVersion);
    expect(graphVersion([{ ...finish, completionRequired: false }], parsed.model))
      .not.toBe(version);
    expect(graphVersion([{ ...finish, inputSchema: { type: 'string' } }], parsed.model))
      .not.toBe(version);
  });

  it('publishes the requested initial context tool choice', () => {
    expect(modelSettings('observe_context')).toMatchObject({
      toolChoice: 'observe_context',
    });
    expect(modelSettings()).toMatchObject({ toolChoice: 'auto' });
  });

  it('rejects a required initial tool outside the frozen catalog', async () => {
    const factory = new AgentGraphFactory({ create: vi.fn() } as never);

    await expect(factory.create({
      agentTurnId: randomUUID(),
      graphVersion: graphVersion([], 'gpt-test'),
      model: 'gpt-test',
      requiredInitialTool: {
        modelName: 'observe_context',
        arguments: { operation: 'observe', scope: 'auto' },
      },
      taskId: randomUUID(),
      toolCatalogDigest: digest,
      tools: [],
    }, {} as never)).rejects.toThrow('required_initial_tool_unavailable');
  });

  it('rejects unknown host message fields and wrong protocol versions', () => {
    const valid = {
      kind: 'runtime.initialize',
      requestId: randomUUID(),
      apiBaseUrl: 'https://api.example.com',
      requiredCapabilities: ['sessions'],
      expected: {
        protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION,
        protocolDigest: LOCAL_AGENT_PROTOCOL_DIGEST,
        sdkVersion: LOCAL_AGENT_SDK_VERSION,
        graphVersion: digest,
        capabilities: [...LOCAL_AGENT_CAPABILITIES],
      },
    };

    expect(LocalAgentHostMessageSchema.safeParse(valid).success).toBe(true);
    expect(LocalAgentHostMessageSchema.safeParse({ ...valid, credential: 'secret' }).success).toBe(false);
    expect(LocalAgentHostMessageSchema.safeParse({
      ...valid,
      expected: { ...valid.expected, protocolVersion: 2 },
    }).success).toBe(false);
  });

  it('rejects capability labels the bundled runtime does not implement', () => {
    const parsed = LocalRuntimeCapabilitiesSchema.safeParse({
      protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION,
      protocolDigest: LOCAL_AGENT_PROTOCOL_DIGEST,
      sdkVersion: LOCAL_AGENT_SDK_VERSION,
      graphVersion: digest,
      capabilities: [...LOCAL_AGENT_CAPABILITIES, 'mcp'],
    });

    expect(parsed.success).toBe(false);
  });

  it('preserves assistant delta whitespace across the process protocol', () => {
    const event = {
      kind: 'turn.event',
      requestId: randomUUID(),
      threadId: randomUUID(),
      turnId: randomUUID(),
      agentId: LOCAL_AGENT_ROOT_ID,
      parentAgentId: null,
      delegationId: null,
      graphVersion: digest,
      sequence: 1,
      event: 'assistant_delta',
      summary: ' gửi bài tập ',
      data: null,
    } as const;

    const parsed = LocalAgentChildMessageSchema.parse(event);
    if (parsed.kind !== 'turn.event') throw new Error('missing turn event');
    expect(parsed.summary).toBe(' gửi bài tập ');
    expect(
      LocalAgentChildMessageSchema.safeParse({ ...event, summary: ' ' })
        .success,
    ).toBe(true);
  });

  it('admits bounded model-request diagnostics across the process protocol', () => {
    const parsed = LocalAgentChildMessageSchema.parse({
      kind: 'turn.event',
      requestId: randomUUID(),
      threadId: randomUUID(),
      turnId: randomUUID(),
      agentId: LOCAL_AGENT_ROOT_ID,
      parentAgentId: null,
      delegationId: null,
      graphVersion: digest,
      sequence: 1,
      event: 'model_request_rejected',
      summary: 'The model request was rejected before inference.',
      data: {
        clientRequestId: randomUUID(),
        serverRequestId: randomUUID(),
        status: 400,
      },
    });

    expect(parsed).toMatchObject({
      event: 'model_request_rejected',
      data: { status: 400 },
    });
  });
});
