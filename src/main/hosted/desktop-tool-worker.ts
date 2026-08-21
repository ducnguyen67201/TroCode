import {
  HostedDesktopInvocationSchema,
  HostedDesktopResultSchema,
  type GoalSpec,
  type HostedDesktopInvocation,
  type HostedDesktopResult,
  type ProposedAction,
} from '../../shared/contracts';
import {
  isConsequentialEffect,
  raiseActionEffect,
  resolveActionEffect,
} from '../agent/action-effect';
import type { DesktopObservation } from '../agent/execution-contracts';
import { evaluateAction } from '../agent/policy';
import type { RuntimeToolDispatcher } from '../agent/runtime-tool-dispatcher';
import type {
  InteractionToolInput,
  RuntimeToolRegistry,
} from '../agent/runtime-tool-registry';

import {
  HOSTED_AGENT_TOOL_SCHEMA_DIGEST,
  hostedToolMetadata,
} from './desktop-worker-protocol';

export interface DesktopToolWorkerOptions {
  approvalProvider?: (runId: string, action: ProposedAction) => Promise<boolean>;
  commitResult(result: HostedDesktopResult): Promise<void>;
  dispatcher: Pick<RuntimeToolDispatcher, 'dispatch'>;
  goalProvider(runId: string): GoalSpec | undefined;
  interactionProvider?: (
    runId: string,
    input: InteractionToolInput,
  ) => Promise<string>;
  latestObservationProvider?: (runId: string) => DesktopObservation | undefined;
  registry: Pick<RuntimeToolRegistry, 'list' | 'supports'>;
  requestExecuting(
    invocationId: string,
    metadata: {
      effect: HostedDesktopInvocation['effect'];
      intentRevision: number;
      approvalRequired: boolean;
      authorizationSource: HostedDesktopInvocation['authorizationSource'];
      consequential: boolean;
    },
  ): Promise<boolean>;
  taskIdProvider(runId: string): string | undefined;
}

const MAX_RECENT_RESULTS = 500;

export class DesktopToolWorker {
  private readonly recent = new Map<string, HostedDesktopResult>();
  private readonly latestObservations = new Map<string, DesktopObservation>();

  constructor(private readonly options: DesktopToolWorkerOptions) {}

  async handle(input: unknown, signal = new AbortController().signal): Promise<HostedDesktopResult> {
    const envelope = HostedDesktopInvocationSchema.parse(input);
    const cached = this.recent.get(envelope.invocationId);
    if (cached) {
      await this.options.commitResult(cached);
      return cached;
    }
    const result = await this.execute(envelope, signal).catch((error: unknown) => ({
      invocationId: envelope.invocationId,
      status: signal.aborted ? 'cancelled' as const : 'failed' as const,
      summary: error instanceof Error ? error.message.slice(0, 1_000) : 'Desktop execution failed.',
      evidence: [],
    }));
    const parsed = HostedDesktopResultSchema.parse(result);
    this.remember(parsed);
    await this.options.commitResult(parsed);
    return parsed;
  }

