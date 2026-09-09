import { useEffect, useRef, useState } from 'react';

import type { LessonContext, LessonDraft } from '../../../shared/classroom-lesson-contracts';
import { planFromRequest, type TeachingOptions } from '../../../shared/classroom-teaching-request';
import '../../classroom-lesson.css';

import { ClassroomLessonPreview } from './ClassroomLessonPreview';

export function ClassroomLessonComposer({ spaceId, runId, vi, enabled }: { spaceId: string; runId: string; vi: boolean; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<LessonContext | null>(null);
  const [request, setRequest] = useState('');
  const [options, setOptions] = useState<TeachingOptions>({ material: 'auto', surface: 'resource_app', navigation: 'student', language: vi ? 'vi' : 'en', section: '' });
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState<LessonDraft | null>(null);
  const generation = useRef(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const locked = sending || Boolean(draft && ['sending', 'unknown', 'sent'].includes(draft.state));

  useEffect(() => {
    if (!open || !window.tro.lessons) return;
    let live = true;
    const previousDraft = draftRef.current;
    if (previousDraft && ['unknown', 'sending'].includes(previousDraft.state)) { setError(vi ? 'Kiểm tra biên nhận trước khi đổi bài học.' : 'Resolve the previous send receipt before changing lessons.'); return; }
    if (previousDraft?.state === 'prepared') void window.tro.lessons.cancelDraft({ draftId: previousDraft.draftId }).catch(() => undefined);
    setDraft(null);
    setContext(null);
    void (async () => {
      const selected = await window.tro.getTeacherClassroom();
      if (!selected || selected.binding.spaceId !== spaceId) throw new Error(vi ? 'Chọn buổi học hiện tại trước.' : 'Select the current class session first.');
      const next = await window.tro.lessons!.context({ spaceId, sessionId: selected.binding.sessionId, runId });
      if (!live) return;
      setContext(next);
      setOptions((value) => ({ ...value, material: next.sources[0]?.sourceVersionId ?? 'current_screen', surface: next.sources.length ? 'resource_app' : 'current_window' }));
    })().catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : 'Lesson context unavailable.'); });
    return () => { live = false; generation.current++; };
  }, [open, runId, spaceId, vi]);

  const invalidate = () => {
    generation.current++;
    if (draft?.state === 'prepared') void window.tro.lessons?.cancelDraft({ draftId: draft.draftId }).catch(() => undefined);
    setDraft(null);
    setError('');
  };
  useEffect(() => {
    if (!open || !context || !request.trim() || locked) { setPreparing(false); return; }
    const version = ++generation.current;
    setPreparing(true);
    const timer = setTimeout(() => {
      void (async () => {
        const plan = planFromRequest(context, runId, request, vi, options);
        const prepared = await window.tro.lessons!.prepare({ binding: { spaceId, sessionId: context.sessionId }, plan });
        if (generation.current !== version) { void window.tro.lessons!.cancelDraft({ draftId: prepared.draftId }).catch(() => undefined); return; }
        setDraft(prepared);
      })().catch((cause: unknown) => { if (generation.current === version) setError(cause instanceof Error ? cause.message : 'Could not prepare lesson.'); })
        .finally(() => { if (generation.current === version) setPreparing(false); });
    }, 500);
    return () => { clearTimeout(timer); if (generation.current === version) generation.current++; };
  }, [open, context, runId, spaceId, request, options, vi, locked]);
  const edit = (value: Partial<TeachingOptions>) => { invalidate(); setOptions((current) => ({ ...current, ...value })); };

  return <section className="classroom-lesson-composer" aria-labelledby="classroom-teach-heading">
    <button type="button" disabled={!enabled || locked} aria-expanded={open} onClick={() => setOpen(!open)}>{vi ? 'Dạy cả lớp' : 'Teach the class'}</button>
    {open && <>
      <h3 id="classroom-teach-heading">{vi ? 'Giải thích tài liệu trên máy học sinh' : 'Explain material on students’ computers'}</h3>
      <p>{vi ? 'Tro tải tài liệu của lớp, mở bằng ứng dụng trên máy học sinh và giải thích nội dung đang hiển thị.' : 'Tro downloads the class material, opens it in an application on each student’s computer, and explains the visible content.'}</p>
      <fieldset disabled={locked}>
        <label>{vi ? 'Tài liệu' : 'Material'}<select value={options.material} onChange={(e) => edit({ material: e.target.value, surface: e.target.value === 'current_screen' ? 'current_window' : 'resource_app' })}>
          <option value="auto">{vi ? 'Chọn theo yêu cầu' : 'Resolve from request'}</option>
          {context?.sources.map((source) => <option key={source.sourceVersionId} value={source.sourceVersionId}>{source.title}</option>)}
          <option value="current_screen">{vi ? 'Nội dung học sinh đang mở' : 'What students already have open'}</option>
        </select></label>
        {options.material !== 'current_screen' && <label>{vi ? 'Mở tài liệu' : 'Open material'}<select value={options.surface} onChange={(e) => edit({ surface: e.target.value as TeachingOptions['surface'] })}>
          <option value="resource_app">{vi ? 'Tải và mở trên máy học sinh' : 'Download and open on student computer'}</option>
          <option value="current_window">{vi ? 'Dùng cửa sổ đã mở' : 'Use an already-open window'}</option>
        </select></label>}
        <label>{vi ? 'Phần / trang' : 'Section / page'}<input value={options.section} maxLength={500} onChange={(e) => edit({ section: e.target.value })} /></label>
        <label>{vi ? 'Ngôn ngữ' : 'Language'}<select value={options.language} onChange={(e) => edit({ language: e.target.value as 'en' | 'vi' })}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>
        <label>{vi ? 'Điều hướng tài liệu' : 'Document navigation'}<select value={options.navigation} onChange={(e) => edit({ navigation: e.target.value as 'student' | 'tro' })}>
          <option value="student">{vi ? 'Học sinh điều hướng' : 'Students navigate'}</option><option value="tro">{vi ? 'Tro điều hướng khi học sinh cho phép' : 'Tro navigates with student permission'}</option>
        </select></label>
        <label>{vi ? 'Yêu cầu dạy học' : 'Teaching request'}<textarea value={request} maxLength={3400} rows={3} placeholder={vi ? 'Giải thích một ví dụ, rồi dừng để học sinh hỏi.' : 'Explain one example, then pause for questions.'} onChange={(e) => { invalidate(); setRequest(e.target.value); }} /></label>
      </fieldset>
      {context && <small>{vi ? 'Buổi học' : 'Session'}: {context.title}</small>}
      {error && <p role="alert">{error}</p>}
      {preparing && !draft && <p role="status">{vi ? 'Đang chuẩn bị bài học…' : 'Preparing lesson…'}</p>}
      {draft && <ClassroomLessonPreview key={draft.draftId} draft={draft} onChange={setDraft} onBusy={setSending} compact vi={vi} />}
      {draft?.state === 'sent' && <button type="button" onClick={() => { invalidate(); setRequest(''); }}>{vi ? 'Dạy phần khác' : 'Teach another section'}</button>}
    </>}
  </section>;
}
