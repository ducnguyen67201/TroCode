import type { VoiceDiagnostic } from '../../../shared/contracts';

import type { VoiceConnectionStep } from './voice-input-types';

export function voiceConnectionErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone access is required for voice input.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Tro could not transcribe voice input.';
}

export function createVoiceConnectionDiagnostic(
  step: VoiceConnectionStep,
  error: unknown,
): VoiceDiagnostic {
  return {
    error:
      error instanceof Error
        ? { message: error.message, name: error.name }
        : { message: String(error) },
    step,
  };
}

export function logVoiceConnectionFailure(
  step: VoiceConnectionStep,
  error: unknown,
  logger: Pick<Console, 'error'> = console,
): void {
  logger.error(
    '[voice] GPT Transcribe transcription failed.',
    createVoiceConnectionDiagnostic(step, error),
  );
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

export function voiceTurnDiagnostic(
  event: string,
  properties: Record<string, string | number | boolean> = {},
): void {
  const details =
    Object.keys(properties).length > 0 ? ` ${JSON.stringify(properties)}` : '';
  console.info(`[voice:renderer] turn.${event}${details}`);
}
