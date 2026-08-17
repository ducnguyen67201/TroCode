import type { RuntimeToolId } from '../../shared/contracts';

import type {
  ResolvedToolInvocation,
  ToolExecutionResult,
} from './agent-contracts';

export interface RuntimeToolDispatchContext {
  signal: AbortSignal;
  taskId: string;
}

export interface RuntimeToolExecutionAdapter {
  execute(
    invocation: ResolvedToolInvocation,
    context: RuntimeToolDispatchContext,
  ): Promise<ToolExecutionResult>;
  id: RuntimeToolId;
}

export class RuntimeToolDispatcher {
  private readonly adapters = new Map<
    RuntimeToolId,
    RuntimeToolExecutionAdapter
  >();

  constructor(adapters: readonly RuntimeToolExecutionAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.id)) {
        throw new Error(
          'Runtime executor ' + adapter.id + ' is already registered.',
        );
      }
      this.adapters.set(adapter.id, adapter);
    }
  }

  async dispatch(
    invocation: ResolvedToolInvocation,
    context: RuntimeToolDispatchContext,
  ): Promise<ToolExecutionResult> {
    if (context.signal.aborted) {
      const error = new Error('Tool dispatch was cancelled.');
      error.name = 'AbortError';
      throw error;
    }
    const adapter = this.adapters.get(invocation.toolId);
    if (!adapter) {
      throw new Error(
        'Runtime tool ' + invocation.toolId + ' is unavailable.',
      );
    }
    return adapter.execute(invocation, context);
  }
}
