import { useState } from 'react';

import type { LessonLocalState } from '../../../shared/classroom-lesson-contracts';
import { lessonRequestsNavigation } from '../../../shared/lesson-execution-policy';

export function ClassroomLessonDesktopControls({ state, vi }: { state: LessonLocalState; vi: boolean }) {
  const [selection, setSelection] = useState<{ lessonId: string; revision: number; windows: { token: string; label: string }[] } | null>(null);
  const windows = selection?.lessonId === state.envelope.lessonId && selection.revision === state.revision ? selection.windows : [];
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const idle = ['paused', 'blocked', 'waiting_for_student'].includes(state.status);
  const work = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update lesson.'); }
    finally { setBusy(false); }
  };
  return <div className="lesson-desktop-controls">
    <p>{vi ? 'Tài liệu được mở trong ứng dụng trên máy của em. Em có thể tự cuộn hoặc đổi trang.' : 'Your material opens in an application on your computer. You can scroll or turn pages yourself.'}</p>
    {lessonRequestsNavigation(state.envelope.plan, state.stepIndex) && <label>
      <input type="checkbox" checked={state.desktopControlConsent} disabled={busy || (!idle && !state.desktopControlConsent)} onChange={(e) => void work(() => window.tro.lessons!.desktopConsent({ lessonId: state.envelope.lessonId, revision: state.revision, enabled: e.target.checked }))} />
      {vi ? 'Cho phép Tro điều hướng và nhập ví dụ đã duyệt trong bước làm mẫu' : 'Allow Tro to navigate and type the reviewed example during a demonstration'}
    </label>}
    {idle && <>
      <button disabled={busy} type="button" onClick={() => void work(() => window.tro.lessons!.chooseFile({ lessonId: state.envelope.lessonId, revision: state.revision }))}>{vi ? 'Chọn tệp trên máy, rồi tiếp tục' : 'Choose a local file, then resume'}</button>
      <button disabled={busy} type="button" onClick={() => void work(async () => setSelection({ lessonId: state.envelope.lessonId, revision: state.revision, windows: await window.tro.lessons!.windows({ lessonId: state.envelope.lessonId, revision: state.revision }) }))}>{vi ? 'Chọn cửa sổ tài liệu' : 'Choose material window'}</button>
      {windows.map((choice) => <button key={choice.token} disabled={busy} type="button" onClick={() => void work(async () => { await window.tro.lessons!.selectWindow({ lessonId: state.envelope.lessonId, revision: state.revision, token: choice.token }); setSelection(null); })}>{choice.label}</button>)}
      <p>{vi ? 'Nếu tài liệu chưa mở, hãy mở tệp bằng ứng dụng phù hợp, chọn cửa sổ ở đây rồi tiếp tục.' : 'If the material is not open, open the file in a suitable application, choose its window here, then resume.'}</p>
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
