import { randomUUID } from 'node:crypto';

import type { LessonLocalState, LessonStep } from '../../shared/classroom-lesson-contracts';
import { lessonExecutionRoute } from '../../shared/lesson-execution-policy';

import type { ClassroomLessonClient } from './classroom-lesson-client';

/** Persist a stable child identity before dispatch; resolve lost receipts without replay. */
export async function claimLessonChild(state: LessonLocalState, step: LessonStep, purpose: 'help' | 'check' | 'work', client: ClassroomLessonClient, persist: () => Promise<void>) {
  const sharedDesktop = lessonExecutionRoute(state.envelope.plan, purpose === 'work' ? step.mode : purpose, state.stepIndex) === 'shared_agent';
  const existing = sharedDesktop ? state.stepTasks[step.id] : undefined;
  if (existing) {
    if (existing.executionId !== state.claim?.executionId || existing.stepId !== step.id || !existing.ownedByThisRequest)
      throw new Error('The persisted step task does not belong to this lesson execution.');
    state.child = existing;
    await persist();
    return;
  }
  const attemptNumber = (state.attempts[step.id] ?? 0) + 1;
  if (attemptNumber > 20) throw new Error('lesson_budget_exhausted');
  state.attempts[step.id] = attemptNumber;
  state.pendingChild = { taskId: randomUUID(), stepId: step.id, attemptNumber, purpose };
  await persist();
  try {
    state.child = await client.startStep(state.claim!.executionId, step.id, {
      taskId: state.pendingChild.taskId,
      attemptNumber,
      purpose,
      clientInstanceId: state.clientInstanceId,
    });
  } catch (error) {
    const found = await client.lookupStep(state.claim!.executionId, step.id, attemptNumber);
    if (!found.claim || found.claim.taskId !== state.pendingChild.taskId) throw error;
    state.child = { ...found.claim, ownedByThisRequest: true };
  }
  if (!state.child.ownedByThisRequest) throw new Error('Step is owned by another request.');
  if (sharedDesktop) {
    state.executionVersion = 2;
    state.stepTasks[step.id] = state.child;
  }
  state.pendingChild = null;
  await persist();
}
