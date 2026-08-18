import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import type {
  CompanionGuidance,
  CompanionInteraction,
  CompanionSpeech,
} from '../shared/contracts';

import {
  getFocusedApprovalShortcut,
  isApprovalExpired,
} from './companion-interaction';
import { CursorApprovalChat } from './CursorApprovalChat';
import {
  createGuidanceAudioPlayback,
  type GuidanceAudioPlayback,
  type GuidanceAudioStatus,
} from './guidance-audio-playback';

interface SharedPlayback {
  playback: GuidanceAudioPlayback;
  references: number;
}

const sharedGuidancePlaybacks = new Map<string, SharedPlayback>();

function acquireGuidancePlayback(
  id: string,
  create: () => GuidanceAudioPlayback,
): GuidanceAudioPlayback {
  const existing = sharedGuidancePlaybacks.get(id);
  if (existing) {
    existing.references += 1;
    return existing.playback;
  }
  const playback = create();
  sharedGuidancePlaybacks.set(id, { playback, references: 1 });
  return playback;
}

function releaseGuidancePlayback(
  id: string,
  playback: GuidanceAudioPlayback,
): void {
  const shared = sharedGuidancePlaybacks.get(id);
  if (!shared || shared.playback !== playback) return;
  shared.references -= 1;
  queueMicrotask(() => {
    const latest = sharedGuidancePlaybacks.get(id);
    if (!latest || latest.playback !== playback || latest.references > 0) return;
    sharedGuidancePlaybacks.delete(id);
    playback.dispose();
  });
}

function friendlyError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'TroCode could not send that response. Try again.';
}

