import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ToolSurfaceFactory } from '../../../services/agent-runtime/src/tool-adapter';

import { createCuaSemanticToolDefinitions } from './cua-semantic-agent-tools';
import { RuntimeToolRegistry } from './runtime-tool-registry';

const registry = new RuntimeToolRegistry();
registry.register(createCuaSemanticToolDefinitions({
  semanticAvailable: () => true,
  browserPrepareAvailable: () => true,
}));

const commands = [
  ['control_surface', { kind: 'click_element', ref: 'e1', button: 'left', count: 1 }],
  ['control_surface', { kind: 'type_text', ref: 'e1', text: 'Example', replace: false }],
  ['control_surface', { kind: 'press_key', ref: null, key: 'Tab', modifiers: [] }],
  ['control_surface', { kind: 'scroll', ref: null, direction: 'down', amount: 1 }],
  ['control_desktop', { kind: 'click', x: 500, y: 500, button: 'left', count: 1 }],
  ['control_desktop', { kind: 'drag', fromX: 100, fromY: 100, toX: 500, toY: 500, durationMs: 500, button: 'left' }],
  ['control_desktop', { kind: 'type_text', text: 'Example' }],
  ['control_desktop', { kind: 'paste_table', rows: [['Example']] }],
  ['control_desktop', { kind: 'keypress', keys: ['Tab'] }],
  ['control_desktop', { kind: 'scroll', x: 500, y: 500, direction: 'down', amount: 1 }],
] as const;

describe('shared control tools across the SDK boundary', () => {
  it.each([undefined, null, [], 'click_element', {}, { kind: 1 }, { kind: 'launch' }])(
    'rejects an unresolved or unadvertised nested command: %j', (command) => {
      const catalog = registry.freeze();
      const spec = catalog.tools.find((entry) => entry.modelName === 'control_surface')!;
      const surface = new ToolSurfaceFactory().create([spec], catalog.digest);
      expect(() => surface.resolve({ rawItem: {
        type: 'function_call', callId: 'invalid-call', name: spec.modelName,
        arguments: JSON.stringify({ command }),
      } } as never)).toThrow('unresolved_tool_operation');
    },
  );

  it.each(commands)('resolves the real %s command %j before checkpointing', (modelName, command) => {
    const catalog = registry.freeze({ taskId: randomUUID() });
    const spec = catalog.tools.find((entry) => entry.modelName === modelName)!;
    const surface = new ToolSurfaceFactory().create([spec], catalog.digest);
    const args = { observationId: randomUUID(), description: 'Navigate the lesson', target: null, command };
    const argumentsJson = JSON.stringify(args);
    const definition = registry.list().find((entry) => entry.modelName === modelName)!;
    // Use the production input parser and catalog, not a simplified SDK fixture.
    expect(() => definition.parse(argumentsJson)).not.toThrow();
    const pending = surface.resolve({ rawItem: {
      type: 'function_call', callId: 'control-call', name: modelName, arguments: argumentsJson,
    } } as never);
    expect(pending).toMatchObject({ toolId: spec.toolId, operation: command.kind, arguments: args });
    expect(pending.idempotencyDigest).toMatch(/^[a-f0-9]{64}$/u);
  });
});
