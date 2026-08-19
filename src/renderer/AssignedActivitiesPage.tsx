import { useEffect, useState } from 'react';

import type { AppLanguage, AssignedActivityList } from '../shared/contracts';

import { translate } from './app-language';

export function AssignedActivitiesPage({ appLanguage, onOpen }: { appLanguage: AppLanguage; onOpen: (attemptId: string) => void }) {
  const [items, setItems] = useState<AssignedActivityList['items']>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const t = (message: string) => translate(appLanguage, message);
  useEffect(() => { void window.tro.listAssignedActivities().then((result) => { setItems(result.items); setError(null); }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : translate(appLanguage, 'Assignments are unavailable.'))).finally(() => setLoading(false)); }, [appLanguage]);
  return <section className="knowledge-page"><header className="knowledge-heading"><div><p className="eyebrow">{t('Your work')}</p><h1>{t('Assigned Activities')}</h1><p>{t('Start in class, continue later, and keep each Attempt private across Work Sessions.')}</p></div></header>{error && <div className="error-banner" role="alert">{error}</div>}{loading ? <p>{t('Loading…')}</p> : items.length === 0 ? <div className="knowledge-empty"><strong>{t('Nothing assigned')}</strong><p>{t('When a facilitator opens a Run for you, it will appear here.')}</p></div> : <ul className="assignment-list">{items.map((item) => <li key={item.attemptId}><button onClick={() => onOpen(item.attemptId)} type="button"><span className="space-role">{item.space.name}</span><strong>{item.activity.title}</strong><p>{item.activity.objective}</p><span>{t(item.state)} · {t(item.run.mode)}</span></button></li>)}</ul>}</section>;
}
