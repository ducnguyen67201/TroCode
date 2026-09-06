import { randomUUID } from 'node:crypto';

import { ActivityContextSchema } from '../../shared/contracts';

import { classroomFixture } from './classroom-broadcast.fixture';
import { assessWorkCheck, type WorkCheckPacket } from './work-check-policy';

export function workCheckFixture() {
  const fixture = classroomFixture();
  fixture.attempt.definition.launchTarget = 'current_surface';
  fixture.attempt.definition.criteria = [
    {
      id: 'loop',
      title: 'Repeat ten times',
      description: 'Use a loop to print ten values.',
      tags: [],
    },
  ];
  const activity = ActivityContextSchema.parse({
    attemptId: fixture.attempt.attemptId,
    workSessionId: randomUUID(),
    activityVersionId: fixture.attempt.activityVersionId,
    runId: fixture.attempt.run.id,
    space: fixture.attempt.space,
    activity: fixture.attempt.definition,
    purpose: 'check',
    currentDirective: null,
    insightPolicy: fixture.attempt.run.insightPolicy,
    insightPolicyVersion: '1',
    policyAcknowledged: true,
    sourceCatalog: [],
    priorProgress: fixture.attempt.priorProgress,
  });
  const timestamp = '2026-09-05T06:00:00.000Z';
  const packet: WorkCheckPacket = {
    taskId: randomUUID(),
    checkId: randomUUID(),
    activity,
    coverage: {
      kind: 'saved_files',
      partial: false,
      notes: ['Saved files only.'],
    },
    evidence: [
      {
        id: 'file-1',
        kind: 'file',
        label: 'main.py',
        capturedAt: timestamp,
        fingerprint: 'a'.repeat(64),
      },
    ],
    sources: [{ id: 'file-1', text: 'for i in range(10): print(i)' }],
  };
  const decision = {
    summary: 'The loop repeats ten times.',
    criteria: [
      {
        criterionId: 'loop',
        outcome: 'looks_met' as const,
        explanation: 'The range contains ten values.',
        evidenceIds: ['file-1'],
      },
    ],
  };
  return {
    ...fixture,
    activity,
    packet,
    decision,
    report: assessWorkCheck(packet, decision, timestamp),
  };
}
