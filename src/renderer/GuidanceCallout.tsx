import { useEffect, useRef, useState } from 'react';

import type {
  CompanionGuidance,
  CompanionSpeech,
} from '../shared/contracts';

export function GuidanceCallout() {
  const [guidance, setGuidance] = useState<CompanionGuidance | null>(null);
  const [speech, setSpeech] = useState<CompanionSpeech | null>(null);
  const fallbackStartedRef = useRef(false);
  const guidanceIdentityRef = useRef<string | null>(null);
  const speechRef = useRef<CompanionSpeech | null>(null);

  useEffect(
    () =>
      window.troCompanion.onGuidanceChange((nextGuidance) => {
        const nextIdentity = nextGuidance
          ? `${nextGuidance.target ?? ''}\u0000${nextGuidance.message}`
          : null;
        if (guidanceIdentityRef.current !== nextIdentity) {
          guidanceIdentityRef.current = nextIdentity;
          speechRef.current = null;
          fallbackStartedRef.current = false;
          setSpeech(null);
        }
        setGuidance(nextGuidance);
      }),
    [],
  );
  useEffect(
    () =>
      window.troCompanion.onSpeechChange((nextSpeech) => {
        speechRef.current = nextSpeech;
        if (!fallbackStartedRef.current || nextSpeech === null) {
          setSpeech(nextSpeech);
        }
      }),
    [],
  );

  useEffect(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    const message = guidance?.message;
    if (!message) return undefined;

    const timer = window.setTimeout(() => {
      if (
        speechRef.current ||
        !('speechSynthesis' in window) ||
        typeof SpeechSynthesisUtterance === 'undefined'
      ) {
        return;
      }
      fallbackStartedRef.current = true;
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = /[À-ỹ]/u.test(message) ? 'vi-VN' : 'en-US';
      utterance.rate = 0.92;
      window.speechSynthesis.speak(utterance);
    }, 2_200);

    return () => {
      window.clearTimeout(timer);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, [guidance?.message, guidance?.target]);

  if (!guidance) return null;

  return (
    <>
      {speech ? (
        <audio
          autoPlay
          key={speech.id}
          src={`data:${speech.mimeType};base64,${speech.dataBase64}`}
        />
      ) : null}
      <aside
        aria-live="polite"
        className={`guidance-callout guidance-callout--${guidance.side}`}
        role="status"
      >
        <div className="guidance-callout__header" aria-hidden="true">
          <span className="guidance-callout__avatar">T</span>
          <span className="guidance-callout__name">TroCode</span>
          <span className="guidance-callout__status">
            {guidance.playback === 'paused' ? 'Paused' : 'Guiding'}
          </span>
        </div>
        <p>{guidance.message}</p>
        <span className="guidance-callout__target">
          {guidance.target ?? 'Look here'}
        </span>
        <div className="guidance-callout__controls" aria-hidden="true">
          <span><kbd>J</kbd> Back</span>
          <span><kbd>K</kbd> {guidance.playback === 'paused' ? 'Resume' : 'Pause'}</span>
          <span><kbd>L</kbd> Next</span>
          <span className="guidance-callout__ask">⌘⌃ Ask</span>
        </div>
      </aside>
    </>
  );
}
