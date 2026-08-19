import type { ProposedAction, RuntimeToolId } from '../../shared/contracts';

import type { DesktopObservation } from './execution-contracts';

export interface ModelToolSpec {
  type: 'function';
  name: string;
  description: string;
  strict: true;
  parameters: StrictJsonObjectSchema;
}

export interface StrictJsonObjectSchema {
  type: 'object';
  additionalProperties: false;
  properties: Record<string, Record<string, unknown>>;
  required: string[];
}

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
  data?: Record<string, unknown>;
  observation?: DesktopObservation;
  imageDataUrl?: string;
}

export interface ResolvedToolInvocation<TInput = unknown> {
  action?: ProposedAction;
  callId: string;
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
