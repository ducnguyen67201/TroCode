import { Agent, Runner, tool } from '@openai/agents';
import {
  ScriptedModel,
  assistantMessage,
  functionCall,
} from '@openai/agents/testing';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BoundedAgentSession } from './bounded-agent-session';

describe('pinned OpenAI Agents SDK compatibility', () => {
  it('streams, pauses for one approval, resumes the same state, and keeps session history', async () => {
    const model = new ScriptedModel([
      [
        functionCall(
          'inspect',
          { value: 'screen' },
          { callId: 'call-approved' },
        ),
      ],
      [assistantMessage('Finished from the resumed run.')],
    ]);
    const execute = vi.fn(async () => [
      { type: 'text' as const, text: 'inspection complete' },
      {
        type: 'image' as const,
        image: 'data:image/png;base64,aA==',
        detail: 'high' as const,
      },
    ]);
    const agent = new Agent({
      name: 'Compatibility canary',
      instructions: 'Use the test tool once.',
      model,
      tools: [
        tool({
          name: 'inspect',
          description: 'Return bounded text and image evidence.',
          parameters: z.object({ value: z.string() }),
          needsApproval: true,
          execute,
        }),
      ],
    });
    const runner = new Runner({
      model,
      modelSettings: { retry: { maxRetries: 0 } },
      tracingDisabled: true,
    });
    const session = new BoundedAgentSession('compatibility-task');

    const paused = await runner.run(agent, 'Inspect now.', {
      session,
      stream: true,
    });
    for await (const event of paused) {
      // Drain the stream so the interruption state is complete.
      void event;
    }
    await paused.completed;
    expect(paused.interruptions).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();

    const interruption = paused.interruptions[0];
    if (!interruption) throw new Error('Expected an approval interruption.');
    paused.state.approve(interruption);
    const resumed = await runner.run(agent, paused.state, {
      session,
      stream: true,
    });
    const textDeltas: string[] = [];
    for await (const event of resumed) {
      if (
        event.type === 'raw_model_stream_event' &&
        event.data.type === 'output_text_delta'
      ) {
        textDeltas.push(event.data.delta);
      }
    }
    await resumed.completed;

    expect(resumed.finalOutput).toBe('Finished from the resumed run.');
    expect(textDeltas.join('')).toBe('Finished from the resumed run.');
    expect(execute).toHaveBeenCalledOnce();
    expect(await session.getItems()).not.toHaveLength(0);
    expect(model.calls).toHaveLength(2);
    model.assertComplete();
  });
});
