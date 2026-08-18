const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const MAX_SSE_LINE_CHARACTERS = 1_000_000;
const MAX_UPSTREAM_RESPONSE_BYTES = 5_000_000;
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export class ResponsesServiceError extends Error {
  constructor(status, message, code = 'responses_error') {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function nonnegativeInteger(name, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative integer.`);
  }
  return value;
}

export function parseProviderUsage(value, expectedModel) {
  if (!value || typeof value !== 'object' || !value.usage) return null;
  const usage = value.usage;
  const inputDetails = usage.input_tokens_details ?? {};
  const outputDetails = usage.output_tokens_details ?? {};
  const inputTokens = nonnegativeInteger('usage.input_tokens', usage.input_tokens);
  const cachedInputTokens = nonnegativeInteger(
    'usage.input_tokens_details.cached_tokens',
    inputDetails.cached_tokens ?? 0,
  );
  const cacheWriteTokens = nonnegativeInteger(
    'usage.input_tokens_details.cache_write_tokens',
    inputDetails.cache_write_tokens ?? 0,
  );
  const outputTokens = nonnegativeInteger(
    'usage.output_tokens',
    usage.output_tokens,
  );
  const reasoningTokens = nonnegativeInteger(
    'usage.output_tokens_details.reasoning_tokens',
    outputDetails.reasoning_tokens ?? 0,
  );
  if (cachedInputTokens + cacheWriteTokens > inputTokens) {
    throw new Error('Provider usage input details exceed total input tokens.');
  }
  if (reasoningTokens > outputTokens) {
    throw new Error('Provider reasoning tokens exceed total output tokens.');
  }
  return {
    cacheWriteTokens,
    cachedInputTokens,
    inputTokens,
    model: typeof value.model === 'string' ? value.model : expectedModel,
    outputTokens,
    reasoningTokens,
    responseId: typeof value.id === 'string' ? value.id : undefined,
    source: 'actual',
  };
}

export function parseStreamingProviderUsage(value, expectedModel) {
  let completedResponse = null;
  for (const line of value.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice('data:'.length).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const event = JSON.parse(data);
      if (event?.type === 'response.completed' && event.response) {
        completedResponse = event.response;
      }
    } catch {
      // Ignore incomplete or provider-specific event payloads.
    }
  }
  return completedResponse
    ? parseProviderUsage(completedResponse, expectedModel)
    : null;
}

async function readBoundedBody(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_UPSTREAM_RESPONSE_BYTES
  ) {
    throw new Error('Upstream response was unexpectedly large.');
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > MAX_UPSTREAM_RESPONSE_BYTES) {
    throw new Error('Upstream response was unexpectedly large.');
  }
  return body;
}

function isRejectedBeforeInference(status) {
  return [400, 401, 403, 404, 422].includes(status);
}

export class OpenAiResponsesService {
  constructor({ budgetService, catalog, fetchImpl = fetch, openAiApiKey }) {
    this.budgetService = budgetService;
    this.catalog = catalog;
    this.fetchImpl = fetchImpl;
    this.openAiApiKey = openAiApiKey;
  }

  async execute(input) {
    const startedAt = Date.now();
    const estimate = this.catalog.estimateResponsesReservation(input.body);
    await this.budgetService.reserve({
      catalogVersion: this.catalog.version,
      lane: 'responses',
      model: input.body.model,
      requestId: input.requestId,
      reservedMicroUsd: estimate.microUsd,
      taskId: input.taskId,
      userId: input.userId,
    });
    await this.budgetService.markDispatched(input.userId, input.requestId);

    let response;
    try {
      response = await this.fetchImpl(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.openAiApiKey}`,
          'Content-Type': 'application/json',
          'OpenAI-Safety-Identifier': input.safetyIdentifier,
        },
        body: JSON.stringify(input.body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      await this.budgetService.markUncertain(input.userId, input.requestId);
      throw new ResponsesServiceError(
        502,
        'The model provider is temporarily unavailable. This call was not retried.',
        'ambiguous_dispatch',
      );
    }

    let body;
    try {
      body = await readBoundedBody(response);
    } catch {
      await this.budgetService.markUncertain(input.userId, input.requestId);
      throw new ResponsesServiceError(
        502,
        'The model provider returned an invalid response. This call was not retried.',
        'ambiguous_response',
      );
    }

    if (!response.ok) {
      if (isRejectedBeforeInference(response.status)) {
        await this.budgetService.release(
          input.userId,
          input.requestId,
          'rejected_before_inference',
        );
      } else {
        await this.budgetService.markUncertain(input.userId, input.requestId);
      }
      return {
        body,
        contentType: response.headers.get('content-type') || JSON_CONTENT_TYPE,
        headers: {},
        status: response.status,
      };
    }

    let usage;
    try {
      usage = parseProviderUsage(JSON.parse(body.toString('utf8')), input.body.model);
    } catch {
      usage = null;
    }
    if (!usage) {
      await this.budgetService.markUncertain(input.userId, input.requestId);
      return {
        body,
        contentType: response.headers.get('content-type') || JSON_CONTENT_TYPE,
        headers: { 'X-Trocode-Usage-Source': 'missing' },
        status: response.status,
      };
    }
    const actualMicroUsd = this.catalog.calculateUsageCost(usage);
    await this.budgetService.settle({
      actualMicroUsd,
      durationMs: Date.now() - startedAt,
      requestId: input.requestId,
      usage,
      userId: input.userId,
    });
    console.info(
      JSON.stringify({
        cacheWriteTokens: usage.cacheWriteTokens,
        cachedInputTokens: usage.cachedInputTokens,
        durationMs: Date.now() - startedAt,
        event: 'inference.settled',
        inputTokens: usage.inputTokens,
        lane: 'responses',
        microUsd: actualMicroUsd,
        model: usage.model,
        outputTokens: usage.outputTokens,
        requestId: input.requestId,
        responseId: usage.responseId,
        taskId: input.taskId,
        usageSource: usage.source,
      }),
    );
    return {
      body,
      contentType: response.headers.get('content-type') || JSON_CONTENT_TYPE,
      headers: {
        'X-Trocode-Usage-Micro-Usd': String(actualMicroUsd),
        'X-Trocode-Usage-Source': usage.source,
      },
      status: response.status,
    };
  }

  async executeStream(input) {
    const startedAt = Date.now();
    const estimate = this.catalog.estimateResponsesReservation(input.body);
    await this.budgetService.reserve({
      catalogVersion: this.catalog.version,
      lane: 'responses',
      model: input.body.model,
      requestId: input.requestId,
      reservedMicroUsd: estimate.microUsd,
      taskId: input.taskId,
      userId: input.userId,
    });
    await this.budgetService.markDispatched(input.userId, input.requestId);

    let response;
    const headerController = new AbortController();
    const headerTimer = setTimeout(() => headerController.abort(), 60_000);
    try {
      response = await this.fetchImpl(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.openAiApiKey}`,
          'Content-Type': 'application/json',
          'OpenAI-Safety-Identifier': input.safetyIdentifier,
        },
        body: JSON.stringify(input.body),
        signal: headerController.signal,
      });
    } catch {
      await this.budgetService.markUncertain(input.userId, input.requestId);
      throw new ResponsesServiceError(
        502,
        'The model provider is temporarily unavailable. This call was not retried.',
        'ambiguous_dispatch',
      );
    } finally {
      clearTimeout(headerTimer);
    }

    if (!response.ok) {
      let body;
      try {
        body = await readBoundedBody(response);
      } catch {
        await this.budgetService.markUncertain(input.userId, input.requestId);
        throw new ResponsesServiceError(
          502,
          'The model provider returned an invalid response. This call was not retried.',
          'ambiguous_response',
        );
      }
      if (isRejectedBeforeInference(response.status)) {
        await this.budgetService.release(
          input.userId,
          input.requestId,
          'rejected_before_inference',
        );
      } else {
        await this.budgetService.markUncertain(input.userId, input.requestId);
      }
      return {
        body,
        contentType: response.headers.get('content-type') || JSON_CONTENT_TYPE,
        headers: {},
        status: response.status,
      };
    }

    const contentType = response.headers.get('content-type') || '';
    if (
      !response.body ||
      !contentType.toLocaleLowerCase().startsWith('text/event-stream')
    ) {
      await response.body?.cancel().catch(() => undefined);
      await this.budgetService.markUncertain(input.userId, input.requestId);
      throw new ResponsesServiceError(
        502,
        'The model provider returned an invalid stream. This call was not retried.',
        'ambiguous_response',
      );
    }

    const service = this;
    async function* stream() {
      const chunks = [];
      const decoder = new TextDecoder();
      let pendingLine = '';
      let size = 0;
      let consumed = false;
      let uncertaintyRecorded = false;
      try {
        for await (const value of response.body) {
          const chunk = Buffer.from(value);
          size += chunk.byteLength;
          if (size > MAX_UPSTREAM_RESPONSE_BYTES) {
            throw new Error('Upstream response was unexpectedly large.');
          }
          pendingLine += decoder.decode(chunk, { stream: true });
          let newline = pendingLine.indexOf('\n');
          while (newline >= 0) {
            if (newline > MAX_SSE_LINE_CHARACTERS) {
              throw new Error('Upstream SSE event was unexpectedly large.');
            }
            pendingLine = pendingLine.slice(newline + 1);
            newline = pendingLine.indexOf('\n');
          }
          if (pendingLine.length > MAX_SSE_LINE_CHARACTERS) {
            throw new Error('Upstream SSE event was unexpectedly large.');
          }
          chunks.push(chunk);
          yield chunk;
        }
        consumed = true;
        pendingLine += decoder.decode();
        if (pendingLine.length > MAX_SSE_LINE_CHARACTERS) {
          throw new Error('Upstream SSE event was unexpectedly large.');
        }
      } catch (error) {
        await service.budgetService.markUncertain(input.userId, input.requestId);
        uncertaintyRecorded = true;
        throw error;
      } finally {
        if (!consumed && !uncertaintyRecorded) {
          await service.budgetService.markUncertain(
            input.userId,
            input.requestId,
          );
        }
      }

      let usage;
      try {
        usage = parseStreamingProviderUsage(
          Buffer.concat(chunks).toString('utf8'),
          input.body.model,
        );
      } catch {
        usage = null;
      }
      if (!usage) {
        await service.budgetService.markUncertain(input.userId, input.requestId);
        return;
      }
      const actualMicroUsd = service.catalog.calculateUsageCost(usage);
      await service.budgetService.settle({
        actualMicroUsd,
        durationMs: Date.now() - startedAt,
        requestId: input.requestId,
        usage,
        userId: input.userId,
      });
      console.info(
        JSON.stringify({
          durationMs: Date.now() - startedAt,
          event: 'inference.settled',
          lane: 'responses',
          microUsd: actualMicroUsd,
          model: usage.model,
          requestId: input.requestId,
          responseId: usage.responseId,
          taskId: input.taskId,
          usageSource: usage.source,
        }),
      );
    }

    return {
      contentType,
      headers: {},
      status: response.status,
      stream: stream(),
    };
  }
}
