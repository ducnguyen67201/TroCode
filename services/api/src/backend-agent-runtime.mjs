import {
  Agent,
  OpenAIProvider,
  RunContext,
  Runner,
  RunState,
  tool,
  withCustomSpan,
  withTrace,
} from '@openai/agents';
import OpenAI from 'openai';
import { z } from 'zod';

import { AGENT_TOOL_SCHEMA_DIGEST, AgentToolCatalog } from './agent-tool-catalog.mjs';
import { ActionEffectSchema } from './agent-runtime-contracts.mjs';

const SYSTEM_INSTRUCTIONS = [
  'You are Tro, a general-purpose agent. Treat the original request as a checklist.',
  'Use only the supplied tools. Tool calls are executed by a trusted desktop worker.',
  'For every tool call, declare the exact typed effect. Read, observe, and navigation use effect kind none. Private reversible creation or edits use their specific create/update/workspace effect. Sending, invitations, deletion, publish, deploy, merge, money, credentials, permissions, install, sensitive transfer, and ambiguous submit must use their matching hard-confirm or unknown effect.',
  'The authenticated user instruction authorizes in-scope reversible work when the desktop host matches it. Do not ask again unless a material choice is missing; the host independently enforces exact approval for hard-confirm effects.',
  'Never claim a side effect succeeded without a confirmed tool result or fresh evidence.',
  'Never retry an action whose result is unknown.',
  'Return a concise user-facing final answer only after every requested outcome is satisfied.',
].join('\n');

function modelToolName(toolId) {
  return toolId.replaceAll('.', '__').replaceAll('-', '_');
}

export function interruptionDetails(item, definitions, intentRevision) {
  const raw = item.rawItem;
  if (raw.type !== 'function_call') throw new Error('Backend runtime received a non-function interruption.');
  const definition = definitions.find((candidate) => modelToolName(candidate.toolId) === raw.name);
  if (!definition) throw new Error('Interrupted tool is not in the current server catalog.');
  const parsed = JSON.parse(raw.arguments);
  const operation = parsed.operation;
  if (!definition.operations.includes(operation)) throw new Error('Interrupted tool operation is not allowlisted.');
  const effect = ActionEffectSchema.parse(parsed.effect);
  const consequential = effect.kind !== 'none';
  return {
    callId: raw.callId,
    effect,
    intentRevision,
    approvalRequired: consequential,
    authorizationSource: consequential ? 'none' : 'routine',
    consequential,
    input: parsed.input,
    operation,
    toolId: definition.toolId,
  };
}

export class BackendAgentRuntime {
  constructor({
    budgetedTransport,
    catalog = new AgentToolCatalog(),
    modelPolicy,
    openAiApiKey,
    runnerFactory,
  }) {
    this.budgetedTransport = budgetedTransport;
    this.catalog = catalog;
    this.modelPolicy = modelPolicy;
    this.openAiClient = new OpenAI({ apiKey: openAiApiKey, fetch: budgetedTransport.readonlyFetch });
    this.provider = new OpenAIProvider({ openAIClient: this.openAiClient, useResponses: true });
    this.runnerFactory = runnerFactory ?? (() => new Runner({
      modelProvider: this.provider,
      traceIncludeSensitiveData: false,
      tracingDisabled: false,
      workflowName: 'TroCode durable task',
    }));
  }

  createGraph({ capabilities, resolveCommittedToolResult, route }) {
    const definitions = this.catalog.intersect(capabilities);
    const tools = definitions.map((definition) => tool({
      name: modelToolName(definition.toolId),
      description: `Request ${definition.toolId} using one allowlisted operation.`,
      parameters: z.object({
        operation: z.enum(definition.operations),
        effect: ActionEffectSchema,
        input: z.record(z.string(), z.unknown()),
      }).strict(),
      strict: true,
      needsApproval: true,
      execute: async (input, runContext, details) => {
        const callId = details?.toolCall?.callId;
        if (!callId) throw new Error('Agents SDK omitted the committed tool call ID.');
        return resolveCommittedToolResult({
          callId,
          input: input.input,
          operation: input.operation,
          toolId: definition.toolId,
          runContext: runContext.context,
        });
      },
    }));
    const agent = new Agent({
      name: 'Tro durable agent',
      instructions: SYSTEM_INSTRUCTIONS,
      model: route.model,
      modelSettings: {
        parallelToolCalls: false,
        reasoning: { effort: route.reasoningEffort },
        store: false,
      },
      tools,
    });
    return { agent, definitions, digest: AGENT_TOOL_SCHEMA_DIGEST };
  }

  async start(input) {
    const route = this.modelPolicy.route(input.routeInput);
    const graph = this.createGraph({ ...input, route });
    const runner = this.runnerFactory();
    const context = new RunContext({ runId: input.runId });
    const result = await this.#runTraced(input, route, 'start', () =>
      this.budgetedTransport.runWithContext(input.budgetContext, () =>
        runner.run(graph.agent, input.request, {
          context,
          maxTurns: input.maxTurns ?? 30,
          session: input.session,
          signal: input.signal,
        })));
    return this.#describeResult(result, graph, route, input.intentRevision ?? 0);
  }

  async resume(input) {
    const route = this.modelPolicy.route(input.routeInput);
    const graph = this.createGraph({ ...input, route });
    if (input.graphDigest !== graph.digest) {
      return { kind: 'blocked', reason: 'upgrade_required', summary: 'The saved run uses a different agent tool graph.' };
    }
    const runContext = new RunContext({ runId: input.runId });
    const state = await RunState.fromStringWithContext(
      graph.agent,
      input.serializedState,
      runContext,
      { contextStrategy: 'replace' },
    );
    const pending = state.getInterruptions();
    const interruption = pending.find((item) => item.rawItem.type === 'function_call' && item.rawItem.callId === input.callId);
    if (!interruption) throw new Error('Saved run state does not contain the committed tool call.');
    state.approve(interruption, { alwaysApprove: false });
    const runner = this.runnerFactory();
    const result = await this.#runTraced(input, route, 'resume', () =>
      this.budgetedTransport.runWithContext(input.budgetContext, () =>
        runner.run(graph.agent, state, {
          context: runContext,
          maxTurns: input.maxTurns ?? 30,
          session: input.session,
          signal: input.signal,
        })));
    return this.#describeResult(result, graph, route, input.intentRevision ?? 0);
  }

  #describeResult(result, graph, route, intentRevision) {
    const interruptions = result.interruptions ?? [];
    if (interruptions.length > 1) throw new Error('Parallel remote tool interruptions are disabled.');
    if (interruptions.length === 1) {
      return {
        kind: 'interrupted',
        graphDigest: graph.digest,
        invocation: interruptionDetails(interruptions[0], graph.definitions, intentRevision),
        route,
        serializedState: result.state.toString({ includeTracingApiKey: false }),
      };
    }
    return {
      kind: 'completed',
      finalOutput: String(result.finalOutput ?? ''),
      route,
      usage: result.state.usage,
    };
  }

  async #runTraced(input, route, phase, operation) {
    return withTrace(
      'TroCode durable task',
      () => withCustomSpan(
        () => operation(),
        {
          data: {
            name: 'trocode.agent.runtime',
            data: {
              model: route.model,
              phase,
              reason_code: route.reasonCode,
              reasoning_effort: route.reasoningEffort,
            },
          },
        },
      ),
      {
        groupId: input.runId,
        metadata: { runtime: 'trocode_backend_agent_v2' },
      },
    );
  }
}
