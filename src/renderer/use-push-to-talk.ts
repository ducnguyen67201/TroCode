import { useCallback, useEffect, useRef, useState } from 'react';

import {
  detectPushToTalkPlatform,
  isPushToTalkChord,
  parseRealtimeTranscriptionEvent,
  pushToTalkShortcutName,
  type PushToTalkPlatform,
} from './push-to-talk';
import {
  closeRealtimeVoiceTransport,
  isRealtimeVoiceTransportReady,
  openRealtimeVoiceTransport,
  type RealtimeVoiceTransport,
} from './realtime-voice-transport';

export type VoiceInputStatus =
  | 'connecting'
  | 'idle'
  | 'listening'
  | 'processing'
  | 'requesting_permission'
  | 'unavailable';

interface UsePushToTalkOptions {
  disabled?: boolean;
  enabled?: boolean;
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
  committed: boolean;
  resultTimer: ReturnType<typeof setTimeout> | null;
  stream: MediaStream;
  transcript: string;
  transport: RealtimeVoiceTransport;
}

const TRANSCRIPT_TIMEOUT_MS = 20_000;

function getPushToTalkPlatform(): PushToTalkPlatform {
  if (typeof navigator === 'undefined') return 'unsupported';
  return detectPushToTalkPlatform(navigator.platform, navigator.userAgent);
}

function stopMicrophone(turn: ActiveVoiceTurn): void {
  for (const track of turn.stream.getTracks()) track.stop();
  void turn.transport.sender.replaceTrack(null).catch(() => undefined);
}

function releaseVoiceTurn(turn: ActiveVoiceTurn): void {
  if (turn.resultTimer) clearTimeout(turn.resultTimer);
  turn.resultTimer = null;
  stopMicrophone(turn);
}

function voiceConnectionErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone access is required for voice input.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'TroCode could not connect to OpenAI voice.';
}

