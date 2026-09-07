import { describe, expect, it } from 'vitest';

import { lessonFixture } from '../knowledge/classroom-lesson.fixture';

import type { CoachDecisionInput } from './coach-runtime';
import { lessonCoachInstruction, validateLessonFeedback } from './lesson-coach-response';

function input(): CoachDecisionInput {
  const f = lessonFixture('check');
  return {
    activity: null,
    taskId: f.envelope.lessonId,
    request: 'Check my greeting',
    priorProgress: null,
    observation: null,
    lesson: {
      mode: 'check',
      step: f.plan.steps[0]!,
      language: 'vi',
      materialText: '',
      demonstratedExamples: ['Teacher printed a name.'],
    },
  };
}
describe('lesson evidence feedback', () => {
  it('cannot claim observed success without screen evidence', () => {
    expect(
      validateLessonFeedback(input(), [
        { criterionId: 'name', outcome: 'observed', explanation: 'Looks correct', evidenceLocator: 'Editor' },
      ])[0],
    ).toMatchObject({ outcome: 'insufficient_evidence', evidenceLocator: null });
  });
  it('rejects invented or duplicate criteria and distinguishes teacher examples', () => {
    expect(() =>
      validateLessonFeedback(input(), [
        { criterionId: 'invented', outcome: 'observed', explanation: 'Yes', evidenceLocator: null },
      ]),
    ).toThrow('exactly');
    expect(lessonCoachInstruction(input())).toContain('do not count those unchanged examples');
  });
});
