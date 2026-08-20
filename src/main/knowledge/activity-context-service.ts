import { randomUUID } from 'node:crypto';

import { ActivityContextSchema, type ActivityContext, type HostedAttemptContext } from '../../shared/contracts';

import type { KnowledgeSpaceClient } from './knowledge-space-client';

export class ActivityContextService {
  constructor(private readonly client: KnowledgeSpaceClient) {}

  inspect(attemptId: string): Promise<HostedAttemptContext> {
    return this.client.getAttempt(attemptId);
  }

  async create(attempt: HostedAttemptContext, taskId: string, launchKind: 'none' | 'workspace' | 'current_surface'): Promise<ActivityContext> {
    const attemptId = attempt.attemptId;
    const workSession = await this.client.createWorkSession(attemptId, { clientId: randomUUID(), taskId, launchKind });
    return ActivityContextSchema.parse({
      attemptId, workSessionId: workSession.id, activityVersionId: attempt.activityVersionId, runId: attempt.run.id,
      space: attempt.space,
      activity: attempt.definition,
      insightPolicy: attempt.run.insightPolicy,
      insightPolicyVersion: attempt.run.insightPolicyVersion,
      policyAcknowledged: attempt.acknowledgedPolicyVersion === attempt.run.insightPolicyVersion,
      sourceCatalog: attempt.sourceCatalog,
      priorProgress: attempt.priorProgress,
    });
  }
}
