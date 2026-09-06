import { useEffect, useMemo, useRef, useState } from 'react';

import {
  SaveKnowledgeActivityRequestSchema,
  type AppLanguage,
  type KnowledgeSourceList,
  type PreparedKnowledgeActivity,
  type SaveKnowledgeActivityRequest,
} from '../shared/contracts';
import { randomUUID } from '../shared/renderer-uuid';

import { translate } from './app-language';

const DEFAULT_OPTIONS = {
  launchTarget: 'none',
  guidancePolicy: { answerReveal: 'after_attempt', hintMode: 'guided', maxHintLevel: 3 },
  completionPolicy: { requiresSubmission: false, requiresFacilitatorConfirmation: true },
  sessionPolicy: { allowRoomJoin: true, allowedOrigins: [] },
} satisfies Omit<SaveKnowledgeActivityRequest['definition'], keyof PreparedKnowledgeActivity>;

type Options = Omit<SaveKnowledgeActivityRequest['definition'], keyof PreparedKnowledgeActivity>;

export function ActivityEditorPage({
  appLanguage,
  onPublished,
  sources,
  spaceId,
}: {
  appLanguage: AppLanguage;
  onPublished: (
    versionId: string,
    definition: SaveKnowledgeActivityRequest['definition'],
  ) => void;
  sources: KnowledgeSourceList['items'];
  spaceId: string;
}) {
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<PreparedKnowledgeActivity | null>(null);
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);
  const [originsText, setOriginsText] = useState('');
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [busy, setBusy] = useState<'preparing' | 'saving' | 'publishing' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const clientId = useMemo(() => randomUUID(), []);
  const t = (message: string, replacements: Readonly<Record<string, string | number>> = {}) =>
    translate(appLanguage, message, replacements);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { headingRef.current?.focus(); }, [reviewing]);

  const readySources = sources.filter((source) =>
    source.latestVersion?.state === 'ready' && source.role !== 'submission',
  );
  const materialNames = sources.filter((source) =>
    source.latestVersion && selectedSources.includes(source.latestVersion.id),
  ).map((source) => source.displayName);
  const canSave = Boolean(draft?.title.trim() && draft.instructions.trim());

  const start = (action: NonNullable<typeof busy>): boolean => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(action);
    setError(null);
    setMessage(null);
    return true;
  };
  const finish = () => {
    busyRef.current = false;
    if (mounted.current) setBusy(null);
  };
  const prepare = async () => {
    if (!description.trim() || !start('preparing')) return;
    try {
      const prepared = await window.tro.prepareKnowledgeActivity({
        spaceId, requestId: randomUUID(), description: description.trim(),
        language: appLanguage, sourceVersionIds: selectedSources,
      });
      if (!mounted.current) return;
      setDraft(prepared);
      setReviewing(true);
      setEditing(false);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error
        ? cause.message : t('Could not prepare this activity. Your description is still here.'));
    } finally { finish(); }
  };
  const save = async (publish: boolean) => {
    if (!draft || !canSave || !start(publish ? 'publishing' : 'saving')) return;
    try {
      const allowedOrigins = originsText.split(/\r?\n/u).map((line) => line.trim())
        .filter(Boolean).map((value) => {
          const url = new URL(value);
          // Paths may be pasted, but credentials are never silently removed.
          if (url.username || url.password) throw new Error(t('Use website addresses without usernames or passwords.'));
          return url.origin;
        });
      const request = SaveKnowledgeActivityRequestSchema.safeParse({
        spaceId, clientId, sourceVersionIds: selectedSources,
        definition: {
          ...draft,
          objective: draft.objective.trim() || draft.instructions.trim().slice(0, 4_000),
          ...options,
          sessionPolicy: { ...options.sessionPolicy, allowedOrigins: [...new Set(allowedOrigins)] },
        },
      });
      if (!request.success) {
        const websiteError = request.error.issues.some((issue) => issue.path.includes('allowedOrigins'));
        throw new Error(t(websiteError
          ? 'Use public HTTPS website addresses, one per line.'
          : 'Review the activity text and success checks before saving.'));
      }
      const saved = await window.tro.saveKnowledgeActivity(request.data);
      if (!mounted.current) return;
      if (publish) {
        const version = await window.tro.publishKnowledgeActivity({
          spaceId, activityId: saved.id, clientId: randomUUID(),
        });
        if (!mounted.current) return;
        setMessage(t('Activity published. Ready for a Session.'));
        onPublished(version.id, request.data.definition);
      } else {
        setMessage(t('Draft saved.'));
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error
        ? cause.message : t('Could not save this Activity.'));
    } finally { finish(); }
  };

  return (
    <section className="space-panel activity-authoring" aria-labelledby="activity-editor-heading">
      <header className="activity-authoring__heading">
        <p className="eyebrow">{t('Activity')}</p>
        <h2 id="activity-editor-heading" ref={headingRef} tabIndex={-1}>
          {t(reviewing ? 'Review your activity' : 'What would you like learners to do?')}
        </h2>
        <p>{t(reviewing
          ? 'Make it your own. Nothing is shared with learners until you publish.'
          : 'Describe it in your own words. Tro will help turn it into an activity you can review and edit.')}</p>
      </header>
      <fieldset className="activity-authoring__body" disabled={Boolean(busy)}>
        <legend className="sr-only">{t('Activity details')}</legend>
        {!reviewing || !draft ? (
          <>
            <label className="activity-authoring__description">
              <span>{t('Describe the activity')}</span>
              <textarea value={description} maxLength={12_000} rows={4}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('For example: Practice welcoming a customer. Role-play a short conversation, give hints when needed, and check that the learner listens and responds clearly.')} />
              <small>{t('Any subject, skill, or audience. Include what to practice and what a good result looks like.')}</small>
            </label>
            <details className="activity-authoring__details">
              <summary>{t('Add materials')} <span>{selectedSources.length
                ? t('{count} selected', { count: selectedSources.length }) : t('Optional')}</span></summary>
              <p>{t('Choose class materials for this activity. Tro uses excerpts when preparing the draft.')}</p>
              {readySources.length === 0 ? <p>{t('Materials appear here when processing is complete. You can also create an activity without them.')}</p> : (
                <fieldset className="source-picker activity-authoring__materials">
                  <legend className="sr-only">{t('Materials for this activity')}</legend>
                  {readySources.map((source) => (
                    <label key={source.id}>
                      <input type="checkbox" checked={selectedSources.includes(source.latestVersion!.id)}
                        onChange={(event) => setSelectedSources((current) => event.target.checked
                          ? [...current, source.latestVersion!.id]
                          : current.filter((id) => id !== source.latestVersion!.id))} />
                      <span><strong>{source.displayName}</strong><small>{t(source.role)}</small></span>
                    </label>
                  ))}
                </fieldset>
              )}
            </details>
          </>
        ) : (
          <>
            <div className="activity-authoring__review-toolbar">
              <button type="button" onClick={() => { setReviewing(false); setEditing(false); setError(null); setMessage(null); }}>
                ← {t('Back to description')}
              </button>
              <button type="button" onClick={() => setEditing(!editing)}>{t(editing ? 'Done editing' : 'Edit content')}</button>
            </div>
            {editing ? (
              <div className="activity-authoring__content-editor">
                <label>{t('Activity name')}<input maxLength={240} value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
                <label>{t('Learning goal')}<textarea rows={2} maxLength={4_000} value={draft.objective}
                  onChange={(event) => setDraft({ ...draft, objective: event.target.value })} /></label>
                <label>{t('Learner instructions')}<textarea rows={6} maxLength={24_000} value={draft.instructions}
                  onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></label>
                <fieldset className="activity-authoring__checks">
                  <legend>{t('What does success look like?')}</legend>
                  <p>{t('Write simple, observable checks. Tro uses these for feedback, not numeric grades.')}</p>
                  {draft.criteria.map((criterion, index) => (
                    <div key={criterion.id} className="activity-authoring__check">
                      <label>{t('Success check {number}', { number: index + 1 })}
                        <input value={criterion.title} maxLength={240} onChange={(event) => setDraft({
                          ...draft, criteria: draft.criteria.map((item, i) => i === index ? { ...item, title: event.target.value } : item),
                        })} /></label>
                      <label>{t('Details (optional)')}<textarea rows={2} maxLength={2_000} value={criterion.description}
                        onChange={(event) => setDraft({ ...draft, criteria: draft.criteria.map((item, i) =>
                          i === index ? { ...item, description: event.target.value } : item) })} /></label>
                      <button type="button" aria-label={t('Remove success check {number}', { number: index + 1 })}
                        onClick={() => setDraft({ ...draft, criteria: draft.criteria.filter((_, i) => i !== index) })}>{t('Remove')}</button>
                    </div>
                  ))}
                  <button type="button" disabled={draft.criteria.length >= 40} onClick={() => setDraft({
                    ...draft, criteria: [...draft.criteria, { id: `check-${randomUUID()}`, title: '', description: '', tags: [] }],
                  })}>+ {t('Add a success check')}</button>
                </fieldset>
              </div>
            ) : (
              <article className="activity-authoring__preview">
                <h3>{draft.title}</h3>
                {draft.objective && <p className="activity-authoring__goal">{draft.objective}</p>}
                <h4>{t('Learner instructions')}</h4>
                <p className="activity-authoring__instructions">{draft.instructions}</p>
                <h4>{t('What does success look like?')}</h4>
                {draft.criteria.length ? <ul>{draft.criteria.map((criterion) => (
                  <li key={criterion.id}><strong>{criterion.title}</strong>{criterion.description && <p>{criterion.description}</p>}</li>
                ))}</ul> : <p>{t('No specific checks added. Tro can still help with the activity.')}</p>}
                <h4>{t('Materials')}</h4>
                {materialNames.length ? <ul>{materialNames.map((name, index) => <li key={`${index}-${name}`}>{name}</li>)}</ul>
                  : <p>{t('No materials attached.')}</p>}
              </article>
            )}
          </>
        )}

        <details className="activity-authoring__details">
          <summary>{t('Customize how it works')} <span>{t('Optional')}</span></summary>
          <p>{t('Keep the defaults, or adapt the activity to your learners and setting.')}</p>
          <div className="activity-form-grid">
            <label>{t('Where will learners work?')}
              <select value={options.launchTarget} onChange={(event) => setOptions({ ...options, launchTarget: event.target.value as Options['launchTarget'] })}>
                <option value="none">{t('In conversation with Tro')}</option>
                <option value="current_surface">{t('In an app or website on their screen')}</option>
                <option value="workspace">{t('In a project folder')}</option>
              </select>
            </label>
            <label>{t('How should Tro help?')}
              <select value={options.guidancePolicy.hintMode} onChange={(event) => setOptions({ ...options,
                guidancePolicy: { ...options.guidancePolicy, hintMode: event.target.value as Options['guidancePolicy']['hintMode'] } })}>
                <option value="guided">{t('Guide step by step')}</option>
                <option value="socratic">{t('Ask guiding questions')}</option>
                <option value="direct">{t('Explain directly')}</option>
              </select>
            </label>
            <label>{t('When can Tro show an answer?')}
              <select value={options.guidancePolicy.answerReveal} onChange={(event) => setOptions({ ...options,
                guidancePolicy: { ...options.guidancePolicy, answerReveal: event.target.value as Options['guidancePolicy']['answerReveal'] } })}>
                <option value="after_attempt">{t('After the learner tries')}</option>
                <option value="never">{t('Give hints only')}</option>
                <option value="allowed">{t('Whenever it helps')}</option>
              </select>
            </label>
          </div>
          <div className="activity-authoring__toggles">
            <label><input type="checkbox" checked={options.sessionPolicy.allowRoomJoin}
              onChange={(event) => setOptions({ ...options, sessionPolicy: { ...options.sessionPolicy, allowRoomJoin: event.target.checked } })} />
              {t('Make this activity available in live sessions')}</label>
            <label><input type="checkbox" checked={options.completionPolicy.requiresSubmission}
              onChange={(event) => setOptions({ ...options, completionPolicy: { ...options.completionPolicy, requiresSubmission: event.target.checked } })} />
              {t('Ask learners to submit a file')}</label>
            <label><input type="checkbox" checked={options.completionPolicy.requiresFacilitatorConfirmation}
              onChange={(event) => setOptions({ ...options, completionPolicy: { ...options.completionPolicy, requiresFacilitatorConfirmation: event.target.checked } })} />
              {t('Require teacher review to finish')}</label>
          </div>
          <label className="activity-authoring__websites">{t('Websites Tro may open automatically')}
            <textarea rows={2} value={originsText} onChange={(event) => setOriginsText(event.target.value)}
              placeholder="https://example.com" />
            <small>{t('Optional. One public HTTPS website per line. Leave blank to let learners open links themselves.')}</small>
          </label>
        </details>
        {reviewing && <p className="activity-authoring__defaults">{t('Current setup:')} {t(options.launchTarget === 'none'
          ? 'Conversation' : options.launchTarget === 'workspace' ? 'Project folder' : 'Current screen')} · {t(options.guidancePolicy.hintMode === 'guided'
            ? 'Step-by-step help' : options.guidancePolicy.hintMode === 'direct' ? 'Direct explanations' : 'Guiding questions')} · {t(options.completionPolicy.requiresSubmission
              ? 'File submission' : 'No file submission')}</p>}
        <footer className="activity-authoring__footer">
          {!reviewing || !draft ? <>
            <button type="button" disabled={!draft && !description.trim()} onClick={() => {
              if (!draft) {
                setDraft({ title: '', objective: '', instructions: description.trim(), criteria: [] });
                setEditing(true);
              }
              setReviewing(true); setError(null);
            }}>{t(draft ? 'Return to draft' : 'Write it myself')}</button>
            <button className="primary-button" type="button" disabled={!description.trim()} onClick={() => void prepare()}>
              {t(busy === 'preparing' ? 'Preparing your activity…' : 'Prepare activity')} →
            </button>
          </> : <>
            <button type="button" disabled={!canSave} onClick={() => void save(false)}>{t(busy === 'saving' ? 'Saving…' : 'Save draft')}</button>
            <button className="primary-button" type="button" disabled={!canSave} onClick={() => void save(true)}>
              {t(busy === 'publishing' ? 'Publishing…' : 'Publish Activity')} →
            </button>
          </>}
        </footer>
      </fieldset>
      <div className="activity-authoring__status" aria-live="polite">
        {busy === 'preparing' && <p>{t('Tro is drafting your activity. You will review it before publishing.')}</p>}
        {message && <p className="studio-message">{message}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}
