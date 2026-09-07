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

function findSource(context: LessonContext, request: string) {
  const normalized = request.toLocaleLowerCase();
  return context.sources.find((source) => {
    const title = source.title.toLocaleLowerCase();
    return normalized.includes(title) || normalized.includes(title.replace(/\.md$/u, ''));
  });
}

function makeStep(mode: LessonStep['mode'], resourceId: string, instruction: string, criteria: string[]) {
  return {
    id: randomUUID(),
    mode,
    resourceId,
    objective: instruction,
    instruction,
    criterionIds: criteria,
    demonstration:
      mode === 'demonstrate'
        ? {
            exampleDescription: instruction,
            expectedResult: 'The reviewed example is visible and verified.',
          }
        : null,
  } satisfies LessonStep;
}

function planFromRequest(context: LessonContext, runId: string, request: string, vi: boolean) {
  const text = request.trim();
  const source = findSource(context, text);
  const url = text.match(/https:\/\/[^\s]+/u)?.[0]?.replace(/[),.]+$/u, '');
  const wantsDemo = /\b(demonstrate|demo|do it|click|type|làm mẫu|thực hiện trên máy)\b/iu.test(text);
  const wantsPractice = /\b(practice|try|thực hành|tự làm)\b/iu.test(text);
  const wantsCheck = /\b(check|review|kiểm tra|chấm)\b/iu.test(text);
  if (wantsDemo && !url) {
    throw new Error(
      vi
        ? 'Để làm mẫu trên máy học sinh, hãy thêm liên kết HTTPS của bài tập trình duyệt được phép.'
        : 'To demonstrate on student computers, include the approved HTTPS browser exercise URL.',
    );
  }
  if (url && !context.allowedOrigins.includes(new URL(url).origin)) {
    throw new Error(vi ? 'Liên kết này chưa nằm trong danh sách miền được phép.' : 'This URL is not in the approved material origins.');
  }
  const resourceId = randomUUID();
  const resource = url
    ? { id: resourceId, kind: 'web' as const, title: context.title, url, origin: new URL(url).origin }
    : source
      ? { id: resourceId, kind: 'source_text' as const, title: source.title, sourceVersionId: source.sourceVersionId }
      : { id: resourceId, kind: 'assignment' as const, title: context.title };
  const criteria = context.criteria.map((criterion) => criterion.id);
  const steps: LessonStep[] = [makeStep('explain', resourceId, text, criteria)];
  if (wantsDemo) steps.push(makeStep('demonstrate', resourceId, text, []));
  if (wantsPractice) steps.push(makeStep('practice', resourceId, vi ? 'Hãy tự thực hành phần vừa học.' : 'Practice the section independently.', []));
  if (wantsCheck) steps.push(makeStep('check', resourceId, vi ? 'Kiểm tra bài làm theo tiêu chí đã công bố.' : 'Check your work against the published criteria.', criteria));
  return ClassroomLessonPlanSchema.parse({
    schemaVersion: 1,
    targetRunId: runId,
    activityVersionId: context.activityVersionId,
    title: context.title,
    objective: text,
    language: vi ? 'vi' : 'en',
    resources: [resource],
    steps,
  });
}

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
  const [request, setRequest] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<LessonDraft | null>(null);

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
    })().catch((cause: unknown) => {
      if (live) setError(cause instanceof Error ? cause.message : 'Lesson context unavailable.');
    });
    return () => {
      live = false;
    };
  }, [open, runId, spaceId, vi]);

  const invalidate = () => {
    if (draft?.state === 'prepared')
      void window.tro.lessons?.cancelDraft({ draftId: draft.draftId }).catch(() => undefined);
    setDraft(null);
  };

  const prepare = async () => {
    if (!context || !window.tro.lessons || !request.trim()) return;
    setBusy(true);
    setError('');
    try {
      const plan = planFromRequest(context, runId, request, vi);
      setDraft(await window.tro.lessons.prepare({ binding: { spaceId, sessionId }, plan }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : vi ? 'Không thể chuẩn bị bài học.' : 'Could not prepare lesson.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="classroom-lesson-composer" aria-labelledby="classroom-teach-heading">
      <button type="button" disabled={!enabled} aria-expanded={open} onClick={() => setOpen(!open)}>
        {vi ? 'Dạy cả lớp' : 'Teach the class'}
      </button>
      {open && (
        <>
          <h3 id="classroom-teach-heading">{vi ? 'Bạn muốn học sinh làm gì?' : 'What should students see or do?'}</h3>
          <p>{vi ? 'Nói ngắn gọn điều cần trình bày. Tro sẽ chọn tài liệu và chuẩn bị các bước.' : 'Describe it briefly. Tro will resolve the material and prepare the lesson steps.'}</p>
          <label>
            {vi ? 'Yêu cầu dạy học' : 'Teaching request'}
            <textarea
              value={request}
              maxLength={4000}
              placeholder={vi ? 'Ví dụ: Giải thích phần 1 của 01-python-bai-hoc.md bằng tiếng Việt.' : 'Example: Explain section 1 of 01-python-bai-hoc.md in Vietnamese.'}
              disabled={busy || Boolean(draft && ['sending', 'unknown', 'sent'].includes(draft.state))}
              onChange={(event) => {
                setRequest(event.target.value);
                invalidate();
              }}
              rows={4}
            />
          </label>
          {context && <small>{vi ? `Buổi học: ${context.title}` : `Session: ${context.title}`}</small>}
          {error && <p role="alert">{error}</p>}
          {!draft && (
            <button type="button" disabled={busy || !context || !request.trim()} onClick={() => void prepare()}>
              {vi ? 'Xem trước' : 'Preview lesson'}
            </button>
          )}
          {draft?.state === 'sent' && (
            <button type="button" onClick={() => { setDraft(null); setRequest(''); }}>
              {vi ? 'Dạy phần khác' : 'Teach another section'}
            </button>
          )}
          {draft && <ClassroomLessonPreview key={draft.draftId} draft={draft} onChange={setDraft} vi={vi} />}
        </>
      )}
    </section>
  );
}
