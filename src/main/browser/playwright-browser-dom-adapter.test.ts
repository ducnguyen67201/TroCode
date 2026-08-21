import { describe, expect, it, vi } from 'vitest';

import { PlaywrightBrowserDomAdapter } from './playwright-browser-dom-adapter';

function harness(options: { count?: number; pageUrl?: string } = {}) {
  let url = options.pageUrl ?? 'https://example.test/inbox';
  const locator = {
    click: vi.fn(async () => undefined),
    count: vi.fn(async () => options.count ?? 1),
    evaluate: vi.fn(async () => undefined),
    evaluateAll: vi.fn(async () => [{ role: 'button', name: 'Open', value: undefined }]),
    fill: vi.fn(async () => undefined),
    innerText: vi.fn(async () => 'Complete message body'),
    press: vi.fn(async () => undefined),
  };
  const page = {
    locator: vi.fn(() => locator),
    url: vi.fn(() => url),
  };
  const browser = {
    _connection: { close: vi.fn(async () => undefined) },
    close: vi.fn(async () => undefined),
    contexts: vi.fn(() => [{ pages: () => [page] }]),
  };
  const connectOverCDP = vi.fn(async () => browser);
  const consume = vi.fn(async () => ({
    endpoint: 'http://127.0.0.1:9222',
    expiresAt: '2099-01-01T00:00:00.000Z',
    observationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    targetUrl: 'https://example.test/inbox',
  }));
  return {
    adapter: new PlaywrightBrowserDomAdapter(
      { consume },
      { connectOverCDP } as never,
    ),
    browser,
    connectOverCDP,
    locator,
    setUrl: (next: string) => { url = next; },
  };
}

describe('PlaywrightBrowserDomAdapter', () => {
  it('binds the exact authorized page and rejects ambiguous strict locators', async () => {
    const { adapter, connectOverCDP } = harness({ count: 2 });
    const observed = await adapter.execute('task', {
      observationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      operation: 'observe',
    });
    expect(observed.facts?.[0]).toMatchObject({ ref: 'd1', role: 'button' });
    const result = await adapter.execute('task', {
      observationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      operation: 'click',
      ref: 'd1',
    });
    expect(result.status).toBe('not_executed');
    expect(connectOverCDP).toHaveBeenCalledWith(
      'http://127.0.0.1:9222',
      expect.objectContaining({ noDefaults: true }),
    );
  });

  it('fails closed when the authorized tab changes', async () => {
    const { adapter, browser, setUrl } = harness();
    await adapter.execute('task', {
      observationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      operation: 'observe',
    });
    setUrl('https://example.test/other');
    const result = await adapter.execute('task', {
      observationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      operation: 'read',
      ref: 'd1',
    });
    expect(result.status).toBe('not_executed');
    expect(browser._connection.close).toHaveBeenCalled();
    expect(browser.close).not.toHaveBeenCalled();
  });
});
