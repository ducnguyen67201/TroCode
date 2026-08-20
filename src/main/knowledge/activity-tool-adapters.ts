import { randomUUID } from 'node:crypto';

import type { RuntimeToolExecutionAdapter } from '../agent/runtime-tool-dispatcher';
import type { ActivitySignalToolInput, KnowledgeSearchToolInput } from '../agent/runtime-tool-registry';

import type { KnowledgeSpaceClient } from './knowledge-space-client';

export function createActivityToolAdapters(
  client: Pick<KnowledgeSpaceClient, 'recordEvidence' | 'searchKnowledge'>,
): RuntimeToolExecutionAdapter[] {
  const signalCounts = new Map<string, number>();
  return [
    {
      id: 'knowledge.search',
      async execute(invocation) {
        const input = invocation.input as KnowledgeSearchToolInput;
        const result = await client.searchKnowledge(input.attemptId, { query: input.query, limit: input.limit });
        return {
          status: 'confirmed',
          summary: result.results.length ? `Found ${result.results.length} pinned Activity reference result(s).` : 'No pinned Activity reference matched the query.',
          data: result,
        };
      },
    },
    {
      id: 'activity.signal',
      async execute(invocation, context) {
        const used = signalCounts.get(context.taskId) ?? 0;
        if (used >= 20) return { status: 'denied', summary: 'This Work Session reached its bounded evidence-signal limit.' };
        const input = invocation.input as ActivitySignalToolInput;
        const evidence = await client.recordEvidence(input.attemptId, {
          clientId: randomUUID(), workSessionId: input.workSessionId, criterionId: input.criterionId,
          tag: input.tag, provenance: 'agent_candidate', resultCode: input.resultCode,
        });
        signalCounts.set(context.taskId, used + 1);
        return {
          status: 'confirmed',
          summary: 'Recorded one provenance-labeled hypothesis for facilitator review.',
          data: { criterionId: evidence.criterionId, tag: evidence.tag, provenance: evidence.provenance, resultCode: evidence.resultCode },
        };
      },
    },
  ];
}
