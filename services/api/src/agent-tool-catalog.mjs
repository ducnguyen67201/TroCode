import { createHash } from 'node:crypto';

import { RuntimeToolIdSchema } from './agent-runtime-contracts.mjs';

const TOOL_DEFINITIONS = Object.freeze([
  { toolId: 'application.launch', operations: ['launch'], defaultEffectKind: 'none' },
  { toolId: 'browser.navigate', operations: ['open_url'], defaultEffectKind: 'none' },
  { toolId: 'browser.dom', operations: ['observe', 'click', 'fill', 'press', 'scroll', 'read', 'assert'], defaultEffectKind: 'operation_specific' },
  { toolId: 'computer.control', operations: ['click_element', 'type_text', 'press_key', 'scroll'], defaultEffectKind: 'operation_specific' },
  { toolId: 'computer.observe', operations: ['observe', 'inspect_surface_region'], defaultEffectKind: 'none' },
  { toolId: 'desktop.control', operations: ['click', 'type_text', 'keypress', 'scroll', 'drag', 'paste_table'], defaultEffectKind: 'operation_specific' },
  { toolId: 'desktop.observe', operations: ['observe'], defaultEffectKind: 'none' },
  { toolId: 'task.interaction', operations: ['request'], defaultEffectKind: 'none' },
  { toolId: 'workspace.filesystem', operations: ['read_file', 'write_file'], defaultEffectKind: 'operation_specific' },
  { toolId: 'workspace.terminal', operations: ['run_command'], defaultEffectKind: 'operation_specific' },
]);

function canonical(value) {
  return JSON.stringify(value, Object.keys(value[0] ?? {}).sort());
}

export const AGENT_TOOL_SCHEMA_DIGEST = createHash('sha256')
  .update(canonical(TOOL_DEFINITIONS))
  .digest('hex');

export class AgentToolCatalog {
  constructor(definitions = TOOL_DEFINITIONS) {
    this.definitions = definitions.map((definition) => ({
      defaultEffectKind: definition.defaultEffectKind === 'none'
        ? 'none'
        : 'operation_specific',
      operations: [...new Set(definition.operations)].sort(),
      toolId: RuntimeToolIdSchema.parse(definition.toolId),
    }));
    this.byId = new Map(this.definitions.map((definition) => [definition.toolId, definition]));
  }

  advertise() {
    return {
      schemaDigest: AGENT_TOOL_SCHEMA_DIGEST,
      tools: this.definitions.map(({ operations, toolId }) => ({ operations, toolId })),
    };
  }

  resolve(toolId, operation) {
    const definition = this.byId.get(toolId);
    if (!definition || !definition.operations.includes(operation)) return null;
    return { ...definition, operation };
  }

  intersect(capabilities) {
    if (capabilities.schemaDigest !== AGENT_TOOL_SCHEMA_DIGEST) {
      throw new Error('Desktop worker schema digest does not match the backend tool graph.');
    }
    const advertised = new Map(capabilities.tools.map((tool) => [tool.toolId, new Set(tool.operations)]));
    return this.definitions.flatMap((definition) => {
      const operations = definition.operations.filter((operation) => advertised.get(definition.toolId)?.has(operation));
      return operations.length > 0 ? [{ ...definition, operations }] : [];
    });
  }
}
