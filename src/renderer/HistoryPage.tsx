import { useMemo } from 'react';

import type {
  AppLanguage,
  TaskEvent,
  TaskHistory,
  TaskSnapshot,
} from '../shared/contracts';

import { appLocale, translate } from './app-language';
import { createHistoryEntries } from './history';

function formatLabel(value: string, appLanguage: AppLanguage): string {
  return translate(appLanguage, value.replaceAll('_', ' '));
}

function formatMessageRole(
  role: TaskSnapshot['messages'][number]['role'],
  appLanguage: AppLanguage,
): string {
  if (role === 'user') return translate(appLanguage, 'You');
  if (role === 'system') return translate(appLanguage, 'System');
  return 'TroCode';
}

function formatTaskTime(value: string, appLanguage: AppLanguage): string {
  return new Intl.DateTimeFormat(appLocale(appLanguage), {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

export function HistoryPage({
  appLanguage,
  events,
  hasLiveTask,
  onOpenAgent,
  persistence,
  tasks,
}: {
  appLanguage: AppLanguage;
  events: readonly TaskEvent[];
  hasLiveTask: boolean;
  onOpenAgent: () => void;
  persistence: TaskHistory['persistence'];
  tasks: readonly TaskSnapshot[];
}) {
  const t = (
    message: string,
    replacements?: Readonly<Record<string, string | number>>,
  ) => translate(appLanguage, message, replacements);
  const entries = useMemo(
    () => createHistoryEntries(tasks, events),
    [events, tasks],
  );

  return (
    <div className="history-page">
      <header className="history-heading">
        <div>
          <p className="eyebrow">
            {persistence.mode === 'postgres'
              ? t('Saved task history')
              : t('Current app session')}
          </p>
          <h1>{t('Task trail')}</h1>
          <p>
            {persistence.mode === 'postgres'
              ? t(
                  'A durable record of finished work, restored when you reopen TroCode.',
                )
              : persistence.summary}
          </p>
        </div>
        <span className="session-badge">
          <span aria-hidden="true" />
          {persistence.mode === 'postgres' ? t('Saved') : t('Session only')}
        </span>
      </header>

      {entries.length === 0 ? (
        <section className="history-empty" aria-labelledby="history-empty-title">
          <div className="history-empty__orbit" aria-hidden="true">
            <span />
          </div>
          <p className="eyebrow">
            {hasLiveTask ? t('Task in motion') : t('The trail is clear')}
          </p>
          <h2 id="history-empty-title">
            {hasLiveTask
              ? t('Your active task has not settled yet.')
              : t('Finished tasks will settle here.')}
          </h2>
          <p>
            {hasLiveTask
              ? t(
                  'Return to Agent to watch, steer, or stop it. Its final record will appear here.',
                )
              : t(
                  'Completed, stopped, and unsuccessful tasks appear with their scope, conversation, and outcome.',
                )}
          </p>
          <button
            className="primary-button"
            onClick={onOpenAgent}
            type="button"
          >
            {hasLiveTask ? t('Return to live task') : t('Start a task')}{' '}
            <span aria-hidden="true">→</span>
          </button>
        </section>
      ) : (
        <ol className="history-trail" aria-label={t('Finished task history')}>
          {entries.map((entry, index) => {
            const progress = entry.progress
              ? 'kind' in entry.progress
                ? t(
                    entry.progress.completed === 1
                      ? '{count} tool call'
                      : '{count} tool calls',
                    { count: entry.progress.completed },
                  )
                : t('{current} of {maximum} steps', {
                    current: entry.progress.currentStep,
                    maximum: entry.progress.maxSteps,
                  })
              : t('No tool calls');
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
                          {formatLabel(entry.phase, appLanguage)}
                        </span>
                        <time dateTime={entry.updatedAt}>
                          {formatTaskTime(entry.updatedAt, appLanguage)}
                        </time>
                        {index === 0 && (
                          <span className="history-latest">{t('Latest')}</span>
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
                      <small>
                        {entry.behavior ? t('Legacy mode') : t('Tools used')}
                      </small>
                      {entry.behavior
                        ? formatLabel(entry.behavior, appLanguage)
                        :
                        (entry.toolsUsed.length > 0
                          ? entry.toolsUsed.join(', ')
                          : t('Assistant only'))}
                    </span>
                    <span>
                      <small>{t('Progress')}</small>
                      {progress}
                    </span>
                    <span>
                      <small>{t('Activity')}</small>
                      {entry.events.length}{' '}
                      {entry.events.length === 1 ? t('event') : t('events')}
                    </span>
                  </div>

                  <details className="history-details">
                    <summary>{t('Open task record')}</summary>
                    <div className="history-details__grid">
                      <section
                        aria-labelledby={`conversation-${entry.snapshot.taskId}`}
                      >
                        <h3 id={`conversation-${entry.snapshot.taskId}`}>
                          {t('Conversation')}
                        </h3>
                        {entry.snapshot.messages.length === 0 ? (
                          <p className="history-muted">
                            {t('No conversation was recorded.')}
                          </p>
                        ) : (
                          <ol className="history-message-list">
                            {entry.snapshot.messages.map((message) => (
                              <li key={message.messageId}>
                                <span>
                                  {formatMessageRole(message.role, appLanguage)}
                                </span>
                                <p>{message.text}</p>
                              </li>
                            ))}
                          </ol>
                        )}
                      </section>
                      <section
                        aria-labelledby={`activity-${entry.snapshot.taskId}`}
                      >
                        <h3 id={`activity-${entry.snapshot.taskId}`}>
                          {t('Outcome & activity')}
                        </h3>
                        {entry.events.length === 0 ? (
                          <p className="history-muted">
                            {t(
                              'No lifecycle activity was captured for this task.',
                            )}
                          </p>
                        ) : (
                          <ol className="history-event-list">
                            {entry.events.map((event) => (
                              <li key={event.eventId}>
                                <span
                                  className={`activity-marker activity-marker--${event.status}`}
                                />
                                <div>
                                  <strong>
                                    {formatLabel(event.phase, appLanguage)}
                                  </strong>
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