  private async execute(
    envelope: HostedDesktopInvocation,
    signal: AbortSignal,
  ): Promise<HostedDesktopResult> {
    if (envelope.schemaDigest !== HOSTED_AGENT_TOOL_SCHEMA_DIGEST) {
      return this.result(
        envelope,
        'not_executed',
        'The backend and desktop tool schemas do not match.',
      );
    }
    if (Date.parse(envelope.expiresAt) <= Date.now()) {
      return this.result(envelope, 'not_executed', 'The desktop invocation expired.');
    }
    const metadata = hostedToolMetadata(envelope.toolId, envelope.operation);
    if (!metadata) {
      return this.result(
        envelope,
        'not_executed',
        'The desktop invocation policy metadata did not match.',
      );
    }
    const goal = this.options.goalProvider(envelope.runId);
    if (!goal) return this.result(envelope, 'not_executed', 'The local task authority is unavailable.');
    const taskId = this.options.taskIdProvider(envelope.runId);
    if (!taskId) return this.result(envelope, 'not_executed', 'The hosted run is not mapped to a local task.');
    const latestObservation =
      this.options.latestObservationProvider?.(envelope.runId) ??
      this.latestObservations.get(envelope.runId);
    const definition = this.options.registry
      .list({ goal, latestObservation, taskId })
      .find((candidate) => candidate.id === envelope.toolId);
    if (!definition || !definition.operations.includes(envelope.operation)) {
      return this.result(envelope, 'not_executed', 'The desktop does not support this tool operation.');
    }
    const normalizedInput =
      envelope.toolId === 'computer.control'
        ? {
            ...envelope.input,
            effect: envelope.input.effect ?? envelope.effect,
            attendees: envelope.input.attendees ?? null,
          }
        : envelope.input;
    const parsedInput = definition.parse(JSON.stringify(normalizedInput));
    const invocation = definition.normalize(
      parsedInput,
      { arguments: JSON.stringify(envelope.input), callId: envelope.callId, name: definition.modelName },
      {
        goal,
        latestObservation,
        taskId,
      },
    );
    if (invocation.operation !== envelope.operation || invocation.toolId !== envelope.toolId) {
      return this.result(envelope, 'not_executed', 'The normalized tool identity did not match the signed envelope.');
    }
    const currentIntentRevision = goal.schemaVersion === 8
      ? goal.intentAuthorization.revision
      : 0;
    if (envelope.intentRevision !== currentIntentRevision) {
      return this.result(envelope, 'not_executed', 'The desktop invocation uses a stale intent revision.');
    }
    let executionMetadata = {
      effect: envelope.effect,
      intentRevision: currentIntentRevision,
      approvalRequired: envelope.approvalRequired,
      authorizationSource: envelope.authorizationSource,
      consequential: envelope.consequential,
    };
    if (invocation.action) {
      const effect = raiseActionEffect(
        resolveActionEffect(invocation.action),
        resolveActionEffect({ ...invocation.action, effect: envelope.effect }),
      );
      const action = { ...invocation.action, effect };
      const decision = evaluateAction(goal, action, this.options.registry);
      if (decision.status === 'denied') return this.result(envelope, 'not_executed', decision.summary);
      if (decision.status === 'needs_approval') {
        const approved = await this.options.approvalProvider?.(envelope.runId, action);
        if (!approved) return this.result(envelope, 'denied', 'The user denied or did not grant the exact action approval.');
        executionMetadata = {
          effect: decision.effect,
          intentRevision: currentIntentRevision,
          approvalRequired: true,
          authorizationSource: 'exact_approval',
          consequential: isConsequentialEffect(decision.effect),
        };
      } else {
        executionMetadata = {
          effect: decision.effect,
          intentRevision: currentIntentRevision,
          approvalRequired: false,
          authorizationSource: decision.authorizationSource,
          consequential: decision.consequential,
        };
      }
    }
    if (!await this.options.requestExecuting(envelope.invocationId, executionMetadata)) {
      return this.result(envelope, 'not_executed', 'The backend did not grant the one-time executing transition.');
    }
    const outcome = invocation.toolId === 'task.interaction'
      ? {
          status: 'confirmed' as const,
          summary: 'The user answered the clarification request.',
          data: {
            answer: await this.options.interactionProvider?.(
              envelope.runId,
              invocation.input as InteractionToolInput,
            ) ?? (() => {
              throw new Error('Hosted clarification is unavailable.');
            })(),
          },
        }
      : await this.options.dispatcher.dispatch(invocation, {
          signal,
          taskId,
        });
    if (outcome.observation) {
      this.latestObservations.set(envelope.runId, outcome.observation);
    }
    const evidence = envelope.obligations.map((obligation) => {
      const status = outcome.status === 'confirmed'
        ? 'supports' as const
        : outcome.status === 'unknown'
          ? 'unknown' as const
          : 'contradicts' as const;
      if (obligation.verifierKind === 'application_surface') {
        const surface = outcome.data?.applicationSurfaceEvidence as {
          observationId?: string;
          observationFingerprint?: string;
        } | undefined;
        return {
          criterionId: obligation.criterionId,
          source: 'fresh_observation' as const,
          status: surface?.observationId && surface.observationFingerprint ? status : 'unknown' as const,
          ...(surface?.observationId ? { observationId: surface.observationId } : {}),
          ...(surface?.observationFingerprint ? { observationFingerprint: surface.observationFingerprint } : {}),
          summary: outcome.summary,
        };
      }
      return {
        criterionId: obligation.criterionId,
        source: obligation.verifierKind === 'browser_semantic'
          ? 'browser_dom' as const
          : obligation.verifierKind === 'filesystem_effect'
            ? 'filesystem' as const
            : 'tool_result' as const,
        status,
        summary: outcome.summary,
      };
    });
    return HostedDesktopResultSchema.parse({
      invocationId: envelope.invocationId,
      status: outcome.status,
      summary: outcome.summary,
      ...(outcome.data ? { data: outcome.data } : {}),
      ...(outcome.imageDataUrl
        ? {
            visual: {
              dataBase64: outcome.imageDataUrl.split(',', 2)[1],
              detail: 'original',
              mimeType: outcome.imageDataUrl.startsWith('data:image/png')
                ? 'image/png'
                : 'image/jpeg',
              observationId:
                String((outcome.data?.crop as { observationId?: string } | undefined)?.observationId),
            },
          }
        : {}),
      evidence,
    });
  }

  private result(
    envelope: HostedDesktopInvocation,
    status: HostedDesktopResult['status'],
    summary: string,
  ): HostedDesktopResult {
    return HostedDesktopResultSchema.parse({
      invocationId: envelope.invocationId,
      status,
      summary,
      evidence: envelope.obligations.map((obligation) => ({
        criterionId: obligation.criterionId,
        source: obligation.verifierKind === 'application_surface' ? 'fresh_observation' : 'tool_result',
        status: status === 'unknown' ? 'unknown' : 'contradicts',
        summary,
      })),
    });
  }

  private remember(result: HostedDesktopResult): void {
    this.recent.set(result.invocationId, result);
    while (this.recent.size > MAX_RECENT_RESULTS) {
      const oldest = this.recent.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.recent.delete(oldest);
    }
  }
}
