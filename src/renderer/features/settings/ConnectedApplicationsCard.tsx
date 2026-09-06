import { useCallback, useEffect, useState } from 'react';

import type { AppLanguage, ConnectorList } from '../../../shared/contracts';
import { translate } from '../../app-language';

export function ConnectedApplicationsCard({
  appLanguage,
}: {
  appLanguage: AppLanguage;
}) {
  const t = useCallback(
    (message: string) => translate(appLanguage, message),
    [appLanguage],
  );
  const [connectors, setConnectors] = useState<ConnectorList | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConnectors(await window.tro.listConnectors());
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Connected applications are unavailable.'),
      );
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    void window.tro.listConnectors().then(
      (next) => {
        if (!active) return;
        setConnectors(next);
        setError(null);
      },
      (cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : t('Connected applications are unavailable.'),
        );
      },
    );
    return () => {
      active = false;
    };
  }, [t]);
  useEffect(() => {
    if (!attemptId) return;
    let active = true;
    const poll = async () => {
      try {
        const attempt = await window.tro.getConnectorAttempt({ attemptId });
        if (!active) return;
        if (
          ['connected', 'denied', 'failed', 'expired'].includes(attempt.status)
        ) {
          setAttemptId(null);
          setBusy(false);
          if (attempt.status !== 'connected')
            setError(t('Gmail was not connected. Please try again.'));
          await refresh();
          return;
        }
        window.setTimeout(() => {
          void poll();
        }, 2_000);
      } catch (cause) {
        if (!active) return;
        setBusy(false);
        setAttemptId(null);
        setError(
          cause instanceof Error
            ? cause.message
            : t('Could not check the Gmail connection.'),
        );
      }
    };
    const timer = window.setTimeout(() => {
      void poll();
    }, 1_000);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [attemptId, refresh, t]);

  const gmail = connectors?.catalog.find((item) => item.catalogKey === 'gmail');
  const connection = connectors?.connections.find(
    (item) => item.catalogKey === 'gmail' && item.status !== 'disconnected',
  );
  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const attempt = await window.tro.connectConnector({
        catalogKey: 'gmail',
      });
      setAttemptId(attempt.attemptId);
    } catch (cause) {
      setBusy(false);
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not start the Gmail connection.'),
      );
    }
  };
  const disconnect = async () => {
    if (!connection) return;
    setBusy(true);
    setError(null);
    try {
      setConnectors(
        await window.tro.disconnectConnector({ connectionId: connection.id }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not disconnect Gmail.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="settings-card"
      aria-labelledby="connected-applications-heading"
    >
      <div className="settings-card__heading">
        <div>
          <p className="eyebrow">{t('Agent tools')}</p>
          <h2 id="connected-applications-heading">
            {t('Connected applications')}
          </h2>
        </div>
        <span className="settings-badge settings-badge--neutral">
          {t('Developer Preview')}
        </span>
      </div>
      <p className="settings-help">
        {gmail?.description ??
          t(
            'Connect Gmail so Tro can search and read mail, create drafts, and organize labels. Sending is not available.',
          )}
      </p>
      <p className="settings-help">
        {connection?.status === 'connected'
          ? t('Gmail is connected to your account only.')
          : connection?.status === 'reauthorize'
            ? t('Reconnect Gmail to continue using it.')
            : busy
              ? t('Finish authorization in your browser…')
              : connectors?.enabled === false
                ? t(
                    'Connected applications are not enabled for this account yet.',
                  )
                : t('Gmail is not connected.')}
      </p>
      {error && (
        <p className="settings-feedback settings-feedback--error" role="alert">
          {error}
        </p>
      )}
      <div className="settings-actions">
        {connection?.status === 'connected' ? (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void disconnect()}
            type="button"
          >
            {busy ? t('Disconnecting…') : t('Disconnect Gmail')}
          </button>
        ) : (
          <button
            className="primary-button"
            disabled={busy || connectors?.enabled === false}
            onClick={() => void connect()}
            type="button"
          >
            {busy
              ? t('Connecting…')
              : connection
                ? t('Reconnect Gmail')
                : t('Connect Gmail')}
          </button>
        )}
      </div>
    </section>
  );
}
