import { CuaDriver } from '@trycua/cua-driver';
import { describe, expect, it } from 'vitest';

import { ToolSurfaceFactory } from '../../../services/agent-runtime/src/tool-adapter';
import {
  createCuaDriverCatalog,
} from '../cua/cua-semantic-contracts';

import { createCuaDriverToolDefinitions } from './cua-driver-agent-tools';
import { RuntimeToolRegistry } from './runtime-tool-registry';

const metadata = {
  driverVersion: '0.19.3',
  contractVersion: '1',
  toolsListSchemaVersion: '1',
  capabilityVersion: '2026-08',
};

const catalog = createCuaDriverCatalog(metadata, {
  capability_version: '2026-08',
  schema_version: '1',
  tools: [{
    name: 'new_driver_ability',
    description: 'Exercise a newly discovered driver ability.',
    capabilities: ['future.action'],
    inputSchema: {
      type: 'object',
      properties: {
        requiredValue: { type: 'string' },
        optionalValue: { type: 'string' },
      },
      required: ['requiredValue'],
    },
  }],
});

const nullableObjectCatalog = createCuaDriverCatalog(metadata, {
  capability_version: '2026-08',
  schema_version: '1',
  tools: [
    {
      name: 'start_session',
      description: 'Start a CUA session.',
      capabilities: ['future.start'],
      inputSchema: {
        type: 'object',
        properties: {
          cursor_theme: {
            anyOf: [
              {
                type: ['object', 'null'],
                properties: {
                  reduced_motion: {
                    type: 'string',
                    enum: ['auto', 'on', 'off'],
                  },
                  theme_id: { type: 'string' },
                },
                required: ['theme_id'],
              },
              { type: 'null' },
            ],
          },
        },
        required: [],
      },
    },
    {
      name: 'verify_state',
      description: 'Verify the observed CUA state.',
      capabilities: ['state.verify'],
      inputSchema: {
        type: 'object',
        properties: {
          expect: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                element: {
                  anyOf: [
                    {
                      type: ['object', 'null'],
                      properties: {
                        enabled: { type: ['boolean', 'null'] },
                        selector: {
                          type: 'object',
                          properties: {
                            label_contains: { type: 'string' },
                            role: { type: 'string' },
                          },
                          required: [],
                        },
                      },
                      required: ['selector'],
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
      },
    },
  ],
});

describe('dynamic CUA agent tools', () => {
  it('normalizes every tool exposed by the installed CUA driver', async () => {
    const driver = CuaDriver.create(undefined) as ReturnType<
      typeof CuaDriver.create
    > & { uniffiDestroy(): void };
    try {
      const driverCatalog = createCuaDriverCatalog(
        await driver.metadata(),
        JSON.parse(await driver.listToolsJson()),
      );
      const definitions = createCuaDriverToolDefinitions(driverCatalog);
      const registry = new RuntimeToolRegistry(definitions);
      const frozen = registry.freeze({
        taskId: '11111111-1111-4111-8111-111111111111',
      });

      expect(definitions).toHaveLength(driverCatalog.tools.length);
      const toolIds = definitions.map((definition) => definition.id);
      expect(toolIds).toContain(
        'cua.verify_state',
      );
      expect(toolIds).not.toContain(
        'cua.start_session',
      );
      expect(toolIds).not.toContain('cua.get_config');
      expect(toolIds).not.toContain('cua.set_config');
      expect(() =>
        new ToolSurfaceFactory().create(
          frozen.tools.map((tool) => ({
            toolId: tool.toolId,
            modelName: tool.modelName,
            description: tool.description,
            inputSchema: tool.inputSchema,
            operations: tool.operations,
            driverCatalogDigest: tool.driverCatalogDigest,
          })),
          frozen.digest,
        ),
      ).not.toThrow();
    } finally {
      await driver.shutdown();
      driver.uniffiDestroy();
    }
  });

  it('registers a newly discovered ability without changing a static contract', () => {
    const [definition] = createCuaDriverToolDefinitions(catalog);
    if (!definition) throw new Error('missing dynamic definition');
    const registry = new RuntimeToolRegistry([definition]);
    const frozen = registry.freeze({ taskId: '11111111-1111-4111-8111-111111111111' });

    expect(frozen.tools[0]).toMatchObject({
      toolId: 'cua.new_driver_ability',
      driverCatalogDigest: catalog.driverCatalogDigest,
    });
    expect(frozen.tools[0]?.inputSchema.required).toEqual([
      'requiredValue',
      'optionalValue',
    ]);
    expect(frozen.tools[0]?.inputSchema.properties.optionalValue).toEqual({
      anyOf: [{ type: 'string' }, { type: 'null' }],
    });
  });

  it('registers the admitted provider schema without rewriting it again', () => {
    const [definition] = createCuaDriverToolDefinitions(catalog);
    if (!definition) throw new Error('missing dynamic definition');

    expect(definition.parameters).toBe(catalog.tools[0]?.inputSchema);
  });

  it('removes SDK-required null placeholders before driver dispatch', () => {
    const [definition] = createCuaDriverToolDefinitions(catalog);
    if (!definition) throw new Error('missing dynamic definition');

    expect(definition.parse(JSON.stringify({
      requiredValue: 'present',
      optionalValue: null,
    }))).toEqual({ requiredValue: 'present' });
  });

  it('uses explicitly adapted nullable object branches from a legacy driver', () => {
    const definitions = createCuaDriverToolDefinitions(nullableObjectCatalog);
    const startSession = definitions.find((definition) => definition.id === 'cua.start_session');
    const verifyState = definitions.find((definition) => definition.id === 'cua.verify_state');
    if (!startSession || !verifyState) throw new Error('missing nullable object definitions');

    const cursorTheme = (
      startSession.parameters.properties.cursor_theme as {
        anyOf: Array<{ properties?: Record<string, unknown>; required?: string[] }>;
      }
    ).anyOf[0];
    expect(cursorTheme?.required).toEqual(['reduced_motion', 'theme_id']);

    const expectItems = (
      verifyState.parameters.properties.expect as {
        items: { properties: Record<string, unknown> };
      }
    ).items;
    const element = (
      expectItems.properties.element as {
        anyOf: Array<{ properties?: Record<string, unknown>; required?: string[] }>;
      }
    ).anyOf[0];
    expect(element?.required).toEqual(['enabled', 'selector']);
    expect(
      (element?.properties?.selector as { required?: string[] }).required,
    ).toEqual(['label_contains', 'role']);
  });

  it('removes nested null placeholders from nullable CUA object branches', () => {
    const definitions = createCuaDriverToolDefinitions(nullableObjectCatalog);
    const startSession = definitions.find((definition) => definition.id === 'cua.start_session');
    const verifyState = definitions.find((definition) => definition.id === 'cua.verify_state');
    if (!startSession || !verifyState) throw new Error('missing nullable object definitions');

    expect(startSession.parse(JSON.stringify({
      cursor_theme: { reduced_motion: null, theme_id: 'amber' },
    }))).toEqual({ cursor_theme: { theme_id: 'amber' } });
    expect(verifyState.parse(JSON.stringify({
      expect: [{
        element: {
          enabled: null,
          selector: { label_contains: 'Save', role: null },
        },
      }],
    }))).toEqual({
      expect: [{
        element: {
          selector: { label_contains: 'Save' },
        },
      }],
    });
  });
});


it('normalizes a native accessibility read as observation and never trusts a model-supplied kind', () => {
  const base = catalog.tools[0]!;
  const definitions = createCuaDriverToolDefinitions({ ...catalog, tools: [{ ...base, name: 'get_accessibility_tree', modelName: 'get_accessibility_tree' }, { ...base, name: 'press_key', modelName: 'press_key' }] });
  const call = { callId: 'call', name: 'get_accessibility_tree', arguments: '{}' };
  expect(definitions[0]!.normalize({ pid: 9992 }, call, {} as never).kind).toBe('observe');
  expect(definitions[1]!.normalize({ kind: 'observe' }, call, {} as never).kind).toBe('direct');
});
