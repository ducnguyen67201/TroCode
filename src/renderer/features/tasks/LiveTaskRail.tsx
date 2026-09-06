import type {
  AgentActivityUpdate,
  AppLanguage,
  GoalSpec,
  TaskEvent,
  TaskSnapshot,
} from '../../../shared/contracts';
import { translate } from '../../app-language';

import { formatLabel } from './task-presentation';

export function LiveTaskRail({
  activities,
  activity,
  appLanguage,
  autoStartFailed,
  canStart,
  goal,
  isStarting,
  lastEvent,
  onRetry,
  phase,
  progress,
  request,
  streamingDraft,
}: {
  activities: readonly AgentActivityUpdate[];
  activity: AgentActivityUpdate | null;
  appLanguage: AppLanguage;
  autoStartFailed: boolean;
  canStart: boolean;
  goal: GoalSpec | null;
  isStarting: boolean;
  lastEvent: TaskEvent | null;
  onRetry: () => void;
  phase: TaskSnapshot['phase'];
  progress: TaskSnapshot['progress'];
  request: string;
  streamingDraft: string;
}) {
  const t = (message: string) => translate(appLanguage, message);
  const completedToolCalls = progress?.completed ?? 0;
  const progressLabel = progress
    ? translate(
        appLanguage,
        progress.completed === 1 ? '{count} tool call' : '{count} tool calls',
        { count: progress.completed },
      )
    : t('Not started');
  const taskTitle = goal?.originalRequest ?? request;
  const showProgress = completedToolCalls > 0;
  const activityText =
    activity?.kind === 'text_delta'
      ? streamingDraft.slice(-500)
      : (activity?.summary ?? lastEvent?.summary);
  const announceActivity =
    activity?.kind === 'tool_started' || activity?.kind === 'tool_completed';
  const visibleActivities = activities
    .filter((item) => item.kind !== 'text_delta')
    .slice(-50);

  return (
    <section
      aria-labelledby="live-task-heading"
      className={`live-task-rail live-task-rail--${phase}`}
    >
      <div className="live-task-rail__signal" aria-hidden="true">
        <span />
      </div>
      <div className="live-task-rail__body">
        <div className="live-task-rail__header">
          <div>
            <p aria-live="polite" className="eyebrow">
              {t('Live task')} · {formatLabel(phase, appLanguage)}
            </p>
            <h2 id="live-task-heading">{taskTitle}</h2>
          </div>
          {showProgress && (
            <div
              aria-label={`${t('Progress')} ${progressLabel}`}
              className="live-task-rail__progress"
            >
              <span>{progressLabel}</span>
            </div>
          )}
        </div>

        <div className="live-task-rail__summary">
          <span>
            {goal
              ? goal.executionProfile === 'workspace'
                ? t('Workspace agent')
                : t('Everyday agent')
              : t('Understanding request')}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {goal ? t('Tools selected at runtime') : t('Preparing task')}
          </span>
        </div>

        {activityText && !['ready', 'blocked'].includes(phase) && (
          <p
            aria-live={announceActivity ? 'polite' : 'off'}
            className="live-task-rail__activity"
          >
            {activityText}
          </p>
        )}

        {visibleActivities.length > 0 && (
          <details className="agent-activity-list">
            <summary>{t('Activity')}</summary>
            <ol>
              {visibleActivities.map((item) => (
                <li key={`${item.taskId}-${item.sequence}`}>
                  <span>{item.summary}</span>
                  {item.kind === 'plan_updated' && item.plan && (
                    <ul>
                      {item.plan.map((step, index) => (
                        <li key={`${item.sequence}-${index}`}>
                          <span>{step.status}</span> {step.step}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </details>
        )}

        {goal && (
          <details className="live-task-details">
            <summary>{t('Task details')}</summary>
            <div className="live-task-details__content">
              {goal.activity && (
                <div className="activity-context-chip">
                  <span>{goal.activity.space.name}</span>
                  <strong>{goal.activity.activity.title}</strong>
                </div>
              )}
              <div>
                <span className="field-label">{t('Execution')}</span>
                <p>
                  {t(
                    'Tro executes the requested goal within the selected workspace and available capabilities. It pauses only when it needs clarification, an operating-system permission, or account authorization.',
                  )}
                </p>
              </div>
              <div>
                <span className="field-label">{t('Success looks like')}</span>
                <p>
                  {t(
                    'A useful assistant answer or an evidence-backed tool result.',
                  )}
                </p>
              </div>
            </div>
          </details>
        )}

        {phase === 'blocked' && lastEvent && (
          <div className="live-task-blocked" role="alert">
            <strong>{t('Why Tro stopped')}</strong>
            <p>{lastEvent.summary}</p>
            {lastEvent.nextActions[0] && (
              <span>{lastEvent.nextActions[0]}</span>
            )}
          </div>
        )}

        {phase === 'ready' && (
          <div className="live-task-rail__start">
            <p aria-live="polite">
              {!canStart
                ? t('Waiting for the OpenAI agent provider before starting.')
                : autoStartFailed
                  ? t('Tro could not start automatically. You can try again.')
                  : isStarting
                    ? t(
                        'Starting automatically… Press Escape while Tro is focused to stop.',
                      )
                    : t(
                        'Ready. Starting automatically… Press Escape while Tro is focused to stop.',
                      )}
            </p>
            {autoStartFailed && (
              <button
                className="primary-button"
                disabled={!canStart || isStarting}
                onClick={onRetry}
                type="button"
              >
                {isStarting ? t('Starting…') : t('Try again')}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
