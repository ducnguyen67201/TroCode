import { randomUUID } from 'node:crypto';

import { diagnosticText, executionDiagnostic } from '../diagnostics/execution-diagnostics';

import { CuaActionStructuredSchema, normalizedCuaActionEffect, parseCuaStructuredResult, type CuaOpenToolResult } from './cua-semantic-contracts';

export function logNativeResult(name: string, result: CuaOpenToolResult, fields: Record<string, string | number | boolean | null> = {}): void {
  let structured: ReturnType<typeof CuaActionStructuredSchema.parse> | undefined;
  try { structured = parseCuaStructuredResult(result, CuaActionStructuredSchema); } catch { /* Older native contracts may omit structured results. */ }
  const effect = normalizedCuaActionEffect(result);
  const refusal = structured?.refusal;
  executionDiagnostic('cua.result', {
    ...fields, nativeTool: name, isError: result.isError, effect: effect ?? null,
    route: structured?.route ?? result.action?.route ?? null,
    errorCode: result.errorCode ?? structured?.code ?? null,
    refusalCode: typeof refusal === 'object' ? refusal.code : null,
    refusalReason: typeof refusal === 'string' ? refusal : refusal?.reason,
    degraded: result.degraded, screenshotCount: result.images.length,
    // Successful read tools can return an entire document in text.
    error: result.isError || (effect !== undefined && effect !== 'confirmed') ? diagnosticText(result.text) : undefined,
  });
}

export async function traceNativeCall<T extends CuaOpenToolResult>(name: string, args: Record<string, unknown>, execute: () => Promise<T>): Promise<T> {
  const nativeCallId = randomUUID();
  const started = performance.now();
  const fields = {
    nativeCallId,
    ...(typeof args.session === 'string' ? { taskId: args.session } : {}),
    ...(typeof args.pid === 'number' ? { targetPid: args.pid } : {}),
    ...(typeof args.window_id === 'number' ? { targetWindowId: args.window_id } : {}),
    ...(typeof args.delivery_mode === 'string' ? { deliveryMode: args.delivery_mode } : {}),
  };
  executionDiagnostic('cua.started', { ...fields, nativeTool: name });
  try {
    const result = await execute();
    logNativeResult(name, result, { ...fields, durationMs: Math.round(performance.now() - started) });
    return result;
  } catch (error) {
    executionDiagnostic('cua.exception', { ...fields, nativeTool: name, durationMs: Math.round(performance.now() - started), error: diagnosticText(error) });
    throw error;
  }
}
