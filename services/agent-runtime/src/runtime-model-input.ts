import type { AgentInputItem, ModelInputData } from '@openai/agents';

import type { LocalAgentHostMessage } from './protocol.js';

export function prefetchedInitialTurnInput(
  request: string,
  result: NonNullable<
    Extract<LocalAgentHostMessage, { kind: 'turn.start' }>['prefetchedInitialToolResult']
  >,
): AgentInputItem[] {
  const content: Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image: string; detail: 'high' }
  > = [
    { type: 'input_text', text: request },
    {
      type: 'input_text',
      text: [
        'Trusted host initial observation:',
        JSON.stringify({
          status: result.status,
          summary: result.summary,
          data: result.data,
        }),
      ].join('\n'),
    },
  ];
  if (result.imageDataUrl) {
    content.push({
      type: 'input_image',
      image: result.imageDataUrl,
      detail: 'high',
    });
  }
  return [{ role: 'user', content }];
}

export function injectRuntimeInstructions(
  modelData: ModelInputData,
  instructions: readonly string[],
): ModelInputData {
  const boundedInput = modelData.input as AgentInputItem[];
  if (instructions.length === 0) return modelData;
  const steering: AgentInputItem[] = instructions.map((instruction) => ({
    role: 'user',
    content: [{ type: 'input_text', text: instruction }],
  }));
  return { ...modelData, input: [...boundedInput, ...steering] };
}
