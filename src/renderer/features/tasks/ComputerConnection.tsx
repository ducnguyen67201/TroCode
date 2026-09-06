import type { AppLanguage, CuaStatus } from '../../../shared/contracts';
import { translate } from '../../app-language';

export function ComputerConnection({
  appLanguage,
  isConnecting,
  onConnect,
  ready,
  status,
}: {
  appLanguage: AppLanguage;
  isConnecting: boolean;
  onConnect: () => void;
  ready: boolean;
  status: CuaStatus;
}) {
  const t = (message: string) => translate(appLanguage, message);
  return (
    <section className="computer-card" aria-labelledby="computer-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">{t('Optional tool')}</p>
          <h2 id="computer-heading">{t('Computer use')}</h2>
        </div>
        <span
          className={`status-dot status-dot--${ready ? 'ready' : 'disconnected'}`}
        >
          {ready ? t('Connected') : t('Not connected')}
        </span>
      </div>
      <p>
        {ready
          ? t(
              'Ready when the agent needs to inspect or operate an application.',
            )
          : t(
              'Text tasks work now. Connect only when you want the agent to use visible applications.',
            )}
      </p>
      {!ready && (
        <button
          className="secondary-button"
          disabled={isConnecting}
          onClick={onConnect}
          type="button"
        >
          {isConnecting ? t('Connecting…') : t('Connect computer')}
        </button>
      )}
      {status.state === 'error' && <p className="metadata">{status.summary}</p>}
    </section>
  );
}
