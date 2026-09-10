import type { LessonLocalState } from '../../shared/classroom-lesson-contracts';

import type { ClassroomLessonClient } from './classroom-lesson-client';

/** Retrieval must not return material after the active lesson changes. */
export async function readLessonResourcePage(
  current: () => LessonLocalState | null,
  authorize: () => Promise<void>,
  client: ClassroomLessonClient,
  lessonId: string, resourceId: string, ordinal: number,
) {
  const state = current();
  if (!state || state.envelope.lessonId !== lessonId || state.material?.resource.id !== resourceId)
    throw new Error('Material changed.');
  const revision = state.revision;
  const assertCurrent = () => {
    if (current() !== state || state.revision !== revision || state.material?.resource.id !== resourceId)
      throw new Error('Material changed.');
  };
  await authorize();
  assertCurrent();
  const material = await client.material(state.anchorAttemptId, lessonId, resourceId, ordinal);
  await authorize();
  assertCurrent();
  return material;
}
