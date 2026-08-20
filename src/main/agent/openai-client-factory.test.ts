import { describe, expect, it, vi } from 'vitest';

import { OpenAIClientFactory } from './openai-client-factory';

describe('OpenAIClientFactory', () => {
  it('reserves each user turn once and reuses its server token for internal calls', async () => {
    const requests: Array<{ headers: Headers; url: string }> = [];
    const serverTurnIds = [
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ];
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      requests.push({ headers: new Headers(init?.headers), url: String(url) });
      if (String(url).endsWith('/v1/agent-turns')) {
        const body = JSON.parse(String(init?.body)) as {
          clientTurnId: string;
          taskId: string;
        };
        return new Response(
          JSON.stringify({
            ...body,
            createdAt: '2026-08-18T10:00:00.000Z',
            id: serverTurnIds.shift(),
            plan: 'basic',
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 201 },
        );
      }
      return new Response(
        JSON.stringify({ error: { message: 'Rejected before inference.' } }),
        { headers: { 'Content-Type': 'application/json' }, status: 400 },
      );
    });
    const requestIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    const session = await new OpenAIClientFactory({
      accessTokenProvider: vi.fn(async () => 'opaque-hosted-token'),
      apiBaseUrl: 'https://api.trocode.test',
      fetchImpl,
      uuid: () => requestIds.shift() ?? '33333333-3333-4333-8333-333333333333',
    }).create('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const firstTurnId = '66666666-6666-4666-8666-666666666666';
    session.setUserTurnIds([firstTurnId]);

    for (const input of ['first', 'second']) {
      await expect(
        session.client.responses.create({
          input,
          model: 'gpt-5.6-luna',
          store: false,
        }),
      ).rejects.toThrow('Rejected before inference');
    }

    const secondTurnId = '77777777-7777-4777-8777-777777777777';
    session.setUserTurnIds([firstTurnId, secondTurnId]);
    await expect(
      session.client.responses.create({
        input: 'third',
        model: 'gpt-5.6-luna',
        store: false,
      }),
    ).rejects.toThrow('Rejected before inference');

    const turnRequests = requests.filter(({ url }) =>
      url.endsWith('/v1/agent-turns'),
    );
    const modelRequests = requests.filter(({ url }) =>
      url.endsWith('/v1/openai/responses'),
    );
    expect(turnRequests).toHaveLength(2);
    expect(modelRequests).toHaveLength(3);
    expect(
      modelRequests.map(({ headers }) => headers.get('x-trocode-task-id')),
    ).toEqual(Array(3).fill('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
    expect(
      modelRequests.map(({ headers }) =>
        headers.get('x-trocode-agent-turn-id'),
      ),
    ).toEqual([
      '44444444-4444-4444-8444-444444444444',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ]);
    expect(
      modelRequests.map(({ headers }) => headers.get('x-trocode-request-id')),
    ).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(
      turnRequests.map(({ headers }) => headers.get('authorization')),
    ).toEqual(Array(2).fill('Bearer opaque-hosted-token'));
    expect(
      turnRequests.map(({ url }) => url.endsWith('/v1/agent-turns')),
    ).toEqual([true, true]);
  });

  it('fails closed when the Tro backend is not configured', async () => {
    const accessTokenProvider = vi.fn(async () => 'unused-token');
    await expect(
      new OpenAIClientFactory({
        accessTokenProvider,
        apiBaseUrl: '',
      }).create('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).rejects.toThrow('Tro model service is not configured');
    expect(accessTokenProvider).not.toHaveBeenCalled();
  });
});
