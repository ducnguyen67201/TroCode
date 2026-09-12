import type { ToolExecutionResult } from '../agent/agent-contracts';
import type { DesktopObservation } from '../agent/execution-contracts';

import { cuaOpenToolOutcome } from './cua-open-tool-outcome';
import type { CuaDriverCatalog, CuaOpenToolResult } from './cua-semantic-contracts';

/** Adapts admitted native tools to the host's evidence and target contracts. */
export async function executeCatalogCuaTool(
  taskId: string, toolName: string, input: Record<string, unknown>, driverCatalogDigest: string,
  options: {
    catalog: CuaDriverCatalog | null;
    hostProcessId: number;
    observe(taskId: string, signal?: AbortSignal): Promise<DesktopObservation>;
    callTool(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<CuaOpenToolResult>;
  },
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
    const catalog = options.catalog;
    if (!catalog || catalog.driverCatalogDigest !== driverCatalogDigest) {
      return {
        status: 'not_executed',
        summary: 'The installed CUA tool catalog changed before execution.',
      };
    }
    const tool = catalog.tools.find((candidate) => candidate.name === toolName);
    if (!tool) {
      return {
        status: 'not_executed',
        summary: 'The requested CUA tool is not in the installed driver catalog.',
      };
    }
    // Keep raw catalog observation on the same host path as observe_context:
    // it prepares legacy desktop scope and returns actionable observation evidence.
    if (tool.name === 'get_desktop_state') {
      return { status: 'confirmed', summary: 'Captured the current desktop. Inspect it before choosing the next action.',
        observation: await options.observe(taskId, signal) };
    }
    if (input.pid === options.hostProcessId) {
      return { status: 'not_executed', summary: 'This PID belongs to the Cua host, not an external application. Use observe_context or list_windows to locate the intended external window and its exact PID/window_id.' };
    }
    const argumentsValue = {
      ...input,
      ...(tool.injectSession ? { session: taskId } : {}),
    };
    const result = await options.callTool(tool.name, argumentsValue, signal);
    return cuaOpenToolOutcome(tool.name, result);
}
