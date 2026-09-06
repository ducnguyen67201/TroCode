import { useEffect, useState } from 'react';

import type {
  TaskSnapshot,
  AppLanguage,
  ClassroomSessionProjection,
  HostedAttemptContext,
  KnowledgeFileSelection,
  SubmitTaskRequest,
  WorkspaceSelection,
} from '../shared/contracts';
import { randomUUID } from '../shared/renderer-uuid';

import { translate } from './app-language';
import { latestCheckForAttempt } from './work-check-view';
import { WorkCheckResultCard } from './WorkCheckResultCard';

type ActivityIntent = SubmitTaskRequest['activityIntent'];

export function AttemptLaunchPage({
  checkSnapshots = [],
  appLanguage,
  attemptId,
  onBack,
  onLaunch,
}: {
  checkSnapshots?: readonly TaskSnapshot[];
  appLanguage: AppLanguage;
  attemptId: string;
  onBack: () => void;
  onLaunch: (request: SubmitTaskRequest) => Promise<void>;
}) {
  const [attempt, setAttempt] = useState<HostedAttemptContext | null>(null);
  const [classroomSession, setClassroomSession] =
    useState<ClassroomSessionProjection | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSelection | null>(null);
  const [submission, setSubmission] = useState<KnowledgeFileSelection | null>(
    null,
  );
  const [prompt, setPrompt] = useState('Help me work through this Activity.');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = (text: string) => translate(appLanguage, text);

  useEffect(() => {
    let active = true;
    const applySession = (session: ClassroomSessionProjection | null) => {
      if (active && (!session || session.attemptId === attemptId)) {
        setClassroomSession(session);
        if (session) {
          setAttempt((current) =>
            current ? { ...current, state: session.attemptState } : current,
          );
        }
      }
    };
    const stopSession = window.tro.onClassroomSessionChanged(applySession);
    void window.tro
      .getHostedAttempt(attemptId)
      .then(async (value) => {
        if (!active) return;
        setAttempt(value);
        setAcknowledged(
          value.acknowledgedPolicyVersion === value.run.insightPolicyVersion,
        );
        if (value.run.mode === 'live' || value.run.mode === 'hybrid') {
          try {
            const current = await window.tro.getClassroomSession();
            if (!active) return;
            if (current?.attemptId === attemptId) applySession(current);
          } catch {
            // A direct live assignment is valid without room participation.
          }
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : translate(appLanguage, 'Activity is unavailable.'),
        );
      });
    return () => {
      active = false;
      stopSession();
    };
  }, [appLanguage, attemptId]);

  if (!attempt) {
    return (
      <section className="knowledge-page">
        <button className="back-link" onClick={onBack} type="button">
          ← {t('Assigned Activities')}
        </button>
        <div className="knowledge-empty">
          <strong>{error ?? t('Loading Activity…')}</strong>
        </div>
      </section>
    );
  }

  const needsDisclosure = attempt.run.insightPolicy === 'evidence_candidates';
  const isTerminal =
    attempt.state === 'completed' || attempt.state === 'withdrawn';
  const isReady = attempt.state === 'ready_for_review';
  const isSubmitted = attempt.state === 'submitted';
  const helpRequested = attempt.state === 'blocked';
  const isLockedForWork = isTerminal || isSubmitted;
  const canReady =
    !attempt.definition.completionPolicy.requiresSubmission &&
    (attempt.state === 'assigned' ||
      attempt.state === 'in_progress' ||
      attempt.state === 'blocked');

  const launch = async (intent: ActivityIntent, text = prompt) => {
    setBusyAction(intent);
    setError(null);
    setMessage(null);
    try {
      if (needsDisclosure && !acknowledged)
        throw new Error(
          t('Review and accept the insight policy before starting.'),
        );
      if (
        needsDisclosure &&
        attempt.acknowledgedPolicyVersion !== attempt.run.insightPolicyVersion
      ) {
        await window.tro.acknowledgeHostedAttempt({
          attemptId,
          policyVersion: attempt.run.insightPolicyVersion,
        });
      }
      if (intent === 'help') {
        await window.tro.requestKnowledgeAttemptHelp({
          attemptId,
          clientId: randomUUID(),
        });
        setAttempt((current) =>
          current ? { ...current, state: 'blocked' } : current,
        );
      }
      await onLaunch({
        activityAttemptId: attemptId,
        activityIntent: intent,
        requestedMode: intent === 'work' ? 'auto' : 'coach',
        screenContext: 'auto',
        executionProfile:
          attempt.definition.launchTarget === 'workspace'
            ? 'workspace'
            : 'everyday',
        workspaceSelectionId: workspace?.selectionId ?? null,
        text,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not start this Activity.'),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const chooseExistingWorkspace = async () => {
    setError(null);
    try {
      setWorkspace(await window.tro.selectWorkspace());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not select that Workspace.'),
      );
    }
  };

  const prepareStarterWorkspace = async () => {
    setBusyAction('starter');
    setError(null);
    try {
      setWorkspace(await window.tro.prepareActivityStarter({ attemptId }));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not prepare the starter Workspace.'),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const chooseSubmission = async () => {
    setError(null);
    try {
      setSubmission(
        await window.tro.selectKnowledgeFiles({
          role: 'submission',
          selectionKind: 'files',
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not review those submission files.'),
      );
    }
  };

  const uploadSubmission = async () => {
    if (!submission) return;
    setBusyAction('submit');
    setError(null);
    try {
      await window.tro.submitKnowledgeSelection({
        attemptId,
        selectionId: submission.selectionId,
      });
      setSubmission(null);
      setAttempt((current) =>
        current ? { ...current, state: 'submitted' } : current,
      );
      setMessage(t('Submission received. Your teacher can now review it.'));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not submit those files.'),
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
        attemptId,
        clientId: randomUUID(),
      });
      setAttempt((current) =>
        current ? { ...current, state: result.state } : current,
      );
      setMessage(t('Your teacher can now review this Attempt.'));
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

  const latestCheck = latestCheckForAttempt(checkSnapshots, attempt.attemptId, attempt.activityVersionId);
  const workspaceRequired = attempt.definition.launchTarget === 'workspace';
  const launchDisabled =
    busyAction !== null || (workspaceRequired && !workspace);

  return (
    <section className="knowledge-page attempt-page">
      <button className="back-link" onClick={onBack} type="button">
        ← {t('Assigned Activities')}
      </button>
      <header className="knowledge-heading knowledge-heading--editorial attempt-hero">
        <div>
          <div className="attempt-breadcrumb">
            <span>{attempt.space.name}</span>
            <i aria-hidden="true">/</i>
            <span>{t(attempt.run.mode)}</span>
          </div>
          <h1>{attempt.definition.title}</h1>
          <p>{attempt.definition.objective}</p>
        </div>
        <span
          className={`attempt-state-seal attempt-state-seal--${attempt.state}`}
        >
          <i aria-hidden="true" />
          {t(attempt.state)}
        </span>
      </header>

      {classroomSession?.currentDirective && (
        <section
          className="attempt-current-direction"
          aria-labelledby="current-direction-heading"
        >
          <div className="attempt-current-direction__mark" aria-hidden="true">
            →
          </div>
          <div>
            <p className="eyebrow">{t('Current teacher direction')}</p>
            <h2 id="current-direction-heading">
              {classroomSession.currentDirective.instruction}
            </h2>
            {classroomSession.currentDirective.kind === 'open_url' && (
              <span>{classroomSession.currentDirective.origin}</span>
            )}
          </div>
        </section>
      )}

      <div className="attempt-layout">
        <main className="attempt-main">
          <article className="attempt-instructions">
            <div className="attempt-section-heading">
              <span className="step-index">01</span>
              <div>
                <p className="eyebrow">{t('Published brief')}</p>
                <h2>{t('Instructions')}</h2>
              </div>
            </div>
            <p>{attempt.definition.instructions}</p>
          </article>

          {attempt.definition.criteria.length > 0 && (
            <section
              className="attempt-criteria"
              aria-labelledby="attempt-criteria-heading"
            >
              <div className="attempt-section-heading">
                <span className="step-index">02</span>
                <div>
                  <p className="eyebrow">{t('Success looks like')}</p>
                  <h2 id="attempt-criteria-heading">{t('Check criteria')}</h2>
                </div>
              </div>
              <ol>
                {attempt.definition.criteria.map((criterion) => (
                  <li key={criterion.id}>
                    <span aria-hidden="true" />
                    <div>
                      <strong>{criterion.title}</strong>
                      <p>{criterion.description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {attempt.sourceCatalog.length > 0 && (
            <details className="attempt-sources">
              <summary>
                {t('Published source set')}{' '}
                <span>{attempt.sourceCatalog.length}</span>
              </summary>
              <ul>
                {attempt.sourceCatalog.map((source) => (
                  <li key={`${source.role}:${source.title}`}>
                    <span>{source.title}</span>
                    <small>{t(source.role)}</small>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {attempt.definition.completionPolicy.requiresSubmission && (
            <section
              className="submission-panel"
              aria-labelledby="submission-heading"
            >
              <div className="attempt-section-heading">
                <span className="step-index">03</span>
                <div>
                  <p className="eyebrow">{t('Explicit hand-in')}</p>
                  <h2 id="submission-heading">{t('Submit files')}</h2>
                </div>
              </div>
              <p>
                {t(
                  'Tro never uploads your local work automatically. You review the exact files before anything leaves your device.',
                )}
              </p>
              {isSubmitted || attempt.state === 'completed' ? (
                <div className="submission-complete">
                  <span aria-hidden="true">✓</span>
                  <div>
                    <strong>{t('Submission received')}</strong>
                    <small>
                      {t('Your teacher can review the submitted snapshot.')}
                    </small>
                  </div>
                </div>
              ) : isTerminal ? (
                <div className="submission-complete">
                  <span aria-hidden="true">—</span>
                  <div>
                    <strong>{t('Submission unavailable')}</strong>
                    <small>{t('This Attempt is no longer active.')}</small>
                  </div>
                </div>
              ) : submission ? (
                <div className="upload-preview">
                  <div className="upload-preview__heading">
                    <strong>{t('Files leaving this device')}</strong>
                    <small>
                      {submission.files.length} {t('files')}
                    </small>
                  </div>
                  <ul>
                    {submission.files.map((file) => (
                      <li key={file.relativePath}>
                        <span>{file.relativePath}</span>
                        <small>{Math.ceil(file.byteSize / 1024)} KB</small>
                      </li>
                    ))}
                  </ul>
                  <div className="upload-preview__actions">
                    <button onClick={() => setSubmission(null)} type="button">
                      {t('Cancel')}
                    </button>
                    <button
                      className="primary-button"
                      disabled={busyAction !== null}
                      onClick={() => void uploadSubmission()}
                      type="button"
                    >
                      {busyAction === 'submit'
                        ? t('Submitting…')
                        : t('Submit reviewed files')}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => void chooseSubmission()} type="button">
                  {t('Review files to submit')}
                </button>
              )}
            </section>
          )}
        </main>

        <aside className="attempt-cockpit" aria-label={t('Activity controls')}>
          <section className="attempt-action-card">
            <p className="eyebrow">{t('Work with Tro')}</p>
            <h2>{t('Move forward without losing context')}</h2>
            <p>
              {t(
                'Choose the intent. Tro uses this Activity’s instructions, criteria, and published sources.',
              )}
            </p>
            <label className="launch-prompt">
              {t('Add a note for Tro')}
              <textarea
                onChange={(event) => setPrompt(event.target.value)}
                rows={3}
                value={prompt}
              />
            </label>
            {workspaceRequired && (
              <div className="workspace-setup">
                <span>{t('Workspace required')}</span>
                <div>
                  <button
                    onClick={() => void chooseExistingWorkspace()}
                    type="button"
                  >
                    {t('Choose folder')}
                  </button>
                  {attempt.starterAvailable && (
                    <button
                      disabled={busyAction !== null}
                      onClick={() => void prepareStarterWorkspace()}
                      type="button"
                    >
                      {t('Use starter')}
                    </button>
                  )}
                </div>
                {workspace && (
                  <span className="workspace-selection-chip">
                    ✓ {workspace.displayName}
                  </span>
                )}
              </div>
            )}
            <div className="attempt-intent-actions">
              <button
                className="attempt-intent attempt-intent--work"
                disabled={launchDisabled || isLockedForWork}
                onClick={() => void launch('work')}
                type="button"
              >
                <span aria-hidden="true">→</span>
                <div>
                  <strong>
                    {busyAction === 'work'
                      ? t('Starting…')
                      : t('Start working')}
                  </strong>
                  <small>{t('Begin or continue the exercise')}</small>
                </div>
              </button>
              <button
                className="attempt-intent attempt-intent--help"
                disabled={launchDisabled || helpRequested || isLockedForWork}
                onClick={() =>
                  void launch(
                    'help',
                    'Help me understand the next step without giving away the full answer.',
                  )
                }
                type="button"
              >
                <span aria-hidden="true">?</span>
                <div>
                  <strong>
                    {busyAction === 'help'
                      ? t('Asking…')
                      : helpRequested
                        ? t('Help request sent')
                        : t('I need help')}
                  </strong>
                  <small>{t('Tell the teacher and get one next step')}</small>
                </div>
              </button>
              <button
                className="attempt-intent attempt-intent--check"
                disabled={launchDisabled || isLockedForWork}
                onClick={() =>
                  void launch(
                    'check',
                    'Check my current work against the published criteria. Tell me what is correct and what to revise.',
                  )
                }
                type="button"
              >
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>
                    {busyAction === 'check'
                      ? t('Checking…')
                      : t('Check my work')}
                  </strong>
                  <small>
                    {t('Advisory feedback, never an automatic grade')}
                  </small>
                </div>
              </button>
            </div>
          </section>

          <section className="attempt-finish-card">
            {attempt.startedAt && <p>{t('Started')}: {new Date(attempt.startedAt).toLocaleString()}</p>}
            {latestCheck && <WorkCheckResultCard projection={latestCheck.workCheck ?? null} sync={latestCheck.workSessionSync} appLanguage={appLanguage}/>}
            <p className="eyebrow">{t('When you are satisfied')}</p>
            <h3>
              {isReady || isSubmitted
                ? t('Waiting for teacher review')
                : t('Tell your teacher you are ready')}
            </h3>
            <p>
              {isReady
                ? t(
                    'You can continue working if your teacher returns this Attempt.',
                  )
                : isSubmitted
                  ? t('Your submitted snapshot is waiting for teacher review.')
                  : attempt.definition.completionPolicy.requiresSubmission
                  ? t(
                      'Submit the required files above when your work is ready.',
                    )
                  : t(
                      'This is explicit. Tro will not mark your work ready on its own.',
                    )}
            </p>
            <button
              className="primary-button"
              disabled={!canReady || busyAction !== null}
              onClick={() => void markReady()}
              type="button"
            >
              {busyAction === 'ready'
                ? t('Marking ready…')
                : isReady
                  ? t('Ready for review')
                  : isSubmitted
                    ? t('Submitted for review')
                    : attempt.definition.completionPolicy.requiresSubmission
                      ? t('Submit files above')
                  : t('Send for teacher review')}
            </button>
          </section>

          <dl className="attempt-policy attempt-policy--stacked">
            <div>
              <dt>{t('Guidance')}</dt>
              <dd>
                {t(attempt.definition.guidancePolicy.hintMode)} ·{' '}
                {t(attempt.definition.guidancePolicy.answerReveal)}
              </dd>
            </div>
            <div>
              <dt>{t('Previous work')}</dt>
              <dd>{attempt.priorProgress.summary}</dd>
            </div>
            <div>
              <dt>{t('Session visibility')}</dt>
              <dd>{t('Explicit lifecycle events only')}</dd>
            </div>
          </dl>
        </aside>
      </div>

      {needsDisclosure && (
        <label className="policy-disclosure">
          <input
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>{t('Insight policy')}</strong>
            {t(
              ' Tro may record bounded, provenance-labeled evidence candidates for teacher review. These cannot grade you or change completion state.',
            )}
          </span>
        </label>
      )}
      {message && (
        <p className="attempt-message" aria-live="polite">
          ✓ {message}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
