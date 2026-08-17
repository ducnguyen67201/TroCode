import { z } from 'zod';

import type { ProposedAction, RuntimeToolId } from '../../shared/contracts';

const AgentOutputTextSchema = z
  .object({
    type: z.literal('output_text'),
    text: z.string().min(1).max(8_000),
  })
  .passthrough();

const AgentAssistantMessageSchema = z
  .object({
    type: z.literal('message'),
    role: z.literal('assistant'),
    content: z.array(z.unknown()).max(64),
  })
  .passthrough();

export const AgentFunctionCallSchema = z
  .object({
    type: z.literal('function_call'),
    name: z.string().trim().min(1).max(100),
    call_id: z.string().trim().min(1).max(500),
    arguments: z.string().min(2).max(200_000),
  })
  .passthrough()
  .superRefine((call, context) => {
    try {
      const value: unknown = JSON.parse(call.arguments);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        context.addIssue({
          code: 'custom',
          message: 'Function arguments must encode a JSON object.',
          path: ['arguments'],
        });
      }
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Function arguments must be valid JSON.',
        path: ['arguments'],
      });
    }
  });

export const AgentResponsesEnvelopeSchema = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    output: z.array(z.unknown()).max(128),
  })
  .passthrough();

export interface ModelToolSpec {
  type: 'function';
  name: string;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
}

export interface AgentToolCall {
  arguments: string;
  callId: string;
  name: string;
}

export type AgentResponseItem = Record<string, unknown>;

export type AgentTurn =
  | {
      kind: 'assistant_message';
      responseItems: AgentResponseItem[];
      text: string;
    }
  | {
      kind: 'tool_call';
      call: AgentToolCall;
      responseItems: AgentResponseItem[];
    };

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
  imageDataUrl?: string;
}

export interface AgentModel {
  appendToolOutput(taskId: string, output: AgentToolOutput): void;
  appendUserMessage(taskId: string, text: string): void;
  end(taskId: string): Promise<void>;
  sample(
    taskId: string,
    tools: readonly ModelToolSpec[],
    signal?: AbortSignal,
  ): Promise<AgentTurn>;
  start(taskId: string, request: string, signal?: AbortSignal): Promise<void>;
}

export interface ResolvedToolInvocation<TInput = unknown> {
  action?: ProposedAction;
  callId: string;
  input: TInput;
  kind: 'observe' | 'desktop' | 'direct' | 'guidance' | 'interaction';
  modelName: string;
  operation: string;
  toolId: RuntimeToolId;
}

function responseItems(output: unknown[]): AgentResponseItem[] {
  return output.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('OpenAI response item ' + index + ' is not an object.');
    }
    return item as AgentResponseItem;
  });
}

export function parseAgentTurn(input: unknown): AgentTurn {
  const envelope = AgentResponsesEnvelopeSchema.parse(input);
  const items = responseItems(envelope.output);
  const functionCalls = envelope.output
    .map((item) => AgentFunctionCallSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data);

  if (functionCalls.length > 1) {
    throw new Error('OpenAI returned more than one function call.');
  }
  const functionCall = functionCalls[0];
  if (functionCall) {
    return {
      kind: 'tool_call',
      responseItems: items,
      call: {
        arguments: functionCall.arguments,
        callId: functionCall.call_id,
        name: functionCall.name,
      },
    };
  }

  const texts: string[] = [];
  for (const item of envelope.output) {
    const message = AgentAssistantMessageSchema.safeParse(item);
    if (!message.success) continue;
    for (const content of message.data.content) {
      const outputText = AgentOutputTextSchema.safeParse(content);
      if (outputText.success) texts.push(outputText.data.text);
    }
  }
  const text = texts.join('\n').trim();
  if (!text) {
    throw new Error('OpenAI returned neither an assistant message nor a tool call.');
  }
  if (text.length > 8_000) {
    throw new Error('OpenAI returned an assistant message that is too large.');
  }
  return { kind: 'assistant_message', responseItems: items, text };
}

export function toolOutputInputItem(
  output: AgentToolOutput,
): Record<string, unknown> {
  return {
    type: 'function_call_output',
    call_id: output.callId,
    output: output.output,
  };
}

export function userMessageInputItem(text: string): Record<string, unknown> {
  return {
    role: 'user',
    content: [{ type: 'input_text', text }],
  };
}
