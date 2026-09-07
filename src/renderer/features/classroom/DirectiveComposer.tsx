import type * as React from 'react';

import type {
  ClassroomDirective,
  KnowledgeDashboard,
} from '../../../shared/contracts';

interface DirectiveComposerProps {
  runState: KnowledgeDashboard['runState'];
  t: (
    message: string,
    values?: Readonly<Record<string, string | number>>,
  ) => string;
  directiveKind: 'exercise' | 'open_url';
  setDirectiveKind: React.Dispatch<
    React.SetStateAction<'exercise' | 'open_url'>
  >;
  setShowPreview: React.Dispatch<React.SetStateAction<boolean>>;
  setInstruction: React.Dispatch<React.SetStateAction<string>>;
  instruction: string;
  setUrl: React.Dispatch<React.SetStateAction<string>>;
  url: string;
  previewOrigin: string | null;
  autoEligible: boolean;
  criteria: {
    id: string;
    title: string;
    description: string;
    tags: string[];
  }[];
  criterionIds: string[];
  setCriterionIds: React.Dispatch<React.SetStateAction<string[]>>;
  showPreview: boolean;
  canPreview: boolean;
  busyAction: string | null;
  broadcast: () => Promise<void>;
  lastDirective: ClassroomDirective | null;
}

export function DirectiveComposer({
  runState,
  t,
  directiveKind,
  setDirectiveKind,
  setShowPreview,
  setInstruction,
  instruction,
  setUrl,
  url,
  previewOrigin,
  autoEligible,
  criteria,
  criterionIds,
  setCriterionIds,
  showPreview,
  canPreview,
  busyAction,
  broadcast,
  lastDirective,
}: DirectiveComposerProps) {
  return (
    <section
      className={`directive-studio ${runState !== 'open' ? 'is-locked' : ''}`}
      aria-labelledby="directive-heading"
    >
      <div className="directive-studio__heading">
        <span className="step-index">03</span>
        <div>
          <p className="eyebrow">{t('Current class direction')}</p>
          <h3 id="directive-heading">
            {t('What should every student do next?')}
          </h3>
        </div>
        {runState !== 'open' && (
          <span className="directive-lock">
            {t('Available when class starts')}
          </span>
        )}
      </div>
      <p>{t('Messages display instructions. Use Teach a lesson for guided execution.')}</p>
      <div
        className="directive-kind-switch"
        role="radiogroup"
        aria-label={t('Direction type')}
      >
        <label className={directiveKind === 'exercise' ? 'is-selected' : ''}>
          <input
            checked={directiveKind === 'exercise'}
            name="directive-kind"
            onChange={() => {
              setDirectiveKind('exercise');
              setShowPreview(false);
            }}
            type="radio"
          />
          <span aria-hidden="true">→</span>
          {t('Message')}
        </label>
        <label className={directiveKind === 'open_url' ? 'is-selected' : ''}>
          <input
            checked={directiveKind === 'open_url'}
            name="directive-kind"
            onChange={() => {
              setDirectiveKind('open_url');
              setShowPreview(false);
            }}
            type="radio"
          />
          <span aria-hidden="true">↗</span>
          {t('Open a link')}
        </label>
      </div>
      <label className="directive-instruction-field">
        {t('Instruction')}
        <textarea
          disabled={runState !== 'open'}
          maxLength={4000}
          onChange={(event) => {
            setInstruction(event.target.value);
            setShowPreview(false);
          }}
          placeholder={t(
            'Open the starter project and complete exercises A, B, and C…',
          )}
          rows={4}
          value={instruction}
        />
        <small>{instruction.length}/4000</small>
      </label>
      {directiveKind === 'open_url' && (
        <label>
          {t('Public HTTPS link')}
          <input
            disabled={runState !== 'open'}
            onChange={(event) => {
              setUrl(event.target.value);
              setShowPreview(false);
            }}
            placeholder="https://scratch.mit.edu/projects/…"
            type="url"
            value={url}
          />
          <small
            className={
              previewOrigin ? 'field-valid' : url ? 'field-invalid' : ''
            }
          >
            {url
              ? previewOrigin
                ? autoEligible
                  ? t('Approved site · eligible for student opt-in auto-open')
                  : t('Safe link · students will choose Open')
                : t('Enter a valid public HTTPS link')
              : t(
                  'Links never broadcast or open until you confirm the preview.',
                )}
          </small>
        </label>
      )}
      {criteria.length > 0 && (
        <fieldset className="directive-criteria">
          <legend>
            {t('Attach check criteria')} <small>{t('optional')}</small>
          </legend>
          {criteria.map((criterion) => (
            <label key={criterion.id}>
              <input
                checked={criterionIds.includes(criterion.id)}
                disabled={runState !== 'open'}
                onChange={(event) =>
                  setCriterionIds((current) =>
                    event.target.checked
                      ? [...current, criterion.id]
                      : current.filter((id) => id !== criterion.id),
                  )
                }
                type="checkbox"
              />
              <span>
                <strong>{criterion.title}</strong>
                <small>{criterion.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {!showPreview ? (
        <button
          className="directive-preview-button"
          disabled={runState !== 'open' || !canPreview}
          onClick={() => setShowPreview(true)}
          type="button"
        >
          {t('Preview exact broadcast')} →
        </button>
      ) : (
        <section
          className="directive-preview"
          aria-labelledby="directive-preview-heading"
        >
          <div className="directive-preview__header">
            <div>
              <span>{t('Exact student preview')}</span>
              <h4 id="directive-preview-heading">{instruction.trim()}</h4>
            </div>
            <span className="directive-delivery-badge">
              {t(
                directiveKind === 'open_url' && autoEligible
                  ? 'Auto-open eligible'
                  : 'Manual delivery',
              )}
            </span>
          </div>
          {directiveKind === 'open_url' && (
            <div className="directive-preview__url">
              <span aria-hidden="true">↗</span>
              <code>{url.trim()}</code>
            </div>
          )}
          {criterionIds.length > 0 && (
            <p>
              {t('{count} check criteria attached', {
                count: criterionIds.length,
              })}
            </p>
          )}
          <div className="directive-preview__notice">
            <span aria-hidden="true">!</span>
            <p>
              <strong>{t('Broadcast is class-wide')}</strong>
              {t(
                ' Students receive exactly this content. A model cannot press Broadcast for you.',
              )}
            </p>
          </div>
          <div className="directive-preview__actions">
            <button
              disabled={busyAction !== null}
              onClick={() => setShowPreview(false)}
              type="button"
            >
              {t('Revise')}
            </button>
            <button
              className="primary-button"
              disabled={busyAction !== null}
              onClick={() => void broadcast()}
              type="button"
            >
              {busyAction === 'broadcast'
                ? t('Broadcasting…')
                : t('Broadcast to class')}
            </button>
          </div>
        </section>
      )}
      {lastDirective && (
        <p className="directive-sent" aria-live="polite">
          ✓{' '}
          {t('Broadcast #{sequence} sent', {
            sequence: lastDirective.sequence,
          })}{' '}
          · {lastDirective.instruction}
        </p>
      )}
    </section>
  );
}
