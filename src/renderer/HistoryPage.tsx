import { useMemo } from 'react';

import type { TaskEvent, TaskSnapshot } from '../shared/contracts';

import { createHistoryEntries } from './history';

function formatLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

function formatMessageRole(role: TaskSnapshot['messages'][number]['role']): string {
  if (role === 'user') return 'You';
  if (role === 'system') return 'System';
  return 'TroCode';
}

function formatTaskTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

export function HistoryPage({
  events,
  hasLiveTask,
  onOpenAgent,
  tasks,
}: {
  events: readonly TaskEvent[];
  hasLiveTask: boolean;
  onOpenAgent: () => void;
  tasks: readonly TaskSnapshot[];
}) {
  const entries = useMemo(
    () => createHistoryEntries(tasks, events),
    [events, tasks],
  );

  return (
    <div className="history-page">
      <header className="history-heading">
        <div>
          <p className="eyebrow">Current app session</p>
          <h1>Task trail</h1>
          <p>
            A quiet record of finished work, kept only for this open session.
            Closing TroCode clears this trail.
          </p>
        </div>
        <span className="session-badge">
          <span aria-hidden="true" />
          Session only
        </span>
      </header>

      {entries.length === 0 ? (
        <section className="history-empty" aria-labelledby="history-empty-title">
          <div className="history-empty__orbit" aria-hidden="true">
            <span />
          </div>
          <p className="eyebrow">
            {hasLiveTask ? 'Task in motion' : 'The trail is clear'}
          </p>
          <h2 id="history-empty-title">
            {hasLiveTask
              ? 'Your active task has not settled yet.'
              : 'Finished tasks will settle here.'}
          </h2>
          <p>
            {hasLiveTask
              ? 'Return to Agent to watch, steer, or stop it. Its final record will appear here.'
              : 'Completed, stopped, and unsuccessful tasks appear with their scope, conversation, and outcome.'}
          </p>
          <button
            className="primary-button"
            onClick={onOpenAgent}
            type="button"
          >
            {hasLiveTask ? 'Return to live task' : 'Start a task'}{' '}
            <span aria-hidden="true">→</span>
          </button>
        </section>
      ) : (
        <ol className="history-trail" aria-label="Finished tasks this session">
          {entries.map((entry, index) => {
            const progress = entry.progress
              ? `${entry.progress.currentStep} of ${entry.progress.maxSteps} steps`
              : 'No execution steps';
            return (
              <li
                className={`history-entry history-entry--${entry.phase}`}
                key={entry.snapshot.taskId}
              >
                <span className="history-entry__node" aria-hidden="true">
                  {entry.phase === 'completed'
                    ? '✓'
                    : entry.phase === 'cancelled'
                      ? '–'
                      : '!'}
                </span>
                <article>
                  <div className="history-entry__header">
                    <div>
                      <div className="history-entry__status-line">
                        <span className={`history-status history-status--${entry.phase}`}>
                          {entry.phase}
                        </span>
                        <time dateTime={entry.updatedAt}>
                          {formatTaskTime(entry.updatedAt)}
                        </time>
                        {index === 0 && (
                          <span className="history-latest">Latest</span>
                        )}
                      </div>
                      <h2>{entry.objective}</h2>
                    </div>
                    <span className="history-entry__index">
                      {String(entries.length - index).padStart(2, '0')}
                    </span>
                  </div>

                  <div className="history-entry__facts">
                    <span>
                      <small>Mode</small>
                      {entry.interactionMode ?? 'Not compiled'}
                    </span>
                    <span>
                      <small>Progress</small>
                      {progress}
                    </span>
                    <span>
                      <small>Activity</small>
                      {entry.events.length}{' '}
                      {entry.events.length === 1 ? 'event' : 'events'}
                    </span>
                  </div>

                  {entry.capabilities.length > 0 && (
                    <div
                      aria-label="Capabilities in scope"
                      className="history-capabilities"
                    >
                      {entry.capabilities.map((capability) => (
                        <span key={capability}>{formatLabel(capability)}</span>
                      ))}
                    </div>
                  )}

                  <details className="history-details">
                    <summary>Open task record</summary>
                    <div className="history-details__grid">
                      <section
                        aria-labelledby={`conversation-${entry.snapshot.taskId}`}
                      >
                        <h3 id={`conversation-${entry.snapshot.taskId}`}>Conversation</h3>
                        {entry.snapshot.messages.length === 0 ? (
                          <p className="history-muted">No conversation was recorded.</p>
                        ) : (
                          <ol className="history-message-list">
                            {entry.snapshot.messages.map((message) => (
                              <li key={message.messageId}>
                                <span>{formatMessageRole(message.role)}</span>
                                <p>{message.text}</p>
                              </li>
                            ))}
                          </ol>
                        )}
                      </section>
                      <section
                        aria-labelledby={`activity-${entry.snapshot.taskId}`}
                      >
                        <h3 id={`activity-${entry.snapshot.taskId}`}>Outcome & activity</h3>
                        {entry.events.length === 0 ? (
                          <p className="history-muted">
                            No lifecycle activity was captured for this task.
                          </p>
                        ) : (
                          <ol className="history-event-list">
                            {entry.events.map((event) => (
                              <li key={event.eventId}>
                                <span
                                  className={`activity-marker activity-marker--${event.status}`}
                                />
                                <div>
                                  <strong>{formatLabel(event.phase)}</strong>
                                  <p>{event.summary}</p>
                                </div>
                              </li>
                            ))}
                          </ol>
                        )}
                      </section>
                    </div>
                  </details>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
