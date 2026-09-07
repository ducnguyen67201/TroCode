import { useEffect, useState } from 'react';

import type { LessonDraft, LessonProgress } from '../../../shared/classroom-lesson-contracts';

export function ClassroomLessonProgress({ draft, vi }: { draft: LessonDraft; vi: boolean }) {
  const [progress, setProgress] = useState<LessonProgress | null>(null);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [stopped, setStopped] = useState(false);
  const lessonId = draft.receipt?.lesson.lessonId;
  useEffect(() => {
    if (!lessonId || !window.tro.lessons) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await window.tro.lessons!.progress({ spaceId: draft.binding.spaceId, sessionId: draft.binding.sessionId, lessonId, cursor });
        if (live) {
          setProgress(next);
          setError('');
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Progress unavailable.');
      } finally {
        if (live)
          timer = setTimeout(() => {
            void poll();
          }, 4000);
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [lessonId, draft.binding.spaceId, draft.binding.sessionId, cursor]);
  if (!lessonId) return null;
  return (
    <section aria-label={vi ? 'Tiến độ bài học' : 'Lesson progress'}>
      <h4>{vi ? 'Tiến độ học sinh' : 'Student progress'}</h4>
      <p>
        {vi
          ? 'Đã gửi không có nghĩa là đã bắt đầu trên máy học sinh.'
          : 'Sent does not mean started on the student computer.'}
      </p>
      {error && <p role="alert">{error}</p>}
      {progress && (
        <>
          <p aria-live="polite">
            {Object.entries(progress.counts)
              .map(([status, count]) => `${status.replaceAll('_', ' ')}: ${count}`)
              .join(' · ')}
          </p>
          <ul>
            {progress.rows.map((row) => (
              <li key={row.userId}>
                {row.userId.slice(0, 8)} —{' '}
                {row.status === 'not_received'
                  ? vi
                    ? 'Chưa nhận bài; kiểm tra kết nối và phiên bản Tro'
                    : 'Not received; check connection and Tro version'
                  : row.status.replaceAll('_', ' ')}
                {row.stepId && (
                  <small>
                    {' '}
                    · {vi ? 'Bước' : 'Step'} {draft.plan.steps.findIndex((step) => step.id === row.stepId) + 1}
                  </small>
                )}
                {row.criterionOutcomes.map((item) => (
                  <small key={item.criterionId}>
                    {' '}
                    · {item.criterionId}: {item.outcome.replaceAll('_', ' ')}
                  </small>
                ))}
                {row.reasonCode ? ` (${row.reasonCode.replaceAll('_', ' ')})` : ''}
                {row.device && (
                  <small>
                    {' '}
                    · {row.device.build} ·{' '}
                    {row.device.connected
                      ? row.device.ready
                        ? 'automatic lessons on'
                        : 'automatic lessons off'
                      : 'connection stale'}
                  </small>
                )}
              </li>
            ))}
          </ul>
          {progress.nextCursor && (
            <button type="button" onClick={() => setCursor(progress.nextCursor ?? undefined)}>
              {vi ? 'Trang tiếp theo' : 'Next page'}
            </button>
          )}
          {cursor && (
            <button type="button" onClick={() => setCursor(undefined)}>
              {vi ? 'Về trang đầu' : 'First page'}
            </button>
          )}
        </>
      )}
      <button
        type="button"
        disabled={stopped}
        onClick={() => {
          void window.tro.lessons
            ?.stop({ ...draft.binding, lessonId })
            .then(() => setStopped(true))
            .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not stop lesson.'));
        }}
      >
        {stopped
          ? vi
            ? 'Đã dừng bài học'
            : 'Lesson stopped'
          : vi
            ? 'Dừng bài học cho cả lớp'
            : 'Stop lesson for class'}
      </button>
    </section>
  );
}
