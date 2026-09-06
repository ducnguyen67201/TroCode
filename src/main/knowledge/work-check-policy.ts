import {
  WorkCheckDecisionSchema,
  WorkCheckReportSchema,
  type ActivityContext,
  type WorkCheckCoverage,
  type WorkCheckEvidence,
  type WorkCheckReport,
} from '../../shared/contracts';

export interface WorkCheckPacket {
  taskId: string;
  checkId: string;
  activity: ActivityContext;
  coverage: WorkCheckCoverage;
  evidence: WorkCheckEvidence[];
  sources: Array<{ id: string; text: string }>;
}

/** Suggestions never update official criterion or assignment completion. */
export function assessWorkCheck(
  packet: WorkCheckPacket,
  input: unknown,
  checkedAt: string,
): WorkCheckReport {
  const decision = WorkCheckDecisionSchema.parse(input);
  const allowed = new Set(packet.activity.activity.criteria.map((c) => c.id));
  const evidence = new Map(packet.evidence.map((e) => [e.id, e]));
  const seen = new Set<string>();
  for (const row of decision.criteria) {
    if (!allowed.has(row.criterionId) || seen.has(row.criterionId))
      throw new Error('Check returned an invalid criterion.');
    if (row.evidenceIds.some((id) => !evidence.has(id)))
      throw new Error('Check cited unavailable evidence.');
    seen.add(row.criterionId);
  }
  const criteria = packet.activity.activity.criteria.map((criterion) => {
    const row = decision.criteria.find((c) => c.criterionId === criterion.id);
    if (
      !row ||
      (row.outcome !== 'not_verified' &&
        !row.evidenceIds.some((id) => evidence.get(id)?.kind !== 'reference'))
    ) {
      return {
        title: criterion.title,
        criterionId: criterion.id,
        outcome: 'not_verified' as const,
        evidenceIds: [],
        explanation:
          'The available student work does not verify this requirement.',
      };
    }
    return { ...row, title: criterion.title };
  });
  const overall = criteria.some((c) => c.outcome === 'needs_work')
    ? 'needs_work'
    : !criteria.length ||
        packet.coverage.partial ||
        criteria.some((c) => c.outcome === 'not_verified')
      ? 'incomplete_context'
      : 'looks_ready';
  return WorkCheckReportSchema.parse({
    taskId: packet.taskId,
    checkId: packet.checkId,
    attemptId: packet.activity.attemptId,
    activityVersionId: packet.activity.activityVersionId,
    checkedAt,
    overall,
    criteria,
    summary: !criteria.length
      ? 'No checklist was provided. Ask your teacher what to check.'
      : decision.summary,
    coverage: packet.coverage,
    evidence: packet.evidence,
  });
}
