import { useCallback, useEffect, useRef, useState } from 'react';

import type { VoiceDiagnostic } from '../shared/contracts';

import {
  detectPushToTalkPlatform,
  isPushToTalkChord,
  parseRealtimeTranscriptionEvent,
  pushToTalkShortcutName,
  realtimeTranscriptionErrorMessage,
  type PushToTalkPlatform,
} from './push-to-talk';
import {
  closeRealtimeVoiceTransport,
  isRealtimeVoiceTransportReady,
  logRealtimeVoiceDiagnostic,
  openRealtimeVoiceTransport,
  readOutboundAudioStats,
  type OutboundAudioStats,
  type RealtimeVoiceTransport,
} from './realtime-voice-transport';

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
  attempt: number;
  audioCaptureStartedAt: number | null;
  committed: boolean;
  outboundAudioAtStart: Promise<OutboundAudioStats | null>;
  resultTimer: ReturnType<typeof setTimeout> | null;
  stream: MediaStream;
  transcript: string;
  transport: RealtimeVoiceTransport;
}

const AUDIO_COMMIT_FLUSH_MS = 150;
const MINIMUM_AUDIO_CAPTURE_MS = 250;
const TRANSCRIPT_TIMEOUT_MS = 20_000;

interface PushToTalkAttemptReadiness {
  disabled: boolean;
  enabled: boolean;
  hasActiveTurn: boolean;
  isChordHeld: boolean;
  platform: PushToTalkPlatform;
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

export function canCommitInputAudioBuffer(
  audioCaptureStartedAt: number | null,
  audioCaptureFinishedAt: number,
): boolean {
  return (
    audioCaptureStartedAt !== null &&
    audioCaptureFinishedAt - audioCaptureStartedAt >= MINIMUM_AUDIO_CAPTURE_MS
  );
}

export function hasNewOutboundAudio(
  start: OutboundAudioStats,
  end: OutboundAudioStats,
): boolean {
  return end.bytesSent > start.bytesSent && end.packetsSent > start.packetsSent;
}

function voiceTurnDiagnostic(
  event: string,
  properties: Record<string, string | number | boolean> = {},
): void {
  logRealtimeVoiceDiagnostic(`turn.${event}`, properties);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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
      voiceTurnDiagnostic('failed', {
        attempt: turn.attempt,
        message: message.slice(0, 300),
      });
      activeTurnRef.current = null;
      chordHeldRef.current = false;
      releaseVoiceTurn(turn);
      setStatus(
        !enabledRef.current
          ? 'unavailable'
          : isRealtimeVoiceTransportReady(preparedTransportRef.current)
            ? 'idle'
            : 'connecting',
      );
      onErrorRef.current(message);
    },
    [],
  );

  const handleTransportFailure = useCallback(
    (transport: RealtimeVoiceTransport): void => {
      if (preparedTransportRef.current !== transport) return;
      voiceTurnDiagnostic('transport-failed', {
        connectionState: transport.connection.connectionState,
      });
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
      const transport = await openRealtimeVoiceTransport();
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
          voiceTurnDiagnostic('provider-error', {
            attempt: turn.attempt,
            code: transcriptionEvent.code ?? 'unknown',
            message: transcriptionEvent.message.slice(0, 300),
          });
          failTurn(
            turn,
            realtimeTranscriptionErrorMessage(
              transcriptionEvent.code,
              transcriptionEvent.message,
              platform,
            ),
          );
          return;
        }

        const transcript =
          transcriptionEvent.transcript || turn.transcript.trim();
        const shouldSubmit = turn.committed && transcript.length >= 2;
        voiceTurnDiagnostic('transcript-completed', {
          attempt: turn.attempt,
          characters: transcript.length,
          committed: turn.committed,
        });
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
        voiceTurnDiagnostic('buffer-cleared', {
          attempt: turn.attempt,
          reason: 'cancelled',
        });
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
    if (!beginPushToTalkAttemptIfValid(
      {
        disabled: disabledRef.current,
        enabled: enabledRef.current,
        hasActiveTurn: activeTurnRef.current !== null,
        isChordHeld: chordHeldRef.current,
        platform,
      },
      () => onAttemptStartRef.current(),
    )) {
      return;
    }

    chordHeldRef.current = true;
    const voiceAttempt = voiceAttemptRef.current + 1;
    voiceAttemptRef.current = voiceAttempt;
    voiceTurnDiagnostic('started', { attempt: voiceAttempt, platform });
    setStatus('requesting_permission');

    let pendingStream: MediaStream | null = null;
    let pendingTurn: ActiveVoiceTurn | null = null;
    let connectionStep: VoiceConnectionStep = 'microphone';

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
      if (transportResult.status === 'rejected') {
        connectionStep = 'realtime_call';
        throw transportResult.reason;
      }

      const stream = streamResult.value;
      const transport = transportResult.value;
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        throw new Error('No microphone audio track is available.');
      }
      voiceTurnDiagnostic('microphone-ready', {
        attempt: voiceAttempt,
        enabled: audioTrack.enabled,
        muted: audioTrack.muted,
        readyState: audioTrack.readyState,
      });

      if (voiceAttemptRef.current !== voiceAttempt || !chordHeldRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      const outboundAudioAtStart = readOutboundAudioStats(transport.sender)
        .then((stats) => {
          voiceTurnDiagnostic('outbound-baseline', {
            attempt: voiceAttempt,
            bytesSent: stats.bytesSent,
            packetsSent: stats.packetsSent,
          });
          return stats;
        })
        .catch((error: unknown) => {
          voiceTurnDiagnostic('outbound-stats-unavailable', {
            attempt: voiceAttempt,
            message: voiceConnectionErrorMessage(error).slice(0, 300),
          });
          return null;
        });

      // Register the turn synchronously after the data channel opens. Awaiting
      // RTP stats here leaves a window where key-up sees no active turn and
      // incorrectly reports that voice was not ready.
      const turn: ActiveVoiceTurn = {
        attempt: voiceAttempt,
        audioCaptureStartedAt: null,
        committed: false,
        outboundAudioAtStart,
        resultTimer: null,
        stream,
        transcript: '',
        transport,
      };
      pendingTurn = turn;
      activeTurnRef.current = turn;
      connectionStep = 'peer_connection';
      await transport.sender.replaceTrack(audioTrack);

      if (
        voiceAttemptRef.current !== voiceAttempt ||
        !chordHeldRef.current ||
        activeTurnRef.current !== turn
      ) {
        if (activeTurnRef.current === turn) activeTurnRef.current = null;
        releaseVoiceTurn(turn);
        return;
      }

      turn.audioCaptureStartedAt = Date.now();
      voiceTurnDiagnostic('listening', {
        attempt: voiceAttempt,
      });
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
        !enabledRef.current
          ? 'unavailable'
          : isRealtimeVoiceTransportReady(preparedTransportRef.current)
            ? 'idle'
            : 'connecting',
      );
      voiceTurnDiagnostic('connection-error', {
        attempt: voiceAttempt,
        message: voiceConnectionErrorMessage(error).slice(0, 300),
      });
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
        !enabledRef.current
          ? 'unavailable'
          : isRealtimeVoiceTransportReady(preparedTransportRef.current)
            ? 'idle'
            : 'connecting',
      );
      onErrorRef.current(
        `Voice was still connecting when you released. Keep holding ${pushToTalkShortcutName(platform)} until “Listening…” appears, then speak and release.`,
      );
      return;
    }

    if (!canCommitInputAudioBuffer(turn.audioCaptureStartedAt, Date.now())) {
      voiceAttemptRef.current += 1;
      activeTurnRef.current = null;
      turn.transport.channel.send(
        JSON.stringify({ type: 'input_audio_buffer.clear' }),
      );
      voiceTurnDiagnostic('buffer-cleared', {
        attempt: turn.attempt,
        captureMs: Math.max(0, Date.now() - (turn.audioCaptureStartedAt ?? Date.now())),
        reason: 'capture-too-short',
      });
      releaseVoiceTurn(turn);
      setStatus(enabledRef.current ? 'idle' : 'unavailable');
      onErrorRef.current(
        `Voice input was too short. Hold ${pushToTalkShortcutName(platform)}, speak, then release.`,
      );
      return;
    }

    setStatus('processing');
    voiceTurnDiagnostic('finish-requested', {
      attempt: turn.attempt,
      captureMs: Math.max(0, Date.now() - (turn.audioCaptureStartedAt ?? Date.now())),
      channelState: turn.transport.channel.readyState,
      connectionState: turn.transport.connection.connectionState,
    });

    void (async () => {
      const start = await turn.outboundAudioAtStart;
      let outboundAudioAtEnd: OutboundAudioStats | null = null;
      try {
        outboundAudioAtEnd = await readOutboundAudioStats(
          turn.transport.sender,
        );
      } catch (error) {
        voiceTurnDiagnostic('outbound-stats-unavailable', {
          attempt: turn.attempt,
          message: voiceConnectionErrorMessage(error).slice(0, 300),
        });
      }

      if (activeTurnRef.current !== turn) return;

      const hasOutboundAudio =
        start === null ||
        outboundAudioAtEnd === null ||
        hasNewOutboundAudio(start, outboundAudioAtEnd);
      voiceTurnDiagnostic('outbound-audio', {
        attempt: turn.attempt,
        bytesSent:
          start && outboundAudioAtEnd
            ? outboundAudioAtEnd.bytesSent - start.bytesSent
            : -1,
        packetsSent:
          start && outboundAudioAtEnd
            ? outboundAudioAtEnd.packetsSent - start.packetsSent
            : -1,
        verified: hasOutboundAudio,
      });

      if (!hasOutboundAudio) {
        activeTurnRef.current = null;
        turn.transport.channel.send(
          JSON.stringify({ type: 'input_audio_buffer.clear' }),
        );
        voiceTurnDiagnostic('buffer-cleared', {
          attempt: turn.attempt,
          reason: 'no-outbound-audio',
        });
        releaseVoiceTurn(turn);
        setStatus(enabledRef.current ? 'idle' : 'unavailable');
        onErrorRef.current(
          `Microphone audio did not reach OpenAI. Hold ${pushToTalkShortcutName(platform)}, speak, then release.`,
        );
        return;
      }

      stopMicrophone(turn);
      await delay(AUDIO_COMMIT_FLUSH_MS);
      if (
        activeTurnRef.current !== turn ||
        turn.transport.channel.readyState !== 'open'
      ) {
        return;
      }

      turn.committed = true;
      turn.transport.channel.send(
        JSON.stringify({ type: 'input_audio_buffer.commit' }),
      );
      voiceTurnDiagnostic('buffer-committed', {
        attempt: turn.attempt,
        flushMs: AUDIO_COMMIT_FLUSH_MS,
      });
      turn.resultTimer = setTimeout(() => {
        failTurn(turn, 'OpenAI voice did not return a transcript in time.');
      }, TRANSCRIPT_TIMEOUT_MS);
    })().catch((error: unknown) => {
      voiceTurnDiagnostic('commit-error', {
        attempt: turn.attempt,
        message: voiceConnectionErrorMessage(error).slice(0, 300),
      });
      failTurn(turn, voiceConnectionErrorMessage(error));
    });
  }, [failTurn, platform]);

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
