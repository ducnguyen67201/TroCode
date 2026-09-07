import { useState } from 'react';
import type { z } from 'zod';

import type { LessonContinueSchema } from '../../../shared/classroom-lesson-contracts';
import type { AppLanguage } from '../../../shared/contracts';
import '../../classroom-lesson.css';

import { ClassroomLessonMaterialPanel } from './ClassroomLessonMaterialPanel';
import { useClassroomLesson } from './use-classroom-lesson';

export function ClassroomLessonPanel({ appLanguage }: { appLanguage: AppLanguage }) {
  const view = useClassroomLesson();
  const [question, setQuestion] = useState('');
  const [error, setError] = useState('');
  const vi = appLanguage === 'vi';
  const state = view?.active;
  if (!view || (!state && !view.pending.length && !view.error)) return null;
  const act = (
    action: z.infer<typeof LessonContinueSchema>['action'],
    lessonId = state?.envelope.lessonId,
    expectedRevision = state?.revision ?? 0,
  ) => {
    if (!lessonId) return;
    setError('');
    void window.tro.lessons
      ?.continue({
        action,
        lessonId,
        expectedRevision,
        ...(action === 'question'
          ? { text: question || (vi ? 'Giúp em hiểu bước tiếp theo.' : 'Help me understand the next step.') }
          : {}),
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Lesson could not continue.'));
  };
  const terminal = state && ['finished', 'stopped', 'expired', 'failed', 'unknown'].includes(state.status);
  return (
    <section className="classroom-lesson-panel" aria-label={vi ? 'Bài học của giáo viên' : 'Teacher lesson'}>
      <h3>{vi ? 'Bài học của giáo viên' : 'Teacher lesson'}</h3>
      <label>
        <input
          type="checkbox"
          checked={view.autoRunConsent}
          onChange={(e) => {
            void window.tro.lessons?.consent({ enabled: e.target.checked });
          }}
        />
        {vi
          ? 'Cho phép mở tài liệu và làm mẫu tự động trong buổi học'
          : 'Allow automatic material opening and demonstrations this session'}
      </label>
      {(error || view.error) && <p role="alert">{error || view.error}</p>}
      {state && (
        <>
          <h4>{state.envelope.plan.title}</h4>
          <p role="status">
            {state.phase} · {state.status.replaceAll('_', ' ')}
          </p>
          <p>
            {vi ? 'Bước' : 'Step'} {Math.min(state.stepIndex + 1, state.envelope.plan.steps.length)} /{' '}
            {state.envelope.plan.steps.length}
          </p>
          {state.reasonCode && (
            <p>
              {state.reasonCode.replaceAll('_', ' ')}.{' '}
              {state.status === 'unknown'
                ? vi
                  ? 'Kết quả thao tác chưa rõ. Tro sẽ không lặp lại. Dừng bài và kiểm tra màn hình trước khi nhận bài mới.'
                  : 'An action outcome is uncertain. Tro will not repeat it. Stop this lesson and inspect the screen before accepting a new one.'
                : vi
                  ? 'Kiểm tra quyền và tài liệu, rồi chọn Tiếp tục.'
                  : 'Check permissions and material, then choose Resume.'}
            </p>
          )}
          <ClassroomLessonMaterialPanel key={`${state.envelope.lessonId}:${state.material?.resource.id}`} state={state} vi={vi} />
          {state.text && <p className="lesson-explanation">{state.text}</p>}
          {state.feedback.length > 0 && (
            <ul>
              {state.feedback.map((f) => (
                <li key={f.criterionId}>
                  <strong>{f.outcome.replaceAll('_', ' ')}</strong>: {f.explanation}
                  {f.evidenceLocator && <small>{f.evidenceLocator}</small>}
                </li>
              ))}
            </ul>
          )}
          <div className="lesson-actions">
            {!terminal && (
              <button type="button" onClick={() => act('pause')}>
                {vi ? 'Tạm dừng' : 'Pause'}
              </button>
            )}
            {!['finished', 'stopped', 'expired'].includes(state.status) && (
              <button type="button" onClick={() => act('stop')}>
                {vi ? 'Dừng' : 'Stop'}
              </button>
            )}
            {['paused', 'blocked', 'received'].includes(state.status) && (
              <button type="button" onClick={() => act('resume')}>
                {vi ? 'Tiếp tục' : 'Resume'}
              </button>
            )}
            {state.status === 'waiting_for_student' && (
              <>
                <button type="button" onClick={() => act('next')}>
                  {state.stepIndex + 1 === state.envelope.plan.steps.length
                    ? vi
                      ? 'Kết thúc bài học'
                      : 'Finish lesson'
                    : vi
                      ? 'Bước tiếp theo'
                      : 'Next step'}
                </button>
                {['practice', 'check'].includes(state.envelope.plan.steps[state.stepIndex]?.mode ?? '') && (
                  <button type="button" onClick={() => act('check')}>
                    {vi ? 'Kiểm tra bài của em' : 'Check my work'}
                  </button>
                )}
              </>
            )}
          </div>
          {!terminal && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                act('question');
              }}
            >
              <label>
                {vi ? 'Em cần giúp gì?' : 'What do you need help with?'}
                <textarea value={question} maxLength={4000} onChange={(e) => setQuestion(e.target.value)} />
              </label>
              <button type="submit">{vi ? 'Hỏi trợ giúp' : 'Ask for help'}</button>
            </form>
          )}
        </>
      )}
      {view.pending.map((lesson) => (
        <div key={lesson.lessonId}>
          <p>{lesson.plan.title}</p>
          <button
            type="button"
            disabled={Boolean(state && !['finished', 'stopped', 'expired'].includes(state.status))}
            onClick={() => act('start', lesson.lessonId, 0)}
          >
            {vi ? 'Bắt đầu bài học' : 'Start lesson'}
          </button>
        </div>
      ))}
    </section>
  );
}
