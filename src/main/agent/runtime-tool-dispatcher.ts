import type { ProposedAction, RuntimeToolId } from '../../shared/contracts';

import type { DesktopActionOutcome } from './execution-contracts';

export interface RuntimeToolDispatchContext {
  signal: AbortSignal;
  taskId: string;
}

export interface RuntimeToolExecutionAdapter<TInput = unknown> {
  id: RuntimeToolId;
  execute(
    action: ProposedAction,
    input: TInput,
    context: RuntimeToolDispatchContext,
  ): Promise<DesktopActionOutcome>;
}

export class RuntimeToolDispatcher {
  private readonly adapters = new Map<
    RuntimeToolId,
    RuntimeToolExecutionAdapter
  >();

  constructor(adapters: readonly RuntimeToolExecutionAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.id)) {
        throw new Error(`Runtime executor ${adapter.id} is already registered.`);
      }
      this.adapters.set(adapter.id, adapter);
    }
  }

  async dispatch<TInput>(
    action: ProposedAction,
    input: TInput,
    context: RuntimeToolDispatchContext,
  ): Promise<DesktopActionOutcome> {
    const toolId = action.toolId;
    if (!toolId) {
      throw new Error('A normalized runtime action requires a tool ID.');
    }
    const adapter = this.adapters.get(toolId);
    if (!adapter) throw new Error(`Runtime tool ${toolId} is unavailable.`);
    return adapter.execute(action, input, context);
  }
}
