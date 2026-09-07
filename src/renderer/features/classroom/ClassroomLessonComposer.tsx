import { useEffect, useState } from 'react';

import {
  ClassroomLessonPlanSchema,
  type LessonContext,
  type LessonDraft,
  type LessonStep,
} from '../../../shared/classroom-lesson-contracts';
import { randomUUID } from '../../../shared/renderer-uuid';
import '../../classroom-lesson.css';

import { ClassroomLessonPreview } from './ClassroomLessonPreview';

export function ClassroomLessonComposer({
  spaceId,
  runId,
  vi,
  enabled,
}: {
  spaceId: string;
  runId: string;
  vi: boolean;
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<LessonContext | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [materialKind, setMaterialKind] = useState('assignment');
  const [objective, setObjective] = useState('');
  const [draft, setDraft] = useState<LessonDraft | null>(null);
  const [steps, setSteps] = useState<LessonStep[]>([]);
  useEffect(() => {
    if (!open || !window.tro.lessons) return;
    let live = true;
    void (async () => {
      const selected = await window.tro.getTeacherClassroom();
      if (!selected || selected.binding.spaceId !== spaceId)
        throw new Error(vi ? 'Chọn buổi học hiện tại trước.' : 'Select the current class session first.');
      const next = await window.tro.lessons!.context({ spaceId, sessionId: selected.binding.sessionId, runId });
      if (!live) return;
      setContext(next);
      setSessionId(next.sessionId);
      setObjective(next.instructions.slice(0, 4000));
      const resourceId = randomUUID();
      setSteps(
        ['explain', 'demonstrate', 'practice', 'check'].map((mode) => ({
          id: randomUUID(),
          mode: mode as LessonStep['mode'],
          resourceId,
          objective: next.title,
          instruction: mode === 'explain' ? next.instructions.slice(0, 4000) : '',
          criterionIds: next.criteria.map((c) => c.id),
          demonstration: mode === 'demonstrate' ? { exampleDescription: '', expectedResult: '' } : null,
        })),
      );
    })().catch((e: unknown) => {
      if (live) setError(e instanceof Error ? e.message : 'Lesson context unavailable.');
    });
    return () => {
      live = false;
    };
  }, [open, runId, spaceId, vi]);
  const invalidate = () => {
    if (draft?.state === 'prepared')
      void window.tro.lessons
        ?.cancelDraft({ draftId: draft.draftId })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not invalidate preview.'));
    setDraft(null);
  };
  const edit = (index: number, patch: Partial<LessonStep>) => {
    invalidate();
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  };
  const prepare = async () => {
    if (!context || !window.tro.lessons || !steps[0]) return;
    setBusy(true);
    setError('');
    try {
      const id = steps[0].resourceId;
      const resource =
        materialKind === 'web'
          ? { id, kind: 'web' as const, title: context.title, url, origin: new URL(url).origin }
          : materialKind === 'assignment'
            ? { id, kind: 'assignment' as const, title: context.title }
            : {
                id,
                kind: 'source_text' as const,
                title: context.sources.find((s) => s.sourceVersionId === materialKind)?.title ?? '',
                sourceVersionId: materialKind,
              };
      const plan = ClassroomLessonPlanSchema.parse({
        schemaVersion: 1,
        targetRunId: runId,
        activityVersionId: context.activityVersionId,
        title: context.title,
        objective,
        language: vi ? 'vi' : 'en',
        resources: [resource],
        steps,
      });
      setDraft(await window.tro.lessons.prepare({ binding: { spaceId, sessionId }, plan }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare lesson.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="classroom-lesson-composer">
      <button type="button" disabled={!enabled} aria-expanded={open} onClick={() => setOpen(!open)}>
        {vi ? 'Dạy một bài học' : 'Teach a lesson'}
      </button>
      {open && (
        <>
          {!window.tro.lessons && (
            <p role="alert">{vi ? 'Cập nhật Tro để dạy bài học.' : 'Update Tro to teach a lesson.'}</p>
          )}
          <p>
            {vi
              ? 'Bài học có thể mở tài liệu, làm mẫu trên máy học sinh, rồi để học sinh tự thực hành.'
              : 'A lesson can open material, demonstrate on student computers, then hand control to students.'}
          </p>
          {error && <p role="alert">{error}</p>}
          {context && (
            <fieldset disabled={busy || Boolean(draft && ['sending', 'unknown', 'sent'].includes(draft.state))}>
              <legend>{context.title}</legend>
              {context.launchTarget === 'workspace' && (
                <p role="alert">
                  {vi
                    ? 'Bài học tự động chưa hỗ trợ hoạt động Workspace.'
                    : 'Automatic lessons do not yet support Workspace activities.'}
                </p>
              )}
              <label>
                {vi ? 'Mục tiêu bài học' : 'Lesson objective'}
                <textarea
                  value={objective}
                  maxLength={4000}
                  onChange={(e) => {
                    setObjective(e.target.value);
                    invalidate();
                  }}
                />
              </label>
              <label>
                {vi ? 'Tài liệu' : 'Material'}
                <select
                  value={materialKind}
                  onChange={(e) => {
                    setMaterialKind(e.target.value);
                    invalidate();
                  }}
                >
                  <option value="assignment">{vi ? 'Hướng dẫn bài tập' : 'Assignment instructions'}</option>
                  <option value="web">{vi ? 'Bài tập trên trình duyệt' : 'Browser exercise'}</option>
                  {context.sources.map((source) => (
                    <option key={source.sourceVersionId} value={source.sourceVersionId}>
                      {source.title}
                    </option>
                  ))}
                </select>
              </label>
              {materialKind === 'web' && (
                <label>
                  {vi ? 'Liên kết HTTPS được phép' : 'Approved HTTPS material URL'}
                  <input
                    value={url}
                    type="url"
                    placeholder="https://…"
                    onChange={(e) => {
                      setUrl(e.target.value);
                      invalidate();
                    }}
                  />
                  <small>
                    {context.allowedOrigins.join(', ') ||
                      (vi
                        ? 'Xuất bản tên miền được phép trong Activity trước.'
                        : 'Publish an allowed origin in the Activity first.')}
                  </small>
                </label>
              )}
              {steps.map((step, index) => (
                <fieldset key={step.id}>
                  <legend>
                    {index + 1}. {step.mode}
                  </legend>
                  <label>
                    {vi ? 'Chế độ' : 'Mode'}
                    <select
                      value={step.mode}
                      onChange={(e) =>
                        edit(index, {
                          mode: e.target.value as LessonStep['mode'],
                          demonstration:
                            e.target.value === 'demonstrate' ? { exampleDescription: '', expectedResult: '' } : null,
                        })
                      }
                    >
                      <option value="explain">{vi ? 'Giải thích' : 'Explain'}</option>
                      <option
                        value="demonstrate"
                        disabled={context.answerReveal !== 'allowed' || materialKind !== 'web'}
                      >
                        {vi ? 'Làm mẫu' : 'Demonstrate'}
                      </option>
                      <option value="practice">{vi ? 'Thực hành' : 'Practice'}</option>
                      <option value="check">{vi ? 'Kiểm tra' : 'Check'}</option>
                    </select>
                  </label>
                  {step.mode === 'demonstrate' && (context.answerReveal !== 'allowed' || materialKind !== 'web') && (
                    <p role="alert">
                      {vi
                        ? 'Chọn bài tập trình duyệt có chính sách cho phép làm mẫu, hoặc đổi chế độ.'
                        : 'Choose a browser exercise with an allowed-answer policy, or change this mode.'}
                    </p>
                  )}
                  <label>
                    {vi ? 'Hướng dẫn bước này' : 'Step instruction'}
                    <textarea
                      value={step.instruction}
                      maxLength={4000}
                      onChange={(e) => edit(index, { instruction: e.target.value })}
                    />
                  </label>
                  {step.demonstration && (
                    <>
                      <label>
                        {vi ? 'Ví dụ giáo viên muốn làm mẫu' : 'Example to demonstrate'}
                        <textarea
                          value={step.demonstration.exampleDescription}
                          maxLength={4000}
                          onChange={(e) =>
                            edit(index, {
                              demonstration: { ...step.demonstration!, exampleDescription: e.target.value },
                            })
                          }
                        />
                      </label>
                      <label>
                        {vi ? 'Kết quả mong đợi của ví dụ' : 'Expected example result'}
                        <input
                          value={step.demonstration.expectedResult}
                          maxLength={4000}
                          onChange={(e) =>
                            edit(index, { demonstration: { ...step.demonstration!, expectedResult: e.target.value } })
                          }
                        />
                      </label>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={steps.length === 1}
                    onClick={() => {
                      setSteps(steps.filter((_, i) => i !== index));
                      invalidate();
                    }}
                  >
                    {vi ? 'Bỏ bước' : 'Remove step'}
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                disabled={steps.length >= 8}
                onClick={() => {
                  invalidate();
                  setSteps([
                    ...steps,
                    {
                      id: randomUUID(),
                      mode: 'explain',
                      resourceId: steps[0].resourceId,
                      objective: context.title,
                      instruction: '',
                      criterionIds: context.criteria.map((c) => c.id),
                      demonstration: null,
                    },
                  ]);
                }}
              >
                {vi ? 'Thêm bước' : 'Add step'}
              </button>
              <button
                type="button"
                disabled={context.launchTarget === 'workspace'}
                onClick={() => {
                  void prepare();
                }}
              >
                {vi ? 'Xem trước bài học chính xác' : 'Preview exact lesson'}
              </button>
            </fieldset>
          )}
          {draft?.state === 'sent' && (
            <button type="button" onClick={() => setDraft(null)}>
              {vi ? 'Chuẩn bị bài học khác' : 'Prepare another lesson'}
            </button>
          )}
          {draft && <ClassroomLessonPreview key={draft.draftId} draft={draft} onChange={setDraft} vi={vi} />}
        </>
      )}
    </section>
  );
}
