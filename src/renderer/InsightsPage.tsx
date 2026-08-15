import { useMemo } from 'react';

import type { TaskEvent, TaskSnapshot } from '../shared/contracts';

import { createInsightsSummary } from './insights';

function formatCapability(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
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

function EmptyCapabilities() {
  return (
    <div className="insights-empty-state">
      <span aria-hidden="true">◇</span>
      <div>
        <strong>No capability usage yet</strong>
        <p>Compile or run a task and its capabilities will appear here.</p>
      </div>
    </div>
  );
}

export function InsightsPage({
  events,
  tasks,
}: {
  events: readonly TaskEvent[];
  tasks: readonly TaskSnapshot[];
}) {
  const summary = useMemo(
    () => createInsightsSummary(tasks, events),
    [events, tasks],
  );
  const weekdayLabels = summary.activityDays.slice(0, 7);

  return (
    <div className="insights-page">
      <header className="insights-heading">
        <div>
          <p className="eyebrow">Current app session</p>
          <h1>Insights</h1>
          <p>
            A private, on-device view of how TroCode is working across your
            tasks. Only counts and lifecycle activity are summarized here.
          </p>
        </div>
        <span className="session-badge">
          <span aria-hidden="true" />
          Live session
        </span>
      </header>

      <div className="insights-tabs">
        <span className="insights-tabs__active">Overview</span>
        <span>Updates as your agent works</span>
      </div>

      <section className="insights-summary-grid" aria-label="Session summary">
        <article className="insight-card insight-card--gauge">
          <div className="insight-card__header">
            <div className="insight-icon">
              <SummaryIcon name="checks" />
            </div>
            <span>Success</span>
          </div>
          <strong className="insight-value">{summary.completionRate}%</strong>
          <span className="insight-label">TASK COMPLETION RATE</span>
          <div
            className="completion-gauge"
            aria-label={`${summary.completionRate}% of finished tasks completed`}
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
              <span>completed</span>
            </div>
          </div>
        </article>

        <article className="insight-card insight-card--tasks">
          <div className="insight-card__header">
            <div className="insight-icon">
              <SummaryIcon name="tasks" />
            </div>
            <span>Tasks</span>
          </div>
          <strong className="insight-value">{summary.taskCount}</strong>
          <span className="insight-label">TASKS OBSERVED</span>
          <div className="insight-stat-list">
            <div>
              <span>Finished</span>
              <strong>{summary.finishedTasks}</strong>
            </div>
            <div>
              <span>Steps observed</span>
              <strong>{summary.stepsObserved}</strong>
            </div>
          </div>
        </article>

        <article className="insight-card insight-card--events">
          <div className="insight-card__header">
            <div className="insight-icon">
              <SummaryIcon name="events" />
            </div>
            <span>Lifecycle activity</span>
          </div>
          <strong className="insight-value">{summary.eventCount}</strong>
          <span className="insight-label">EVENTS OBSERVED</span>
          <div className="event-summary">
            <div>
              <span className="event-summary__dot" aria-hidden="true" />
              <span>Approval decisions</span>
              <strong>{summary.approvalDecisions}</strong>
            </div>
            <div>
              <span
                className="event-summary__dot event-summary__dot--error"
                aria-hidden="true"
              />
              <span>Needs attention</span>
              <strong>{summary.errorEvents}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="insights-detail-grid">
        <article className="insight-card capability-card">
          <div className="detail-card-heading">
            <div>
              <p className="eyebrow">What TroCode used</p>
              <h2>Capability mix</h2>
            </div>
            <span>{summary.capabilityUsage.length} active</span>
          </div>

          {summary.capabilityUsage.length === 0 ? (
            <EmptyCapabilities />
          ) : (
            <ol className="capability-list">
              {summary.capabilityUsage.map((item) => (
                <li key={item.capability}>
                  <div className="capability-row">
                    <span>{formatCapability(item.capability)}</span>
                    <strong>
                      {item.count} {item.count === 1 ? 'task' : 'tasks'}
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
              <p className="eyebrow">Last six weeks</p>
              <h2>
                {summary.currentStreak} day
                {summary.currentStreak === 1 ? '' : 's'} active
              </h2>
            </div>
            <span>Best {summary.longestStreak}d</span>
          </div>

          <div className="activity-heatmap-wrap">
            <div className="activity-weekdays" aria-hidden="true">
              {weekdayLabels.map((day) => (
                <span key={day.date}>{day.weekday}</span>
              ))}
            </div>
            <div
              className="activity-heatmap"
              aria-label="Lifecycle events per day for the last six weeks"
              role="img"
            >
              {summary.activityDays.map((day) => (
                <span
                  className={`activity-cell activity-cell--${day.level}`}
                  key={day.date}
                  title={`${day.label}: ${day.count} ${day.count === 1 ? 'event' : 'events'}`}
                />
              ))}
            </div>
          </div>
          <div className="activity-legend">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <i className={`activity-cell activity-cell--${level}`} key={level} />
            ))}
            <span>More</span>
          </div>
        </article>
      </section>
    </div>
  );
}
