import { useEffect, useState } from 'react';

import type {
  AppLanguage,
  HostedAttemptContext,
  KnowledgeFileSelection,
  SubmitTaskRequest,
  WorkspaceSelection,
} from '../shared/contracts';
import { randomUUID } from '../shared/renderer-uuid';

import { translate } from './app-language';

export function AttemptLaunchPage({
  appLanguage,
  attemptId,
  onBack,
  onLaunch,
}: {
  appLanguage: AppLanguage;
  attemptId: string;
  onBack: () => void;
  onLaunch: (request: SubmitTaskRequest) => Promise<void>;
}) {
  const [attempt, setAttempt] = useState<HostedAttemptContext | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSelection | null>(null);
  const [submission, setSubmission] = useState<KnowledgeFileSelection | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [helpRequested, setHelpRequested] = useState(false);
  const [prompt, setPrompt] = useState('Help me work through this Activity.');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = (message: string) => translate(appLanguage, message);

  useEffect(() => {
    void window.tro
      .getHostedAttempt(attemptId)
      .then((value) => {
        setAttempt(value);
        setAcknowledged(
          value.acknowledgedPolicyVersion === value.run.insightPolicyVersion,
        );
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : translate(appLanguage, 'Activity is unavailable.'),
        ),
      );
  }, [appLanguage, attemptId]);

  if (!attempt) {
    return (
      <section className="knowledge-page">
        <button onClick={onBack} type="button">
          ← {t('Assigned Activities')}
        </button>
        <p>{error ?? t('Loading…')}</p>
      </section>
    );
  }

  const needsDisclosure = attempt.run.insightPolicy === 'evidence_candidates';
  const launch = async () => {
    setBusy(true);
    setError(null);
    try {
      if (needsDisclosure && !acknowledged) {
        throw new Error(t('Review and accept the insight policy before starting.'));
      }
      if (
        needsDisclosure &&
        attempt.acknowledgedPolicyVersion !== attempt.run.insightPolicyVersion
      ) {
        await window.tro.acknowledgeHostedAttempt({
          attemptId,
          policyVersion: attempt.run.insightPolicyVersion,
        });
      }
      await onLaunch({
        activityAttemptId: attemptId,
        executionProfile:
          attempt.definition.launchTarget === 'workspace'
            ? 'workspace'
            : 'everyday',
        workspaceSelectionId: workspace?.selectionId ?? null,
        text: prompt,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not start this Activity.'),
      );
    } finally {
      setBusy(false);
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
    setBusy(true);
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
      setBusy(false);
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
    setBusy(true);
    setError(null);
    try {
      await window.tro.submitKnowledgeSelection({
        attemptId,
        selectionId: submission.selectionId,
      });
      setSubmission(null);
      setSubmitted(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not submit those files.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="knowledge-page attempt-page">
      <button className="back-link" onClick={onBack} type="button">
        ← {t('Assigned Activities')}
      </button>
      <header className="knowledge-heading">
        <div>
          <p className="eyebrow">{attempt.space.name}</p>
          <h1>{attempt.definition.title}</h1>
          <p>{attempt.definition.objective}</p>
        </div>
        <span className="knowledge-status">{t(attempt.state)}</span>
      </header>
      <div className="attempt-support-action">
        <button
          disabled={helpRequested}
          onClick={() => {
            setError(null);
            void window.tro
              .requestKnowledgeAttemptHelp({ attemptId, clientId: randomUUID() })
              .then(() => setHelpRequested(true))
              .catch((cause: unknown) =>
                setError(
                  cause instanceof Error
                    ? cause.message
                    : t('Could not send the help request.'),
                ),
              );
          }}
          type="button"
        >
          {helpRequested ? t('Help request sent') : t('I need help')}
        </button>
        <span>
          {t('This shares only an explicit support request—not your screen or conversation.')}
        </span>
      </div>
      <article className="attempt-instructions">
        <h2>{t('Instructions')}</h2>
        <p>{attempt.definition.instructions}</p>
      </article>
      <dl className="attempt-policy">
        <div>
          <dt>{t('Work context')}</dt>
          <dd>{t(attempt.definition.launchTarget)}</dd>
        </div>
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
      </dl>
      {attempt.sourceCatalog.length > 0 && (
        <details className="attempt-sources">
          <summary>{t('Pinned sources')}</summary>
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
              ' TroCode may record bounded, provenance-labeled hypotheses for facilitator review. These cannot grade you or change completion state.',
            )}
          </span>
        </label>
      )}
      {attempt.definition.launchTarget === 'workspace' && (
        <div className="workspace-launch-options">
          <button onClick={() => void chooseExistingWorkspace()} type="button">
            {t('Choose an existing folder')}
          </button>
          {attempt.starterAvailable && (
            <button
              disabled={busy}
              onClick={() => void prepareStarterWorkspace()}
              type="button"
            >
              {t('Create from published starter')}
            </button>
          )}
          {workspace && (
            <span className="workspace-selection-chip">
              {workspace.displayName}
            </span>
          )}
        </div>
      )}
      {attempt.definition.completionPolicy.requiresSubmission && (
        <section className="submission-panel" aria-labelledby="submission-heading">
          <h2 id="submission-heading">{t('Explicit submission')}</h2>
          <p>
            {t(
              'TroCode never uploads your local work automatically. Review the exact files before submitting.',
            )}
          </p>
          {submitted ? (
            <span className="knowledge-status knowledge-status--ready">
              {t('Submission received')}
            </span>
          ) : submission ? (
            <div className="upload-preview">
              <ul>
                {submission.files.map((file) => (
                  <li key={file.relativePath}>{file.relativePath}</li>
                ))}
              </ul>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void uploadSubmission()}
                type="button"
              >
                {t('Submit reviewed files')}
              </button>
            </div>
          ) : (
            <button onClick={() => void chooseSubmission()} type="button">
              {t('Review files to submit')}
            </button>
          )}
        </section>
      )}
      <label className="launch-prompt">
        {t('What do you want help with?')}
        <textarea
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          value={prompt}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary-button"
        disabled={
          busy ||
          (attempt.definition.launchTarget === 'workspace' && !workspace)
        }
        onClick={() => void launch()}
        type="button"
      >
        {busy ? t('Starting…') : t('Start Activity')}
      </button>
    </section>
  );
}
