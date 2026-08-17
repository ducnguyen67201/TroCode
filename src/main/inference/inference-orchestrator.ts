import { randomUUID } from 'node:crypto';

import type { AgentTurn, ModelToolSpec } from '../agent/agent-contracts';

import { selectInferenceProfile } from './inference-profile-policy';
import type { InferenceSession } from './inference-session';
import { assertModelSupportsProfile } from './model-catalog';
import type { ResponsesGateway } from './responses-gateway';

export interface InferenceOrchestratorOptions {
  configuredModel?: string;
  gateway: ResponsesGateway;
  instructions: string;
  qualityOverride?: boolean;
}

export class InferenceOrchestrator {
  private readonly configuredModel?: string;

  private readonly gateway: ResponsesGateway;

  private readonly instructions: string;

  private readonly qualityOverride: boolean;

  constructor(options: InferenceOrchestratorOptions) {
    this.configuredModel = options.configuredModel?.trim() || undefined;
    this.gateway = options.gateway;
    this.instructions = options.instructions;
    this.qualityOverride = options.qualityOverride ?? false;
  }

  async sample(
    session: InferenceSession,
    tools: readonly ModelToolSpec[],
    signal?: AbortSignal,
  ): Promise<AgentTurn> {
    const sample = session.beginSample();
    const selected = selectInferenceProfile({
      hasCurrentImage: sample.hasCurrentImage,
      qualityOverride: this.qualityOverride,
      requestLength: session.request.length,
    });
    const profile = this.configuredModel
      ? { ...selected, model: this.configuredModel }
      : selected;
    assertModelSupportsProfile(profile.model, profile.id);
    const stableTools = [...tools].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    const result = await this.gateway.call(
      {
        credential: session.credential,
        imageCount: sample.imageCount,
        input: sample.input,
        instructions: this.instructions,
        profile,
        requestId: randomUUID(),
        responsesUrl: session.responsesUrl,
        sampleOrdinal: sample.ordinal,
        taskId: session.taskId,
        tools: stableTools,
      },
      signal,
    );
    session.recordTurn(result.turn);
    const usage = result.metadata.usage;
    console.info(
      '[inference] sample.completed',
      JSON.stringify({
        cacheWriteTokens: usage?.cacheWriteTokens ?? null,
        cachedInputTokens: usage?.cachedInputTokens ?? null,
        durationMs: result.metadata.durationMs,
        imageCount: result.metadata.imageCount,
        inputTokens: usage?.inputTokens ?? null,
        lane: result.metadata.lane,
        model: usage?.model ?? profile.model,
        outputTokens: usage?.outputTokens ?? null,
        profile: profile.id,
        requestId: result.metadata.requestId,
        responseId: usage?.responseId ?? null,
        sampleOrdinal: result.metadata.sampleOrdinal,
        taskId: result.metadata.taskId,
        usageSource: usage?.source ?? 'missing',
      }),
    );
    return result.turn;
  }
}
