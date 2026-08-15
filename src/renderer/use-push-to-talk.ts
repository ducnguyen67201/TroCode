import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  VoiceDiagnostic,
  VoiceShortcutEvent,
} from '../shared/contracts';

import {
  detectPushToTalkPlatform,
  isPushToTalkChord,
  parseRealtimeTranscriptionEvent,
  pushToTalkShortcutName,
  type PushToTalkPlatform,
} from './push-to-talk';

export type VoiceInputStatus =
  | 'connecting'
  | 'idle'
  | 'listening'
  | 'processing'
  | 'requesting_permission'
  | 'unavailable';

export type VoiceConnectionStep =
  | 'client_session'
  | 'data_channel'
  | 'microphone'
  | 'peer_connection'
  | 'realtime_call'
  | 'remote_description';

interface UsePushToTalkOptions {
  disabled?: boolean;
  enabled?: boolean;
  onAttemptStart(): void;
  onError(message: string): void;
  onTranscriptChange(transcript: string): void;
  onTranscriptSubmit(transcript: string): void;
}

interface PushToTalkState {
  cancel(): void;
  platform: PushToTalkPlatform;
  status: VoiceInputStatus;
}

interface ActiveVoiceTurn {
  channel: RTCDataChannel;
  committed: boolean;
  connection: RTCPeerConnection;
  resultTimer: ReturnType<typeof setTimeout> | null;
  stream: MediaStream;
  transcript: string;
}

const CONNECTION_TIMEOUT_MS = 12_000;
const TRANSCRIPT_TIMEOUT_MS = 20_000;

interface PushToTalkAttemptReadiness {
  disabled: boolean;
  enabled: boolean;
  hasActiveTurn: boolean;
  isChordHeld: boolean;
  platform: PushToTalkPlatform;
}

interface VoiceShortcutEventHandlers {
  beginListening(): unknown;
  finishListening(): void;
  isListening: boolean;
}

export function beginPushToTalkAttemptIfValid(
  {
    disabled,
    enabled,
    hasActiveTurn,
    isChordHeld,
    platform,
  }: PushToTalkAttemptReadiness,
  onAttemptStart: () => void,
): boolean {
  if (
    disabled ||
    !enabled ||
    platform === 'unsupported' ||
    isChordHeld ||
    hasActiveTurn
  ) {
    return false;
  }

  onAttemptStart();
  return true;
}

export function handleVoiceShortcutEvent(
  event: VoiceShortcutEvent,
  { beginListening, finishListening, isListening }: VoiceShortcutEventHandlers,
): void {
  if (event.action === 'pressed') {
    if (!isListening) beginListening();
    return;
  }

  if (event.action === 'released' && isListening) finishListening();
}

function getPushToTalkPlatform(): PushToTalkPlatform {
  if (typeof navigator === 'undefined') return 'unsupported';
  return detectPushToTalkPlatform(navigator.platform, navigator.userAgent);
}

function closeVoiceTurn(turn: ActiveVoiceTurn): void {
  if (turn.resultTimer) clearTimeout(turn.resultTimer);
  turn.resultTimer = null;
  for (const track of turn.stream.getTracks()) track.stop();
  if (turn.channel.readyState !== 'closed') turn.channel.close();
  if (turn.connection.connectionState !== 'closed') turn.connection.close();
}

function waitForDataChannelOpen(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === 'open') return Promise.resolve();

  return new Promise((resolve, reject) => {
    function cleanup(): void {
      clearTimeout(timer);
      channel.removeEventListener('open', handleOpen);
      channel.removeEventListener('close', handleClose);
      channel.removeEventListener('error', handleError);
    }
    function handleOpen(): void {
      cleanup();
      resolve();
    }
    function handleClose(): void {
      cleanup();
      reject(new Error('OpenAI closed the voice connection.'));
    }
    function handleError(): void {
      cleanup();
      reject(new Error('OpenAI voice could not establish a media connection.'));
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('OpenAI voice connection timed out.'));
    }, CONNECTION_TIMEOUT_MS);

    channel.addEventListener('open', handleOpen);
    channel.addEventListener('close', handleClose);
    channel.addEventListener('error', handleError);
  });
}

export function voiceConnectionErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone access is required for voice input.';
  }
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return 'TroCode could not reach OpenAI voice. Check network access to api.openai.com and try again.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'TroCode could not connect to OpenAI voice.';
}

export function createVoiceConnectionDiagnostic(
  step: VoiceConnectionStep,
  error: unknown,
): VoiceDiagnostic {
  return {
    error:
      error instanceof Error
        ? {
            message: error.message,
            name: error.name,
          }
        : {
            message: String(error),
          },
    step,
  };
}

