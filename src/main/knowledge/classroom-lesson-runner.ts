import type { LessonLocalState, LessonMaterial, LessonMode } from '../../shared/classroom-lesson-contracts';

export interface LessonRunner {
  busy(): boolean;
  reserve(parentId: string): void;
  release(parentId: string): void;
  prepare(state: LessonLocalState, material: LessonMaterial, signal: AbortSignal): Promise<void>;
  run(
    state: LessonLocalState,
    mode: LessonMode | 'help',
    question: string | undefined,
    signal: AbortSignal,
  ): Promise<{ text: string; feedback: LessonLocalState['feedback']; disposition?: 'continue' | 'step_finished'; modelRequestCount?: number }>;
  cancel(taskId: string): Promise<'confirmed' | 'unknown'>;
}
