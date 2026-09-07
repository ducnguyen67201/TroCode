import { randomUUID } from 'node:crypto';

import type { LessonView } from '../../shared/classroom-lesson-contracts';
import type { CompanionResponseCard } from '../../shared/contracts';

export function lessonCompanionCard(view: LessonView): CompanionResponseCard | null {
  const state = view.active;
  if (!state || state.child || ['stopped', 'finished', 'expired'].includes(state.status)) return null;
  return {
    cardId: randomUUID(),
    taskId: state.envelope.lessonId,
    phase: 'completed',
    side: 'right',
    lesson: { revision: state.revision, status: state.status, language: state.envelope.plan.language },
    message: `${state.envelope.plan.title}\n${state.phase}\n${state.text || view.error || ''}`.slice(0, 8000),
  };
}
