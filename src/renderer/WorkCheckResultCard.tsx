import type { AppLanguage, WorkCheckProjection } from '../shared/contracts';

import { translate } from './app-language';

export function WorkCheckResultCard({
  projection,
  appLanguage = 'en',
  sync,
}: {
  projection: WorkCheckProjection | null;
  appLanguage?: AppLanguage;
  sync?: 'pending' | 'synced' | 'unknown' | null;
}) {
  const t = (text: string) => translate(appLanguage, text);
  const report = projection?.report;
  const outcomes = {
    looks_met: 'Looks met',
    needs_work: 'Needs work',
    not_verified: 'Could not verify',
  };
  return (
    <section className="work-check-result" aria-label={t('Assignment check')}>
      <p role="status">
        {t(
          projection?.phase === 'checking'
            ? 'Checking your work…'
            : report
              ? 'Check finished'
              : 'Assignment check',
        )}
      </p>
      {projection?.message && <p>{projection.message}</p>}
      {report && (
        <>
          <p className="work-check-result__scope">
            <time dateTime={report.checkedAt}>
              {new Date(report.checkedAt).toLocaleString(
                appLanguage === 'vi' ? 'vi-VN' : 'en-US',
              )}
            </time>{' '}
            ·{' '}
            {t(
              report.coverage.kind === 'screen'
                ? 'Visible content only'
                : report.coverage.kind === 'saved_files'
                  ? 'Saved files only'
                  : 'No work context',
            )}
          </p>
          <p>
            <strong>
              {t(
                {
                  looks_ready: 'Looks ready for review',
                  needs_work: 'Needs work',
                  incomplete_context: 'Could not verify everything',
                }[report.overall],
              )}
            </strong>
          </p>
          <p>{t(report.summary)}</p>
          <ul>
            {report.criteria.map((criterion) => (
              <li key={criterion.title ?? criterion.criterionId}>
                <strong>{t(outcomes[criterion.outcome])}</strong> ·{' '}
                {criterion.title ?? criterion.criterionId}
                <p>{criterion.explanation}</p>
                {criterion.evidenceIds.length > 0 && (
                  <small>
                    {criterion.evidenceIds
                      .map(
                        (id) =>
                          report.evidence.find((e) => e.id === id)?.label ?? id,
                      )
                      .join(' · ')}
                  </small>
                )}
              </li>
            ))}
          </ul>
          <details>
            <summary>{t('What Tro checked')}</summary>
            <ul>
              {report.evidence.map((e) => (
                <li key={e.id}>{e.label}</li>
              ))}
            </ul>
            {report.coverage.notes.map((note, index) => (
              <p key={index}>{t(note)}</p>
            ))}
          </details>
          <p>
            {t(
              'This is feedback on an earlier snapshot, not a grade. Check again after making changes.',
            )}
          </p>
        </>
      )}
      {sync === 'unknown' && (
        <p role="alert">
          {t(
            'Could not confirm progress sync. Refresh your classroom session to see its saved state.',
          )}
        </p>
      )}
    </section>
  );
}
