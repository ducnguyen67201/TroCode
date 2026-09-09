import { randomUUID } from 'node:crypto';

import { LessonLocalStateSchema, type ClassroomLessonPlan, type LessonContext, type LessonEnvelope, type LessonMode } from '../../shared/classroom-lesson-contracts';

import { lessonDigest } from './classroom-lesson-policy';

export function lessonFixture(mode: LessonMode = 'explain') {
  const resource = {
    id: randomUUID(),
    kind: 'web' as const,
    title: 'Greeting editor',
    url: 'https://example.com/editor',
    origin: 'https://example.com',
  };
  const plan: ClassroomLessonPlan = {
    schemaVersion: mode === 'open' ? 2 : 1,
    targetRunId: randomUUID(),
    activityVersionId: randomUUID(),
    title: 'Greeting',
    objective: 'Learn variables',
    language: 'en',
    resources: [resource],
    steps: [
      {
        id: randomUUID(),
        mode,
        objective: 'Read a name',
        instruction: 'Explain name input.',
        resourceId: resource.id,
        criterionIds: mode === 'open' ? [] : ['name'],
        demonstration:
          mode === 'demonstrate' ? { exampleDescription: 'Print a name', expectedResult: 'Greeting visible' } : null,
      },
    ],
  };
  const context: LessonContext = {
    maxPlanVersion: 2,
    sessionId: randomUUID(),
    targetRunId: plan.targetRunId,
    activityVersionId: plan.activityVersionId,
    title: plan.title,
    instructions: 'Read a name and greet.',
    allowedOrigins: [resource.origin],
    criteria: [{ id: 'name', title: 'Name', description: 'Read input' }],
    sources: [],
    launchTarget: 'current_surface',
    answerReveal: 'allowed',
  };
  const envelope: LessonEnvelope = {
    lessonId: randomUUID(),
    sessionId: context.sessionId,
    sequence: 1,
    contractVersion: 1,
    plan,
    planDigest: lessonDigest(plan),
    state: 'active',
    createdAt: new Date().toISOString(),
    serverTime: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1800_000).toISOString(),
  };
  return { plan, context, envelope, resource };
}

export function lessonStateFixture(mode: LessonMode = 'explain') {
  const f = lessonFixture(mode);
  return LessonLocalStateSchema.parse({
    schemaVersion: 1, ownerId: 'student', anchorAttemptId: randomUUID(), envelope: f.envelope,
    revision: 3, status: 'preparing', reasonCode: null, claim: null,
    clientStartId: randomUUID(), clientInstanceId: randomUUID(), stepIndex: 0, attempts: {},
    child: null, pendingChild: null, phase: 'Opening material', text: '', feedback: [],
    actionCount: 0, modelRequestCount: 0, observationCount: 0, effect: 'dispatching',
    material: { resource: { id: f.resource.id, kind: 'assignment', title: 'Python lesson' },
      text: 'name = input("Name: ")', chunks: [], nextOrdinal: null }, pendingReports: [],
  });
}
