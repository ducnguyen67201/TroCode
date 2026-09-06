import { useEffect, useMemo, useRef, useState } from 'react';

import { validateClassroomUrl } from '../shared/classroom-url-policy';
import type {
  AppLanguage,
  ClassroomDirective,
  KnowledgeDashboard,
  KnowledgeRoomCode,
  SaveKnowledgeActivityRequest,
} from '../shared/contracts';
import { randomUUID } from '../shared/renderer-uuid';

import { translate } from './app-language';
import { ClassDashboard } from './features/classroom/ClassDashboard';
import { DirectiveComposer } from './features/classroom/DirectiveComposer';
import { RunControls } from './features/classroom/RunControls';

export function FacilitatorRunPage({
  onRunStateChanged,
  allowedOrigins,
  appLanguage,
  criteria,
  initialRoomCode = null,
  runId,
  spaceId,
}: {
  onRunStateChanged?: (state: 'open' | 'closed') => Promise<void>;
  allowedOrigins: string[];
  appLanguage: AppLanguage;
  criteria: SaveKnowledgeActivityRequest['definition']['criteria'];
  initialRoomCode?: KnowledgeRoomCode | null;
  runId: string;
  spaceId: string;
}) {
  const [dashboard, setDashboard] = useState<KnowledgeDashboard | null>(null);
  const [roomCode, setRoomCode] = useState<KnowledgeRoomCode | null>(
    initialRoomCode,
  );
  const [runState, setRunState] = useState<
    'archived' | 'closed' | 'draft' | 'open'
  >('draft');
  const [directiveKind, setDirectiveKind] = useState<'exercise' | 'open_url'>(
    'exercise',
  );
  const [instruction, setInstruction] = useState('');
  const [url, setUrl] = useState('');
  const [criterionIds, setCriterionIds] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [lastDirective, setLastDirective] = useState<ClassroomDirective | null>(
    null,
  );
  const [pendingReview, setPendingReview] = useState<{
    action: 'complete' | 'return';
    attemptId: string;
  } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef<number | undefined>(undefined);
  const polling = useRef(false);
  const t = (
    message: string,
    values?: Readonly<Record<string, string | number>>,
  ) => translate(appLanguage, message, values);
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(appLanguage === 'vi' ? 'vi-VN' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [appLanguage],
  );

  const snapshot = async () => {
    const next = await window.tro.getKnowledgeDashboard({ spaceId, runId });
    sequence.current = next.maxSequence;
    setRunState(next.runState);
    setDashboard(next);
    setError(null);
  };

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    const refresh = async () => {
      if (document.visibilityState !== 'visible' || polling.current) return;
      polling.current = true;
      try {
        if (sequence.current === undefined) {
          const next = await window.tro.getKnowledgeDashboard({
            spaceId,
            runId,
          });
          if (!active) return;
          sequence.current = next.maxSequence;
          setRunState(next.runState);
          setDashboard(next);
          setError(null);
          return;
        }
        const delta = await window.tro.getKnowledgeDashboard({
          spaceId,
          runId,
          sinceSequence: sequence.current,
        });
        if (!active) return;
        sequence.current = delta.maxSequence;
        setRunState(delta.runState);
        if ((delta.events?.length ?? 0) > 0) {
          const next = await window.tro.getKnowledgeDashboard({
            spaceId,
            runId,
          });
          if (!active) return;
          sequence.current = next.maxSequence;
          setRunState(next.runState);
          setDashboard(next);
          setError(null);
        }
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : translate(appLanguage, 'Dashboard is unavailable.'),
          );
      } finally {
        polling.current = false;
      }
    };
    void refresh();
    timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [appLanguage, runId, spaceId]);

  const createCode = async () => {
    setBusyAction('room-code');
    setError(null);
    try {
      setRoomCode(
        await window.tro.createKnowledgeRoomCode({
          spaceId,
          runId,
          clientId: randomUUID(),
          expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
          maxUses: 500,
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not create a room code.'),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const revokeCode = async () => {
    setBusyAction('revoke');
    setError(null);
    try {
      await window.tro.revokeKnowledgeRoomCode({ spaceId, runId });
      setRoomCode(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not close room admission.'),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const changeRunState = async (state: 'closed' | 'open') => {
    setBusyAction(state);
    setError(null);
    try {
      await window.tro.setKnowledgeRunState({ spaceId, runId, state });
      setRunState(state);
      await onRunStateChanged?.(state);
      await snapshot();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not update the class state.'),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const broadcast = async () => {
    setBusyAction('broadcast');
    setError(null);
    try {
      const directive = await window.tro.createClassroomDirective({
        spaceId,
        runId,
        clientId: randomUUID(),
        directive:
          directiveKind === 'exercise'
            ? {
                kind: 'exercise',
                instruction: instruction.trim(),
                criterionIds,
              }
            : {
                kind: 'open_url',
                instruction: instruction.trim(),
                criterionIds,
                url: url.trim(),
              },
      });
      setLastDirective(directive);
      setInstruction('');
      setUrl('');
      setCriterionIds([]);
      setShowPreview(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not broadcast this direction.'),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const resolveHelp = async (attemptId: string) => {
    setBusyAction(`resolve:${attemptId}`);
    setError(null);
    try {
      await window.tro.resolveKnowledgeAttemptHelp({
        spaceId,
        runId,
        attemptId,
        clientId: randomUUID(),
      });
      await snapshot();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not resolve this help request.'),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const review = async (attemptId: string, action: 'complete' | 'return') => {
    setBusyAction(`${action}:${attemptId}`);
    setError(null);
    try {
      await window.tro.reviewKnowledgeAttempt({
        spaceId,
        runId,
        attemptId,
        clientId: randomUUID(),
        action,
      });
      setPendingReview(null);
      await snapshot();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not update this review.'),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const participants = dashboard?.participants ?? [];
  const countFor = (status: string) =>
    participants.filter((participant) => participant.status === status).length;
  const previewOrigin =
    directiveKind === 'open_url'
      ? (validateClassroomUrl(url.trim())?.origin ?? null)
      : null;
  const autoEligible =
    previewOrigin !== null && allowedOrigins.includes(previewOrigin);
  const canPreview =
    instruction.trim().length > 0 &&
    (directiveKind === 'exercise' || previewOrigin !== null);
  const runEnded = runState === 'closed' || runState === 'archived';

  return (
    <section
      className={`space-panel facilitator-room facilitator-room--${runEnded ? 'closed' : runState}`}
      aria-labelledby="facilitator-room-heading"
    >
      <header className="facilitator-room__header">
        <div>
          <div className="room-live-label">
            <span aria-hidden="true" />
            {t(
              runState === 'draft'
                ? 'Room lobby'
                : runState === 'open'
                  ? 'Class live'
                  : 'Class ended',
            )}
          </div>
          <h2 id="facilitator-room-heading">{t('Live classroom control')}</h2>
          <p>
            {t(
              'Invite the room, set the current direction, and review explicit student signals in one place.',
            )}
          </p>
        </div>
        <div className="room-session-id">
          <span>{t('Session')}</span>
          <code>{runId.slice(0, 8)}</code>
        </div>
      </header>

      <RunControls
        t={t}
        roomCode={roomCode}
        formatter={formatter}
        busyAction={busyAction}
        runEnded={runEnded}
        createCode={createCode}
        revokeCode={revokeCode}
        countFor={countFor}
        participants={participants}
        runState={runState}
        changeRunState={changeRunState}
      />

      <DirectiveComposer
        runState={runState}
        t={t}
        directiveKind={directiveKind}
        setDirectiveKind={setDirectiveKind}
        setShowPreview={setShowPreview}
        setInstruction={setInstruction}
        instruction={instruction}
        setUrl={setUrl}
        url={url}
        previewOrigin={previewOrigin}
        autoEligible={autoEligible}
        criteria={criteria}
        criterionIds={criterionIds}
        setCriterionIds={setCriterionIds}
        showPreview={showPreview}
        canPreview={canPreview}
        busyAction={busyAction}
        broadcast={broadcast}
        lastDirective={lastDirective}
      />

      <ClassDashboard
        t={t}
        participants={participants}
        countFor={countFor}
        dashboard={dashboard}
        formatter={formatter}
        busyAction={busyAction}
        resolveHelp={resolveHelp}
        pendingReview={pendingReview}
        setPendingReview={setPendingReview}
        review={review}
      />

      {error && (
        <p className="form-error facilitator-room__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
