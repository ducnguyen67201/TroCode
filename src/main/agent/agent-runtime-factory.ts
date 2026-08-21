import type { ExecutableAgentTaskContract } from '../../shared/contracts';

import type { AgentRuntime } from './agent-runtime';

export interface AgentRuntimeFactoryOptions {
  openaiAgents: AgentRuntime;
}

/** Host-selected runtime routing. Model output is never an input to this factory. */
export class AgentRuntimeFactory {
  private readonly runtimes: ReadonlyMap<
    ExecutableAgentTaskContract['runtimeKind'],
    AgentRuntime
  >;

  constructor(options: AgentRuntimeFactoryOptions) {
    const runtimes = new Map<
      ExecutableAgentTaskContract['runtimeKind'],
      AgentRuntime
    >();
    runtimes.set('openai_agents', options.openaiAgents);
    this.runtimes = runtimes;
  }

  forContract(contract: ExecutableAgentTaskContract): AgentRuntime {
    const runtime = this.runtimes.get(contract.runtimeKind);
    if (!runtime || runtime.kind !== contract.runtimeKind) {
      throw new Error(`${contract.runtimeKind} is not available for this task.`);
    }
    return runtime;
  }
}

export class StaticAgentRuntimeFactory {
  constructor(private readonly runtime: AgentRuntime) {}

  forContract(): AgentRuntime {
    return this.runtime;
  }
}
