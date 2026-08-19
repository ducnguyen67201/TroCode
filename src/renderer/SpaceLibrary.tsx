import { useState } from 'react';

import type { AppLanguage, KnowledgeFileSelection, KnowledgeSourceList } from '../shared/contracts';

import { translate } from './app-language';

export function SpaceLibrary({ appLanguage, sources, spaceId, onChanged }: { appLanguage: AppLanguage; sources: KnowledgeSourceList['items']; spaceId: string; onChanged: () => void }) {
  const [selection, setSelection] = useState<KnowledgeFileSelection | null>(null);
  const [role, setRole] = useState<'reference' | 'instructions' | 'rubric' | 'starter'>('reference');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = (message: string) => translate(appLanguage, message);
  const choose = async (selectionKind: 'files' | 'folder') => {
    try { setSelection(await window.tro.selectKnowledgeFiles({ role, selectionKind })); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('Could not review those files.')); }
  };
  const upload = async () => {
    if (!selection) return;
    setBusy(true);
    try { await window.tro.uploadKnowledgeSelection({ spaceId, selectionId: selection.selectionId }); setSelection(null); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('Upload could not be completed.')); }
    finally { setBusy(false); }
  };
  return <section className="space-panel" aria-labelledby="library-heading">
    <div className="section-heading-row"><div><p className="eyebrow">{t('Reusable content')}</p><h2 id="library-heading">{t('Library')}</h2></div><div className="knowledge-actions"><label>{t('Content role')}<select onChange={(event) => setRole(event.target.value as typeof role)} value={role}><option value="reference">{t('Reference')}</option><option value="instructions">{t('Instructions')}</option><option value="rubric">{t('Rubric')}</option><option value="starter">{t('Starter files')}</option></select></label><button onClick={() => void choose('files')} type="button">{t('Upload files')}</button><button onClick={() => void choose('folder')} type="button">{t('Snapshot folder')}</button></div></div>
    <p>{t('Text, Markdown, and PDF content is versioned, processed privately, and searched only inside assigned Activities.')}</p>
    {selection && <div className="upload-preview"><strong>{t('Review upload')}</strong><ul>{selection.files.map((file) => <li key={file.relativePath}><span>{file.relativePath}</span><small>{Math.ceil(file.byteSize / 1024)} KB</small></li>)}</ul><button className="primary-button" disabled={busy} onClick={() => void upload()} type="button">{busy ? t('Uploading…') : t('Upload reviewed files')}</button></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {sources.length === 0 ? <div className="knowledge-empty"><strong>{t('Library is empty')}</strong><p>{t('Upload reusable references, instructions, rubrics, or starter material.')}</p></div> : <table className="knowledge-table"><thead><tr><th>{t('Source')}</th><th>{t('Role')}</th><th>{t('Status')}</th></tr></thead><tbody>{sources.map((source) => <tr key={source.id}><td><strong>{source.displayName}</strong><small>{source.relativePath}</small></td><td>{t(source.role)}</td><td><span className={`knowledge-status knowledge-status--${source.latestVersion?.state ?? 'pending'}`}>{t(source.latestVersion?.state ?? 'pending')}</span></td></tr>)}</tbody></table>}
  </section>;
}
