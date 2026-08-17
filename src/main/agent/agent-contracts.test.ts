import { describe, expect, it } from 'vitest';

import {
  developerMessageInputItem,
  parseAgentTurn,
} from './agent-contracts';

describe('agent response contracts', () => {
  it('creates a trusted developer message for host completion review', () => {
    expect(developerMessageInputItem('Review completion.')).toEqual({
      role: 'developer',
      content: [{ type: 'input_text', text: 'Review completion.' }],
    });
  });

  it('parses ordinary assistant output', () => {
    expect(
      parseAgentTurn({
        id: 'resp_1',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '27 × 14 = 378.' }],
          },
        ],
      }),
    ).toMatchObject({ kind: 'assistant_message', text: '27 × 14 = 378.' });
  });

  it('preserves reasoning and function-call response items', () => {
    const turn = parseAgentTurn({
      output: [
        { type: 'reasoning', id: 'reasoning_1', summary: [] },
        {
          type: 'function_call',
          name: 'observe_desktop',
          call_id: 'call_1',
          arguments: JSON.stringify({ reason: 'Inspect Gmail.' }),
        },
      ],
    });

    expect(turn).toMatchObject({
      kind: 'tool_call',
      call: { callId: 'call_1', name: 'observe_desktop' },
    });
    expect(turn.responseItems).toHaveLength(2);
    expect(turn.responseItems[0]).toMatchObject({ type: 'reasoning' });
  });

  it.each([
    [{ output: [] }, 'neither'],
    [
      {
        output: [
          {
            type: 'function_call',
            name: '',
            call_id: 'call_1',
            arguments: '{}',
          },
        ],
      },
      'neither',
    ],
    [
      {
        output: [
          {
            type: 'function_call',
            name: 'open_url',
            call_id: 'call_1',
            arguments: '{bad json',
          },
        ],
      },
      'neither',
    ],
  ])('rejects unsupported response shapes', (input, message) => {
    expect(() => parseAgentTurn(input)).toThrow(message);
  });

  it('rejects multiple tool calls even when parallel calls are disabled upstream', () => {
    expect(() =>
      parseAgentTurn({
        output: [
          {
            type: 'function_call',
            name: 'open_url',
            call_id: 'call_1',
            arguments: '{}',
          },
          {
            type: 'function_call',
            name: 'open_url',
            call_id: 'call_2',
            arguments: '{}',
          },
        ],
      }),
    ).toThrow('more than one');
  });
});
