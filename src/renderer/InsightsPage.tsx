import { useMemo } from 'react';

import type {
  AppLanguage,
  TaskEvent,
  TaskHistory,
  TaskSnapshot,
} from '../shared/contracts';

import { translate } from './app-language';
import { createInsightsSummary } from './insights';

function formatBehavior(value: string, appLanguage: AppLanguage): string {
  const label = value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return translate(appLanguage, label);
}

function SummaryIcon({ name }: { name: 'checks' | 'events' | 'tasks' }) {
  if (name === 'tasks') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M8 6.5h10M8 12h10M8 17.5h6" />
        <path d="m3.5 6.5 1 1 2-2M3.5 12l1 1 2-2M3.5 17.5l1 1 2-2" />
      </svg>
    );
  }

  if (name === 'events') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M5 19V9M12 19V4M19 19v-7" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m5 12 4 4L19 6" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function EmptyBehaviors({ appLanguage }: { appLanguage: AppLanguage }) {
  const t = (message: string) => translate(appLanguage, message);
  return (
    <div className="insights-empty-state">
      <span aria-hidden="true">◇</span>
      <div>
        <strong>{t('No task behavior yet')}</strong>
        <p>
          {t('Compile or run a task and its behavior will appear here.')}
        </p>
      </div>
    </div>
  );
}

export function InsightsPage({
  appLanguage,
  events,
  persistence,
  tasks,
}: {
  appLanguage: AppLanguage;
  events: readonly TaskEvent[];
  persistence: TaskHistory['persistence'];
  tasks: readonly TaskSnapshot[];
}) {
  const t = (
    message: string,
    replacements?: Readonly<Record<string, string | number>>,
  ) => translate(appLanguage, message, replacements);
  const summary = useMemo(
    () => createInsightsSummary(tasks, events),
    [events, tasks],
  );
  const weekdayLabels = summary.activityDays.slice(0, 7);

  return (
    <div className="insights-page">
      <header className="insights-heading">
        <div>
          <p className="eyebrow">
            {persistence.mode === 'postgres'
              ? t('Saved task history')
              : t('Current app session')}
          </p>
          <h1>{t('Insights')}</h1>
          <p>
            {persistence.mode === 'postgres'
              ? t(
                  'A view of how TroCode is working across your saved tasks and lifecycle activity.',
                )
              : t(
                  'A private, session-only view of how TroCode is working across your tasks.',
                )}
          </p>
        </div>
        <span className="session-badge">
          <span aria-hidden="true" />
          {persistence.mode === 'postgres'
            ? t('Across sessions')
            : t('Live session')}
        </span>
      </header>

      <div className="insights-tabs">
        <span className="insights-tabs__active">{t('Overview')}</span>
        <span>{t('Updates as your agent works')}</span>
      </div>

      <section
        className="insights-summary-grid"
        aria-label={t('Session summary')}
      >
        <article className="insight-card insight-card--gauge">
          <div className="insight-card__header">
            <div className="insight-icon">
              <SummaryIcon name="checks" />
            </div>
            <span>{t('Success')}</span>
          </div>
          <strong className="insight-value">{summary.completionRate}%</strong>
          <span className="insight-label">{t('TASK COMPLETION RATE')}</span>
          <div
            className="completion-gauge"
            aria-label={t('{rate}% of finished tasks completed', {
              rate: summary.completionRate,
            })}
            role="img"
          >
            <svg viewBox="0 0 164 96">
              <path
                className="completion-gauge__track"
                d="M 18 82 A 64 64 0 0 1 146 82"
                pathLength="100"
              />
              <path
                className="completion-gauge__value"
                d="M 18 82 A 64 64 0 0 1 146 82"
                pathLength="100"
                style={{
                  opacity: summary.completionRate === 0 ? 0 : 1,
                  strokeDasharray: `${summary.completionRate} 100`,
                }}
              />
            </svg>
            <div>
              <strong>{summary.completedTasks}</strong>
              <span>{t('completed')}</span>
            </div>
          </div>
        </article>

        <article className="insight-card insight-card--tasks">
          <div className="insight-card__header">
            <div className="insight-icon">
              <SummaryIcon name="tasks" />
            </div>
            <span>{t('Tasks')}</span>
          </div>
          <strong className="insight-value">{summary.taskCount}</strong>
          <span className="insight-label">{t('TASKS OBSERVED')}</span>
          <div className="insight-stat-list">
            <div>
              <span>{t('Finished')}</span>
              <strong>{summary.finishedTasks}</strong>
            </div>
            <div>
              <span>{t('Steps observed')}</span>
              <strong>{summary.stepsObserved}</strong>
            </div>
          </div>
        </article>

        <article className="insight-card insight-card--events">
          <div className="insight-card__header">
            <div className="insight-icon">
              <SummaryIcon name="events" />
            </div>
            <span>{t('Lifecycle activity')}</span>
          </div>
          <strong className="insight-value">{summary.eventCount}</strong>
          <span className="insight-label">{t('EVENTS OBSERVED')}</span>
          <div className="event-summary">
            <div>
              <span className="event-summary__dot" aria-hidden="true" />
              <span>{t('Approval decisions')}</span>
              <strong>{summary.approvalDecisions}</strong>
            </div>
            <div>
              <span
                className="event-summary__dot event-summary__dot--error"
                aria-hidden="true"
              />
              <span>{t('Needs attention')}</span>
              <strong>{summary.errorEvents}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="insights-detail-grid">
        <article className="insight-card capability-card">
          <div className="detail-card-heading">
            <div>
              <p className="eyebrow">{t('How TroCode helped')}</p>
              <h2>{t('Task behavior')}</h2>
            </div>
            <span>
              {t('{count} active', { count: summary.behaviorUsage.length })}
            </span>
          </div>

          {summary.behaviorUsage.length === 0 ? (
            <EmptyBehaviors appLanguage={appLanguage} />
          ) : (
            <ol className="capability-list">
              {summary.behaviorUsage.map((item) => (
                <li key={item.behavior}>
                  <div className="capability-row">
                    <span>{formatBehavior(item.behavior, appLanguage)}</span>
                    <strong>
                      {item.count} {item.count === 1 ? t('task') : t('tasks')}
                    </strong>
                  </div>
                  <div className="capability-track" aria-hidden="true">
                    <span style={{ width: `${item.percentage}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </article>

        <article className="insight-card activity-rhythm-card">
          <div className="detail-card-heading">
            <div>
              <p className="eyebrow">{t('Last six weeks')}</p>
              <h2>
                {t(
                  summary.currentStreak === 1
                    ? '{count} day active'
                    : '{count} days active',
                  { count: summary.currentStreak },
                )}
              </h2>
            </div>
            <span>{t('Best {count}d', { count: summary.longestStreak })}</span>
          </div>

          <div className="activity-heatmap-wrap">
            <div className="activity-weekdays" aria-hidden="true">
              {weekdayLabels.map((day) => (
                <span key={day.date}>{day.weekday}</span>
              ))}
            </div>
            <div
              className="activity-heatmap"
              aria-label={t('Lifecycle events per day for the last six weeks')}
              role="img"
            >
              {summary.activityDays.map((day) => (
                <span
                  className={`activity-cell activity-cell--${day.level}`}
                  key={day.date}
                  title={`${day.label}: ${day.count} ${day.count === 1 ? t('event') : t('events')}`}
                />
              ))}
            </div>
          </div>
          <div className="activity-legend">
            <span>{t('Less')}</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <i className={`activity-cell activity-cell--${level}`} key={level} />
            ))}
            <span>{t('More')}</span>
          </div>
        </article>
      </section>
    </div>
  );
}
