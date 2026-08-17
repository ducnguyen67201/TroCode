import { describe, expect, it, vi } from 'vitest';

import { GptTaskIntentCompiler } from './task-intent-compiler';

function response(name: string, argumentsValue: unknown): Response {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: 'function_call',
          name,
          arguments: JSON.stringify(argumentsValue),
        },
      ],
    }),
    { status: 200 },
  );
}

describe('GptTaskIntentCompiler', () => {
  it('compiles multilingual action intent without a keyword capability router', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      response('compile_task_intent', {
        behavior: 'act',
        objective: 'Open Gmail and read the latest email.',
        successDescription: 'The latest email is visible and summarized to the user.',
      }),
    );
    const compiler = new GptTaskIntentCompiler({
      credentialStore: { read: vi.fn().mockResolvedValue('stored-key') },
      environmentApiKey: '',
      fetchImpl,
    });

    await expect(
      compiler.compile('Mở mail và đọc cho tôi mail gần nhất.'),
    ).resolves.toEqual({
      kind: 'compiled',
      intent: {
        behavior: 'act',
        objective: 'Open Gmail and read the latest email.',
        successDescription: 'The latest email is visible and summarized to the user.',
      },
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.input[0].content[0].text).toBe(
      'Mở mail và đọc cho tôi mail gần nhất.',
    );
    expect(JSON.stringify({ input: body.input, tools: body.tools })).not.toContain(
      'capabilities',
    );
    expect(JSON.stringify({ input: body.input, tools: body.tools })).not.toContain(
      'domain',
    );
  });

  it('returns a bounded clarification chosen by the model', async () => {
    const compiler = new GptTaskIntentCompiler({
      credentialStore: { read: vi.fn().mockResolvedValue('stored-key') },
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        response('request_task_clarification', {
          prompt: 'What kind of song should I help you create?',
          choices: ['Instrumental', 'Song with lyrics'],
        }),
      ),
    });

    await expect(compiler.compile('Make music for me')).resolves.toEqual({
      kind: 'clarification',
      prompt: 'What kind of song should I help you create?',
      choices: [
        { id: 'choice-1', label: 'Instrumental' },
        { id: 'choice-2', label: 'Song with lyrics' },
      ],
    });
  });

  it('falls back once when the preferred model returns an invalid contract', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response('compile_task_intent', {
          behavior: 'unsupported',
          objective: 'Create a beat.',
          successDescription: 'A beat is playable.',
        }),
      )
      .mockResolvedValueOnce(
        response('compile_task_intent', {
          behavior: 'act',
          objective: 'Create a beat in GarageBand.',
          successDescription: 'A beat is playable in the open project.',
        }),
      );
    const compiler = new GptTaskIntentCompiler({
      credentialStore: { read: vi.fn().mockResolvedValue('stored-key') },
      fetchImpl,
      model: 'preferred-model',
      fallbackModel: 'fallback-model',
    });

    await expect(compiler.compile('Create a simple beat.')).resolves.toMatchObject({
      kind: 'compiled',
      intent: { behavior: 'act' },
    });
    expect(
      fetchImpl.mock.calls.map((call) =>
        JSON.parse(String(call[1]?.body)).model,
      ),
    ).toEqual(['preferred-model', 'fallback-model']);
  });

  it('does not retry authentication failures on another model', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('', { status: 401 }));
    const compiler = new GptTaskIntentCompiler({
      credentialStore: { read: vi.fn().mockResolvedValue('invalid-key') },
      fetchImpl,
      model: 'preferred-model',
      fallbackModel: 'fallback-model',
    });

    await expect(compiler.compile('Open Gmail.')).rejects.toThrow('HTTP 401');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('honors caller cancellation before any network request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const compiler = new GptTaskIntentCompiler({
      credentialStore: { read: vi.fn().mockResolvedValue('stored-key') },
      fetchImpl,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      compiler.compile('Open Spotify.', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an oversized model response without parsing its contents', async () => {
    const compiler = new GptTaskIntentCompiler({
      credentialStore: { read: vi.fn().mockResolvedValue('stored-key') },
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('x'.repeat(1_000_001), { status: 200 })),
      model: 'one-model',
      fallbackModel: 'one-model',
    });

    await expect(compiler.compile('Open Spotify.')).rejects.toThrow(
      'unexpectedly large',
    );
  });
});
