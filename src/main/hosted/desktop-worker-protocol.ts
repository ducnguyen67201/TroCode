import { createHash } from 'node:crypto';

import type { RuntimeToolId } from '../../shared/contracts';
import type { RuntimeToolRegistry } from '../agent/runtime-tool-registry';

const HOSTED_TOOL_DEFINITIONS: ReadonlyArray<{
  defaultEffectKind: 'none' | 'operation_specific';
  operations: readonly string[];
  toolId: RuntimeToolId;
}> = [
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
];

function canonical(value: typeof HOSTED_TOOL_DEFINITIONS): string {
  return JSON.stringify(value, Object.keys(value[0] ?? {}).sort());
}

export const HOSTED_AGENT_TOOL_SCHEMA_DIGEST = createHash('sha256')
  .update(canonical(HOSTED_TOOL_DEFINITIONS))
  .digest('hex');

export function hostedToolMetadata(
  toolId: RuntimeToolId,
  operation: string,
): { defaultEffectKind: 'none' | 'operation_specific' } | null {
  const definition = HOSTED_TOOL_DEFINITIONS.find(
    (candidate) =>
      candidate.toolId === toolId && candidate.operations.includes(operation),
  );
  return definition ? { defaultEffectKind: definition.defaultEffectKind } : null;
}

export function desktopWorkerCapabilities(
  registry: Pick<RuntimeToolRegistry, 'list'>,
): {
  protocolVersion: 2;
  schemaDigest: string;
  tools: Array<{ operations: string[]; toolId: RuntimeToolId }>;
} {
  const local = new Map(
    registry.list().map((definition) => [
      definition.id,
      new Set(definition.operations),
    ]),
  );
  return {
    protocolVersion: 2,
    schemaDigest: HOSTED_AGENT_TOOL_SCHEMA_DIGEST,
    tools: HOSTED_TOOL_DEFINITIONS.flatMap((definition) => {
      const supported = local.get(definition.toolId);
      const operations = definition.operations.filter((operation) =>
        supported?.has(operation),
      );
      return operations.length > 0
        ? [{ toolId: definition.toolId, operations: [...operations] }]
        : [];
    }),
  };
}
