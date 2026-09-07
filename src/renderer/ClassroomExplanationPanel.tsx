import { useEffect, useState } from 'react';

import type {
  AppLanguage,
  BroadcastNotice,
  GuidanceState,
} from '../shared/contracts';
export function ClassroomExplanationPanel({
  appLanguage,
  compact = false,
  onOpenClasswork,
}: {
  appLanguage: AppLanguage;
  compact?: boolean;
  onOpenClasswork: (attemptId: string) => void;
}) {
  const [notice, setNotice] = useState<BroadcastNotice | null>(null);
  const [state, setState] = useState<GuidanceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const vi = appLanguage === 'vi';
  useEffect(() => {
    if (!window.tro.onClassroomBroadcastChanged) return;
    let active = true;
    let changed = false;
    const stopNotice = window.tro.onClassroomBroadcastChanged((next) => {
      changed = true;
      if (active)
        setNotice((current) =>
          !next || !current || next.revision > current.revision
            ? next
            : current,
        );
    });
    const apply = (next: GuidanceState) => {
      if (active)
        setState((current) =>
          !current || next.revision > current.revision ? next : current,
        );
    };
    const stopState = window.tro.onClassroomGuidanceChanged(apply);
    void window.tro
      .getClassroomBroadcastNotice()
      .then((next) => {
        if (active && !changed) setNotice(next);
      })
      .catch(() => undefined);
    void window.tro
      .getClassroomGuidanceState()
      .then(apply)
      .catch(() => undefined);
    return () => {
      active = false;
      stopNotice();
      stopState();
    };
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Explanation unavailable.',
      );
    } finally {
      setBusy(false);
    }
  };
  const broadcast = notice?.broadcast;
  const active = state?.active;
  if (!broadcast && !active && !state?.pending.length && !state?.sessionId)
    return null;
  const activeRunning =
    active &&
    !['finished', 'cancelled', 'failed', 'unknown'].includes(active.phase);
  const next = (action: 'next' | 'question' | 'finish' | 'text_only') =>
    run(async () => {
      if (!active) return;
      await window.tro.continueClassroomExplanation({
        guidanceId: active.guidanceId,
        stepRevision: active.stepRevision,
        action,
        text: action === 'question' ? question : null,
      });
      setQuestion('');
    });
  return (
    <section
      className="classroom-broadcast-card"
      aria-label={vi ? 'Hướng dẫn từ giáo viên' : 'Teacher guidance'}
    >
      {broadcast && (
        <div>
          <p className="eyebrow">
            {vi ? 'Thông báo của lớp' : 'Class broadcast'}
          </p>
          <p className="classroom-broadcast-copy">
            {broadcast.payload.instruction}
          </p>
          {notice.offline && (
            <p role="status">
              {vi
                ? 'Đang ngoại tuyến. Kết nối lại để tiếp tục.'
                : 'Offline. Reconnect to continue.'}
            </p>
          )}
          <div className="classroom-broadcast-actions">
            {broadcast.payload.kind === 'assignment' && (
              <button
                disabled={busy || notice.offline}
                type="button"
                onClick={() =>
                  void run(async () =>
                    onOpenClasswork(
                      (
                        await window.tro.openClassroomBroadcastAssignment({
                          broadcastId: broadcast.id,
                        })
                      ).attemptId,
                    ),
                  )
                }
              >
                {vi ? 'Mở bài tập' : 'Open assignment'}
              </button>
            )}
            {broadcast.payload.kind === 'open_url' && (
              <button
                disabled={busy || notice.offline}
                type="button"
                onClick={() =>
                  void run(() =>
                    window.tro.openClassroomBroadcastLink({
                      broadcastId: broadcast.id,
                    }),
                  )
                }
              >
                {vi ? 'Mở liên kết' : 'Open link'}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  window.tro.dismissClassroomBroadcast({
                    broadcastId: broadcast.id,
                  }),
                )
              }
            >
              {vi ? 'Ẩn' : 'Dismiss'}
            </button>
          </div>
        </div>
      )}
      {state?.pending
        .filter((b) => b.id !== active?.broadcastId)
        .map((b) => (
          <div key={b.id} className="classroom-explanation-pending">
            <strong>
              {b.payload.kind === 'assignment' ? b.payload.title : ''}
            </strong>
            <p>
              {vi
                ? 'Giải thích riêng dùng hạn mức Tro của bạn.'
                : 'Your individual explanation uses your own Tro allowance.'}
            </p>
            <div className="classroom-broadcast-actions">
              <button
                disabled={busy || Boolean(activeRunning) || notice?.offline}
                type="button"
                onClick={() =>
                  void run(() =>
                    window.tro.startClassroomExplanation({
                      broadcastId: b.id,
                      contextMode: 'screen_if_permitted',
                    }),
                  )
                }
              >
                {vi ? 'Bắt đầu giải thích' : 'Start explanation'}
              </button>
              <button
                disabled={busy || Boolean(activeRunning) || notice?.offline}
                type="button"
                onClick={() =>
                  void run(() =>
                    window.tro.startClassroomExplanation({
                      broadcastId: b.id,
                      contextMode: 'text_only',
                    }),
                  )
                }
              >
                {vi
                  ? 'Giải thích không dùng màn hình'
                  : 'Explain without screen'}
              </button>
            </div>
          </div>
        ))}
      {state?.sessionId && (
        <details
          className="classroom-session-settings"
          open={compact ? undefined : true}
        >
          <summary>
            {vi ? 'Cài đặt giải thích' : 'Explanation settings'}
          </summary>
          <label className="classroom-guidance-consent">
            <input
              type="checkbox"
              checked={state.consent?.enabled ?? false}
              disabled={busy}
              onChange={(event) => {
                const enabled = event.target.checked;
                void run(() =>
                  window.tro.setClassroomGuidanceConsent({
                    sessionId: state.sessionId!,
                    enabled,
                    contextMode: 'screen_if_permitted',
                  }),
                );
              }}
            />
            {vi
              ? 'Tự động bắt đầu giải thích mới trong phiên này khi thiết bị rảnh'
              : 'Automatically start new teacher explanations in this session when my device is idle'}
          </label>
        </details>
      )}
      {active && (
        <div className="classroom-explanation-active">
          <p role="status">{active.text}</p>
          {active.phase === 'waiting' && (
            <>
              <div className="classroom-broadcast-actions">
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => void next('next')}
                >
                  {vi ? 'Tiếp theo' : 'Next'}
                </button>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => void next('text_only')}
                >
                  {vi ? 'Chỉ dùng văn bản' : 'Use text only'}
                </button>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => void next('finish')}
                >
                  {vi ? 'Kết thúc giải thích' : 'Finish explanation'}
                </button>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void next('question');
                }}
              >
                <label>
                  {vi ? 'Câu hỏi của bạn' : 'Your question'}
                  <input
                    maxLength={2000}
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                  />
                </label>
                <button disabled={busy || !question.trim()} type="submit">
                  {vi ? 'Hỏi' : 'Ask'}
                </button>
              </form>
            </>
          )}
          {activeRunning && (
            <button
              type="button"
              onClick={() =>
                void run(() =>
                  window.tro.stopClassroomExplanation({
                    guidanceId: active.guidanceId,
                  }),
                )
              }
            >
              {vi ? 'Dừng giải thích' : 'Stop explanation'}
            </button>
          )}
        </div>
      )}
      {state?.message && <p role="status">{state.message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
