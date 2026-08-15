export type PushToTalkPlatform = 'macos' | 'unsupported' | 'windows';

interface RecognitionAlternativeLike {
  transcript: string;
}

interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly [index: number]: RecognitionAlternativeLike;
}

interface RecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: RecognitionResultLike;
}

export interface RecognitionTranscript {
  combined: string;
  final: string;
  interim: string;
}

export function detectPushToTalkPlatform(
  navigatorPlatform: string,
  userAgent: string,
): PushToTalkPlatform {
  const platformDescription = `${navigatorPlatform} ${userAgent}`.toLowerCase();

  if (platformDescription.includes('mac')) return 'macos';
  if (platformDescription.includes('win')) return 'windows';
  return 'unsupported';
}

export function isPushToTalkChord(
  platform: PushToTalkPlatform,
  pressedCodes: ReadonlySet<string>,
): boolean {
  if (platform === 'macos') {
    const commandPressed =
      pressedCodes.has('MetaLeft') || pressedCodes.has('MetaRight');
    const controlPressed =
      pressedCodes.has('ControlLeft') || pressedCodes.has('ControlRight');
    return commandPressed && controlPressed;
  }

  if (platform === 'windows') {
    return pressedCodes.has('AltLeft') && pressedCodes.has('ControlLeft');
  }

  return false;
}

export function pushToTalkShortcutName(platform: PushToTalkPlatform): string {
  if (platform === 'windows') return 'left Alt + left Control';
  return 'Command + Control';
}

export function readRecognitionTranscript(
  results: RecognitionResultListLike,
): RecognitionTranscript {
  const finalParts: string[] = [];
  const interimParts: string[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const transcript = result?.[0]?.transcript.trim();
    if (!result || !transcript) continue;

    if (result.isFinal) finalParts.push(transcript);
    else interimParts.push(transcript);
  }

  const final = finalParts.join(' ');
  const interim = interimParts.join(' ');

  return {
    combined: [final, interim].filter(Boolean).join(' '),
    final,
    interim,
  };
}

export function speechRecognitionErrorMessage(
  error: string,
  platform: PushToTalkPlatform = 'macos',
): string | null {
  switch (error) {
    case 'aborted':
      return null;
    case 'audio-capture':
      return 'No microphone is available for voice input.';
    case 'language-not-supported':
      return 'Voice input does not support the current system language.';
    case 'network':
      return 'Voice transcription could not reach the speech service.';
    case 'no-speech':
      return `No speech was detected. Hold ${pushToTalkShortcutName(platform)} and try again.`;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is required for voice input.';
    default:
      return 'Voice transcription stopped unexpectedly.';
  }
}
