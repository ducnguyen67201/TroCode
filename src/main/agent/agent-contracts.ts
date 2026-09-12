import type { StrictJsonObjectSchema } from '../../shared/agent-tool-contracts';
import type { ProposedAction, RuntimeToolId } from '../../shared/contracts';

import type { DesktopObservation } from './execution-contracts';

export interface ModelToolSpec {
  type: 'function';
  name: string;
  description: string;
  strict: true;
  parameters: StrictJsonObjectSchema;
}

export type { StrictJsonObjectSchema } from '../../shared/agent-tool-contracts';

export interface AgentToolCall {
  arguments: string;
  callId: string;
  name: string;
}

export type AgentToolOutputContent =
  | { type: 'input_text'; text: string }
  | {
      type: 'input_image';
      image_url: string;
      detail: 'original';
    };

export interface AgentToolOutput {
  callId: string;
  output: string | AgentToolOutputContent[];
}

export interface ToolExecutionResult {
  status: 'confirmed' | 'unknown' | 'failed' | 'denied' | 'not_executed';
  summary: string;
  /** A returned native input needs observation; this never permits replay. */
  recovery?: 'observe';
  data?: Record<string, unknown>;
  observation?: DesktopObservation;
  imageDataUrl?: string;
}

export interface ResolvedToolInvocation<TInput = unknown> {
  action?: ProposedAction;
  callId: string;
  driverCatalogDigest?: string | null;
  input: TInput;
  kind:
    | 'observe'
    | 'surface'
    | 'desktop'
    | 'direct'
    | 'guidance'
    | 'interaction';
  modelName: string;
  operation: string;
  toolId: RuntimeToolId;
}
