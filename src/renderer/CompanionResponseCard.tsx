import { useEffect } from 'react';

import type {
  CompanionResponseCard as CompanionResponse,
  CompanionResponseAction,
} from '../shared/contracts';

import type { GuidanceAudioStatus } from './guidance-audio-playback';
import './classroom-lesson.css';

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
    if (!isCompleted || isBusy || response.lesson) return undefined;
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
  }, [isBusy, isCompleted, onAction, readAction, response.lesson]);

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
          {response.lesson && ['received', 'preparing', 'running'].includes(response.lesson.status) && (
            <span className="lesson-loading-spinner" aria-hidden="true" />
          )}
          {response.lesson ? response.lesson.status.replaceAll('_', ' ') : getCompanionResponseStatus(response.phase, audioStatus)}
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

      {response.lesson ? <footer className="companion-response-card__actions">
        <button type="button" disabled={isBusy} onClick={() => onAction('open_task')}>{response.lesson.language === 'vi' ? 'Mở lớp học' : 'Open class'}</button>
        {!['unknown', 'failed', 'finished', 'paused', 'blocked'].includes(response.lesson.status) && <button type="button" disabled={isBusy} onClick={() => onAction('lesson_pause')}>{response.lesson.language === 'vi' ? 'Tạm dừng' : 'Pause'}</button>}
        {response.lesson.status !== 'finished' && <button type="button" disabled={isBusy} onClick={() => onAction('lesson_stop')}>{response.lesson.language === 'vi' ? 'Dừng' : 'Stop'}</button>}
        {response.lesson.status === 'finished' && <button type="button" disabled={isBusy} onClick={() => onAction('dismiss')}>{response.lesson.language === 'vi' ? 'Xong' : 'Done'}</button>}
        {response.lesson.status === 'waiting_for_student' && <button type="button" disabled={isBusy} onClick={() => onAction('lesson_next')}>{response.lesson.language === 'vi' ? 'Tiếp theo' : 'Next'}</button>}
      </footer> : isCompleted ? (
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
