import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AppLanguage,
  ClassroomSessionProjection,
  KnowledgeClassSession,
  PublishedKnowledgeActivity,
} from '../shared/contracts';
import { randomUUID } from '../shared/renderer-uuid';

import { translate } from './app-language';
import { FacilitatorRunPage } from './FacilitatorRunPage';

export function ClassSessionsPanel({
  onTeacherSessionSelect,
  teacherSessionId,
  appLanguage,
  canFacilitate,
  onJoined,
  refreshToken,
  spaceId,
}: {
  onTeacherSessionSelect?: (
    spaceId: string,
    sessionId: string | null,
  ) => Promise<void>;
  teacherSessionId?: string | null;
  appLanguage: AppLanguage;
  canFacilitate: boolean;
  onJoined?: (attemptId: string) => void;
  refreshToken: number;
  spaceId: string;
}) {
  const [activities, setActivities] = useState<PublishedKnowledgeActivity[]>(
    [],
  );
  const [sessions, setSessions] = useState<KnowledgeClassSession[]>([]);
  const [openedSession, setActiveSession] =
    useState<KnowledgeClassSession | null>(null);
  const activeSession=openedSession??sessions.find(session=>session.id===teacherSessionId)??null;
  const [initialRoomCode, setInitialRoomCode] = useState<Awaited<
    ReturnType<typeof window.tro.createKnowledgeRoomCode>
  > | null>(null);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [selectedVersionIds, setSelectedVersionIds] = useState<string[]>([]);
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(canFacilitate);
  const [busy, setBusy] = useState<string | null>(null);
  const opening = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const t = useCallback(
    (
      message: string,
      replacements: Readonly<Record<string, string | number>> = {},
    ) => translate(appLanguage, message, replacements),
    [appLanguage],
  );

  const load = useCallback(async () => {
    if (!canFacilitate) return;
    try {
      const [published, classSessions] = await Promise.all([
        window.tro.listPublishedKnowledgeActivities(spaceId),
        window.tro.listKnowledgeClassSessions(spaceId),
      ]);
      setActivities(published.items);
      setSessions(classSessions.items);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('Sessions are unavailable.'),
      );
    } finally {
      setLoading(false);
    }
  }, [canFacilitate, spaceId, t]);

  useEffect(() => {
    if (!canFacilitate) return;
    let active = true;
    void Promise.all([
      window.tro.listPublishedKnowledgeActivities(spaceId),
      window.tro.listKnowledgeClassSessions(spaceId),
    ])
      .then(([published, classSessions]) => {
        if (!active) return;
        setActivities(published.items);
        setSessions(classSessions.items);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : t('Sessions are unavailable.'),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canFacilitate, refreshToken, spaceId, t]);

  const beginSession = () => {
    setTitle(t('Session {number}', { number: sessions.length + 1 }));
    setSelectedVersionIds([]);
    setComposing(true);
    setError(null);
  };

  const createSession = async () => {
    if (!title.trim() || selectedVersionIds.length === 0) return;
    setBusy('create');
    setError(null);
    try {
      const session = await window.tro.createKnowledgeClassSession({
        activityVersionIds: selectedVersionIds,
        clientId: randomUUID(),
        spaceId,
        title: title.trim(),
      });
      setSessions((current) => [session, ...current]);
      setComposing(false);
      setTitle('');
      setSelectedVersionIds([]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not create this Session.'),
      );
    } finally {
      setBusy(null);
    }
  };

  const openSession = async (session: KnowledgeClassSession) => {
    const primary = session.activities[0];
    if (!primary || opening.current) return;
    opening.current = true;
    setBusy(`open:${session.id}`);
    setError(null);
    try {
      const code =
        session.state === 'closed' || session.state === 'archived'
          ? null
          : await window.tro.createKnowledgeRoomCode({
              clientId: randomUUID(),
              expiresAt: null,
              maxUses: 500,
              reuseActive: true,
              runId: primary.runId,
              spaceId,
            });
      setInitialRoomCode(code);
      setActiveSession(session);
      if (session.state === 'open')
        await onTeacherSessionSelect?.(spaceId, session.id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not open this Session.'),
      );
    } finally {
      opening.current = false;
      setBusy(null);
    }
  };

  const joinSession = async () => {
    const code = roomCode.trim().toUpperCase();
    if (code.length < 8) return;
    setBusy('join');
    setError(null);
    try {
      const classroom: ClassroomSessionProjection =
        await window.tro.joinKnowledgeRoom({
          clientId: randomUUID(),
          code,
        });
      setRoomCode('');
      onJoined?.(classroom.attemptId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not join this Session.'),
      );
    } finally {
      setBusy(null);
    }
  };

  if (!canFacilitate) {
    return (
      <section className="class-sessions class-sessions--student">
        <div className="class-sessions__student-copy">
          <p className="eyebrow">{t('Live Session')}</p>
          <h2>{t('Join your Teacher')}</h2>
          <p>
            {t(
              'Enter the code your Teacher shares. All Activities for this Session will appear in your Assigned work.',
            )}
          </p>
          <p>
            {t('Approved class links open automatically. New teacher explanations start while you are idle. You can turn either off in the class controls.')}
          </p>
          <p>{t('Teacher lessons may open approved material and demonstrate an example on your screen while you are idle. Pause or stop at any time, or turn off automatic lessons in Class updates.')}</p>
        </div>
        <form
          className="class-session-code-entry"
          onSubmit={(event) => {
            event.preventDefault();
            void joinSession();
          }}
        >
          <label htmlFor={`session-room-code-${spaceId}`}>
            {t('Session code')}
          </label>
          <div>
            <input
              autoCapitalize="characters"
              autoComplete="off"
              id={`session-room-code-${spaceId}`}
              maxLength={32}
              onChange={(event) =>
                setRoomCode(event.target.value.toUpperCase())
              }
              placeholder="TRO-84MK"
              spellCheck={false}
              value={roomCode}
            />
            <button
              className="primary-button"
              disabled={busy !== null || roomCode.trim().length < 8}
              type="submit"
            >
              {t(busy === 'join' ? 'Joining…' : 'Join Session')}
            </button>
          </div>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  if (activeSession) {
    const primary = activeSession.activities[0];
    return (
      <div className="class-session-live">
        {error && <p role="alert">{error}</p>}
        <button
          className="back-link"
          onClick={() => {
            void onTeacherSessionSelect?.(spaceId, null);
            setActiveSession(null);
            setInitialRoomCode(null);
            void load();
          }}
          type="button"
        >
          <span aria-hidden="true">←</span> {t('All Sessions')}
        </button>
        <header className="class-session-live__identity">
          <div>
            <p className="eyebrow">{t('Session')}</p>
            <h2>{activeSession.title}</h2>
          </div>
          <ol aria-label={t('Session Activities')}>
            {activeSession.activities.map((activity) => (
              <li key={activity.runId}>{activity.title}</li>
            ))}
          </ol>
        </header>
        {primary && (
          <FacilitatorRunPage
            key={primary.runId}
            onRunStateChanged={async (state) => {
              setSessions((current) => current.map((session) =>
                session.id === activeSession.id ? { ...session, state } : session,
              ));
              setActiveSession({ ...activeSession, state });
              await onTeacherSessionSelect?.(
                spaceId,
                state === 'open' ? activeSession.id : null,
              );
            }}
            allowedOrigins={primary.allowedOrigins}
            appLanguage={appLanguage}
            criteria={primary.criteria}
            initialRoomCode={initialRoomCode}
            runId={primary.runId}
            spaceId={spaceId}
          />
        )}
      </div>
    );
  }

  return (
    <section
      className="class-sessions"
      aria-labelledby="class-sessions-heading"
    >
      <header className="class-sessions__heading">
        <div>
          <p className="eyebrow">{t('Teach live')}</p>
          <h2 id="class-sessions-heading">{t('Sessions')}</h2>
          <p>
            {t('Open a Session lobby, invite learners, then start class.')}
          </p>
        </div>
        {!composing && (
          <button
            className="primary-button"
            onClick={beginSession}
            type="button"
          >
            <span aria-hidden="true">＋</span> {t('New Session')}
          </button>
        )}
      </header>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {composing && (
        <section
          className="class-session-composer"
          aria-labelledby="new-session-heading"
        >
          <div className="class-session-composer__heading">
            <div>
              <p className="eyebrow">{t('New Session')}</p>
              <h3 id="new-session-heading">{t('Choose the learning path')}</h3>
            </div>
            <button onClick={() => setComposing(false)} type="button">
              {t('Cancel')}
            </button>
          </div>
          <label>
            {t('Session name')}
            <input
              autoFocus
              maxLength={240}
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </label>
          <fieldset>
            <legend>{t('Activities')}</legend>
            {activities.length === 0 ? (
              <p>{t('Publish an Activity first, then add it here.')}</p>
            ) : (
              <div className="class-session-activity-picker">
                {activities.map((activity) => {
                  const checked = selectedVersionIds.includes(
                    activity.versionId,
                  );
                  return (
                    <label
                      className={checked ? 'is-selected' : ''}
                      key={activity.versionId}
                    >
                      <input
                        checked={checked}
                        disabled={!activity.allowRoomJoin}
                        onChange={(event) =>
                          setSelectedVersionIds((current) =>
                            event.target.checked
                              ? [...current, activity.versionId]
                              : current.filter(
                                  (id) => id !== activity.versionId,
                                ),
                          )
                        }
                        type="checkbox"
                      />
                      <b className="class-session-activity-picker__order">
                        {checked
                          ? selectedVersionIds.indexOf(activity.versionId) + 1
                          : '—'}
                      </b>
                      <span>
                        <strong>{activity.title}</strong>
                        <small>
                          {activity.allowRoomJoin
                            ? activity.objective
                            : t(
                                'Enable live joining when you publish this Activity.',
                              )}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
          <button
            className="primary-button class-session-composer__save"
            disabled={
              busy !== null || !title.trim() || selectedVersionIds.length === 0
            }
            onClick={() => void createSession()}
            type="button"
          >
            {t(busy === 'create' ? 'Creating…' : 'Create Session')}
          </button>
        </section>
      )}

      {!composing && loading && (
        <p className="knowledge-loading">{t('Loading Sessions…')}</p>
      )}

      {!composing && !loading && sessions.length === 0 && (
        <div className="class-sessions__empty">
          <span aria-hidden="true">01</span>
          <div>
            <h3>{t('Your first Session starts here')}</h3>
            <p>
              {t(
                'Group one or more published Activities into one live lesson.',
              )}
            </p>
          </div>
        </div>
      )}

      {!composing && sessions.length > 0 && (
        <div className="class-session-list">
          {sessions.map((session, index) => (
            <article className="class-session-card" key={session.id}>
              <span className="class-session-card__number">
                {String(sessions.length - index).padStart(2, '0')}
              </span>
              <div className="class-session-card__body">
                <div>
                  <span
                    className={`class-session-state class-session-state--${session.state}`}
                  >
                    {t(
                      session.state === 'open'
                        ? 'Live'
                        : session.state === 'closed' || session.state === 'archived'
                          ? 'Ended'
                          : 'Room lobby',
                    )}
                  </span>
                  <h3>{session.title}</h3>
                  <p>
                    {t('{count} Activities', {
                      count: session.activities.length,
                    })}
                    {' · '}
                    {session.activities
                      .map((activity) => activity.title)
                      .join(' → ')}
                  </p>
                </div>
                <button
                  className="primary-button"
                  disabled={busy !== null}
                  onClick={() => void openSession(session)}
                  type="button"
                >
                  {t(
                    busy === `open:${session.id}`
                      ? 'Opening…'
                      : session.state === 'closed' || session.state === 'archived'
                        ? 'Review'
                        : session.state === 'open'
                          ? 'Open live'
                          : 'Open lobby',
                  )}{' '}
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
