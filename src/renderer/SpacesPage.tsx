import { useEffect, useState } from 'react';

import type { AppLanguage, KnowledgeSpaceSummary } from '../shared/contracts';
import { randomUUID } from '../shared/renderer-uuid';

import { translate } from './app-language';

export function SpacesPage({ appLanguage, onOpen }: { appLanguage: AppLanguage; onOpen: (space: KnowledgeSpaceSummary) => void }) {
  const [spaces, setSpaces] = useState<KnowledgeSpaceSummary[]>([]);
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const t = (message: string) => translate(appLanguage, message);
  const load = async () => {
    setLoading(true);
    try { setSpaces((await window.tro.listKnowledgeSpaces()).items); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('Knowledge Spaces are unavailable.')); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    void window.tro.listKnowledgeSpaces()
      .then((value) => {
        if (!active) return;
        setSpaces(value.items);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : translate(appLanguage, 'Knowledge Spaces are unavailable.'),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [appLanguage]);

  return (
    <section className="knowledge-page" aria-labelledby="spaces-heading">
      <header className="knowledge-heading">
        <div><p className="eyebrow">{t('Reusable context')}</p><h1 id="spaces-heading">{t('Knowledge Spaces')}</h1><p>{t('Organize references, Activities, people, and reusable assignment context without a manifest.')}</p></div>
      </header>
      <form className="knowledge-create" onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        void window.tro.createKnowledgeSpace({ clientId: randomUUID(), name: name.trim(), description: '', purposeLabel: null })
          .then((result) => { setName(''); onOpen(result.space); return load(); })
          .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t('Could not create the Space.')));
      }}>
        <label htmlFor="space-name">{t('New Space')}</label>
        <input id="space-name" maxLength={240} onChange={(event) => setName(event.target.value)} placeholder={t('Python Foundations, Sales onboarding, Research project…')} value={name} />
        <button className="primary-button" type="submit">{t('Create Space')}</button>
      </form>
      <form className="knowledge-create" onSubmit={(event) => {
        event.preventDefault();
        if (!inviteCode.trim()) return;
        void window.tro.redeemKnowledgeInvite({ code: inviteCode.trim() })
          .then(() => { setInviteCode(''); return load(); })
          .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t('Could not join that Space.')));
      }}>
        <label htmlFor="space-invite-code">{t('Join a Space')}</label>
        <input id="space-invite-code" onChange={(event) => setInviteCode(event.target.value)} placeholder={t('Paste an expiring join code')} value={inviteCode} />
        <button type="submit">{t('Join Space')}</button>
      </form>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {loading ? <p>{t('Loading…')}</p> : spaces.length === 0 ? (
        <div className="knowledge-empty"><strong>{t('No Spaces yet')}</strong><p>{t('Create one, then upload reusable content or design an Activity.')}</p></div>
      ) : (
        <ul className="space-grid">
          {spaces.map((space) => <li key={space.id}><button onClick={() => onOpen(space)} type="button"><span className="space-role">{t(space.role)}</span><strong>{space.name}</strong><p>{space.description || t('Library, Activities, and people')}</p><span>{t('Open Space')} →</span></button></li>)}
        </ul>
      )}
    </section>
  );
}
