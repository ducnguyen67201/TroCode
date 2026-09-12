import { randomUUID } from 'node:crypto';

import type { ToolExecutionResult } from '../agent/agent-contracts';

import { normalizedCuaActionEffect, type CuaOpenToolResult } from './cua-semantic-contracts';

export function cuaOpenToolOutcome(toolName: string, result: CuaOpenToolResult): ToolExecutionResult {
  const effect = normalizedCuaActionEffect(result);
  const structured = (() => {
    if (!result.structuredJson) return undefined;
    try {
      return JSON.parse(result.structuredJson) as unknown;
    } catch {
      return result.structuredJson.slice(0, 500_000);
    }
  })();
  const image = result.images[0];
  const summary = (
    result.text.trim() ||
    result.errorCode ||
    (result.isError ? 'CUA tool execution failed.' : `CUA completed ${toolName}.`)
  ).slice(0, 1_000);
  const imageObservationId = image ? randomUUID() : undefined;
  const data = {
    ...(structured === undefined ? {} : { result: structured }),
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    ...(imageObservationId ? { crop: { observationId: imageObservationId } } : {}),
  };
  if (result.isError || effect === 'refused') {
    return {
      status: effect === 'refused' ? 'denied' : 'failed',
      summary,
      ...(Object.keys(data).length > 0 ? { data } : {}),
    };
  }
  const confirmed = effect === undefined || effect === 'confirmed';
  return {
    status: confirmed ? 'confirmed' : 'unknown',
    ...(['press_key', 'type_text', 'click', 'scroll'].includes(toolName) && (effect === 'unverifiable' || effect === 'suspected_noop') ? { recovery: 'observe' as const } : {}),
    summary,
    ...(Object.keys(data).length > 0 ? { data } : {}),
    ...(image && ['image/jpeg', 'image/png'].includes(image.mimeType)
      ? { imageDataUrl: `data:${image.mimeType};base64,${image.dataBase64}` }
      : {}),
  };
}
