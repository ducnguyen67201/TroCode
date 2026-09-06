import { useEffect, useMemo, useState } from 'react';

import type {
  AppLanguage,
  ClassroomDirectiveNotice,
  ClassroomSessionProjection,
  SubmitTaskRequest,
} from '../shared/contracts';
import { randomUUID } from '../shared/renderer-uuid';

import { translate } from './app-language';
import {
  classroomDirectiveMessage,
  classroomSessionView,
} from './classroom-session-view';

export function ClassroomSessionBar({
  appLanguage,
  onLaunch,
  onOpenClasswork,
}: {
  appLanguage: AppLanguage;
  onLaunch: (request: SubmitTaskRequest) => Promise<void>;
  onOpenClasswork: (attemptId: string) => void;
}) {
  const [session, setSession] = useState<ClassroomSessionProjection | null>(
    null,
  );
  const [notice, setNotice] = useState<ClassroomDirectiveNotice | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = (message: string) => translate(appLanguage, message);

  useEffect(() => {
    let active = true;
    const stopSession = window.tro.onClassroomSessionChanged((next) => {
      if (active) setSession(next);
    });
    const stopDirective = window.tro.onClassroomDirectiveChanged((next) => {
      if (active) setNotice(next);
    });
    void window.tro
      .restoreClassroomSession()
      .then((next) => {
        if (active) setSession(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      stopSession();
      stopDirective();
    };
  }, []);

  const view = useMemo(
    () => (session ? classroomSessionView(session) : null),
    [session],
  );

  if (!session || !view) return null;

  const launch = async (intent: 'check' | 'help') => {
    if (session.activity.launchTarget === 'workspace') {
      onOpenClasswork(session.attemptId);
      return;
    }
    setBusyAction(intent);
    setError(null);
    try {
      if (intent === 'help') {
        await window.tro.requestKnowledgeAttemptHelp({
          attemptId: session.attemptId,
          clientId: randomUUID(),
        });
        setSession((current) =>
          current ? { ...current, attemptState: 'blocked' } : current,
        );
      }
      await onLaunch({
        activityAttemptId: session.attemptId,
        activityIntent: intent,
        executionProfile: 'everyday',
        requestedMode: 'coach',
        screenContext: 'auto',
        workspaceSelectionId: null,
        text:
          intent === 'help'
            ? 'Help me understand the next step without giving away the full answer.'
            : 'Check my current work against the published criteria. Tell me what is correct and what to revise.',
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not start classroom support.'),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const markReady = async () => {
    setBusyAction('ready');
    setError(null);
    try {
      const result = await window.tro.readyKnowledgeAttempt({
        attemptId: session.attemptId,
        clientId: randomUUID(),
      });
      setSession((current) =>
        current ? { ...current, attemptState: result.state } : current,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not mark this work ready.'),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const leave = async () => {
    setBusyAction('leave');
    setError(null);
    try {
      await window.tro.leaveClassroomSession({
        attemptId: session.attemptId,
        clientId: randomUUID(),
      });
      setSession(null);
      setNotice(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not leave this class.'),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const setConsent = async (consent: boolean) => {
    setBusyAction('consent');
    setError(null);
    try {
      setSession(await window.tro.setClassroomLinkConsent({ consent }));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not update link permission.'),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const activeNotice = notice?.status === 'dismissed' ? null : notice;

  return (
    <aside
      className={`classroom-bar classroom-bar--${view.tone}`}
      aria-label={t('Current class session')}
    >
      <div className="classroom-bar__signal" aria-hidden="true">
        <span />
      </div>
      <div className="classroom-bar__identity">
        <span className="classroom-bar__status">{t(view.label)}</span>
        <strong>{session.activity.title}</strong>
        <span>{session.space.name}</span>
      </div>
      <div className="classroom-bar__context">
        <span>{t('Current direction')}</span>
        <p>{session.currentDirective?.instruction ?? t(view.description)}</p>
      </div>
      <div className="classroom-bar__actions">
        {view.canAskForHelp && (
          <button
            disabled={busyAction !== null}
            onClick={() => void launch('help')}
            type="button"
          >
            {busyAction === 'help' ? t('Asking…') : t('Help')}
          </button>
        )}
        {view.canCheck && (
          <button
            disabled={busyAction !== null}
            onClick={() => void launch('check')}
            type="button"
          >
            {busyAction === 'check' ? t('Checking…') : t('Check my work')}
          </button>
        )}
        {view.canMarkReady && (
          <button
            className="classroom-bar__ready"
            disabled={busyAction !== null}
            onClick={() => void markReady()}
            type="button"
          >
            {busyAction === 'ready'
              ? t('Marking ready…')
              : t('Send for teacher review')}
          </button>
        )}
        <button
          onClick={() => onOpenClasswork(session.attemptId)}
          type="button"
        >
          {t('Open classwork')}
        </button>
        {view.canLeave && (
          <button
            className="classroom-bar__leave"
            disabled={busyAction !== null}
            onClick={() => void leave()}
            type="button"
          >
            {busyAction === 'leave' ? t('Leaving…') : t('Leave')}
          </button>
        )}
      </div>

      {session.run.status === 'live' && (
        <label className="classroom-consent">
          <input
            checked={session.autoOpenConsent}
            disabled={busyAction === 'consent'}
            onChange={(event) => void setConsent(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>{t('Open approved class links automatically')}</strong>
            <small>
              {t(
                'Only published HTTPS sites allowed by this Activity. You can turn this off anytime.',
              )}
            </small>
          </span>
        </label>
      )}

      {activeNotice && (
        <section
          className={`classroom-directive classroom-directive--${activeNotice.status}`}
          aria-live="polite"
        >
          <div className="classroom-directive__mark" aria-hidden="true">
            {activeNotice.directive.kind === 'open_url' ? '↗' : '→'}
          </div>
          <div>
            <span>{t(classroomDirectiveMessage(activeNotice))}</span>
            <strong>{activeNotice.directive.instruction}</strong>
            {activeNotice.directive.kind === 'open_url' && (
              <small>{activeNotice.directive.origin}</small>
            )}
          </div>
          <div className="classroom-directive__actions">
            {activeNotice.directive.kind === 'open_url' &&
              activeNotice.status !== 'opened' && (
                <button
                  className="primary-button"
                  onClick={() =>
                    void window.tro
                      .openClassroomDirective({
                        directive: activeNotice.directive,
                      })
                      .catch((cause: unknown) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : t('Could not open this link.'),
                        ),
                      )
                  }
                  type="button"
                >
                  {t('Open link')}
                </button>
              )}
            <button
              onClick={() =>
                void window.tro
                  .dismissClassroomDirective(activeNotice.directive.id)
                  .then(() => setNotice(null))
              }
              type="button"
            >
              {t('Dismiss')}
            </button>
          </div>
        </section>
      )}

      {error && (
        <p className="classroom-bar__error" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
