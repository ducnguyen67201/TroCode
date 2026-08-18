import type { AgentTaskContract } from '../../shared/contracts';

import type { AgentRuntime } from './agent-runtime';

export interface AgentRuntimeFactoryOptions {
  codexAppServer?: AgentRuntime;
  openaiAgents: AgentRuntime;
}

/** Host-selected runtime routing. Model output is never an input to this factory. */
export class AgentRuntimeFactory {
  private readonly runtimes: ReadonlyMap<AgentTaskContract['runtimeKind'], AgentRuntime>;

  constructor(options: AgentRuntimeFactoryOptions) {
    const runtimes = new Map<AgentTaskContract['runtimeKind'], AgentRuntime>();
    runtimes.set('openai_agents', options.openaiAgents);
    if (options.codexAppServer) {
      runtimes.set('codex_app_server', options.codexAppServer);
    }
    this.runtimes = runtimes;
  }

  forContract(contract: AgentTaskContract): AgentRuntime {
    const runtime = this.runtimes.get(contract.runtimeKind);
    if (!runtime || runtime.kind !== contract.runtimeKind) {
      throw new Error(`${contract.runtimeKind} is not available for this task.`);
    }
    if (
      contract.runtimeKind === 'codex_app_server' &&
      (contract.executionProfile !== 'workspace' || !contract.workspace)
    ) {
      throw new Error('Codex runtime requires a trusted Workspace task contract.');
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
