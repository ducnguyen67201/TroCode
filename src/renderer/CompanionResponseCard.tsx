import { useEffect } from 'react';

import type {
  CompanionResponseAction,
  CompanionResponseCard as CompanionResponse,
} from '../shared/contracts';

import { translate } from './app-language';
import type { GuidanceAudioStatus } from './guidance-audio-playback';
import { WorkCheckResultCard } from './WorkCheckResultCard';


interface CompanionResponseCardProps {
  audioStatus: GuidanceAudioStatus | null;
  error?: string | null;
  isBusy?: boolean;
  onAction(action: CompanionResponseAction): void;
  response: CompanionResponse;
}

interface CompanionCalloutAvailability {
  hasGuidance: boolean;
  hasInteraction: boolean;
  hasPetNudge?: boolean;
  hasResponse: boolean;
}

export type CompanionCalloutKind =
  | 'guidance'
  | 'interaction'
  | 'pet_nudge'
  | 'response'
  | null;

type CompanionReadAction = Extract<
  CompanionResponseAction,
  'read_aloud' | 'stop_reading'
>;

interface CompanionResponseNumberEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  repeat: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined') return false;
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

export function getCompanionResponseNumberAction(
  event: CompanionResponseNumberEvent,
  readAction: CompanionReadAction,
): CompanionResponseAction | null {
  if (
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    isTextEntryTarget(event.target)
  ) {
    return null;
  }
  return (
    {
      '1': 'dismiss',
      '2': 'open_task',
      '3': 'ask_follow_up',
      '4': readAction,
    } satisfies Record<string, CompanionResponseAction>
  )[event.key] ?? null;
}

export function getCompanionCalloutKind({
  hasGuidance,
  hasInteraction,
  hasPetNudge = false,
  hasResponse,
}: CompanionCalloutAvailability): CompanionCalloutKind {
  if (hasInteraction) return 'interaction';
  if (hasGuidance) return 'guidance';
  if (hasResponse) return 'response';
  if (hasPetNudge) return 'pet_nudge';
  return null;
}

export function getCompanionResponseStatus(
  phase: CompanionResponse['phase'],
  audioStatus: GuidanceAudioStatus | null,
): 'Completed' | 'Fallback voice' | 'Responding' | 'Speaking' {
  if (audioStatus === 'fallback') return 'Fallback voice';
  if (audioStatus === 'loading' || audioStatus === 'speaking') {
    return 'Speaking';
  }
  return phase === 'streaming' ? 'Responding' : 'Completed';
}

export function CompanionResponseCard({
  audioStatus,
  error = null,
  isBusy = false,
  onAction,
  response,
}: CompanionResponseCardProps) {
  const isReading = audioStatus !== null;
  const isCompleted = response.phase === 'completed';
  const readAction: CompanionResponseAction = isReading
    ? 'stop_reading'
    : 'read_aloud';

  useEffect(() => {
    if (response.workCheck || !isCompleted || isBusy) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      const action = getCompanionResponseNumberAction(
        event,
        readAction as CompanionReadAction,
      );
      if (!action) return;
      event.preventDefault();
      onAction(action);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBusy, isCompleted, onAction, readAction, response.workCheck]);

  if (response.workCheck) {
    const panel = response.workCheck;
    const t = (text: string) => translate(panel.language ?? 'en', text);
    const busy = panel.busy || isBusy;
    return <aside className={`guidance-callout companion-response-card work-check-panel guidance-callout--${response.side}`} aria-label={t('Assignment check')}>
      <header><strong>{panel.assignmentTitle}</strong><button type="button" onClick={() => onAction('dismiss')} aria-label={t('Close check panel')}>×</button></header>
      <div className="work-check-panel__content">
      {(!panel.projection?.report || response.message !== 'Check finished.') && <p role="status">{t(response.message)}</p>}
      {panel.policyNotice && <p>{t(panel.policyNotice)}</p>}
      {panel.projection && <WorkCheckResultCard projection={panel.projection} sync={panel.sync} appLanguage={panel.language}/>}
      {error && <p role="alert">{error}</p>}
      {panel.submissionFiles && <ul aria-label={t('Files to submit')}>{panel.submissionFiles.map((file,i) => <li key={i}>{file.displayName} · {file.byteSize} bytes</li>)}</ul>}
      </div>
      <footer className="work-check-panel__actions">
        {panel.projection?.phase === 'checking' && <button type="button" onClick={() => onAction('stop_check')}>{t('Stop check')}</button>}
        {panel.needsWorkspace && <button disabled={busy} type="button" onClick={() => onAction('choose_check_workspace')}>{t('Choose folder')}</button>}
        {(!panel.projection || panel.policyNotice) && <button disabled={busy || !panel.canCheck} type="button" onClick={() => onAction('start_assignment')}>{t(panel.policyNotice ? 'Start working and acknowledge policy' : 'Start working')}</button>}
        <button disabled={busy || !panel.canCheck || panel.needsWorkspace} type="button" onClick={() => onAction('check_again')}>{t(panel.projection ? 'Check again' : 'Check my work')}</button>
        <button className="work-check-panel__review" disabled={busy || !panel.canReview} type="button" onClick={() => onAction(panel.submissionFiles ? 'confirm_submit_files' : 'send_for_review')}>{t(panel.submissionFiles ? 'Submit files' : 'Send for teacher review')}</button>
        <button type="button" onClick={() => onAction('dismiss')}>{t('Keep working')}</button>
      </footer>
    </aside>;
  }

  return (
    <aside
      aria-labelledby="companion-response-title"
      className={`guidance-callout companion-response-card guidance-callout--${response.side}`}
      role="region"
    >
      <header className="guidance-callout__header">
        <span className="guidance-callout__avatar" aria-hidden="true">
          T
        </span>
        <h2
          className="companion-response-card__title"
          id="companion-response-title"
        >
          Tro
        </h2>
        <span
          aria-atomic="true"
          aria-live="polite"
          className="guidance-callout__status"
        >
          {getCompanionResponseStatus(response.phase, audioStatus)}
        </span>
      </header>

      <div className="companion-response-card__message">
        {response.message}
        {response.phase === 'streaming' ? (
          <span className="companion-response-card__cursor" aria-hidden="true" />
        ) : null}
      </div>

      {error ? (
        <p className="companion-response-card__error" role="alert">
          {error}
        </p>
      ) : null}

      {isCompleted ? (
        <footer className="companion-response-card__actions">
          <button
            aria-keyshortcuts="1"
            className="companion-response-card__done"
            disabled={isBusy}
            onClick={() => onAction('dismiss')}
            type="button"
          >
            <kbd>1</kbd>
            Done
          </button>
          <button
            aria-keyshortcuts="2"
            disabled={isBusy}
            onClick={() => onAction('open_task')}
            type="button"
          >
            <kbd>2</kbd>
            Open task
          </button>
          <button
            aria-keyshortcuts="3"
            disabled={isBusy}
            onClick={() => onAction('ask_follow_up')}
            type="button"
          >
            <kbd>3</kbd>
            Ask follow-up
          </button>
          <button
            aria-keyshortcuts="4"
            disabled={isBusy}
            onClick={() => onAction(readAction)}
            type="button"
          >
            <kbd>4</kbd>
            {isReading ? 'Stop' : 'Read aloud'}
          </button>
        </footer>
      ) : null}
    </aside>
  );
}
