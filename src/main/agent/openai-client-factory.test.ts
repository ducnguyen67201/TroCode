import { describe, expect, it, vi } from 'vitest';

import { OpenAIClientFactory } from './openai-client-factory';

describe('OpenAIClientFactory', () => {
  it('uses hosted opaque auth, a stable task ID, fresh call IDs, and no retries', async () => {
    const requests: Array<{ headers: Headers; url: string }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      requests.push({ headers: new Headers(init?.headers), url: String(url) });
      return new Response(
        JSON.stringify({ error: { message: 'Rejected before inference.' } }),
        { headers: { 'Content-Type': 'application/json' }, status: 400 },
      );
    });
    const requestIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    const client = await new OpenAIClientFactory({
      accessTokenProvider: vi.fn(async () => 'opaque-hosted-token'),
      apiBaseUrl: 'https://api.trocode.test',
      fetchImpl,
      uuid: () => requestIds.shift() ?? '33333333-3333-4333-8333-333333333333',
    }).create('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    for (const input of ['first', 'second']) {
      await expect(
        client.responses.create({ input, model: 'gpt-5.6-luna', store: false }),
      ).rejects.toThrow('Rejected before inference');
    }

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requests.map(({ headers }) => headers.get('x-trocode-task-id'))).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ]);
    expect(
      requests.map(({ headers }) => headers.get('x-trocode-request-id')),
    ).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(requests.every(({ url }) => url.endsWith('/v1/openai/responses'))).toBe(
      true,
    );
  });

  it('fails closed when the TroCode backend is not configured', async () => {
    const accessTokenProvider = vi.fn(async () => 'unused-token');
    await expect(
      new OpenAIClientFactory({
        accessTokenProvider,
        apiBaseUrl: '',
      }).create('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).rejects.toThrow('TroCode model service is not configured');
    expect(accessTokenProvider).not.toHaveBeenCalled();
  });
});
