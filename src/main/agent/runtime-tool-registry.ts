import type { ProposedAction, RuntimeToolId } from '../../shared/contracts';

export interface RuntimeToolDefinition {
  id: RuntimeToolId;
  description: string;
  operations: readonly string[];
  available?: () => boolean;
}

const DEFAULT_TOOLS: readonly RuntimeToolDefinition[] = [
  {
    id: 'browser.navigate',
    description: 'Open a public HTTPS destination in the user\'s browser.',
    operations: ['open_url'],
  },
  {
    id: 'desktop.control',
    description: 'Observe and control visible desktop applications.',
    operations: [
      'click',
      'delete',
      'download',
      'drag',
      'install',
      'keypress',
      'login',
      'point',
      'purchase',
      'scroll',
      'send',
      'submit',
      'type_text',
      'upload',
    ],
  },
  {
    id: 'task.guidance',
    description: 'Answer or guide using grounded visible context.',
    operations: ['answer', 'guide'],
  },
] as const;

export function toolIdentityForAction(action: ProposedAction): {
  toolId: RuntimeToolId;
  operation: string;
} {
  if (action.toolId && action.operation) {
    return { toolId: action.toolId, operation: action.operation };
  }
  const command = action.parameters?.command;
  const operation = typeof command === 'string' ? command : action.action;
  if (action.action === 'open_url' || operation === 'open_url') {
    return { toolId: 'browser.navigate', operation: 'open_url' };
  }
  if (action.action === 'answer' || action.action === 'guide') {
    return { toolId: 'task.guidance', operation: action.action };
  }
  return { toolId: 'desktop.control', operation };
}

export class RuntimeToolRegistry {
  private readonly tools = new Map<RuntimeToolId, RuntimeToolDefinition>();

  constructor(definitions: readonly RuntimeToolDefinition[] = DEFAULT_TOOLS) {
    for (const definition of definitions) {
      if (this.tools.has(definition.id)) {
        throw new Error(`Runtime tool ${definition.id} is already registered.`);
      }
      this.tools.set(definition.id, definition);
    }
  }

  list(): RuntimeToolDefinition[] {
    return [...this.tools.values()].filter(
      (definition) => definition.available?.() !== false,
    );
  }

  supports(action: ProposedAction): boolean {
    const identity = toolIdentityForAction(action);
    return Boolean(
      this.list()
        .find((definition) => definition.id === identity.toolId)
        ?.operations.includes(identity.operation),
    );
  }
}

export const defaultRuntimeToolRegistry = new RuntimeToolRegistry();
