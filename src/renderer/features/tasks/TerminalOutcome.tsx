import type { AppLanguage, TaskSnapshot } from '../../../shared/contracts';
import { translate } from '../../app-language';

import { formatLabel } from './task-presentation';

export function TerminalOutcome({
  appLanguage,
  onViewHistory,
  snapshot,
}: {
  appLanguage: AppLanguage;
  onViewHistory: () => void;
  snapshot: TaskSnapshot;
}) {
  const t = (message: string) => translate(appLanguage, message);
  const heading =
    snapshot.phase === 'completed'
      ? t('Outcome reached')
      : snapshot.phase === 'cancelled'
        ? t('Task stopped safely')
        : t('Task needs attention');

  return (
    <section
      aria-labelledby="terminal-heading"
      className={`terminal-outcome terminal-outcome--${snapshot.phase}`}
    >
      <span className="terminal-outcome__mark" aria-hidden="true">
        {snapshot.phase === 'completed'
          ? '✓'
          : snapshot.phase === 'cancelled'
            ? '–'
            : '!'}
      </span>
      <div>
        <p className="eyebrow">{formatLabel(snapshot.phase, appLanguage)}</p>
        <h2 id="terminal-heading">{heading}</h2>
        <p>
          {snapshot.lastEvent?.summary ??
            t(
              'The task finished. Its conversation and activity are available in History.',
            )}
        </p>
      </div>
      <button
        className="terminal-outcome__link"
        onClick={onViewHistory}
        type="button"
      >
        {t('View task trail')} <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}
