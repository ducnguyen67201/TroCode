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
  const statusLabel = (status: string) => {
    const labels: Record<string, [string, string]> = {
      not_received: ['Not received', 'Chưa nhận bài'], received: ['Received', 'Đã nhận'],
      preparing: ['Preparing', 'Đang chuẩn bị'], running: ['In progress', 'Đang học'],
      waiting_for_student: ['Waiting for student', 'Chờ học sinh'], paused: ['Paused', 'Tạm dừng'],
      blocked: ['Needs attention', 'Cần hỗ trợ'], stopped: ['Stopped', 'Đã dừng'],
      failed: ['Failed', 'Thất bại'], unknown: ['Outcome unknown', 'Chưa rõ kết quả'],
      expired: ['Expired', 'Đã hết hạn'], finished: ['Finished', 'Hoàn thành'],
    };
    return labels[status]?.[vi ? 1 : 0] ?? status.replaceAll('_', ' ');
  };
  const counts = Object.entries(progress?.counts ?? {}).filter(([, count]) => count > 0);
  return (
    <section className="lesson-progress" aria-label={vi ? 'Tiến độ bài học' : 'Lesson progress'}>
      <details className="lesson-roster">
        <summary>
          <strong>{vi ? 'Tiến độ học sinh' : 'Student progress'}</strong>
          <span className="lesson-progress__counts" aria-live="polite">
            {progress ? counts.length > 0
              ? counts.map(([status, count]) => <span key={status} className="lesson-status" data-status={status}><strong>{count}</strong> {statusLabel(status)}</span>)
              : <span>{vi ? 'Chưa có báo cáo' : 'No reports yet'}</span>
              : <span>{error ? (vi ? 'Chưa có dữ liệu' : 'Unavailable') : (vi ? 'Đang tải…' : 'Loading…')}</span>}
          </span>
        </summary>
        <p className="lesson-note">{vi ? 'Đã gửi không có nghĩa là đã bắt đầu trên máy học sinh.' : 'Sent does not mean started on the student computer.'}</p>
        {progress && <>
          {progress.rows.length === 0 && <p className="lesson-note">{vi ? 'Chưa có học sinh trên trang này.' : 'No students on this page yet.'}</p>}
          <ul className="lesson-students">
            {progress.rows.map((row) => {
              const stepIndex = draft.plan.steps.findIndex((step) => step.id === row.stepId);
              const needsUpdate = row.device && row.device.lessonsVersion < draft.plan.schemaVersion;
              return <li key={row.userId}>
                <div className="lesson-student__identity">
                  <span className="lesson-student__avatar" aria-hidden="true">{row.userId.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{vi ? 'Học sinh' : 'Student'} {row.userId.slice(0, 8)}</strong>
                    {stepIndex >= 0 && <small>{vi ? 'Bước' : 'Step'} {stepIndex + 1} / {draft.plan.steps.length}</small>}
                  </span>
                  <span className="lesson-status" data-status={row.status}>{statusLabel(row.status)}</span>
                </div>
                {needsUpdate ? <p className="lesson-student__guidance">{vi ? 'Cập nhật và khởi động lại Tro trên máy học sinh để nhận bài.' : 'Update and restart Tro on this student’s computer to receive the lesson.'}</p>
                  : row.status === 'not_received' && <p className="lesson-student__guidance">{vi ? 'Kiểm tra kết nối và phiên bản Tro trên máy học sinh.' : 'Check the student’s connection and Tro version.'}</p>}
                <details className="lesson-device">
                  <summary>{vi ? 'Chi tiết học sinh' : 'Student details'}</summary>
                  <dl>
                    <div><dt>{vi ? 'Mã học sinh' : 'Student ID'}</dt><dd>{row.userId}</dd></div>
                    {row.device && <>
                      <div><dt>{vi ? 'Phiên bản Tro' : 'Tro build'}</dt><dd>{row.device.build}</dd></div>
                      <div><dt>{vi ? 'Kết nối' : 'Connection'}</dt><dd>{row.device.connected ? vi ? 'Đã kết nối' : 'Connected' : vi ? 'Mất kết nối' : 'Connection stale'}</dd></div>
                      <div><dt>{vi ? 'Bài học tự động' : 'Automatic lessons'}</dt><dd>{row.device.ready ? vi ? 'Bật' : 'On' : vi ? 'Tắt' : 'Off'}</dd></div>
                    </>}
                    {row.reasonCode && <div><dt>{vi ? 'Lý do' : 'Reason'}</dt><dd>{row.reasonCode.replaceAll('_', ' ')}</dd></div>}
                    {row.criterionOutcomes.map((item) => <div key={item.criterionId}><dt>{item.criterionId}</dt><dd>{item.outcome.replaceAll('_', ' ')}</dd></div>)}
                  </dl>
                </details>
              </li>;
            })}
          </ul>
          {(progress.nextCursor || cursor) && <div className="lesson-actions">
            {cursor && <button type="button" onClick={() => setCursor(undefined)}>{vi ? 'Về trang đầu' : 'First page'}</button>}
            {progress.nextCursor && <button type="button" onClick={() => setCursor(progress.nextCursor ?? undefined)}>{vi ? 'Trang tiếp theo' : 'Next page'}</button>}
          </div>}
        </>}
      </details>
      <button className="lesson-button--stop" type="button" disabled={stopped} onClick={() => {
        void window.tro.lessons?.stop({ ...draft.binding, lessonId })
          .then(() => setStopped(true))
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not stop lesson.'));
      }}>
        {stopped ? vi ? 'Đã dừng bài học' : 'Lesson stopped' : vi ? 'Dừng bài học cho cả lớp' : 'Stop lesson for class'}
      </button>
      {error && <p role="alert">{error}</p>}
      {!progress && !error && <p className="lesson-note" role="status">{vi ? 'Đang tải tiến độ…' : 'Loading student progress…'}</p>}
    </section>
  );
}
