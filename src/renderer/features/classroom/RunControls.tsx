import { type CSSProperties } from 'react';

import type {
  KnowledgeDashboard,
  KnowledgeRoomCode,
} from '../../../shared/contracts';

interface RunControlsProps {
  t: (
    message: string,
    values?: Readonly<Record<string, string | number>>,
  ) => string;
  roomCode: KnowledgeRoomCode | null;
  formatter: Intl.DateTimeFormat;
  busyAction: string | null;
  runEnded: boolean;
  createCode: () => Promise<void>;
  revokeCode: () => Promise<void>;
  countFor: (status: string) => number;
  participants: NonNullable<KnowledgeDashboard['participants']>;
  runState: KnowledgeDashboard['runState'];
  changeRunState: (state: 'closed' | 'open') => Promise<void>;
}

export function RunControls({
  t,
  roomCode,
  formatter,
  busyAction,
  runEnded,
  createCode,
  revokeCode,
  countFor,
  participants,
  runState,
  changeRunState,
}: RunControlsProps) {
  return (
    <div className="room-control-grid">
      <section className="room-invite-card" aria-labelledby="room-code-heading">
        <div className="room-card-label">
          <span className="step-index">01</span>
          <div>
            <strong id="room-code-heading">{t('Invite the room')}</strong>
            <small>{t('Short-lived · up to 500 joins')}</small>
          </div>
        </div>
        {roomCode ? (
          <>
            <div className="room-code-display" aria-live="polite">
              <span>{t('Room code')}</span>
              <code>{roomCode.code}</code>
              <small>
                {t('Expires at {time}', {
                  time: formatter.format(new Date(roomCode.expiresAt)),
                })}
              </small>
            </div>
            <div className="room-card-actions">
              <button
                disabled={busyAction !== null || runEnded}
                onClick={() => void createCode()}
                type="button"
              >
                {t('Rotate code')}
              </button>
              <button
                className="danger-text-button"
                disabled={busyAction !== null}
                onClick={() => void revokeCode()}
                type="button"
              >
                {t('Revoke')}
              </button>
            </div>
          </>
        ) : (
          <div className="room-code-empty">
            <p>
              {t('Create a code, then display or read it to your students.')}
            </p>
            <button
              className="primary-button"
              disabled={busyAction !== null || runEnded}
              onClick={() => void createCode()}
              type="button"
            >
              {busyAction === 'room-code'
                ? t('Creating…')
                : t('Create room code')}
            </button>
          </div>
        )}
      </section>

      <section className="room-start-card" aria-labelledby="room-start-heading">
        <div className="room-card-label">
          <span className="step-index">02</span>
          <div>
            <strong id="room-start-heading">{t('Start together')}</strong>
            <small>
              {t('{count} students in the lobby', {
                count: countFor('lobby'),
              })}
            </small>
          </div>
        </div>
        <div className="room-presence-row" aria-hidden="true">
          {participants.slice(0, 7).map((participant, index) => (
            <span
              key={participant.attemptId}
              style={{ '--presence-index': index } as CSSProperties}
            >
              {String(participant.id).slice(0, 1).toUpperCase()}
            </span>
          ))}
          {participants.length > 7 && <span>+{participants.length - 7}</span>}
        </div>
        {runState === 'draft' ? (
          <button
            className="primary-button room-start-button"
            disabled={busyAction !== null}
            onClick={() => void changeRunState('open')}
            type="button"
          >
            {busyAction === 'open' ? t('Starting…') : t('Start class')}{' '}
            <span aria-hidden="true">→</span>
          </button>
        ) : runState === 'open' ? (
          <button
            className="room-end-button"
            disabled={busyAction !== null}
            onClick={() => void changeRunState('closed')}
            type="button"
          >
            {busyAction === 'closed' ? t('Ending…') : t('End class safely')}
          </button>
        ) : (
          <p className="room-ended-note">
            ✓ {t('The room is closed. Student work remains saved.')}
          </p>
        )}
      </section>
    </div>
  );
}
