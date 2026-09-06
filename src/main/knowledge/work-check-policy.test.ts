import { describe, expect, it } from 'vitest';

import { WorkCheckDecisionSchema } from '../../shared/contracts';

import { assessWorkCheck } from './work-check-policy';
import { workCheckFixture } from './work-check.fixture';

describe('advisory work-check policy', () => {
  it('attaches host identity and titles without mutating official progress', () => {
    const f = workCheckFixture();
    expect(f.report).toMatchObject({
      overall: 'looks_ready',
      taskId: f.packet.taskId,
      criteria: [{ title: 'Repeat ten times' }],
    });
    expect(f.activity.priorProgress.completedCriterionIds).toEqual([]);
    expect(JSON.stringify(f.report)).not.toContain('for i in range');
  });
  it.each(['reference', 'missing'] as const)(
    'does not accept %s proof',
    (kind) => {
      const f = workCheckFixture();
      if (kind === 'reference') f.packet.evidence[0]!.kind = 'reference';
      else f.decision.criteria[0]!.evidenceIds = [];
      const result = assessWorkCheck(f.packet, f.decision, f.report.checkedAt);
      expect(result).toMatchObject({
        overall: 'incomplete_context',
        criteria: [{ outcome: 'not_verified' }],
      });
    },
  );
  it.each(['unknown criterion', 'duplicate criterion', 'unknown evidence'])(
    'rejects %s',
    (invalid) => {
      const f = workCheckFixture();
      if (invalid === 'unknown criterion')
        f.decision.criteria[0]!.criterionId = 'invented';
      if (invalid === 'duplicate criterion')
        f.decision.criteria.push(f.decision.criteria[0]!);
      if (invalid === 'unknown evidence')
        f.decision.criteria[0]!.evidenceIds = ['invented'];
      expect(() =>
        assessWorkCheck(f.packet, f.decision, f.report.checkedAt),
      ).toThrow();
    },
  );
  it('makes partial coverage and omitted criteria incomplete', () => {
    const f = workCheckFixture();
    f.packet.coverage.partial = true;
    expect(
      assessWorkCheck(f.packet, f.decision, f.report.checkedAt).overall,
    ).toBe('incomplete_context');
    expect(
      assessWorkCheck(
        f.packet,
        { ...f.decision, criteria: [] },
        f.report.checkedAt,
      ).criteria[0]!.outcome,
    ).toBe('not_verified');
    expect(
      assessWorkCheck(
        f.packet,
        {
          ...f.decision,
          criteria: [{ ...f.decision.criteria[0]!, outcome: 'needs_work' }],
        },
        f.report.checkedAt,
      ).overall,
    ).toBe('needs_work');
  });
  it('never invents a passing checklist or accepts model completion fields', () => {
    const f = workCheckFixture();
    f.activity.activity.criteria = [];
    expect(
      assessWorkCheck(
        f.packet,
        { criteria: [], summary: 'Perfect' },
        f.report.checkedAt,
      ),
    ).toMatchObject({
      overall: 'incomplete_context',
      summary: expect.stringContaining('No checklist'),
    });
    expect(
      WorkCheckDecisionSchema.safeParse({ ...f.decision, completed: true })
        .success,
    ).toBe(false);
    expect(
      WorkCheckDecisionSchema.safeParse({
        ...f.decision,
        summary: 'x'.repeat(1201),
      }).success,
    ).toBe(false);
  });
});
