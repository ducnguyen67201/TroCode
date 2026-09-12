import { tool, type FunctionTool, type RunToolApprovalItem } from '@openai/agents';

import { turnMessageIdentity, type LocalAgentRunContext } from './host-backed-session.js';
import { childRequestId } from './host-bridge.js';
import type {
  LocalRuntimeToolSpec,
  LocalToolExecutionResult,
  RequiredInitialToolCall,
} from './protocol.js';
import { digest } from './serialization.js';

export class ToolOutcomeUnknownError extends Error {
  constructor(readonly callId: string) {
    super('The tool outcome is unknown and cannot be retried.');
    this.name = 'ToolOutcomeUnknownError';
  }
}

export interface PendingToolCall {
  readonly arguments: Record<string, unknown>;
  readonly callId: string;
  readonly catalogDigest: string;
  readonly driverCatalogDigest: string | null;
  readonly idempotencyDigest: string;
  readonly modelName: string;
  readonly operation: string;
  readonly toolId: string;
}

export interface ToolSurface {
  readonly tools: readonly unknown[];
  pendingCompletion(): string[];
  markCheckpointed(call: PendingToolCall): void;
  resolve(interruption: RunToolApprovalItem): PendingToolCall;
}

export interface ToolSurfaceAdmission {
  readonly acceptedModelNames: string[];
  readonly rejected: Array<{
    readonly message: string;
    readonly modelName: string;
    readonly toolId: string;
  }>;
}

export class ToolSurfaceFactory {
  inspect(
    specs: readonly LocalRuntimeToolSpec[],
    catalogDigest: string,
  ): ToolSurfaceAdmission {
    const acceptedModelNames: string[] = [];
    const rejected: ToolSurfaceAdmission['rejected'] = [];
    for (const spec of specs) {
      try {
        this.create([spec], catalogDigest);
        acceptedModelNames.push(spec.modelName);
      } catch (error) {
        rejected.push({
          message:
            error instanceof Error
              ? error.message.slice(0, 1_000)
              : 'The Agents SDK rejected this tool schema.',
          modelName: spec.modelName,
          toolId: spec.toolId,
        });
      }
    }
    return { acceptedModelNames, rejected };
  }

  create(
    specs: readonly LocalRuntimeToolSpec[],
    catalogDigest: string,
    requiredInitialTool: RequiredInitialToolCall | null = null,
  ): ToolSurface {
    const byName = new Map<string, LocalRuntimeToolSpec>();
    const checkpointed = new Map<string, PendingToolCall>();
    const pendingCompletion = new Set(specs.filter((spec) => spec.completionRequired).map((spec) => spec.modelName));
    let pendingRequiredInitialTool = requiredInitialTool;
    const tools = specs.map((spec) => {
      if (byName.has(spec.modelName)) throw new Error('duplicate_model_tool_name');
      byName.set(spec.modelName, spec);
      const sdkTool = tool({
        name: spec.modelName,
        description: spec.description,
        parameters: spec.inputSchema as never,
        strict: true,
        needsApproval: true,
        execute: async (_input: Record<string, unknown>, context, details) => {
          const callId = details?.toolCall?.callId;
          if (!callId || !context) throw new Error('missing_sdk_tool_context');
          const pending = checkpointed.get(callId);
          if (!pending) throw new Error('tool_effect_without_durable_checkpoint');
          checkpointed.delete(callId);
          const runtime = context.context as LocalAgentRunContext;
          const requestId = childRequestId();
          const response = await runtime.bridge.request({
            ...turnMessageIdentity(runtime.bridge, runtime.identity),
            requestId,
            kind: 'tool.execute',
            callId: pending.callId,
            toolId: pending.toolId,
            modelName: pending.modelName,
            operation: pending.operation,
            arguments: pending.arguments,
            catalogDigest: pending.catalogDigest,
            driverCatalogDigest: pending.driverCatalogDigest,
            idempotencyDigest: pending.idempotencyDigest,
          }, { signal: runtime.signal, timeoutMs: 180_000 });
          if (response.kind !== 'tool.execute.result') throw new Error('unexpected_tool_execute_response');
          if (response.result.status === 'completed') pendingCompletion.delete(pending.modelName);
          return modelToolResult(response.result, pending.callId);
        },
      }) as FunctionTool<LocalAgentRunContext, never, unknown>;
      if (digest(sdkTool.parameters) !== digest(spec.inputSchema)) {
        throw new Error(
          `The Agents SDK rewrote model schema for ${spec.modelName}; publish an exact provider-compatible schema instead.`,
        );
      }
      return sdkTool;
    });

    return {
      tools,
      pendingCompletion: () => [...pendingCompletion],
      markCheckpointed: (call) => checkpointed.set(call.callId, call),
      resolve: (interruption) => {
        const raw = interruption.rawItem;
        if (raw.type !== 'function_call') throw new Error('unsupported_sdk_interruption');
        const spec = byName.get(raw.name);
        if (!spec) throw new Error('unknown_sdk_tool_interruption');
        if (
          pendingRequiredInitialTool &&
          pendingRequiredInitialTool.modelName !== spec.modelName
        ) {
          throw new Error('required_initial_tool_unavailable');
        }
        const argumentsForExecution = pendingRequiredInitialTool
          ? pendingRequiredInitialTool.arguments
          : parseArguments(raw.arguments);
        const operation = resolveOperation(spec, argumentsForExecution);
        pendingRequiredInitialTool = null;
        const value = {
          arguments: argumentsForExecution,
          callId: raw.callId,
          catalogDigest,
          driverCatalogDigest: spec.driverCatalogDigest,
          modelName: spec.modelName,
          operation,
          toolId: spec.toolId,
        };
        return { ...value, idempotencyDigest: digest(value) };
      },
    };
  }
}

function modelToolResult(result: LocalToolExecutionResult, callId: string): unknown {
  if (result.status === 'unknown' && result.recovery !== 'observe') throw new ToolOutcomeUnknownError(callId);
  if (result.status === 'cancelled') {
    const error = new Error(result.summary);
    error.name = 'AbortError';
    throw error;
  }
  const text = JSON.stringify({
    status: result.status, summary: result.summary, data: result.data,
    ...(result.recovery ? { recovery: 'Use observe_context to capture fresh screen evidence before choosing another action. Do not replay this action. Intermediate UI progress is not final task completion.' } : {}),
  });
  if (!result.imageDataUrl) return text;
  return [{ type: 'text', text }, { type: 'image', image: result.imageDataUrl, detail: 'high' }];
}

function resolveOperation(spec: LocalRuntimeToolSpec, input: Record<string, unknown>): string {
  if (spec.operations.length === 1) return spec.operations[0] as string;
  const commandKind = isRecord(input.command) ? input.command.kind : undefined;
  const candidate = input.kind ?? input.operation ?? input.action ?? commandKind;
  if (typeof candidate === 'string' && spec.operations.includes(candidate)) return candidate;
  throw new Error('unresolved_tool_operation');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseArguments(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new Error('invalid_sdk_tool_arguments');
  return parsed;
}