export function logVoiceConnectionFailure(
  step: VoiceConnectionStep,
  error: unknown,
  logger: Pick<Console, 'error'> = console,
): void {
  logger.error(
    '[voice] OpenAI Realtime connection failed.',
    createVoiceConnectionDiagnostic(step, error),
  );
}

export function usePushToTalk({
  disabled = false,
  enabled = true,
  onAttemptStart,
  onError,
  onTranscriptChange,
  onTranscriptSubmit,
}: UsePushToTalkOptions): PushToTalkState {
  const [platform] = useState<PushToTalkPlatform>(getPushToTalkPlatform);
  const [status, setStatus] = useState<VoiceInputStatus>(() =>
    enabled && platform !== 'unsupported' ? 'idle' : 'unavailable',
  );
  const activeTurnRef = useRef<ActiveVoiceTurn | null>(null);
  const attemptRef = useRef(0);
  const pressedCodesRef = useRef(new Set<string>());
  const chordHeldRef = useRef(false);
  const disabledRef = useRef(disabled);
  const enabledRef = useRef(enabled);
  const onAttemptStartRef = useRef(onAttemptStart);
  const onErrorRef = useRef(onError);
  const onTranscriptChangeRef = useRef(onTranscriptChange);
  const onTranscriptSubmitRef = useRef(onTranscriptSubmit);

  useEffect(() => {
    disabledRef.current = disabled;
    enabledRef.current = enabled;
    onAttemptStartRef.current = onAttemptStart;
    onErrorRef.current = onError;
    onTranscriptChangeRef.current = onTranscriptChange;
    onTranscriptSubmitRef.current = onTranscriptSubmit;
  }, [
    disabled,
    enabled,
    onAttemptStart,
    onError,
    onTranscriptChange,
    onTranscriptSubmit,
  ]);

  const cancel = useCallback(() => {
    attemptRef.current += 1;
    pressedCodesRef.current.clear();
    chordHeldRef.current = false;

    const turn = activeTurnRef.current;
    activeTurnRef.current = null;
    if (turn) closeVoiceTurn(turn);

    setStatus(
      enabledRef.current && platform !== 'unsupported'
        ? 'idle'
        : 'unavailable',
    );
  }, [platform]);

  const failTurn = useCallback(
    (turn: ActiveVoiceTurn, message: string): void => {
      if (activeTurnRef.current !== turn) return;
      activeTurnRef.current = null;
      chordHeldRef.current = false;
      closeVoiceTurn(turn);
      setStatus(enabledRef.current ? 'idle' : 'unavailable');
      onErrorRef.current(message);
    },
    [],
  );

  const beginListening = useCallback(async () => {
    if (
      !beginPushToTalkAttemptIfValid(
        {
          disabled: disabledRef.current,
          enabled: enabledRef.current,
          hasActiveTurn: activeTurnRef.current !== null,
          isChordHeld: chordHeldRef.current,
          platform,
        },
        () => onAttemptStartRef.current(),
      )
    ) {
      return;
    }

    chordHeldRef.current = true;
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    setStatus('requesting_permission');

    let pendingStream: MediaStream | null = null;
    let pendingTurn: ActiveVoiceTurn | null = null;
    let connectionStep: VoiceConnectionStep = 'microphone';

    try {
      pendingStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      if (attemptRef.current !== attempt || !chordHeldRef.current) {
        for (const track of pendingStream.getTracks()) track.stop();
        return;
      }

      setStatus('connecting');
      connectionStep = 'peer_connection';
      const connection = new RTCPeerConnection();
      const channel = connection.createDataChannel('oai-events');
      const turn: ActiveVoiceTurn = {
        channel,
        committed: false,
        connection,
        resultTimer: null,
        stream: pendingStream,
        transcript: '',
      };
      pendingTurn = turn;
      activeTurnRef.current = turn;

      for (const track of pendingStream.getTracks()) {
        connection.addTrack(track, pendingStream);
      }

      channel.addEventListener('message', (event) => {
        if (activeTurnRef.current !== turn || typeof event.data !== 'string') {
          return;
        }

        const transcriptionEvent = parseRealtimeTranscriptionEvent(event.data);
        if (!transcriptionEvent) return;

        if (transcriptionEvent.type === 'delta') {
          turn.transcript += transcriptionEvent.delta;
          onTranscriptChangeRef.current(turn.transcript.trimStart());
          return;
        }

        if (transcriptionEvent.type === 'error') {
          failTurn(turn, transcriptionEvent.message);
          return;
        }

        const transcript =
          transcriptionEvent.transcript || turn.transcript.trim();
        const shouldSubmit = turn.committed && transcript.length >= 2;
        activeTurnRef.current = null;
        closeVoiceTurn(turn);
        setStatus(enabledRef.current ? 'idle' : 'unavailable');

        if (shouldSubmit) {
          onTranscriptChangeRef.current(transcript);
          onTranscriptSubmitRef.current(transcript);
        } else if (turn.committed) {
          onErrorRef.current(
            `No speech was detected. Hold ${pushToTalkShortcutName(platform)} and try again.`,
          );
        }
      });

      connection.addEventListener('connectionstatechange', () => {
        if (connection.connectionState === 'failed') {
          failTurn(turn, 'The OpenAI voice media connection failed.');
        }
      });

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      connectionStep = 'realtime_call';
      const { answerSdp } = await window.tro.createVoiceCall({
        offerSdp: offer.sdp ?? '',
      });

      connectionStep = 'remote_description';
      await connection.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });
      connectionStep = 'data_channel';
      await waitForDataChannelOpen(channel);

      if (
        attemptRef.current !== attempt ||
        !chordHeldRef.current ||
        activeTurnRef.current !== turn
      ) {
        if (activeTurnRef.current === turn) activeTurnRef.current = null;
        closeVoiceTurn(turn);
        return;
      }

      setStatus('listening');
    } catch (error) {
      const turnAlreadyHandled =
        pendingTurn !== null && activeTurnRef.current !== pendingTurn;
      if (turnAlreadyHandled) return;

      if (pendingTurn && activeTurnRef.current === pendingTurn) {
        activeTurnRef.current = null;
        closeVoiceTurn(pendingTurn);
      } else if (pendingStream) {
        for (const track of pendingStream.getTracks()) track.stop();
      }

      if (attemptRef.current !== attempt) return;
      chordHeldRef.current = false;
      setStatus(enabledRef.current ? 'idle' : 'unavailable');
      logVoiceConnectionFailure(connectionStep, error);
      void window.tro
        .reportVoiceDiagnostic(
          createVoiceConnectionDiagnostic(connectionStep, error),
        )
        .catch((diagnosticError: unknown) => {
          console.error('[voice] Failed to report voice diagnostic.', {
            error:
              diagnosticError instanceof Error
                ? {
                    message: diagnosticError.message,
                    name: diagnosticError.name,
                  }
                : {
                    message: String(diagnosticError),
                  },
          });
        });
      onErrorRef.current(voiceConnectionErrorMessage(error));
    }
  }, [failTurn, platform]);

  const finishListening = useCallback(() => {
    if (!chordHeldRef.current) return;
    chordHeldRef.current = false;

    const turn = activeTurnRef.current;
    if (!turn || turn.channel.readyState !== 'open') {
      attemptRef.current += 1;
      if (turn) {
        activeTurnRef.current = null;
        closeVoiceTurn(turn);
      }
      setStatus(enabledRef.current ? 'idle' : 'unavailable');
      onErrorRef.current(
        'Voice was still connecting. Hold the shortcut until "Listening" appears, then speak.',
      );
      return;
    }

    turn.committed = true;
    setStatus('processing');
    turn.channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    for (const track of turn.stream.getTracks()) track.stop();
    turn.resultTimer = setTimeout(() => {
      failTurn(turn, 'OpenAI voice did not return a transcript in time.');
    }, TRANSCRIPT_TIMEOUT_MS);
  }, [failTurn]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) cancel();
  }, [cancel, enabled, platform]);

  useEffect(
    () => {
      const unsubscribe = window.tro.onVoiceShortcut((event) => {
        handleVoiceShortcutEvent(event, {
          beginListening: () => void beginListening(),
          finishListening,
          isListening: chordHeldRef.current,
        });
      });

      return unsubscribe;
    },
    [beginListening, finishListening],
  );

  useEffect(() => {
    const pressedCodes = pressedCodesRef.current;

    const handleKeyDown = (event: KeyboardEvent): void => {
      pressedCodes.add(event.code);

      if (event.key === 'Escape' && chordHeldRef.current) {
        event.preventDefault();
        cancel();
        return;
      }

      if (event.repeat || !isPushToTalkChord(platform, pressedCodes)) return;
      event.preventDefault();
      void beginListening();
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      pressedCodes.delete(event.code);
      if (!chordHeldRef.current || isPushToTalkChord(platform, pressedCodes)) {
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
      cancel();
    };
  }, [beginListening, cancel, finishListening, platform]);

  const visibleStatus =
    !enabled || platform === 'unsupported'
      ? 'unavailable'
      : status === 'unavailable'
        ? 'idle'
        : status;

  return { cancel, platform, status: visibleStatus };
}
