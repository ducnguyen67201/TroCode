import { randomUUID } from 'node:crypto';

import type { ClassroomLessonPlan, LessonContext, LessonEnvelope } from '../../shared/classroom-lesson-contracts';

import { lessonDigest } from './classroom-lesson-policy';

export function lessonFixture(mode: 'explain' | 'demonstrate' | 'practice' | 'check' = 'explain') {
  const resource = {
    id: randomUUID(),
    kind: 'web' as const,
    title: 'Greeting editor',
    url: 'https://example.com/editor',
    origin: 'https://example.com',
  };
  const plan: ClassroomLessonPlan = {
    schemaVersion: 1,
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
        criterionIds: ['name'],
        demonstration:
          mode === 'demonstrate' ? { exampleDescription: 'Print a name', expectedResult: 'Greeting visible' } : null,
      },
    ],
  };
  const context: LessonContext = {
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
