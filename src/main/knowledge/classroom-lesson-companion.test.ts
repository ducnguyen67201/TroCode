import { randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';

import { LessonLocalStateSchema } from '../../shared/classroom-lesson-contracts';

import { lessonCompanionCard } from './classroom-lesson-companion';
import { lessonFixture } from './classroom-lesson.fixture';

it('presents parent controls while opening, without declaring task completion', () => {
  const f = lessonFixture();
  const active = LessonLocalStateSchema.parse({
    schemaVersion: 1,
    ownerId: 'student',
    anchorAttemptId: randomUUID(),
    envelope: f.envelope,
    revision: 4,
    status: 'preparing',
    reasonCode: null,
    claim: null,
    clientStartId: randomUUID(),
    clientInstanceId: randomUUID(),
    stepIndex: 0,
    attempts: {},
    child: null,
    pendingChild: null,
    phase: 'Opening material',
    text: '',
    feedback: [],
    actionCount: 0,
    modelRequestCount: 0,
    observationCount: 0,
    effect: 'dispatching',
    material: null,
    pendingReports: [],
  });
  const card = lessonCompanionCard({ active, pending: [], autoRunConsent: true, error: null });
  expect(card?.lesson).toMatchObject({ status: 'preparing', revision: 4 });
  expect(card?.message).toContain('Opening material');
  active.status = 'stopped';
  expect(lessonCompanionCard({ active, pending: [], autoRunConsent: true, error: null })).toBeNull();
});
