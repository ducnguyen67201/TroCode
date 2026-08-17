import { describe, expect, it, vi } from 'vitest';

import { GptResponsesAgent } from './responses-agent';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GptResponsesAgent', () => {
  it('uses an assistant-or-tool request with host tool specs and no server storage', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '378' }],
          },
        ],
      }),
    );
    const agent = new GptResponsesAgent({
      credentialStore: { read: vi.fn(async () => 'secret-key') },
      fetchImpl,
      model: 'test-model',
      fallbackModel: 'test-model',
    });
    await agent.start('task-1', 'What is 27 × 14?');

    await expect(agent.sample('task-1', [])).resolves.toMatchObject({
      kind: 'assistant_message',
      text: '378',
    });
    const request = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'test-model',
      tool_choice: 'auto',
      parallel_tool_calls: false,
      store: false,
    });
    expect(String(request?.headers)).not.toContain('secret-key');
  });

  it('preserves response reasoning and appends output by exact call ID', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          output: [
            { type: 'reasoning', id: 'reasoning_1', summary: [] },
            {
              type: 'function_call',
              name: 'open_url',
              call_id: 'call_1',
              arguments: JSON.stringify({
                url: 'https://example.com/',
                reason: 'Open it.',
              }),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Opened.' }],
            },
          ],
        }),
      );
    const agent = new GptResponsesAgent({
      credentialStore: { read: vi.fn(async () => 'secret-key') },
      fetchImpl,
      model: 'test-model',
      fallbackModel: 'test-model',
    });
    await agent.start('task-2', 'Open the site.');
    await expect(agent.sample('task-2', [])).resolves.toMatchObject({
      kind: 'tool_call',
      call: { callId: 'call_1' },
    });
    expect(() =>
      agent.appendToolOutput('task-2', {
        callId: 'wrong',
        output: '{}',
      }),
    ).toThrow('does not match');
    agent.appendToolOutput('task-2', {
      callId: 'call_1',
      output: JSON.stringify({ status: 'confirmed' }),
    });
    await agent.sample('task-2', []);

    const secondRequest = fetchImpl.mock.calls[1]?.[1];
    const secondBody = JSON.parse(String(secondRequest?.body)) as {
      input: Array<Record<string, unknown>>;
    };
    expect(secondBody.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'reasoning', id: 'reasoning_1' }),
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call_1',
        }),
      ]),
    );
  });

  it('falls back after a recoverable model failure', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Unavailable' } }, 503))
      .mockResolvedValueOnce(
        jsonResponse({
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Recovered.' }],
            },
          ],
        }),
      );
    const agent = new GptResponsesAgent({
      credentialStore: { read: vi.fn(async () => 'secret-key') },
      fetchImpl,
      model: 'primary',
      fallbackModel: 'fallback',
    });
    await agent.start('task-3', 'Help me.');

    await expect(agent.sample('task-3', [])).resolves.toMatchObject({
      text: 'Recovered.',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toMatchObject({
      model: 'fallback',
    });
  });

  it('does not resend deterministic request-schema failures to another model', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            message:
              "Invalid schema for function 'control_desktop': discriminator must have a type key.",
          },
        },
        400,
      ),
    );
    const agent = new GptResponsesAgent({
      credentialStore: { read: vi.fn(async () => 'secret-key') },
      fetchImpl,
      model: 'primary',
      fallbackModel: 'fallback',
    });
    await agent.start('task-schema', 'Open Gmail.');

    await expect(agent.sample('task-schema', [])).rejects.toThrow(
      'Invalid schema',
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('does not fall back on authorization errors or start without credentials', async () => {
    const missing = new GptResponsesAgent({
      credentialStore: { read: vi.fn(async () => null) },
      environmentApiKey: '',
      fetchImpl: vi.fn<typeof fetch>(),
    });
    await expect(missing.start('missing', 'Help me.')).rejects.toThrow(
      'Connect an OpenAI API key',
    );

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: { message: 'Unauthorized' } }, 401));
    const agent = new GptResponsesAgent({
      credentialStore: { read: vi.fn(async () => 'bad-key') },
      fetchImpl,
      model: 'primary',
      fallbackModel: 'fallback',
    });
    await agent.start('task-4', 'Help me.');
    await expect(agent.sample('task-4', [])).rejects.toThrow('Unauthorized');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
