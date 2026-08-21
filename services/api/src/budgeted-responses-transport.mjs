import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { parseProviderUsage, parseStreamingProviderUsage } from './openai-responses-service.mjs';

const RESPONSES_PATH = /\/v1\/responses(?:\/compact)?$/u;
const MAX_ACCOUNTING_BYTES = 5_000_000;

function requestUrl(input) {
  return typeof input === 'string' || input instanceof URL ? String(input) : input.url;
}

function requestBody(input, init) {
  const body = init?.body ?? (typeof input === 'object' && 'body' in input ? input.body : null);
  if (typeof body !== 'string') throw new Error('Budgeted Responses transport requires a JSON request body.');
  return JSON.parse(body);
}

function retryableBeforeEvent(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export class BudgetedResponsesTransport {
  constructor({ budgetService, catalog, circuitBreaker, fetchImpl = fetch, maxPreEventAttempts = 2 }) {
    this.budgetService = budgetService;
    this.catalog = catalog;
    this.fetchImpl = fetchImpl;
    this.maxPreEventAttempts = Math.min(Math.max(maxPreEventAttempts, 1), 2);
    this.context = new AsyncLocalStorage();
    this.circuitBreaker = circuitBreaker;
  }

  runWithContext(context, operation) {
    return this.context.run(context, operation);
  }

  readonlyFetch = async (input, init) => {
    const url = requestUrl(input);
    if (!RESPONSES_PATH.test(new URL(url).pathname) || String(init?.method ?? 'GET').toUpperCase() !== 'POST') {
      return this.fetchImpl(input, init);
    }
    const context = this.context.getStore();
    if (!context) throw new Error('Responses request has no active TroCode budget context.');
    if (this.circuitBreaker?.allow() === false) {
      const error = new Error('The model provider circuit is temporarily open.');
      error.code = 'provider_circuit_open';
      error.retryAfterSeconds = 30;
      throw error;
    }
    const body = requestBody(input, init);
    const requestId = randomUUID();
    const estimate = this.catalog.estimateResponsesReservation({
      ...body,
      max_output_tokens: body.max_output_tokens ?? 8_000,
    });
    await this.budgetService.reserve({
      catalogVersion: this.catalog.version,
      agentTurnId: context.agentTurnId,
      lane: new URL(url).pathname.endsWith('/compact') ? 'responses_compaction' : 'responses',
      model: body.model,
      planId: context.planId,
      requestId,
      reservedMicroUsd: estimate.microUsd,
      taskId: context.taskId,
      userId: context.userId,
    });

    let response;
    for (let attempt = 1; attempt <= this.maxPreEventAttempts; attempt += 1) {
      try {
        await this.budgetService.markDispatched(context.userId, requestId);
        response = await this.fetchImpl(input, init);
      } catch (error) {
        this.circuitBreaker?.failure();
        await this.budgetService.markUncertain(context.userId, requestId);
        throw error;
      }
      if (!retryableBeforeEvent(response.status) || attempt === this.maxPreEventAttempts) break;
      this.circuitBreaker?.failure();
      await response.body?.cancel().catch(() => undefined);
      const retryAfter = Number(response.headers.get('retry-after'));
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) ? Math.min(retryAfter * 1_000, 5_000) : 100 * attempt));
    }
    if (!response.ok) {
      if (retryableBeforeEvent(response.status)) this.circuitBreaker?.failure();
      if ([400, 401, 403, 404, 422].includes(response.status)) {
        await this.budgetService.release(context.userId, requestId, 'rejected_before_inference');
      } else {
        await this.budgetService.markUncertain(context.userId, requestId);
      }
      return response;
    }
    this.circuitBreaker?.success();
    void this.#settleFromClone(response.clone(), { body, context, requestId });
    return response;
  };

  async #settleFromClone(response, { body, context, requestId }) {
    try {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_ACCOUNTING_BYTES) throw new Error('Provider accounting response exceeded the bound.');
      const text = bytes.toString('utf8');
      const usage = body.stream
        ? parseStreamingProviderUsage(text, body.model)
        : parseProviderUsage(JSON.parse(text), body.model);
      if (!usage) throw new Error('Provider usage was missing.');
      await this.budgetService.settle({
        actualMicroUsd: this.catalog.calculateUsageCost(usage),
        durationMs: 0,
        requestId,
        usage,
        userId: context.userId,
      });
    } catch {
      await this.budgetService.markUncertain(context.userId, requestId);
    }
  }
}