export function usePushToTalk({
  disabled = false,
  enabled = true,
  onError,
  onTranscriptChange,
  onTranscriptSubmit,
}: UsePushToTalkOptions): PushToTalkState {
  const [platform] = useState<PushToTalkPlatform>(getPushToTalkPlatform);
  const [status, setStatus] = useState<VoiceInputStatus>(() =>
    enabled && platform !== 'unsupported' ? 'connecting' : 'unavailable',
  );
  const activeTurnRef = useRef<ActiveVoiceTurn | null>(null);
  const preparedTransportRef = useRef<RealtimeVoiceTransport | null>(null);
  const preparationPromiseRef =
    useRef<Promise<RealtimeVoiceTransport> | null>(null);
  const prepareTransportRef =
    useRef<(() => Promise<RealtimeVoiceTransport>) | null>(null);
  const preparationAttemptRef = useRef(0);
  const voiceAttemptRef = useRef(0);
  const pressedCodesRef = useRef(new Set<string>());
  const chordHeldRef = useRef(false);
  const disabledRef = useRef(disabled);
  const enabledRef = useRef(enabled);
  const onErrorRef = useRef(onError);
  const onTranscriptChangeRef = useRef(onTranscriptChange);
  const onTranscriptSubmitRef = useRef(onTranscriptSubmit);

  useEffect(() => {
    disabledRef.current = disabled;
    enabledRef.current = enabled;
    onErrorRef.current = onError;
    onTranscriptChangeRef.current = onTranscriptChange;
    onTranscriptSubmitRef.current = onTranscriptSubmit;
  }, [disabled, enabled, onError, onTranscriptChange, onTranscriptSubmit]);

  const disposePreparedTransport = useCallback(() => {
    preparationAttemptRef.current += 1;
    preparationPromiseRef.current = null;

    const transport = preparedTransportRef.current;
    preparedTransportRef.current = null;
    if (transport) closeRealtimeVoiceTransport(transport);
  }, []);

  const failTurn = useCallback(
    (turn: ActiveVoiceTurn, message: string): void => {
      if (activeTurnRef.current !== turn) return;
      activeTurnRef.current = null;
      chordHeldRef.current = false;
      releaseVoiceTurn(turn);
      setStatus(
        isRealtimeVoiceTransportReady(preparedTransportRef.current)
          ? 'idle'
          : 'unavailable',
      );
      onErrorRef.current(message);
    },
    [],
  );

  const handleTransportFailure = useCallback(
    (transport: RealtimeVoiceTransport): void => {
      if (preparedTransportRef.current !== transport) return;
      preparedTransportRef.current = null;
      closeRealtimeVoiceTransport(transport);

      const turn = activeTurnRef.current;
      if (turn?.transport === transport) {
        activeTurnRef.current = null;
        chordHeldRef.current = false;
        releaseVoiceTurn(turn);
        onErrorRef.current('The OpenAI voice media connection failed.');
      }

      if (!enabledRef.current || platform === 'unsupported') {
        setStatus('unavailable');
        return;
      }

      setStatus('connecting');
      queueMicrotask(() => {
        const prepareTransport = prepareTransportRef.current;
        if (!prepareTransport || !enabledRef.current) return;
        void prepareTransport().catch((error: unknown) => {
          if (!enabledRef.current) return;
          setStatus('unavailable');
          onErrorRef.current(voiceConnectionErrorMessage(error));
        });
      });
    },
    [platform],
  );

  const prepareTransport = useCallback(async (): Promise<RealtimeVoiceTransport> => {
    const preparedTransport = preparedTransportRef.current;
    if (isRealtimeVoiceTransportReady(preparedTransport)) {
      return preparedTransport;
    }

    const pendingPreparation = preparationPromiseRef.current;
    if (pendingPreparation) return pendingPreparation;

    if (!enabledRef.current || platform === 'unsupported') {
      throw new Error('Voice recognition is unavailable.');
    }

    const preparationAttempt = preparationAttemptRef.current + 1;
    preparationAttemptRef.current = preparationAttempt;
    setStatus('connecting');

    const promise = (async () => {
      const session = await window.tro.createVoiceSession();
      if (preparationAttemptRef.current !== preparationAttempt) {
        throw new Error('Voice connection was cancelled.');
      }

      const transport = await openRealtimeVoiceTransport(session);
      if (
        preparationAttemptRef.current !== preparationAttempt ||
        !enabledRef.current
      ) {
        closeRealtimeVoiceTransport(transport);
        throw new Error('Voice connection was cancelled.');
      }

      transport.channel.addEventListener('message', (event) => {
        const turn = activeTurnRef.current;
        if (
          !turn ||
          turn.transport !== transport ||
          typeof event.data !== 'string'
        ) {
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
        releaseVoiceTurn(turn);
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

      const reportTransportFailure = (): void => {
        handleTransportFailure(transport);
      };
      transport.channel.addEventListener('close', reportTransportFailure);
      transport.channel.addEventListener('error', reportTransportFailure);
      transport.connection.addEventListener('connectionstatechange', () => {
        if (
          transport.connection.connectionState === 'closed' ||
          transport.connection.connectionState === 'failed'
        ) {
          reportTransportFailure();
        }
      });

      preparedTransportRef.current = transport;
      setStatus(chordHeldRef.current ? 'requesting_permission' : 'idle');
      return transport;
    })();

    preparationPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      if (preparationPromiseRef.current === promise) {
        preparationPromiseRef.current = null;
      }
    }
  }, [failTurn, handleTransportFailure, platform]);

  useEffect(() => {
    prepareTransportRef.current = prepareTransport;
  }, [prepareTransport]);

  const cancel = useCallback(() => {
    voiceAttemptRef.current += 1;
    pressedCodesRef.current.clear();
    chordHeldRef.current = false;

    const turn = activeTurnRef.current;
    activeTurnRef.current = null;
    if (turn) {
      if (!turn.committed && turn.transport.channel.readyState === 'open') {
        turn.transport.channel.send(
          JSON.stringify({ type: 'input_audio_buffer.clear' }),
        );
      }
      releaseVoiceTurn(turn);
    }

    setStatus(
      !enabledRef.current || platform === 'unsupported'
        ? 'unavailable'
        : isRealtimeVoiceTransportReady(preparedTransportRef.current)
          ? 'idle'
          : 'connecting',
    );
  }, [platform]);

  const stopVoice = useCallback(() => {
    voiceAttemptRef.current += 1;
    pressedCodesRef.current.clear();
    chordHeldRef.current = false;

    const turn = activeTurnRef.current;
    activeTurnRef.current = null;
    if (turn) releaseVoiceTurn(turn);
    disposePreparedTransport();
  }, [disposePreparedTransport]);

  const shutdown = useCallback(() => {
    stopVoice();
    setStatus('unavailable');
  }, [stopVoice]);

  const beginListening = useCallback(async () => {
    if (
      disabledRef.current ||
      !enabledRef.current ||
      platform === 'unsupported' ||
      chordHeldRef.current ||
      activeTurnRef.current
    ) {
      return;
    }

    chordHeldRef.current = true;
    const voiceAttempt = voiceAttemptRef.current + 1;
    voiceAttemptRef.current = voiceAttempt;
    setStatus(
      isRealtimeVoiceTransportReady(preparedTransportRef.current)
        ? 'requesting_permission'
        : 'connecting',
    );

    let pendingStream: MediaStream | null = null;
    let pendingTurn: ActiveVoiceTurn | null = null;

    try {
      const [streamResult, transportResult] = await Promise.allSettled([
        navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true,
          },
        }),
        prepareTransport(),
      ]);
      if (streamResult.status === 'rejected') throw streamResult.reason;
      pendingStream = streamResult.value;
      if (transportResult.status === 'rejected') throw transportResult.reason;

      const stream = streamResult.value;
      const transport = transportResult.value;

      if (voiceAttemptRef.current !== voiceAttempt || !chordHeldRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      const turn: ActiveVoiceTurn = {
        committed: false,
        resultTimer: null,
        stream,
        transcript: '',
        transport,
      };
      pendingTurn = turn;
      activeTurnRef.current = turn;
      await transport.sender.replaceTrack(stream.getAudioTracks()[0] ?? null);

      if (
        voiceAttemptRef.current !== voiceAttempt ||
        !chordHeldRef.current ||
        activeTurnRef.current !== turn
      ) {
        if (activeTurnRef.current === turn) activeTurnRef.current = null;
        releaseVoiceTurn(turn);
        return;
      }

      setStatus('listening');
    } catch (error) {
      if (pendingTurn && activeTurnRef.current === pendingTurn) {
        activeTurnRef.current = null;
        releaseVoiceTurn(pendingTurn);
      } else if (pendingStream) {
        for (const track of pendingStream.getTracks()) track.stop();
      }

      if (voiceAttemptRef.current !== voiceAttempt) return;
      chordHeldRef.current = false;
      setStatus(
        isRealtimeVoiceTransportReady(preparedTransportRef.current)
          ? 'idle'
          : 'unavailable',
      );
      onErrorRef.current(voiceConnectionErrorMessage(error));
    }
  }, [platform, prepareTransport]);

  const finishListening = useCallback(() => {
    if (!chordHeldRef.current) return;
    chordHeldRef.current = false;

    const turn = activeTurnRef.current;
    if (!turn || turn.transport.channel.readyState !== 'open') {
      voiceAttemptRef.current += 1;
      if (turn) {
        activeTurnRef.current = null;
        releaseVoiceTurn(turn);
      }
      setStatus(
        isRealtimeVoiceTransportReady(preparedTransportRef.current)
          ? 'idle'
          : 'connecting',
      );
      onErrorRef.current(
        'Voice was not ready before you released. Wait for “Voice ready,” then hold the shortcut and speak.',
      );
      return;
    }

    turn.committed = true;
    setStatus('processing');
    turn.transport.channel.send(
      JSON.stringify({ type: 'input_audio_buffer.commit' }),
    );
    stopMicrophone(turn);
    turn.resultTimer = setTimeout(() => {
      failTurn(turn, 'OpenAI voice did not return a transcript in time.');
    }, TRANSCRIPT_TIMEOUT_MS);
  }, [failTurn]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled || platform === 'unsupported') {
      stopVoice();
      return;
    }

    let active = true;
    void prepareTransport().catch((error: unknown) => {
      if (!active || !enabledRef.current) return;
      setStatus('unavailable');
      onErrorRef.current(voiceConnectionErrorMessage(error));
    });

    return () => {
      active = false;
    };
  }, [enabled, platform, prepareTransport, stopVoice]);

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
      shutdown();
    };
  }, [beginListening, cancel, finishListening, platform, shutdown]);

  return {
    cancel,
    platform,
    status:
      !enabled || platform === 'unsupported' ? 'unavailable' : status,
  };
}
