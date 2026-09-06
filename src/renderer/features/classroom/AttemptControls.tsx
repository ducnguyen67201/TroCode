import type * as React from 'react';

import type {
  HostedAttemptContext,
  SubmitTaskRequest,
  WorkspaceSelection,
} from '../../../shared/contracts';

interface AttemptControlsProps {
  t: (text: string) => string;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
  prompt: string;
  workspaceRequired: boolean;
  chooseExistingWorkspace: () => Promise<void>;
  attempt: HostedAttemptContext;
  busyAction: string | null;
  prepareStarterWorkspace: () => Promise<void>;
  workspace: WorkspaceSelection | null;
  launchDisabled: boolean;
  isLockedForWork: boolean;
  launch: (
    intent: SubmitTaskRequest['activityIntent'],
    text?: string,
  ) => Promise<void>;
  helpRequested: boolean;
  isReady: boolean;
  isSubmitted: boolean;
  canReady: boolean;
  markReady: () => Promise<void>;
}

export function AttemptControls({
  t,
  setPrompt,
  prompt,
  workspaceRequired,
  chooseExistingWorkspace,
  attempt,
  busyAction,
  prepareStarterWorkspace,
  workspace,
  launchDisabled,
  isLockedForWork,
  launch,
  helpRequested,
  isReady,
  isSubmitted,
  canReady,
  markReady,
}: AttemptControlsProps) {
  return (
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
                {busyAction === 'work' ? t('Starting…') : t('Start working')}
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
                {busyAction === 'check' ? t('Checking…') : t('Check my work')}
              </strong>
              <small>{t('Advisory feedback, never an automatic grade')}</small>
            </div>
          </button>
        </div>
      </section>

      <section className="attempt-finish-card">
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
                ? t('Submit the required files above when your work is ready.')
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
                  : t('I’m ready for review')}
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
  );
}
