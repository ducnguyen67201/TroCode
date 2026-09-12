import { RunContext, type FunctionTool } from '@openai/agents';
import { describe, expect, it, vi } from 'vitest';

import type { LocalAgentRunContext } from '../src/host-backed-session.js';

import type { LocalRuntimeToolSpec } from '../src/protocol.js';
import { ToolSurfaceFactory } from '../src/tool-adapter.js';

const digest = 'a'.repeat(64);

function toolSpec(
  toolId: string,
  inputSchema: LocalRuntimeToolSpec['inputSchema'],
): LocalRuntimeToolSpec {
  return {
    toolId: `cua.${toolId}`,
    modelName: toolId,
    description: `Exercise the ${toolId} CUA capability.`,
    inputSchema,
    operations: [toolId],
    driverCatalogDigest: digest,
  };
}

describe('SDK tool adapter', () => {
  it.each(['kind', 'operation', 'action'])('preserves the top-level %s discriminator', (field) => {
    const spec = toolSpec('filesystem', {
      type: 'object', additionalProperties: false,
      properties: { [field]: { type: 'string', enum: ['read', 'write'] } },
      required: [field],
    });
    const surface = new ToolSurfaceFactory().create([{ ...spec, operations: ['read', 'write'] }], digest);
    const resolve = (input: Record<string, unknown>) => surface.resolve({ rawItem: {
      type: 'function_call', callId: 'operation-call', name: spec.modelName,
      arguments: JSON.stringify(input),
    } } as never);
    expect(resolve({ [field]: 'read' }).operation).toBe('read');
    // A nested value must not override an invalid explicit top-level operation.
    expect(() => resolve({ [field]: 'unknown', command: { kind: 'read' } }))
      .toThrow('unresolved_tool_operation');
  });

  it('normalizes only the first interruption to the required exact call', () => {
    const observeContext: LocalRuntimeToolSpec = {
      toolId: 'computer.observe',
      modelName: 'observe_context',
      description: 'Observe or inspect the current visible context.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          operation: {
            type: 'string',
            enum: ['observe', 'inspect_surface_region'],
          },
          scope: {
            anyOf: [
              { type: 'string', enum: ['auto', 'desktop'] },
              { type: 'null' },
            ],
          },
        },
        required: ['operation', 'scope'],
      },
      operations: ['observe', 'inspect_surface_region'],
      driverCatalogDigest: digest,
    };
    const requiredInitialTool = {
      modelName: 'observe_context',
      arguments: { operation: 'observe', scope: 'auto' },
    };
    const surface = new ToolSurfaceFactory().create(
      [observeContext],
      digest,
      requiredInitialTool,
    );

    const first = surface.resolve({
      rawItem: {
        type: 'function_call',
        callId: 'call-1',
        name: 'observe_context',
        arguments: 'model arguments are ignored for the required call',
      },
    } as never);
    const second = surface.resolve({
      rawItem: {
        type: 'function_call',
        callId: 'call-2',
        name: 'observe_context',
        arguments: JSON.stringify({ operation: 'observe', scope: 'desktop' }),
      },
    } as never);

    expect(first).toMatchObject({
      arguments: requiredInitialTool.arguments,
      operation: 'observe',
    });
    expect(second).toMatchObject({
      arguments: { operation: 'observe', scope: 'desktop' },
      operation: 'observe',
    });
  });

  it('constructs strict SDK tools from normalized nullable CUA object branches', () => {
    const startSession = toolSpec('start_session', {
      type: 'object',
      additionalProperties: false,
      properties: {
        cursor_theme: {
          anyOf: [
            {
              type: ['object', 'null'],
              additionalProperties: false,
              properties: {
                reduced_motion: {
                  anyOf: [
                    { type: 'string', enum: ['auto', 'on', 'off'] },
                    { type: 'null' },
                  ],
                },
                theme_id: { type: 'string' },
              },
              required: ['reduced_motion', 'theme_id'],
            },
            { type: 'null' },
          ],
        },
      },
      required: ['cursor_theme'],
    });
    const verifyState = toolSpec('verify_state', {
      type: 'object',
      additionalProperties: false,
      properties: {
        expect: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              element: {
                anyOf: [
                  {
                    type: ['object', 'null'],
                    additionalProperties: false,
                    properties: {
                      enabled: { type: ['boolean', 'null'] },
                      selector: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          label_contains: {
                            anyOf: [{ type: 'string' }, { type: 'null' }],
                          },
                          role: {
                            anyOf: [{ type: 'string' }, { type: 'null' }],
                          },
                        },
                        required: ['label_contains', 'role'],
                      },
                    },
                    required: ['enabled', 'selector'],
                  },
                  { type: 'null' },
                ],
              },
            },
            required: ['element'],
          },
        },
      },
      required: ['expect'],
    });

    expect(() =>
      new ToolSurfaceFactory().create(
        [startSession, verifyState],
        digest,
      ),
    ).not.toThrow();
  });

  it('rejects schemas that the Agents SDK would rewrite', () => {
    const optional = toolSpec('optional_value', {
      type: 'object',
      additionalProperties: false,
      properties: { value: { type: 'string' } },
      required: [],
    });

    const admission = new ToolSurfaceFactory().inspect([optional], digest);

    expect(admission.acceptedModelNames).toEqual([]);
    expect(admission.rejected[0]).toMatchObject({
      modelName: 'optional_value',
      toolId: 'cua.optional_value',
    });
    expect(admission.rejected[0]?.message).toContain('rewrote model schema');
  });
});

