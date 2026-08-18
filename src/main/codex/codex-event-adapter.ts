import type { AgentRuntimeActivity } from '../agent/agent-runtime';

import {
  CodexAgentMessageDeltaSchema,
  CodexItemLifecycleSchema,
  CodexPlanUpdatedSchema,
  CodexTurnCompletedSchema,
  CodexWarningSchema,
  type CodexMethodEnvelope,
} from './codex-protocol';

export interface CodexTurnScope {
  threadId: string;
  turnId: string;
}

export type AdaptedCodexEvent =
  | { kind: 'activity'; activity: AgentRuntimeActivity }
  | { kind: 'completed'; status: 'completed' | 'failed' | 'interrupted' }
  | { kind: 'ignored' };

function assertScope(
  actual: { threadId: string; turnId: string },
  expected: CodexTurnScope,
): void {
  if (
    actual.threadId !== expected.threadId ||
    actual.turnId !== expected.turnId
  ) {
    throw new Error('Codex event did not match the active thread and turn.');
  }
}

function toolLabel(type: string): string | null {
  switch (type) {
    case 'commandExecution':
      return 'workspace_command';
    case 'fileChange':
      return 'workspace_file_change';
    case 'mcpToolCall':
      return 'workspace_connector';
    case 'webSearch':
      return 'workspace_web_search';
    default:
      return null;
  }
}

/** Maps only bounded summaries; command output, diffs, arguments, and reasoning are dropped. */
export function adaptCodexEvent(
  event: CodexMethodEnvelope,
  scope: CodexTurnScope,
): AdaptedCodexEvent {
  if (event.method === 'item/agentMessage/delta') {
    const parsed = CodexAgentMessageDeltaSchema.parse(event);
    assertScope(parsed.params, scope);
    return {
      kind: 'activity',
      activity: { kind: 'text_delta', textDelta: parsed.params.delta },
    };
  }
  if (event.method === 'turn/plan/updated') {
    const parsed = CodexPlanUpdatedSchema.parse(event);
    assertScope(parsed.params, scope);
    return {
      kind: 'activity',
      activity: {
        kind: 'plan_updated',
        summary: parsed.params.explanation ?? 'Workspace plan updated.',
        plan: parsed.params.plan.map((step) => ({
          step: step.step,
          status: step.status === 'inProgress' ? 'in_progress' : step.status,
        })),
      },
    };
  }
  if (event.method === 'item/started' || event.method === 'item/completed') {
    const parsed = CodexItemLifecycleSchema.parse(event);
    assertScope(parsed.params, scope);
    const started = parsed.method === 'item/started';
    const name = toolLabel(parsed.params.item.type);
    if (!name) return { kind: 'ignored' };
    return {
      kind: 'activity',
      activity: {
        kind: started ? 'tool_started' : 'tool_completed',
        summary: started ? `Started ${name}.` : `Completed ${name}.`,
        tool: { name, status: started ? 'running' : 'completed' },
      },
    };
  }
  if (event.method === 'turn/completed') {
    const parsed = CodexTurnCompletedSchema.parse(event);
    assertScope(
      { threadId: parsed.params.threadId, turnId: parsed.params.turn.id },
      scope,
    );
    return {
      kind: 'completed',
      status:
        parsed.params.turn.status === 'completed'
          ? 'completed'
          : parsed.params.turn.status === 'failed'
            ? 'failed'
            : 'interrupted',
    };
  }
  if (
    event.method === 'warning' ||
    event.method === 'configWarning' ||
    event.method === 'deprecationNotice'
  ) {
    const parsed = CodexWarningSchema.parse(event);
    if (
      parsed.method === 'warning' &&
      parsed.params.threadId &&
      parsed.params.threadId !== scope.threadId
    ) {
      throw new Error('Codex warning did not match the active thread.');
    }
    const summary =
      parsed.method === 'warning'
        ? parsed.params.message
        : [parsed.params.summary, parsed.params.details]
            .filter(Boolean)
            .join(' ');
    return {
      kind: 'activity',
      activity: { kind: 'status', summary },
    };
  }
  return { kind: 'ignored' };
}