export function GuidanceCallout() {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<CompanionGuidance | null>(null);
  const [interaction, setInteraction] =
    useState<CompanionInteraction | null>(null);
  const [approvalExpired, setApprovalExpired] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [speech, setSpeech] = useState<CompanionSpeech | null>(null);
  const [audioStatus, setAudioStatus] =
    useState<GuidanceAudioStatus | null>(null);
  const audioPlaybackRef = useRef<GuidanceAudioPlayback | null>(null);
  const presentationIdentityRef = useRef<string | null>(null);

  useEffect(
    () =>
      window.troCompanion.onGuidanceChange((nextGuidance) => {
        setAudioStatus(null);
        setGuidance(nextGuidance);
      }),
    [],
  );
  useEffect(
    () =>
      window.troCompanion.onInteractionChange((nextInteraction) => {
        setApprovalExpired(
          nextInteraction?.kind === 'approval'
            ? isApprovalExpired(nextInteraction.expiresAt)
            : false,
        );
        setInteraction(nextInteraction);
      }),
    [],
  );
  useEffect(
    () =>
      window.troCompanion.onSpeechChange((nextSpeech) => {
        setAudioStatus(null);
        setSpeech(nextSpeech);
      }),
    [],
  );

  const presentationIdentity = interaction
    ? `interaction:${interaction.id}`
    : guidance
      ? `guidance:${guidance.target ?? ''}\u0000${guidance.message}`
      : null;
  const guidanceMessage = guidance?.message;

  useEffect(() => {
    if (presentationIdentityRef.current === presentationIdentity) return;
    presentationIdentityRef.current = presentationIdentity;
    setAnswer('');
    setError(null);
    setIsSending(false);
  }, [presentationIdentity]);

  const interactionSpokenMessage = useMemo(() => {
    if (interaction?.kind === 'approval') {
      return `${interaction.prompt}. ${interaction.consequence} Use the exact approval buttons or the displayed keyboard shortcut.`;
    }
    return interaction?.prompt ?? '';
  }, [interaction]);

  useEffect(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (!interactionSpokenMessage) return undefined;

    const timer = window.setTimeout(() => {
      if (
        !('speechSynthesis' in window) ||
        typeof SpeechSynthesisUtterance === 'undefined'
      ) {
        return;
      }
      const utterance = new SpeechSynthesisUtterance(interactionSpokenMessage);
      utterance.lang = /[À-ỹ]/u.test(interactionSpokenMessage) ? 'vi-VN' : 'en-US';
      utterance.rate = 0.92;
      window.speechSynthesis.speak(utterance);
    }, 2_200);

    return () => {
      window.clearTimeout(timer);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, [interactionSpokenMessage]);

  useEffect(() => {
    audioPlaybackRef.current = null;
    if (!guidanceMessage || !speech) return undefined;

    const playback = acquireGuidancePlayback(speech.id, () =>
      createGuidanceAudioPlayback({
        message: guidanceMessage,
        onStatus: setAudioStatus,
        paused: false,
        report: (report) => {
          void window.troCompanion
            .reportSpeechPlayback(report)
            .catch(() => undefined);
        },
        speech,
      }),
    );
    audioPlaybackRef.current = playback;
    return () => {
      if (audioPlaybackRef.current === playback) {
        audioPlaybackRef.current = null;
      }
      releaseGuidancePlayback(speech.id, playback);
    };
  }, [guidanceMessage, speech]);

  useEffect(() => {
    audioPlaybackRef.current?.setPaused(guidance?.playback === 'paused');
  }, [guidance?.playback]);

  useEffect(() => {
    if (interaction?.kind !== 'approval') return undefined;
    const updateExpiration = (): void => {
      setApprovalExpired(isApprovalExpired(interaction.expiresAt));
    };
    const timer = window.setInterval(updateExpiration, 1_000);
    return () => window.clearInterval(timer);
  }, [interaction]);

  const submitAnswer = useCallback(
    async (text: string) => {
      if (interaction?.kind !== 'clarification' || isSending) return;
      const normalized = text.trim();
      if (!normalized) return;

      setError(null);
      setIsSending(true);
      try {
        await window.troCompanion.respondToInteraction({
          interactionId: interaction.id,
          kind: 'answer',
          taskId: interaction.taskId,
          text: normalized,
        });
      } catch (nextError) {
        setError(friendlyError(nextError));
        setIsSending(false);
      }
    },
    [interaction, isSending],
  );

  const decideApproval = useCallback(
    async (decision: 'approve' | 'deny') => {
      if (
        interaction?.kind !== 'approval' ||
        isSending ||
        approvalExpired
      ) {
        return;
      }

      setError(null);
      setIsSending(true);
      try {
        await window.troCompanion.decideApproval({
          actionDigest: interaction.actionDigest,
          decision,
          interactionId: interaction.id,
          kind: 'approval',
          taskId: interaction.taskId,
        });
      } catch (nextError) {
        setError(friendlyError(nextError));
        setIsSending(false);
      }
    },
    [approvalExpired, interaction, isSending],
  );

  useEffect(() => {
    if (!interaction) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (interaction.kind === 'approval') {
        const decision = getFocusedApprovalShortcut(event);
        if (!decision) return;
        event.preventDefault();
        void decideApproval(decision);
        return;
      }

      const target = event.target;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement;
      if (
        isTyping ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !/^[1-9]$/.test(event.key)
      ) {
        return;
      }
      const choice = interaction.choices?.[Number(event.key) - 1];
      if (!choice) return;
      event.preventDefault();
      void submitAnswer(choice.label);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [decideApproval, interaction, submitAnswer]);

  const handleAnswerSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void submitAnswer(answer);
  };

  if (!interaction && !guidance) return null;

  return (
    <>
      {interaction ? (
        <aside
          aria-labelledby="companion-interaction-title"
          aria-live={interaction.kind === 'approval' ? 'assertive' : 'polite'}
          className={`guidance-callout guidance-callout--interactive guidance-callout--${interaction.kind} guidance-callout--${interaction.side}`}
          role={interaction.kind === 'approval' ? 'alertdialog' : 'dialog'}
        >
          <div className="guidance-callout__header">
            <span className="guidance-callout__avatar" aria-hidden="true">
              T
            </span>
            <span className="guidance-callout__name">TroCode</span>
            <span className="guidance-callout__status">
              {interaction.kind === 'approval' ? 'Approval' : 'Question'}
            </span>
          </div>
          <p className="guidance-callout__eyebrow">
            {interaction.kind === 'approval'
              ? 'Exact approval required'
              : 'I need one detail'}
          </p>
          <h2 id="companion-interaction-title">{interaction.prompt}</h2>

          {interaction.kind === 'clarification' ? (
            <>
              {interaction.choices?.length ? (
                <div className="guidance-callout__choices">
                  {interaction.choices.map((choice, index) => (
                    <button
                      disabled={isSending}
                      key={choice.id}
                      onClick={() => void submitAnswer(choice.label)}
                      type="button"
                    >
                      <kbd>{index + 1}</kbd>
                      {choice.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <form
                className="guidance-callout__answer"
                onSubmit={handleAnswerSubmit}
              >
                <input
                  aria-label="Your answer"
                  disabled={isSending}
                  onChange={(event) => setAnswer(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      (event.metaKey || event.ctrlKey)
                    ) {
                      event.preventDefault();
                      void submitAnswer(answer);
                    }
                  }}
                  placeholder="Type an answer…"
                  value={answer}
                />
                <button disabled={isSending || !answer.trim()} type="submit">
                  {isSending ? 'Sending…' : 'Send'}
                </button>
              </form>
              <p className="guidance-callout__hint">
                Or use your voice shortcut to answer · <kbd>⌘/Ctrl ↵</kbd> send
              </p>
            </>
          ) : (
            <CursorApprovalChat
              approvalExpired={approvalExpired}
              interaction={interaction}
              isSending={isSending}
              onDecision={(decision) => void decideApproval(decision)}
            />
          )}
          {error ? <p className="guidance-callout__error">{error}</p> : null}
        </aside>
      ) : guidance ? (
        <aside
          aria-live="polite"
          className={`guidance-callout guidance-callout--${guidance.side}`}
          role="status"
        >
          <div className="guidance-callout__header" aria-hidden="true">
            <span className="guidance-callout__avatar">T</span>
            <span className="guidance-callout__name">TroCode</span>
            <span className="guidance-callout__status">
              {guidance.playback === 'paused' || audioStatus === 'paused'
                ? 'Paused'
                : audioStatus === 'loading'
                  ? 'Loading voice'
                  : audioStatus === 'fallback'
                    ? 'Fallback voice'
                    : audioStatus === 'speaking'
                      ? 'Speaking'
                      : 'Guiding'}
            </span>
          </div>
          <p>{guidance.message}</p>
          <span className="guidance-callout__target">
            {guidance.target ?? 'Look here'}
          </span>
          <div className="guidance-callout__controls">
            {guidance.shortcuts?.back.available ? (
              <span><kbd>{guidance.shortcuts.back.label}</kbd> Back</span>
            ) : null}
            {guidance.shortcuts?.pause.available ? (
              <span>
                <kbd>{guidance.shortcuts.pause.label}</kbd>{' '}
                {guidance.playback === 'paused' ? 'Resume' : 'Pause'}
              </span>
            ) : null}
            {guidance.shortcuts?.next.available ? (
              <span><kbd>{guidance.shortcuts.next.label}</kbd> Next</span>
            ) : null}
            <span className="guidance-callout__ask">⌘⌃ Ask</span>
          </div>
        </aside>
      ) : null}
    </>
  );
}
