import type { Browser, Page } from 'playwright-core';
import { chromium as defaultChromium } from 'playwright-core';

import type {
  BrowserCdpAuthorizationProvider,
  BrowserDomAdapter,
  BrowserDomInvocation,
  BrowserDomResult,
} from './browser-dom-adapter';

interface ChromiumConnector {
  connectOverCDP(endpoint: string, options: Record<string, unknown>): Promise<Browser>;
}

interface BrowserSession {
  browser: Browser;
  observationId: string;
  page: Page;
  refs: Map<string, string>;
  targetUrl: string;
}

async function disconnectClient(browser: Browser): Promise<void> {
  const connection = (browser as unknown as {
    _connection?: { close(): Promise<void> | void };
  })._connection;
  await connection?.close();
}

function bounded(value: string, limit: number): string {
  return value.trim().slice(0, limit);
}

export class PlaywrightBrowserDomAdapter implements BrowserDomAdapter {
  private readonly sessions = new Map<string, BrowserSession>();

  constructor(
    private readonly authorization: BrowserCdpAuthorizationProvider,
    private readonly chromium: ChromiumConnector = defaultChromium,
    private readonly timeoutMs = 8_000,
  ) {}

  async execute(
    taskId: string,
    invocation: BrowserDomInvocation,
    signal?: AbortSignal,
  ): Promise<BrowserDomResult> {
    if (signal?.aborted) throw signal.reason ?? new Error('Browser DOM action cancelled.');
    const session = await this.session(taskId, invocation.observationId);
    if (session.page.url() !== session.targetUrl) {
      await this.closeTask(taskId);
      return { status: 'not_executed', summary: 'The authorized browser target changed.' };
    }
    if (invocation.operation === 'observe') return this.observe(session);
    const selector = invocation.ref ? session.refs.get(invocation.ref) : undefined;
    if (!selector) return { status: 'not_executed', summary: 'The browser reference is stale.' };
    const locator = session.page.locator(selector);
    if (await locator.count() !== 1) {
      return { status: 'not_executed', summary: 'The strict browser locator is ambiguous or missing.' };
    }
    switch (invocation.operation) {
      case 'click':
        await locator.click({ timeout: this.timeoutMs });
        break;
      case 'fill':
        await locator.fill(invocation.text ?? '', { timeout: this.timeoutMs });
        break;
      case 'press':
        await locator.press(invocation.key ?? '', { timeout: this.timeoutMs });
        break;
      case 'scroll':
        await locator.evaluate((element) => element.scrollIntoView({ block: 'center' }));
        break;
      case 'read': {
        const text = bounded(await locator.innerText({ timeout: this.timeoutMs }), 8_000);
        return { status: 'confirmed', summary: text || 'The target has no readable text.' };
      }
      case 'assert': {
        const text = bounded(await locator.innerText({ timeout: this.timeoutMs }), 8_000);
        const assertion = invocation.assertion ?? '';
        return text.includes(assertion)
          ? { status: 'confirmed', summary: 'The fresh DOM assertion passed.' }
          : { status: 'failed', summary: 'The fresh DOM assertion did not match.' };
      }
    }
    if (session.page.url() !== session.targetUrl) {
      return { status: 'unknown', summary: 'The action navigated away from the exact authorized target.' };
    }
    return { status: 'confirmed', summary: 'The strict DOM action completed on the authorized target.' };
  }

  async closeTask(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId);
    this.sessions.delete(taskId);
    if (session) await disconnectClient(session.browser).catch(() => undefined);
  }

  private async session(taskId: string, observationId: string): Promise<BrowserSession> {
    const existing = this.sessions.get(taskId);
    if (existing?.observationId === observationId) return existing;
    if (existing) await this.closeTask(taskId);
    const grant = await this.authorization.consume(taskId, observationId);
    if (Date.parse(grant.expiresAt) <= Date.now() || grant.observationId !== observationId) {
      throw new Error('The one-use browser authorization expired.');
    }
    const browser = await this.chromium.connectOverCDP(grant.endpoint, {
      noDefaults: true,
      timeout: this.timeoutMs,
    });
    const pages = browser.contexts().flatMap((context) => context.pages());
    const matches = pages.filter((page) => page.url() === grant.targetUrl);
    if (matches.length !== 1 || !matches[0]) {
      await disconnectClient(browser).catch(() => undefined);
      throw new Error('The exact authorized browser target is unavailable or ambiguous.');
    }
    const session = {
      browser,
      observationId,
      page: matches[0],
      refs: new Map<string, string>(),
      targetUrl: grant.targetUrl,
    };
    this.sessions.set(taskId, session);
    return session;
  }

  private async observe(session: BrowserSession): Promise<BrowserDomResult> {
    const facts = await session.page.locator('a,button,input,textarea,select,[role]').evaluateAll(
      (elements) => elements.slice(0, 200).map((element, index) => ({
        selector: `[data-tro-ref="${index + 1}"]`,
        role: element.getAttribute('role') || element.tagName.toLowerCase(),
        name: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 500),
        value: 'value' in element ? String((element as HTMLInputElement).value).slice(0, 2_000) : undefined,
      })),
    );
    session.refs.clear();
    const boundedFacts = facts.map((fact, index) => {
      const ref = `d${index + 1}`;
      const selector = `a,button,input,textarea,select,[role] >> nth=${index}`;
      session.refs.set(ref, selector);
      return { ref, role: fact.role, name: fact.name, ...(fact.value ? { value: fact.value } : {}) };
    });
    return {
      facts: boundedFacts,
      status: 'confirmed',
      summary: `Read ${boundedFacts.length} bounded semantic browser elements.`,
    };
  }
}
