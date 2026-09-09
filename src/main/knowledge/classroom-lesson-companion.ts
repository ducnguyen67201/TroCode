import { randomUUID } from 'node:crypto';

import type { LessonView } from '../../shared/classroom-lesson-contracts';
import type { CompanionResponseCard } from '../../shared/contracts';

export function lessonCompanionCard(view: LessonView): CompanionResponseCard | null {
  const state = view.active;
  if (!state || ['stopped', 'expired'].includes(state.status)) return null;
  return {
    cardId: randomUUID(),
    taskId: state.envelope.lessonId,
    phase: ['received', 'preparing', 'running'].includes(state.status) ? 'streaming' : 'completed',
    side: 'right',
    lesson: { revision: state.revision, status: state.status, language: state.envelope.plan.language, continueExplanation: state.teachingProgress?.disposition === 'continue' },
    message: `${state.envelope.plan.title}\n${state.phase}\n${view.error || (['preparing', 'running'].includes(state.status) ? '' : state.text)}`.slice(0, 8000),
  };
}
