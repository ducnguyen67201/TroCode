import type { CompanionState } from '../shared/contracts';

import type { VoiceInputStatus } from './use-push-to-talk';

interface CompanionStateInput {
  hasError: boolean;
  isSending: boolean;
  voiceStatus: VoiceInputStatus;
}

export function getCompanionState({
  hasError,
  isSending,
  voiceStatus,
}: CompanionStateInput): CompanionState {
  if (voiceStatus === 'processing' || isSending) return 'sending';

  if (
    voiceStatus === 'connecting' ||
    voiceStatus === 'listening' ||
    voiceStatus === 'requesting_permission'
  ) {
    return 'listening';
  }

  if (hasError) return 'error';
  return 'idle';
}
