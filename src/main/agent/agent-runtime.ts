import type {
  ExecutableAgentTaskContract,
  ProposedAction,
  TaskSnapshot,
} from '../../shared/contracts';

import type {
  AgentToolCall,
  AgentToolOutput,
  ModelToolSpec,
} from './agent-contracts';
import type { DesktopObservation } from './execution-contracts';

export interface RuntimeInputRequest {
  choices?: string[];
  prompt: string;
}

export interface RuntimeApprovalRequest {
  action: ProposedAction;
  consequence: string;
  prompt: string;
}

export interface AgentRuntimeCallbacks {
  billableUserTurnIds(): Promise<string[]> | string[];
  beforeModel(): Promise<string[]> | string[];
  executeTool(call: AgentToolCall): Promise<AgentToolOutput['output']>;
  needsApproval?(call: AgentToolCall): Promise<boolean> | boolean;
  resolveToolApproval?(call: AgentToolCall): Promise<boolean>;
  requestApproval?(request: RuntimeApprovalRequest): Promise<boolean>;
  requestInput?(request: RuntimeInputRequest): Promise<string>;
  setRuntimeResumeMetadata?(metadata: TaskSnapshot['runtimeResume']): void;
}

export interface AgentRuntimeActivity {
  kind:
    | 'run_started'
    | 'status'
    | 'text_delta'
    | 'tool_started'
    | 'tool_completed'
    | 'plan_updated'
    | 'approval_required'
    | 'run_completed'
    | 'run_failed';
  summary?: string;
  textDelta?: string;
  tool?: {
    name: string;
    status: 'running' | 'completed' | 'failed';
  };
  plan?: Array<{
    step: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}

export interface AgentRuntimeStart {
  callbacks: AgentRuntimeCallbacks;
  contract: ExecutableAgentTaskContract;
  maxTurns: number;
  emitActivity?(activity: AgentRuntimeActivity): void;
  initialObservation?: DesktopObservation;
  request: string;
  resumeMetadata?: TaskSnapshot['runtimeResume'];
  signal?: AbortSignal;
  taskId: string;
  tools: readonly ModelToolSpec[];
}

/**
 * Provider-neutral boundary between task supervision and a model-owned agent loop.
 * Implementations own conversation continuity and repeated model/tool turns.
 */
export interface AgentRuntime {
  readonly kind: ExecutableAgentTaskContract['runtimeKind'];
  continueTask(
    taskId: string,
    instruction: string,
    signal?: AbortSignal,
  ): Promise<string>;
  end(taskId: string): Promise<void>;
  runTask(input: AgentRuntimeStart): Promise<string>;
  steer?(taskId: string, instruction: string): Promise<'delivered' | 'queued'>;
}
