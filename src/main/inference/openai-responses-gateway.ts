import { createHash } from 'node:crypto';

import { z } from 'zod';

import { parseAgentTurn } from '../agent/agent-contracts';

import {
  InferenceCallMetadataSchema,
  ProviderUsageSchema,
  type ProviderUsage,
} from './inference-contracts';
import {
  ResponsesGatewayError,
  type ResponsesGateway,
  type ResponsesGatewayRequest,
  type ResponsesGatewayResult,
} from './responses-gateway';

const MAX_RESPONSE_BYTES = 2_000_000;

const ProviderEnvelopeSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    usage: z
      .object({
        input_tokens: z.number().int().nonnegative(),
        input_tokens_details: z
          .object({
            cached_tokens: z.number().int().nonnegative().default(0),
            cache_write_tokens: z.number().int().nonnegative().default(0),
          })
          .passthrough()
          .optional(),
        output_tokens: z.number().int().nonnegative(),
        output_tokens_details: z
          .object({
            reasoning_tokens: z.number().int().nonnegative().default(0),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function abortError(): Error {
  const error = new Error('Inference call was cancelled.');
  error.name = 'AbortError';
  return error;
}

function providerUsage(value: unknown, expectedModel: string): ProviderUsage | null {
  const envelope = ProviderEnvelopeSchema.parse(value);
  if (!envelope.usage) return null;
  return ProviderUsageSchema.parse({
    cacheWriteTokens:
      envelope.usage.input_tokens_details?.cache_write_tokens ?? 0,
    cachedInputTokens:
      envelope.usage.input_tokens_details?.cached_tokens ?? 0,
    inputTokens: envelope.usage.input_tokens,
    model: envelope.model ?? expectedModel,
    outputTokens: envelope.usage.output_tokens,
    reasoningTokens:
      envelope.usage.output_tokens_details?.reasoning_tokens ?? 0,
    responseId: envelope.id,
    source: 'actual',
  });
}

function explicitRejection(status: number): boolean {
  return [400, 401, 403, 404, 422].includes(status);
}

export class OpenAIResponsesGateway implements ResponsesGateway {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 45_000,
  ) {}

  async call(
    request: ResponsesGatewayRequest,
    signal?: AbortSignal,
  ): Promise<ResponsesGatewayResult> {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    const relayAbort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener('abort', relayAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(request.responsesUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${request.credential}`,
            'Content-Type': 'application/json',
            'OpenAI-Safety-Identifier': createHash('sha256')
              .update(request.taskId)
              .digest('hex'),
            'X-Trocode-Request-Id': request.requestId,
            'X-Trocode-Task-Id': request.taskId,
          },
          body: JSON.stringify({
            input: request.input,
            instructions: request.instructions,
            max_output_tokens: request.profile.maxOutputTokens,
            model: request.profile.model,
            parallel_tool_calls: false,
            reasoning: { effort: request.profile.reasoningEffort },
            store: false,
            text: { verbosity: request.profile.verbosity },
            tool_choice: 'auto',
            tools: request.tools,
          }),
          signal: controller.signal,
        });
      } catch {
        if (signal?.aborted) throw abortError();
        throw new ResponsesGatewayError(
          controller.signal.aborted
            ? 'The inference request timed out and was not retried.'
            : 'The inference dispatch outcome is unknown and was not retried.',
          controller.signal.aborted ? 'ambiguous' : 'ambiguous',
        );
      }
      const responseText = await response.text();
      if (responseText.length > MAX_RESPONSE_BYTES) {
        throw new ResponsesGatewayError(
          'The provider response was unexpectedly large and was not retried.',
          'ambiguous',
          response.status,
        );
      }
      if (!response.ok) {
        let message = `OpenAI Responses returned HTTP ${response.status}.`;
        try {
          const parsed = z
            .object({ error: z.object({ message: z.string() }).optional() })
            .parse(JSON.parse(responseText));
          message = parsed.error?.message.slice(0, 600) ?? message;
        } catch {
          // Keep only bounded status metadata when the provider body is malformed.
        }
        throw new ResponsesGatewayError(
          message,
          explicitRejection(response.status)
            ? 'rejected_before_inference'
            : 'ambiguous',
          response.status,
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        throw new ResponsesGatewayError(
          'The provider returned malformed JSON and the call was not retried.',
          'ambiguous',
          response.status,
        );
      }
      const turn = parseAgentTurn(parsed);
      const metadata = InferenceCallMetadataSchema.parse({
        durationMs: Date.now() - startedAt,
        imageCount: request.imageCount,
        lane: 'responses',
        requestId: request.requestId,
        sampleOrdinal: request.sampleOrdinal,
        taskId: request.taskId,
        usage: providerUsage(parsed, request.profile.model),
      });
      return { metadata, turn };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', relayAbort);
    }
  }
}
