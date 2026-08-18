import { useEffect, useState } from 'react';

import type { CompanionVoiceActivity } from '../shared/contracts';

import { translate } from './app-language';

function voiceActivityLabel(
  phase: CompanionVoiceActivity['phase'],
  appLanguage: CompanionVoiceActivity['appLanguage'],
): string {
  switch (phase) {
    case 'requesting_permission':
      return translate(appLanguage, 'Starting microphone');
    case 'listening':
      return translate(appLanguage, 'Listening');
    case 'processing':
      return translate(appLanguage, 'Transcribing');
  }
}

function voiceActivityPlaceholder(
  phase: CompanionVoiceActivity['phase'],
  appLanguage: CompanionVoiceActivity['appLanguage'],
): string {
  switch (phase) {
    case 'requesting_permission':
      return translate(appLanguage, 'Waiting for microphone access…');
    case 'listening':
      return translate(appLanguage, 'Speak now…');
    case 'processing':
      return translate(appLanguage, 'Finishing your request…');
  }
}

export function VoiceIsland() {
  const [activity, setActivity] = useState<CompanionVoiceActivity | null>(null);

  useEffect(
    () => window.troCompanion.onVoiceActivityChange(setActivity),
    [],
  );

  if (!activity) return null;

  const transcript = activity.transcript.trim();

  return (
    <div
      aria-live="polite"
      className={`voice-island voice-island--${activity.phase} ${
        transcript
          ? 'voice-island--has-transcript'
          : 'voice-island--compact'
      }`}
      role="status"
    >
      <span className="voice-island__signal" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 15.25a3.25 3.25 0 0 0 3.25-3.25V7a3.25 3.25 0 0 0-6.5 0v5A3.25 3.25 0 0 0 12 15.25Z" />
          <path d="M6.75 11.5v.5a5.25 5.25 0 0 0 10.5 0v-.5M12 17.25V21M9.5 21h5" />
        </svg>
      </span>
      <span className="voice-island__copy">
        <strong>
          {voiceActivityLabel(activity.phase, activity.appLanguage)}
        </strong>
        <span className={transcript ? '' : 'voice-island__placeholder'}>
          {transcript ||
            voiceActivityPlaceholder(activity.phase, activity.appLanguage)}
        </span>
      </span>
      <span className="voice-island__meter" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
