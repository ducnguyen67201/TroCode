import type { LessonLocalState } from '../../shared/classroom-lesson-contracts';

export function createCoachObserver<T>(options: {
  lesson(): LessonLocalState | null;
  prepare(keepLessonMaterial: boolean): Promise<() => Promise<void>>;
  observe(taskId: string, signal: AbortSignal): Promise<T>;
}) {
  return async (taskId: string, signal: AbortSignal): Promise<T> => {
    const state = options.lesson();
    const keepMaterial = state?.child?.taskId === taskId && state.material != null && state.material.resource.kind !== 'web';
    const cleanup = await options.prepare(keepMaterial);
    try {
      return await options.observe(taskId, signal);
    } finally {
      await cleanup();
    }
  };
}
