import { useEffect, useState } from 'react';

import type { VoiceStatus } from '../../../shared/contracts';
import { EMPTY_VOICE_STATUS } from '../../runtime-status';

export function useVoiceAvailability({
  reportError,
}: {
  reportError: (message: string) => void;
}) {
  const [voiceProviderStatus, setVoiceProviderStatus] =
    useState<VoiceStatus>(EMPTY_VOICE_STATUS);

  useEffect(() => {
    void window.tro
      .getVoiceStatus()
      .then((status) => {
        setVoiceProviderStatus(status);
      })
      .catch((statusError: unknown) => {
        reportError(
          statusError instanceof Error
            ? statusError.message
            : 'Could not inspect the OpenAI voice connection.',
        );
      });
  }, [reportError]);

  return { voiceProviderStatus };
}