it('accepts the two strict classroom schemas without adding a send tool', () => {
  const prepare: LocalRuntimeToolSpec = {
    toolId: 'classroom.broadcast',
    modelName: 'prepare_classroom_broadcast',
    description: 'Prepare a teacher-reviewed classroom draft.',
    operations: ['prepare'],
    driverCatalogDigest: null,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['assignment', 'exercise', 'open_url'] },
        studentAction: {
          type: ['string', 'null'],
          enum: ['open', 'explain', null],
        },
        assignmentNumber: {
          type: ['integer', 'null'],
          minimum: 1,
          maximum: 50,
        },
        assignmentTitle: { type: ['string', 'null'], maxLength: 240 },
        assignmentRunId: { type: ['string', 'null'], format: 'uuid' },
        instruction: { type: ['string', 'null'], maxLength: 4000 },
        url: { type: ['string', 'null'], maxLength: 2000 },
      },
      required: [
        'kind',
        'studentAction',
        'assignmentNumber',
        'assignmentTitle',
        'assignmentRunId',
        'instruction',
        'url',
      ],
    },
  };
  const list: LocalRuntimeToolSpec = {
    toolId: 'classroom.assignments',
    modelName: 'list_session_assignments',
    description: 'Read the bound session playlist.',
    operations: ['list'],
    driverCatalogDigest: null,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
  };
  const admission = new ToolSurfaceFactory().inspect([list, prepare], digest);
  expect(admission.rejected).toEqual([]);
  expect(admission.acceptedModelNames).toEqual([
    'list_session_assignments',
    'prepare_classroom_broadcast',
  ]);
});


it('returns a host-authorized observation recovery instruction without executing the native action again', async () => {
  const spec = toolSpec('press_key', { type: 'object', properties: {}, required: [], additionalProperties: false });
  const surface = new ToolSurfaceFactory().create([spec], digest);
  const call = surface.resolve({ rawItem: { type: 'function_call', callId: 'input-1', name: spec.modelName, arguments: '{}' } } as never);
  surface.markCheckpointed(call);
  const request = vi.fn(async () => ({ kind: 'tool.execute.result', result: { status: 'unknown', recovery: 'observe', summary: 'Enter was not verified.', data: null, imageDataUrl: null } }));
  const context = new RunContext<LocalAgentRunContext>({
    bridge: { request, nextSequence: () => 1 } as never,
    identity: { threadId: 'thread', turnId: 'turn', agentId: 'agent', graphVersion: digest, parentAgentId: null, delegationId: null },
    signal: new AbortController().signal,
  });
  const sdkTool = surface.tools[0] as FunctionTool<LocalAgentRunContext, never, unknown>;
  const output = await sdkTool.invoke(context, '{}', { toolCall: { callId: call.callId } } as never);
  expect(JSON.parse(String(output))).toMatchObject({ status: 'unknown', recovery: expect.stringContaining('Do not replay') });
  expect(request).toHaveBeenCalledOnce();
});
