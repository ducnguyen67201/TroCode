import { useEffect, useState } from 'react';

import type { LessonContext, LessonDraft } from '../../../shared/classroom-lesson-contracts';

import { ClassroomLessonProgress } from './ClassroomLessonProgress';

export function ClassroomLessonPreview({
  draft,
  onChange,
  vi,
}: {
  draft: LessonDraft;
  onChange(draft: LessonDraft): void;
  vi: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [context, setContext] = useState<LessonContext | null>(null);
  useEffect(() => {
    let live = true;
    setContext(null);
    void window.tro.lessons
      ?.context({ ...draft.binding, runId: draft.plan.targetRunId })
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
    }
  };
  return (
    <section className="lesson-preview" aria-label={vi ? 'Xem trước bài học' : 'Exact lesson preview'}>
      <h3>{draft.plan.title}</h3>
      <p>{draft.plan.objective}</p>
      <p>
        {vi ? 'Bài tập' : 'Assignment'}: {context?.title ?? '…'} ·{' '}
        {draft.plan.language === 'vi' ? 'Tiếng Việt' : 'English'}
      </p>
      <p>
        {vi
          ? 'Gửi tới học sinh trong buổi học này. Bài học hết hạn sau 30 phút.'
          : 'For students in this session. The lesson expires 30 minutes after sending.'}
      </p>
      <ul>
        {draft.plan.resources.map((r) => (
          <li key={r.id}>
            {r.title}
            {r.kind === 'web' ? ` — ${r.url}` : ''}
          </li>
        ))}
      </ul>
      <ol>
        {draft.plan.steps.map((step) => (
          <li key={step.id}>
            <strong>{step.mode}</strong>: {step.instruction}
            <p>
              {vi ? 'Mục tiêu' : 'Objective'}: {step.objective}
            </p>
            <p>
              {vi ? 'Tài liệu' : 'Material'}:{' '}
              {draft.plan.resources.find((resource) => resource.id === step.resourceId)?.title}
            </p>
            {step.criterionIds.length > 0 && (
              <ul>
                {step.criterionIds.map((id) => {
                  const criterion = context?.criteria.find((item) => item.id === id);
                  return <li key={id}>{criterion ? `${criterion.title}: ${criterion.description}` : '…'}</li>;
                })}
              </ul>
            )}
            {step.demonstration && (
              <p>
                {step.demonstration.exampleDescription}
                <br />
                {step.demonstration.expectedResult}
              </p>
            )}
          </li>
        ))}
      </ol>
      {error && <p role="alert">{error}</p>}
      {draft.state === 'prepared' && (
        <button
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
          {vi ? 'Phát bài học cho lớp' : 'Broadcast lesson'}
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
