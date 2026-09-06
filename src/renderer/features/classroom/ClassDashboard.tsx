import type * as React from 'react';

import type { KnowledgeDashboard } from '../../../shared/contracts';

import { STATUS_ORDER } from './participant-status';

interface ClassDashboardProps {
  t: (
    message: string,
    values?: Readonly<Record<string, string | number>>,
  ) => string;
  participants: NonNullable<KnowledgeDashboard['participants']>;
  countFor: (status: string) => number;
  dashboard: KnowledgeDashboard | null;
  formatter: Intl.DateTimeFormat;
  busyAction: string | null;
  resolveHelp: (attemptId: string) => Promise<void>;
  pendingReview: { action: 'complete' | 'return'; attemptId: string } | null;
  setPendingReview: React.Dispatch<
    React.SetStateAction<{
      action: 'complete' | 'return';
      attemptId: string;
    } | null>
  >;
  review: (attemptId: string, action: 'complete' | 'return') => Promise<void>;
}

export function ClassDashboard({
  t,
  participants,
  countFor,
  dashboard,
  formatter,
  busyAction,
  resolveHelp,
  pendingReview,
  setPendingReview,
  review,
}: ClassDashboardProps) {
  return (
    <section
      className="class-dashboard"
      aria-labelledby="class-dashboard-heading"
    >
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">{t('Explicit class signals')}</p>
          <h3 id="class-dashboard-heading">{t('Class pulse')}</h3>
          <p className="section-deck">
            {t(
              'Only joined, Help, Check, readiness, submission, and review events—never inferred attention or understanding.',
            )}
          </p>
        </div>
        <span className="dashboard-total">
          <strong>{participants.length}</strong>
          <small>{t('students')}</small>
        </span>
      </div>
      <div className="dashboard-lanes">
        {STATUS_ORDER.map((status) => (
          <div
            className={`dashboard-lane dashboard-lane--${status}`}
            key={status}
          >
            <span className="dashboard-lane__dot" aria-hidden="true" />
            <strong>{countFor(status)}</strong>
            <span>{t(status)}</span>
          </div>
        ))}
      </div>

      {(dashboard?.helpQueue?.length ?? 0) > 0 && (
        <section className="review-queue review-queue--help">
          <div className="review-queue__heading">
            <div>
              <span className="queue-icon" aria-hidden="true">
                ?
              </span>
              <div>
                <h4>{t('Needs help now')}</h4>
                <p>{t('Raised explicitly by the student')}</p>
              </div>
            </div>
            <strong>{dashboard!.helpQueue!.length}</strong>
          </div>
          <ul>
            {dashboard!.helpQueue!.map((row) => (
              <li key={row.attemptId}>
                <span className="student-avatar">
                  {String(row.id).slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{row.id}</strong>
                  <small>
                    {row.helpRequestedAt
                      ? t('Asked at {time}', {
                          time: formatter.format(new Date(row.helpRequestedAt)),
                        })
                      : t('Help requested')}
                  </small>
                </div>
                <button
                  disabled={busyAction !== null}
                  onClick={() => void resolveHelp(row.attemptId)}
                  type="button"
                >
                  {busyAction === `resolve:${row.attemptId}`
                    ? t('Resolving…')
                    : t('Mark resolved')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="participant-table-shell">
        <table className="knowledge-table participant-table">
          <thead>
            <tr>
              <th>{t('Student')}</th>
              <th>{t('Explicit status')}</th>
              <th>{t('Sessions')}</th>
              <th>{t('Evidence')}</th>
              <th>
                <span className="visually-hidden">{t('Review actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {participants.map((row) => (
              <tr key={row.attemptId}>
                <td>
                  <span className="student-avatar">
                    {String(row.id).slice(0, 1).toUpperCase()}
                  </span>
                  <strong>{row.id}</strong>
                </td>
                <td>
                  <span
                    className={`participant-status participant-status--${row.status}`}
                  >
                    <i aria-hidden="true" />
                    {t(row.status)}
                  </span>
                  <small>{formatter.format(new Date(row.updatedAt))}</small>
                </td>
                <td>{row.sessionCount}</td>
                <td>{row.evidenceCount}</td>
                <td>
                  <div className="participant-review-actions">
                    {(row.status === 'ready' || row.status === 'submitted') &&
                      (pendingReview?.attemptId === row.attemptId ? (
                        <div
                          className="participant-review-confirmation"
                          aria-live="polite"
                        >
                          <span>
                            {t(
                              pendingReview.action === 'complete'
                                ? 'Complete this exact Attempt?'
                                : 'Return this exact Attempt for revision?',
                            )}
                            <small>
                              {row.id} · {row.attemptId.slice(0, 8)}
                            </small>
                          </span>
                          <button
                            disabled={busyAction !== null}
                            onClick={() => setPendingReview(null)}
                            type="button"
                          >
                            {t('Cancel')}
                          </button>
                          <button
                            className="primary-button"
                            disabled={busyAction !== null}
                            onClick={() =>
                              void review(
                                pendingReview.attemptId,
                                pendingReview.action,
                              )
                            }
                            type="button"
                          >
                            {busyAction !== null
                              ? t('Updating…')
                              : t(
                                  pendingReview.action === 'complete'
                                    ? 'Confirm Complete'
                                    : 'Confirm Return',
                                )}
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            disabled={busyAction !== null}
                            onClick={() =>
                              setPendingReview({
                                action: 'return',
                                attemptId: row.attemptId,
                              })
                            }
                            type="button"
                          >
                            {t('Return')}
                          </button>
                          <button
                            className="primary-button"
                            disabled={busyAction !== null}
                            onClick={() =>
                              setPendingReview({
                                action: 'complete',
                                attemptId: row.attemptId,
                              })
                            }
                            type="button"
                          >
                            {t('Complete')}
                          </button>
                        </>
                      ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {participants.length === 0 && (
          <div className="knowledge-empty knowledge-empty--inline">
            <span className="empty-illustration" aria-hidden="true">
              ◎
            </span>
            <div>
              <strong>{t('Waiting for students')}</strong>
              <p>
                {t(
                  'Share the room code above. Joined students appear here without refreshing.',
                )}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
