import type { LocalToolExecutionResult } from '../../../services/agent-runtime/src/protocol';
import type { ToolExecutionResult } from '../agent/agent-contracts';
import type { DesktopObservation } from '../agent/execution-contracts';

function modelObservationData(observation: DesktopObservation) {
  return {
    capturedAt: observation.capturedAt,
    degraded: observation.degraded,
    observationId: observation.observationId,
    fingerprint: observation.fingerprint,
    route: observation.route,
    text: observation.text,
    ...(observation.structuredState ? { structuredState: observation.structuredState } : {}),
    ...(observation.coordinateSpace ? { coordinateSpace: observation.coordinateSpace } : {}),
    ...(observation.surface ? { surface: observation.surface } : {}),
    ...(observation.elements ? { elements: observation.elements } : {}),
  };
}

export function normalizeLocalToolResult(result: ToolExecutionResult): LocalToolExecutionResult {
  const status = result.status === 'confirmed' ? 'completed' : result.status === 'unknown' ? 'unknown' : 'failed';
  const data = result.observation
    ? {
        ...(result.data ?? {}),
        observation: modelObservationData(result.observation),
      }
    : (result.data ?? null);
  const observationImageDataUrl = result.observation?.screenshot
    ? `data:${result.observation.screenshot.mimeType};base64,${result.observation.screenshot.dataBase64}`
    : null;
  return {
    status,
    summary: result.summary.slice(0, 1_000),
    data,
    imageDataUrl: result.imageDataUrl ?? observationImageDataUrl,
  };
}
