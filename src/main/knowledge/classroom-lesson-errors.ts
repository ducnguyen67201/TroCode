import type { LessonReason } from '../../shared/classroom-lesson-contracts';

/** Only throw before an effect has been dispatched. Unknown native outcomes use the normal error path. */
export class LessonBlockedError extends Error {
  constructor(
    readonly reason: LessonReason,
    message: string,
  ) {
    super(message);
    this.name = 'LessonBlockedError';
  }
}
