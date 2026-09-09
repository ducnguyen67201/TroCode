import { useEffect, useState } from 'react';

import type { LessonContext, LessonDraft } from '../../../shared/classroom-lesson-contracts';
import '../../classroom-lesson.css';

import { ClassroomLessonProgress } from './ClassroomLessonProgress';

export function ClassroomLessonPreview({
  draft,
  onChange,
  vi,
  onBusy,
}: {
  draft: LessonDraft;
  onChange(draft: LessonDraft): void;
  vi: boolean;
  onBusy?(busy: boolean): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [context, setContext] = useState<LessonContext | null>(null);
  useEffect(() => {
    let live = true;
    void window.tro.lessons
      ?.context({ spaceId: draft.binding.spaceId, sessionId: draft.binding.sessionId, runId: draft.plan.targetRunId })
      .then((next) => {
        if (!live) return;
        if (next.activityVersionId !== draft.plan.activityVersionId)
          throw new Error('The assignment changed. Prepare a new lesson.');
        setContext(next);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Could not load lesson criteria.');
      });
    return () => {
      live = false;
    };
  }, [
    draft.draftId,
    draft.binding.spaceId,
    draft.binding.sessionId,
    draft.plan.targetRunId,
    draft.plan.activityVersionId,
  ]);
  const act = async (reconcile = false) => {
    if (!window.tro.lessons) return;
    setBusy(true);
    onBusy?.(true);
    setError('');
    try {
      onChange(
        await (reconcile
          ? window.tro.lessons.reconcile({ draftId: draft.draftId })
          : window.tro.lessons.confirm({ draftId: draft.draftId, revision: draft.revision, digest: draft.digest })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send lesson.');
      try {
        onChange(await window.tro.lessons.draft({ draftId: draft.draftId }));
      } catch {
        /* Keep the exact preview available for reconciliation. */
      }
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };
  return (
    <section className="lesson-preview" aria-label={vi ? 'Xem trước bài học' : 'Exact lesson preview'}>
      <header className="lesson-preview__header">
        <div>
          <h3>{draft.plan.title}</h3>
        </div>
        <span className="lesson-status" data-status={draft.state}>{({
          prepared: vi ? 'Sẵn sàng gửi' : 'Ready to send',
          sending: vi ? 'Đang gửi' : 'Sending',
          sent: vi ? 'Đã gửi' : 'Sent',
          unknown: vi ? 'Cần kiểm tra biên nhận' : 'Receipt needed',
          stale: vi ? 'Cần chuẩn bị lại' : 'Needs refresh',
          expired: vi ? 'Đã hết hạn' : 'Expired',
          cancelled: vi ? 'Đã hủy' : 'Cancelled',
          failed: vi ? 'Gửi thất bại' : 'Send failed',
        })[draft.state]}</span>
      </header>
      <details className="lesson-plan" open={draft.state === 'prepared'}>
        <summary>{vi ? 'Nội dung bài học' : 'Lesson plan'} <span>{draft.plan.steps.length} {vi ? 'bước' : draft.plan.steps.length === 1 ? 'step' : 'steps'} · {draft.plan.resources.length} {vi ? 'tài liệu' : draft.plan.resources.length === 1 ? 'material' : 'materials'}</span></summary>
        <div className="lesson-plan__overview">
          <p className="lesson-preview__objective">{draft.plan.objective}</p>
          <div className="lesson-preview__meta">
            <span>{vi ? 'Bài tập' : 'Assignment'}: {context?.title ?? '…'}</span>
            <span>{draft.plan.language === 'vi' ? 'Tiếng Việt' : 'English'}</span>
            <span>{vi ? 'Hết hạn 30 phút sau khi gửi' : 'Expires 30 min after sending'}</span>
          </div>
        </div>
        <div className="lesson-plan__body">
          <ul className="lesson-resources" aria-label={vi ? 'Tài liệu' : 'Materials'}>
            {draft.plan.resources.map((resource) => <li key={resource.id}>
              <svg className="lesson-resource-icon" aria-hidden="true" width="16" height="18" viewBox="0 0 16 18" fill="none" stroke="currentColor"><rect x="2" y="1" width="12" height="16" rx="2" /><path d="M5 6h6M5 9h6M5 12h4" /></svg>
              <span>{resource.title}{resource.kind === 'web' && <small>{resource.url}</small>}</span>
            </li>)}
          </ul>
          <ol className="lesson-steps">
            {draft.plan.steps.map((step) => <li key={step.id}>
              <div>
                <strong className="lesson-step-mode">{({ open: vi ? 'Mở tài liệu' : 'Open material', explain: vi ? 'Giải thích' : 'Explain', demonstrate: vi ? 'Làm mẫu' : 'Demonstrate', practice: vi ? 'Thực hành' : 'Practice', check: vi ? 'Kiểm tra' : 'Check' })[step.mode]}</strong>
                <p>{step.instruction}</p>
                {step.mode === 'explain' && draft.plan.resources.some((resource) => resource.id === step.resourceId && resource.kind === 'web') && (
                  <p className="lesson-note">{vi ? 'Mở trang trên máy học sinh, sau đó giải thích nội dung.' : 'Open the page on the student computer, then explain its content.'}</p>
                )}
                {step.objective !== step.instruction && <p className="lesson-note">{vi ? 'Mục tiêu' : 'Objective'}: {step.objective}</p>}
                <p className="lesson-note">{vi ? 'Tài liệu' : 'Material'}: {draft.plan.resources.find((resource) => resource.id === step.resourceId)?.title}</p>
                {step.criterionIds.length > 0 && <ul className="lesson-criteria">
                  {step.criterionIds.map((id) => {
                    const criterion = context?.criteria.find((item) => item.id === id);
                    return <li key={id}>{criterion ? `${criterion.title}: ${criterion.description}` : '…'}</li>;
                  })}
                </ul>}
                {step.demonstration && <p>{step.demonstration.exampleDescription}<br />{step.demonstration.expectedResult}</p>}
              </div>
            </li>)}
          </ol>
        </div>
      </details>
      {error && <p role="alert">{error}</p>}
      {draft.state === 'prepared' && (
        <button className="lesson-button--primary"
          type="button"
          disabled={
            busy ||
            !context ||
            draft.plan.steps.some((step) =>
              step.criterionIds.some((id) => !context.criteria.some((criterion) => criterion.id === id)),
            )
          }
          onClick={() => {
            void act();
          }}
        >
          {vi ? 'Gửi cho lớp' : 'Send to class'}
        </button>
      )}
      {['sending', 'unknown'].includes(draft.state) && (
        <>
          <p>
            {vi
              ? 'Chưa xác nhận được kết quả gửi. Kiểm tra biên nhận trước khi gửi bài mới.'
              : 'Send outcome is uncertain. Check the receipt before preparing another lesson.'}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void act(true);
            }}
          >
            {vi ? 'Kiểm tra biên nhận' : 'Reconcile receipt'}
          </button>
        </>
      )}
      {draft.state === 'sent' && <ClassroomLessonProgress draft={draft} vi={vi} />}
    </section>
  );
}
