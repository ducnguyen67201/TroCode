import { useCallback, useEffect, useRef, useState } from 'react';

import {
  detectPushToTalkPlatform,
  isPushToTalkChord,
  pushToTalkShortcutName,
  readRecognitionTranscript,
  speechRecognitionErrorMessage,
  type PushToTalkPlatform,
} from './push-to-talk';

export type VoiceInputStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'requesting_permission'
  | 'unavailable';

interface UsePushToTalkOptions {
  disabled?: boolean;
  onError(message: string): void;
  onTranscriptChange(transcript: string): void;
  onTranscriptSubmit(transcript: string): void;
}

interface PushToTalkState {
  cancel(): void;
  platform: PushToTalkPlatform;
  status: VoiceInputStatus;
}

function getSpeechRecognitionConstructor():
  | BrowserSpeechRecognitionConstructor
  | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

function getPushToTalkPlatform(): PushToTalkPlatform {
  if (typeof navigator === 'undefined') return 'unsupported';
  return detectPushToTalkPlatform(navigator.platform, navigator.userAgent);
}

export function usePushToTalk({
  disabled = false,
  onError,
  onTranscriptChange,
  onTranscriptSubmit,
}: UsePushToTalkOptions): PushToTalkState {
  const [platform] = useState<PushToTalkPlatform>(getPushToTalkPlatform);
  const [status, setStatus] = useState<VoiceInputStatus>(() =>
    platform !== 'unsupported' && getSpeechRecognitionConstructor()
      ? 'idle'
      : 'unavailable',
  );
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const pressedCodesRef = useRef(new Set<string>());
  const chordHeldRef = useRef(false);
  const recognitionStartedRef = useRef(false);
  const releaseRequestedRef = useRef(false);
  const transcriptRef = useRef('');
  const permissionRequestRef = useRef(0);
  const disabledRef = useRef(disabled);
  const onErrorRef = useRef(onError);
  const onTranscriptChangeRef = useRef(onTranscriptChange);
  const onTranscriptSubmitRef = useRef(onTranscriptSubmit);

  useEffect(() => {
    disabledRef.current = disabled;
    onErrorRef.current = onError;
    onTranscriptChangeRef.current = onTranscriptChange;
    onTranscriptSubmitRef.current = onTranscriptSubmit;
  }, [disabled, onError, onTranscriptChange, onTranscriptSubmit]);

  const cancel = useCallback(() => {
    pressedCodesRef.current.clear();
    chordHeldRef.current = false;
    releaseRequestedRef.current = false;
    permissionRequestRef.current += 1;

    const recognition = recognitionRef.current;
    if (recognition && recognitionStartedRef.current) recognition.abort();
    else setStatus(recognition ? 'idle' : 'unavailable');
  }, []);

  const beginListening = useCallback(async () => {
    if (
      disabledRef.current ||
      chordHeldRef.current ||
      !recognitionRef.current
    ) {
      return;
    }

    chordHeldRef.current = true;
    releaseRequestedRef.current = false;
    transcriptRef.current = '';
    const permissionRequest = permissionRequestRef.current + 1;
    permissionRequestRef.current = permissionRequest;
    setStatus('requesting_permission');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();

      if (permissionRequestRef.current !== permissionRequest) return;

      if (!chordHeldRef.current || disabledRef.current) {
        setStatus('idle');
        return;
      }

      recognitionRef.current.start();
    } catch (error) {
      if (permissionRequestRef.current !== permissionRequest) return;

      chordHeldRef.current = false;
      setStatus('idle');
      onErrorRef.current(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Microphone access is required for voice input.'
          : 'TroCode could not start the microphone.',
      );
    }
  }, []);

  const finishListening = useCallback(() => {
    if (!chordHeldRef.current) return;

    chordHeldRef.current = false;

    if (!recognitionStartedRef.current || !recognitionRef.current) {
      permissionRequestRef.current += 1;
      setStatus(recognitionRef.current ? 'idle' : 'unavailable');
      return;
    }

    releaseRequestedRef.current = true;
    setStatus('processing');
    recognitionRef.current.stop();
  }, []);

  useEffect(() => {
    const SpeechRecognitionConstructor = getSpeechRecognitionConstructor();

    if (!SpeechRecognitionConstructor || platform === 'unsupported') {
      return undefined;
    }

    const recognition = new SpeechRecognitionConstructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      recognitionStartedRef.current = true;

      if (!chordHeldRef.current) {
        releaseRequestedRef.current = true;
        setStatus('processing');
        recognition.stop();
        return;
      }

      setStatus('listening');
    };

    recognition.onresult = (event) => {
      const transcript = readRecognitionTranscript(event.results).combined;
      transcriptRef.current = transcript;
      onTranscriptChangeRef.current(transcript);
    };

    recognition.onerror = (event) => {
      releaseRequestedRef.current = false;
      const message = speechRecognitionErrorMessage(event.error, platform);
      if (message) onErrorRef.current(message);
    };

    recognition.onend = () => {
      recognitionStartedRef.current = false;
      chordHeldRef.current = false;
      const shouldSubmit = releaseRequestedRef.current;
      releaseRequestedRef.current = false;
      setStatus('idle');

      const transcript = transcriptRef.current.trim();
      if (shouldSubmit && transcript.length >= 2) {
        onTranscriptSubmitRef.current(transcript);
      } else if (shouldSubmit) {
        onErrorRef.current(
          `No speech was detected. Hold ${pushToTalkShortcutName(platform)} and try again.`,
        );
      }
    };

    return () => {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [platform]);

  useEffect(() => {
    const pressedCodes = pressedCodesRef.current;

    const handleKeyDown = (event: KeyboardEvent): void => {
      pressedCodes.add(event.code);

      if (event.key === 'Escape' && chordHeldRef.current) {
        event.preventDefault();
        cancel();
        return;
      }

      if (
        event.repeat ||
        !isPushToTalkChord(platform, pressedCodes)
      ) {
        return;
      }
      event.preventDefault();
      void beginListening();
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      pressedCodes.delete(event.code);
      if (
        !chordHeldRef.current ||
        isPushToTalkChord(platform, pressedCodes)
      ) {
        return;
      }
      event.preventDefault();
      finishListening();
    };

    const handleBlur = (): void => {
      pressedCodes.clear();
      finishListening();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      pressedCodes.clear();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [beginListening, cancel, finishListening, platform]);

  return { cancel, platform, status };
}
