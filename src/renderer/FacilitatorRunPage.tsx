import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

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

const STATUS_ORDER = [
  'not_joined',
  'lobby',
  'working',
  'needs_help',
  'ready',
  'submitted',
  'completed',
  'withdrawn',
  'left',
  'launch_failed',
] as const;

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

      <div className="room-control-grid">
        <section
          className="room-invite-card"
          aria-labelledby="room-code-heading"
        >
          <div className="room-card-label">
            <span className="step-index">01</span>
            <div>
              <strong id="room-code-heading">{t('Invite the room')}</strong>
              <small>{t('Short-lived · up to 500 joins')}</small>
            </div>
          </div>
          {roomCode ? (
            <>
              <div className="room-code-display" aria-live="polite">
                <span>{t('Room code')}</span>
                <code>{roomCode.code}</code>
                <small>
                  {t('Expires at {time}', {
                    time: formatter.format(new Date(roomCode.expiresAt)),
                  })}
                </small>
              </div>
              <div className="room-card-actions">
                <button
                  disabled={busyAction !== null || runEnded}
                  onClick={() => void createCode()}
                  type="button"
                >
                  {t('Rotate code')}
                </button>
                <button
                  className="danger-text-button"
                  disabled={busyAction !== null}
                  onClick={() => void revokeCode()}
                  type="button"
                >
                  {t('Revoke')}
                </button>
              </div>
            </>
          ) : (
            <div className="room-code-empty">
              <p>
                {t('Create a code, then display or read it to your students.')}
              </p>
              <button
                className="primary-button"
                disabled={busyAction !== null || runEnded}
                onClick={() => void createCode()}
                type="button"
              >
                {busyAction === 'room-code'
                  ? t('Creating…')
                  : t('Create room code')}
              </button>
            </div>
          )}
        </section>

        <section
          className="room-start-card"
          aria-labelledby="room-start-heading"
        >
          <div className="room-card-label">
            <span className="step-index">02</span>
            <div>
              <strong id="room-start-heading">{t('Start together')}</strong>
              <small>
                {t('{count} students in the lobby', {
                  count: countFor('lobby'),
                })}
              </small>
            </div>
          </div>
          <div className="room-presence-row" aria-hidden="true">
            {participants.slice(0, 7).map((participant, index) => (
              <span
                key={participant.attemptId}
                style={{ '--presence-index': index } as CSSProperties}
              >
                {String(participant.id).slice(0, 1).toUpperCase()}
              </span>
            ))}
            {participants.length > 7 && <span>+{participants.length - 7}</span>}
          </div>
          {runState === 'draft' ? (
            <button
              className="primary-button room-start-button"
              disabled={busyAction !== null}
              onClick={() => void changeRunState('open')}
              type="button"
            >
              {busyAction === 'open' ? t('Starting…') : t('Start class')}{' '}
              <span aria-hidden="true">→</span>
            </button>
          ) : runState === 'open' ? (
            <button
              className="room-end-button"
              disabled={busyAction !== null}
              onClick={() => void changeRunState('closed')}
              type="button"
            >
              {busyAction === 'closed' ? t('Ending…') : t('End class safely')}
            </button>
          ) : (
            <p className="room-ended-note">
              ✓ {t('The room is closed. Student work remains saved.')}
            </p>
          )}
        </section>
      </div>

      <section
        className={`directive-studio ${runState !== 'open' ? 'is-locked' : ''}`}
        aria-labelledby="directive-heading"
      >
        <div className="directive-studio__heading">
          <span className="step-index">03</span>
          <div>
            <p className="eyebrow">{t('Current class direction')}</p>
            <h3 id="directive-heading">
              {t('What should every student do next?')}
            </h3>
          </div>
          {runState !== 'open' && (
            <span className="directive-lock">
              {t('Available when class starts')}
            </span>
          )}
        </div>
        <div
          className="directive-kind-switch"
          role="radiogroup"
          aria-label={t('Direction type')}
        >
          <label className={directiveKind === 'exercise' ? 'is-selected' : ''}>
            <input
              checked={directiveKind === 'exercise'}
              name="directive-kind"
              onChange={() => {
                setDirectiveKind('exercise');
                setShowPreview(false);
              }}
              type="radio"
            />
            <span aria-hidden="true">→</span>
            {t('Exercise')}
          </label>
          <label className={directiveKind === 'open_url' ? 'is-selected' : ''}>
            <input
              checked={directiveKind === 'open_url'}
              name="directive-kind"
              onChange={() => {
                setDirectiveKind('open_url');
                setShowPreview(false);
              }}
              type="radio"
            />
            <span aria-hidden="true">↗</span>
            {t('Open a link')}
          </label>
        </div>
        <label className="directive-instruction-field">
          {t('Instruction')}
          <textarea
            disabled={runState !== 'open'}
            maxLength={4000}
            onChange={(event) => {
              setInstruction(event.target.value);
              setShowPreview(false);
            }}
            placeholder={t(
              'Open the starter project and complete exercises A, B, and C…',
            )}
            rows={4}
            value={instruction}
          />
          <small>{instruction.length}/4000</small>
        </label>
        {directiveKind === 'open_url' && (
          <label>
            {t('Public HTTPS link')}
            <input
              disabled={runState !== 'open'}
              onChange={(event) => {
                setUrl(event.target.value);
                setShowPreview(false);
              }}
              placeholder="https://scratch.mit.edu/projects/…"
              type="url"
              value={url}
            />
            <small
              className={
                previewOrigin ? 'field-valid' : url ? 'field-invalid' : ''
              }
            >
              {url
                ? previewOrigin
                  ? autoEligible
                    ? t('Approved site · eligible for student opt-in auto-open')
                    : t('Safe link · students will choose Open')
                  : t('Enter a valid public HTTPS link')
                : t(
                    'Links never broadcast or open until you confirm the preview.',
                  )}
            </small>
          </label>
        )}
        {criteria.length > 0 && (
          <fieldset className="directive-criteria">
            <legend>
              {t('Attach check criteria')} <small>{t('optional')}</small>
            </legend>
            {criteria.map((criterion) => (
              <label key={criterion.id}>
                <input
                  checked={criterionIds.includes(criterion.id)}
                  disabled={runState !== 'open'}
                  onChange={(event) =>
                    setCriterionIds((current) =>
                      event.target.checked
                        ? [...current, criterion.id]
                        : current.filter((id) => id !== criterion.id),
                    )
                  }
                  type="checkbox"
                />
                <span>
                  <strong>{criterion.title}</strong>
                  <small>{criterion.description}</small>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {!showPreview ? (
          <button
            className="directive-preview-button"
            disabled={runState !== 'open' || !canPreview}
            onClick={() => setShowPreview(true)}
            type="button"
          >
            {t('Preview exact broadcast')} →
          </button>
        ) : (
          <section
            className="directive-preview"
            aria-labelledby="directive-preview-heading"
          >
            <div className="directive-preview__header">
              <div>
                <span>{t('Exact student preview')}</span>
                <h4 id="directive-preview-heading">{instruction.trim()}</h4>
              </div>
              <span className="directive-delivery-badge">
                {t(
                  directiveKind === 'open_url' && autoEligible
                    ? 'Auto-open eligible'
                    : 'Manual delivery',
                )}
              </span>
            </div>
            {directiveKind === 'open_url' && (
              <div className="directive-preview__url">
                <span aria-hidden="true">↗</span>
                <code>{url.trim()}</code>
              </div>
            )}
            {criterionIds.length > 0 && (
              <p>
                {t('{count} check criteria attached', {
                  count: criterionIds.length,
                })}
              </p>
            )}
            <div className="directive-preview__notice">
              <span aria-hidden="true">!</span>
              <p>
                <strong>{t('Broadcast is class-wide')}</strong>
                {t(
                  ' Students receive exactly this content. A model cannot press Broadcast for you.',
                )}
              </p>
            </div>
            <div className="directive-preview__actions">
              <button
                disabled={busyAction !== null}
                onClick={() => setShowPreview(false)}
                type="button"
              >
                {t('Revise')}
              </button>
              <button
                className="primary-button"
                disabled={busyAction !== null}
                onClick={() => void broadcast()}
                type="button"
              >
                {busyAction === 'broadcast'
                  ? t('Broadcasting…')
                  : t('Broadcast to class')}
              </button>
            </div>
          </section>
        )}
        {lastDirective && (
          <p className="directive-sent" aria-live="polite">
            ✓{' '}
            {t('Broadcast #{sequence} sent', {
              sequence: lastDirective.sequence,
            })}{' '}
            · {lastDirective.instruction}
          </p>
        )}
      </section>

      <section
        className="class-dashboard"
        aria-labelledby="class-dashboard-heading"
      >
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">{t('Explicit class signals')}</p>
            <h3 id="class-dashboard-heading">{t('Class pulse')}</h3>
            <p className="section-deck">
              {t(
                'Only joined, Help, Check, readiness, submission, and review events—never inferred attention or understanding.',
              )}
            </p>
          </div>
          <span className="dashboard-total">
            <strong>{participants.length}</strong>
            <small>{t('students')}</small>
          </span>
        </div>
        <div className="dashboard-lanes">
          {STATUS_ORDER.map((status) => (
            <div
              className={`dashboard-lane dashboard-lane--${status}`}
              key={status}
            >
              <span className="dashboard-lane__dot" aria-hidden="true" />
              <strong>{countFor(status)}</strong>
              <span>{t(status)}</span>
            </div>
          ))}
        </div>

        {(dashboard?.helpQueue?.length ?? 0) > 0 && (
          <section className="review-queue review-queue--help">
            <div className="review-queue__heading">
              <div>
                <span className="queue-icon" aria-hidden="true">
                  ?
                </span>
                <div>
                  <h4>{t('Needs help now')}</h4>
                  <p>{t('Raised explicitly by the student')}</p>
                </div>
              </div>
              <strong>{dashboard!.helpQueue!.length}</strong>
            </div>
            <ul>
              {dashboard!.helpQueue!.map((row) => (
                <li key={row.attemptId}>
                  <span className="student-avatar">
                    {String(row.id).slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{row.id}</strong>
                    <small>
                      {row.helpRequestedAt
                        ? t('Asked at {time}', {
                            time: formatter.format(
                              new Date(row.helpRequestedAt),
                            ),
                          })
                        : t('Help requested')}
                    </small>
                  </div>
                  <button
                    disabled={busyAction !== null}
                    onClick={() => void resolveHelp(row.attemptId)}
                    type="button"
                  >
                    {busyAction === `resolve:${row.attemptId}`
                      ? t('Resolving…')
                      : t('Mark resolved')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="participant-table-shell">
          <table className="knowledge-table participant-table">
            <thead>
              <tr>
                <th>{t('Student')}</th>
                <th>{t('Explicit status')}</th>
                <th>{t('Started')}</th>
                <th>{t('Assignment check')}</th>
                <th>{t('Sessions')}</th>
                <th>{t('Evidence')}</th>
                <th>
                  <span className="visually-hidden">{t('Review actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {participants.map((row) => (
                <tr key={row.attemptId}>
                  <td>
                    <span className="student-avatar">
                      {String(row.id).slice(0, 1).toUpperCase()}
                    </span>
                    <strong>{row.id}</strong>
                  </td>
                  <td>
                    <span
                      className={`participant-status participant-status--${row.status}`}
                    >
                      <i aria-hidden="true" />
                      {t(row.status)}
                    </span>
                    <small>{formatter.format(new Date(row.updatedAt))}</small>
                  </td>
                  <td>{row.startedAt ? formatter.format(new Date(row.startedAt)) : '—'}</td>
                  <td>{row.lastCheck ? <>{t(row.lastCheck.state === 'completed' ? 'Check finished' : row.lastCheck.state === 'failed' ? 'Check unavailable' : row.lastCheck.state === 'cancelled' ? 'Check interrupted' : 'Checking your work…')}<small>{formatter.format(new Date(row.lastCheck.updatedAt))}</small></> : '—'}</td>
                  <td>{row.sessionCount}</td>
                  <td>{row.evidenceCount}</td>
                  <td>
                    <div className="participant-review-actions">
                      {(row.status === 'ready' || row.status === 'submitted') &&
                        (pendingReview?.attemptId === row.attemptId ? (
                          <div
                            className="participant-review-confirmation"
                            aria-live="polite"
                          >
                            <span>
                              {t(
                                pendingReview.action === 'complete'
                                  ? 'Complete this exact Attempt?'
                                  : 'Return this exact Attempt for revision?',
                              )}
                              <small>
                                {row.id} · {row.attemptId.slice(0, 8)}
                              </small>
                            </span>
                            <button
                              disabled={busyAction !== null}
                              onClick={() => setPendingReview(null)}
                              type="button"
                            >
                              {t('Cancel')}
                            </button>
                            <button
                              className="primary-button"
                              disabled={busyAction !== null}
                              onClick={() =>
                                void review(
                                  pendingReview.attemptId,
                                  pendingReview.action,
                                )
                              }
                              type="button"
                            >
                              {busyAction !== null
                                ? t('Updating…')
                                : t(
                                    pendingReview.action === 'complete'
                                      ? 'Confirm Complete'
                                      : 'Confirm Return',
                                  )}
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              disabled={busyAction !== null}
                              onClick={() =>
                                setPendingReview({
                                  action: 'return',
                                  attemptId: row.attemptId,
                                })
                              }
                              type="button"
                            >
                              {t('Return')}
                            </button>
                            <button
                              className="primary-button"
                              disabled={busyAction !== null}
                              onClick={() =>
                                setPendingReview({
                                  action: 'complete',
                                  attemptId: row.attemptId,
                                })
                              }
                              type="button"
                            >
                              {t('Complete')}
                            </button>
                          </>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {participants.length === 0 && (
            <div className="knowledge-empty knowledge-empty--inline">
              <span className="empty-illustration" aria-hidden="true">
                ◎
              </span>
              <div>
                <strong>{t('Waiting for students')}</strong>
                <p>
                  {t(
                    'Share the room code above. Joined students appear here without refreshing.',
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {error && (
        <p className="form-error facilitator-room__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
