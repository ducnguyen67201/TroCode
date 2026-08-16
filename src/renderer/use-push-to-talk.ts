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
  realtimeTranscriptionErrorMessage,
  type PushToTalkPlatform,
} from './push-to-talk';
import {
  closeRealtimeVoiceTransport,
  logRealtimeVoiceDiagnostic,
  readOutboundAudioStats,
  type OutboundAudioStats,
  type RealtimeVoiceTransport,
} from './realtime-voice-transport';
import { WarmRealtimeVoiceTransport } from './warm-realtime-voice-transport';

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

type VoiceTurnPhase =
  | 'idle'
  | 'listening'
  | 'microphone'
  | 'processing'
  | 'realtime_call';

type VoiceActivationMode = 'global-hold' | 'local-hold';

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
const QUEUED_RELEASE_GRACE_MS = 750;
const QUEUED_RELEASE_SETTLE_MS = 150;
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

interface LocalVoiceReleaseState {
  activationMode: VoiceActivationMode | null;
  isListening: boolean;
  isLocalChordHeld: boolean;
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

export function shouldFinishVoiceOnLocalRelease({
  activationMode,
  isListening,
  isLocalChordHeld,
}: LocalVoiceReleaseState): boolean {
  return (
    activationMode === 'local-hold' && isListening && !isLocalChordHeld
  );
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

function closeVoiceTurn(turn: ActiveVoiceTurn): void {
  if (turn.resultTimer) clearTimeout(turn.resultTimer);
  turn.resultTimer = null;
  stopMicrophone(turn);
  closeRealtimeVoiceTransport(turn.transport);
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
  const activationModeRef = useRef<VoiceActivationMode | null>(null);
  const attemptStartedAtRef = useRef<number | null>(null);
  const connectingStreamRef = useRef<MediaStream | null>(null);
  const finishListeningRef = useRef<() => void>(() => undefined);
  const queuedReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const releaseRequestedAtRef = useRef<number | null>(null);
  const voicePhaseRef = useRef<VoiceTurnPhase>('idle');
  const voiceAttemptRef = useRef(0);
  const pressedCodesRef = useRef(new Set<string>());
  const chordHeldRef = useRef(false);
  const disabledRef = useRef(disabled);
  const enabledRef = useRef(enabled);
  const onAttemptStartRef = useRef(onAttemptStart);
  const onErrorRef = useRef(onError);
  const onTranscriptChangeRef = useRef(onTranscriptChange);
  const onTranscriptSubmitRef = useRef(onTranscriptSubmit);
  const [warmTransport] = useState(
    () =>
      new WarmRealtimeVoiceTransport({
        onWarmFailure: (error) => {
          voiceTurnDiagnostic('warm-connection-failed', {
            message: voiceConnectionErrorMessage(error).slice(0, 300),
          });
        },
      }),
  );

  const clearQueuedReleaseTimer = useCallback((): void => {
    if (queuedReleaseTimerRef.current) {
      clearTimeout(queuedReleaseTimerRef.current);
    }
    queuedReleaseTimerRef.current = null;
  }, []);

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

  const failTurn = useCallback(
    (turn: ActiveVoiceTurn, message: string): void => {
      if (activeTurnRef.current !== turn) return;
      voiceTurnDiagnostic('failed', {
        attempt: turn.attempt,
        message: message.slice(0, 300),
      });
      activeTurnRef.current = null;
      activationModeRef.current = null;
      chordHeldRef.current = false;
      releaseRequestedAtRef.current = null;
      clearQueuedReleaseTimer();
      attemptStartedAtRef.current = null;
      voicePhaseRef.current = 'idle';
      closeVoiceTurn(turn);
      warmTransport.replenish();
      setStatus(enabledRef.current ? 'idle' : 'unavailable');
      onErrorRef.current(message);
    },
    [clearQueuedReleaseTimer, warmTransport],
  );

  const cancel = useCallback(() => {
    voiceAttemptRef.current += 1;
    pressedCodesRef.current.clear();
    activationModeRef.current = null;
    chordHeldRef.current = false;
    releaseRequestedAtRef.current = null;
    clearQueuedReleaseTimer();
    attemptStartedAtRef.current = null;
    voicePhaseRef.current = 'idle';

    const turn = activeTurnRef.current;
    activeTurnRef.current = null;
    const connectingStream = connectingStreamRef.current;
    connectingStreamRef.current = null;
    if (connectingStream) {
      for (const track of connectingStream.getTracks()) track.stop();
    }
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
      closeVoiceTurn(turn);
    }
    warmTransport.replenish();

    setStatus(
      enabledRef.current && platform !== 'unsupported'
        ? 'idle'
        : 'unavailable',
    );
  }, [clearQueuedReleaseTimer, platform, warmTransport]);

  const stopVoice = useCallback(() => {
    voiceAttemptRef.current += 1;
    pressedCodesRef.current.clear();
    activationModeRef.current = null;
    chordHeldRef.current = false;
    releaseRequestedAtRef.current = null;
    clearQueuedReleaseTimer();
    attemptStartedAtRef.current = null;
    voicePhaseRef.current = 'idle';

    const turn = activeTurnRef.current;
    activeTurnRef.current = null;
    const connectingStream = connectingStreamRef.current;
    connectingStreamRef.current = null;
    if (connectingStream) {
      for (const track of connectingStream.getTracks()) track.stop();
    }
    if (turn) closeVoiceTurn(turn);
  }, [clearQueuedReleaseTimer]);

  const shutdown = useCallback(() => {
    warmTransport.stop();
    stopVoice();
    setStatus('unavailable');
  }, [stopVoice, warmTransport]);

  const beginListening = useCallback(async (
    activationMode: VoiceActivationMode = 'local-hold',
  ) => {
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

    activationModeRef.current = activationMode;
    chordHeldRef.current = true;
    releaseRequestedAtRef.current = null;
    clearQueuedReleaseTimer();
    const voiceAttempt = voiceAttemptRef.current + 1;
    voiceAttemptRef.current = voiceAttempt;
    attemptStartedAtRef.current = Date.now();
    voicePhaseRef.current = 'microphone';
    voiceTurnDiagnostic('started', { attempt: voiceAttempt, platform });
    setStatus('requesting_permission');

    let pendingStream: MediaStream | null = null;
    let pendingTransport: RealtimeVoiceTransport | null = null;
    let pendingTurn: ActiveVoiceTurn | null = null;
    let connectionStep: VoiceConnectionStep = 'microphone';
    let microphoneCaptureStartedAt: number | null = null;

    try {
      pendingStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      const stream = pendingStream;
      connectingStreamRef.current = stream;
      microphoneCaptureStartedAt = Date.now();
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
        if (connectingStreamRef.current === stream) {
          connectingStreamRef.current = null;
        }
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      setStatus('connecting');
      connectionStep = 'realtime_call';
      voicePhaseRef.current = 'realtime_call';
      const transport = await warmTransport.take();
      pendingTransport = transport;

      if (voiceAttemptRef.current !== voiceAttempt || !chordHeldRef.current) {
        if (connectingStreamRef.current === stream) {
          connectingStreamRef.current = null;
        }
        closeRealtimeVoiceTransport(transport);
        warmTransport.replenish();
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      connectionStep = 'peer_connection';
      await transport.sender.replaceTrack(audioTrack);

      clearQueuedReleaseTimer();
      const releaseWasQueued = releaseRequestedAtRef.current !== null;
      const outboundAudioAtStart = releaseWasQueued
        ? Promise.resolve({ bytesSent: 0, packetsSent: 0 })
        : readOutboundAudioStats(transport.sender)
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
      if (releaseWasQueued) {
        voiceTurnDiagnostic('outbound-baseline', {
          attempt: voiceAttempt,
          bytesSent: 0,
          packetsSent: 0,
          queuedRelease: true,
        });
      }

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
      if (connectingStreamRef.current === stream) {
        connectingStreamRef.current = null;
      }
      pendingTransport = null;

      transport.channel.addEventListener('message', (event) => {
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
        activationModeRef.current = null;
        chordHeldRef.current = false;
        releaseRequestedAtRef.current = null;
        clearQueuedReleaseTimer();
        attemptStartedAtRef.current = null;
        voicePhaseRef.current = 'idle';
        closeVoiceTurn(turn);
        warmTransport.replenish();
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
        if (activeTurnRef.current !== turn) return;
        voiceTurnDiagnostic('transport-failed', {
          attempt: turn.attempt,
          connectionState: transport.connection.connectionState,
        });
        failTurn(turn, 'The OpenAI voice media connection failed.');
      };
      transport.channel.addEventListener('close', reportTransportFailure);
      transport.channel.addEventListener('error', reportTransportFailure);
      transport.connection.addEventListener('connectionstatechange', () => {
        if (transport.connection.connectionState === 'failed') {
          reportTransportFailure();
        }
      });

      turn.audioCaptureStartedAt = releaseWasQueued
        ? microphoneCaptureStartedAt
        : Date.now();
      voicePhaseRef.current = 'listening';
      voiceTurnDiagnostic('listening', {
        attempt: voiceAttempt,
      });
      setStatus('listening');
      if (releaseWasQueued) {
        voiceTurnDiagnostic('queued-release-settling', {
          attempt: voiceAttempt,
          settleMs: QUEUED_RELEASE_SETTLE_MS,
        });
        await delay(QUEUED_RELEASE_SETTLE_MS);
        if (
          activeTurnRef.current === turn &&
          releaseRequestedAtRef.current !== null
        ) {
          finishListeningRef.current();
        }
      }
    } catch (error) {
      if (pendingTurn && activeTurnRef.current === pendingTurn) {
        activeTurnRef.current = null;
        closeVoiceTurn(pendingTurn);
      } else {
        if (pendingTransport) closeRealtimeVoiceTransport(pendingTransport);
        if (pendingStream) {
          for (const track of pendingStream.getTracks()) track.stop();
        }
      }
      warmTransport.replenish();

      if (voiceAttemptRef.current !== voiceAttempt) return;
      if (connectingStreamRef.current === pendingStream) {
        connectingStreamRef.current = null;
      }
      activationModeRef.current = null;
      chordHeldRef.current = false;
      releaseRequestedAtRef.current = null;
      clearQueuedReleaseTimer();
      attemptStartedAtRef.current = null;
      voicePhaseRef.current = 'idle';
      setStatus(enabledRef.current ? 'idle' : 'unavailable');
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
  }, [clearQueuedReleaseTimer, failTurn, platform, warmTransport]);

  const finishListening = useCallback(() => {
    if (!chordHeldRef.current) return;
    const releasedAt = Date.now();
    const heldMs = Math.max(
      0,
      releasedAt - (attemptStartedAtRef.current ?? releasedAt),
    );
    const phase = voicePhaseRef.current;

    const turn = activeTurnRef.current;
    voiceTurnDiagnostic('release-requested', {
      attempt: voiceAttemptRef.current,
      hasActiveTurn: Boolean(turn),
      heldMs,
      phase,
    });
    if (!turn && phase === 'realtime_call') {
      activationModeRef.current = null;
      releaseRequestedAtRef.current = releasedAt;
      clearQueuedReleaseTimer();
      voiceTurnDiagnostic('release-queued', {
        attempt: voiceAttemptRef.current,
        heldMs,
        phase,
      });

      const queuedAttempt = voiceAttemptRef.current;
      queuedReleaseTimerRef.current = setTimeout(() => {
        if (
          voiceAttemptRef.current !== queuedAttempt ||
          releaseRequestedAtRef.current !== releasedAt ||
          activeTurnRef.current
        ) {
          return;
        }

        voiceTurnDiagnostic('release-queue-timeout', {
          attempt: queuedAttempt,
          graceMs: QUEUED_RELEASE_GRACE_MS,
        });
        voiceAttemptRef.current += 1;
        activationModeRef.current = null;
        chordHeldRef.current = false;
        releaseRequestedAtRef.current = null;
        attemptStartedAtRef.current = null;
        voicePhaseRef.current = 'idle';
        const connectingStream = connectingStreamRef.current;
        connectingStreamRef.current = null;
        if (connectingStream) {
          for (const track of connectingStream.getTracks()) track.stop();
        }
        queuedReleaseTimerRef.current = null;
        setStatus(enabledRef.current ? 'idle' : 'unavailable');
        onErrorRef.current(
          'Voice did not finish connecting in time. Try the shortcut again.',
        );
      }, QUEUED_RELEASE_GRACE_MS);
      return;
    }

    activationModeRef.current = null;
    chordHeldRef.current = false;
    releaseRequestedAtRef.current = null;
    clearQueuedReleaseTimer();

    if (!turn || turn.transport.channel.readyState !== 'open') {
      voiceTurnDiagnostic('release-before-listening', {
        attempt: voiceAttemptRef.current,
        heldMs,
        phase,
      });
      voiceAttemptRef.current += 1;
      attemptStartedAtRef.current = null;
      voicePhaseRef.current = 'idle';
      if (turn) {
        activeTurnRef.current = null;
        closeVoiceTurn(turn);
        warmTransport.replenish();
      }
      setStatus(enabledRef.current ? 'idle' : 'unavailable');
      onErrorRef.current(
        `Voice was still connecting when you released. Keep holding ${pushToTalkShortcutName(platform)} until “Listening…” appears, then speak and release.`,
      );
      return;
    }

    if (!canCommitInputAudioBuffer(turn.audioCaptureStartedAt, Date.now())) {
      voiceAttemptRef.current += 1;
      attemptStartedAtRef.current = null;
      voicePhaseRef.current = 'idle';
      activeTurnRef.current = null;
      turn.transport.channel.send(
        JSON.stringify({ type: 'input_audio_buffer.clear' }),
      );
      voiceTurnDiagnostic('buffer-cleared', {
        attempt: turn.attempt,
        captureMs: Math.max(0, Date.now() - (turn.audioCaptureStartedAt ?? Date.now())),
        reason: 'capture-too-short',
      });
      closeVoiceTurn(turn);
      warmTransport.replenish();
      setStatus(enabledRef.current ? 'idle' : 'unavailable');
      onErrorRef.current(
        `Voice input was too short. Hold ${pushToTalkShortcutName(platform)}, speak, then release.`,
      );
      return;
    }

    setStatus('processing');
    voicePhaseRef.current = 'processing';
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
        attemptStartedAtRef.current = null;
        voicePhaseRef.current = 'idle';
        turn.transport.channel.send(
          JSON.stringify({ type: 'input_audio_buffer.clear' }),
        );
        voiceTurnDiagnostic('buffer-cleared', {
          attempt: turn.attempt,
          reason: 'no-outbound-audio',
        });
        closeVoiceTurn(turn);
        warmTransport.replenish();
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
      warmTransport.replenish();
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
  }, [clearQueuedReleaseTimer, failTurn, platform, warmTransport]);

  useEffect(() => {
    finishListeningRef.current = finishListening;
  }, [finishListening]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (enabled && platform !== 'unsupported') {
      warmTransport.start();
      return;
    }

    warmTransport.stop();
    stopVoice();
  }, [enabled, platform, stopVoice, warmTransport]);

  useEffect(
    () => {
      const unsubscribe = window.tro.onVoiceShortcut((event) => {
        handleVoiceShortcutEvent(event, {
          beginListening: () =>
            void beginListening('global-hold'),
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
      void beginListening('local-hold');
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      pressedCodes.delete(event.code);
      if (!shouldFinishVoiceOnLocalRelease({
        activationMode: activationModeRef.current,
        isListening: chordHeldRef.current,
        isLocalChordHeld: isPushToTalkChord(platform, pressedCodes),
      })) {
        return;
      }
      event.preventDefault();
      finishListening();
    };

    const handleBlur = (): void => {
      pressedCodes.clear();
      if (activationModeRef.current === 'local-hold') finishListening();
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
