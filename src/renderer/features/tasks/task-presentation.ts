import type { AppLanguage, VoiceMode } from '../../../shared/contracts';
import { translate } from '../../app-language';
import type { VoiceInputStatus } from '../voice/voice-input-types';

export function formatLabel(
  value: string,
  appLanguage: AppLanguage = 'en',
): string {
  return translate(appLanguage, value.replaceAll('_', ' '));
}

export function voiceStatusMessage(
  status: VoiceInputStatus,
  appLanguage: AppLanguage,
  mode: VoiceMode | null,
): string {
  switch (status) {
    case 'listening':
      return translate(
        appLanguage,
        mode === 'task'
          ? 'Giving Tro a task… Release to transcribe, then press Escape to cancel.'
          : 'Dictating… Release to insert text without sending.',
      );
    case 'processing':
      return translate(appLanguage, 'Finishing transcript…');
    case 'committing':
      return translate(
        appLanguage,
        mode === 'task' ? 'Sending voice task…' : 'Inserting dictated text…',
      );
    case 'requesting_permission':
      return translate(appLanguage, 'Waiting for microphone access…');
    case 'unavailable':
      return translate(
        appLanguage,
        'Voice recognition is unavailable. Type your request instead.',
      );
    case 'idle': {
      return translate(appLanguage, 'Voice ready.');
    }
  }
}
