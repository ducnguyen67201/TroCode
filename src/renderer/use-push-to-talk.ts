import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  VoiceDiagnostic,
  VoiceShortcutEvent,
} from '../shared/contracts';

import { detectPushToTalkPlatform, isPushToTalkChord, pushToTalkShortcutName, type PushToTalkPlatform } from './push-to-talk';
import { openVoiceCapture, type VoiceCapturePipeline } from './voice-capture';
import {
  encodePcm16Wav,
  OrderedTranscriptAssembler,
  SegmentUploadQueue,
  VoiceSegmenter,
  type FinalizedVoiceSegment,
} from './voice-segmentation';

export type VoiceInputStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'requesting_permission'
  | 'unavailable';

export type VoiceConnectionStep = VoiceDiagnostic['step'];
type VoiceActivationMode = 'global-hold' | 'local-hold';

export const VOICE_TRANSCRIPT_CONFIRMATION_MS = 1_000;

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
  isHolding: boolean;
  platform: PushToTalkPlatform;
  status: VoiceInputStatus;
}

interface ActiveVoiceTurn {
  abortController: AbortController;
  activationMode: VoiceActivationMode;
  assembler: OrderedTranscriptAssembler;
  attempt: number;
  cancelled: boolean;
  capture: VoiceCapturePipeline | null;
  confirmationTimer: ReturnType<typeof setTimeout> | null;
  expectedSegmentCount: number | null;
  limitReached: boolean;
  queue: SegmentUploadQueue<FinalizedVoiceSegment, void>;
  released: boolean;
  releasedAt: number | null;
  segmentCount: number;
  segmenter: VoiceSegmenter;
  submitted: boolean;
  utteranceId: string;
}

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
  return activationMode === 'local-hold' && isListening && !isLocalChordHeld;
}

export function shouldMuteSystemAudioForVoice(
  enabled: boolean,
  isHolding: boolean,
): boolean {
  return enabled && isHolding;
}

function getPushToTalkPlatform(): PushToTalkPlatform {
  if (typeof navigator === 'undefined') return 'unsupported';
  return detectPushToTalkPlatform(navigator.platform, navigator.userAgent);
}

export function voiceConnectionErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone access is required for voice input.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'TroCode could not transcribe voice input.';
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function voiceTurnDiagnostic(
  event: string,
  properties: Record<string, string | number | boolean> = {},
): void {
  const details =
    Object.keys(properties).length > 0 ? ` ${JSON.stringify(properties)}` : '';
  console.info(`[voice:renderer] turn.${event}${details}`);
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
  const [isHolding, setIsHolding] = useState(false);
  const activeTurnRef = useRef<ActiveVoiceTurn | null>(null);
  const activationModeRef = useRef<VoiceActivationMode | null>(null);
  const attemptRef = useRef(0);
  const chordHeldRef = useRef(false);
  const disabledRef = useRef(disabled);
  const enabledRef = useRef(enabled);
  const pressedCodesRef = useRef(new Set<string>());
  const onAttemptStartRef = useRef(onAttemptStart);
  const onErrorRef = useRef(onError);
  const onTranscriptChangeRef = useRef(onTranscriptChange);
  const onTranscriptSubmitRef = useRef(onTranscriptSubmit);
  const finishListeningRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    disabledRef.current = disabled;
    enabledRef.current = enabled;
    onAttemptStartRef.current = onAttemptStart;
    onErrorRef.current = onError;
    onTranscriptChangeRef.current = onTranscriptChange;
    onTranscriptSubmitRef.current = onTranscriptSubmit;
  }, [disabled, enabled, onAttemptStart, onError, onTranscriptChange, onTranscriptSubmit]);

  const closeTurn = useCallback(async (turn: ActiveVoiceTurn): Promise<void> => {
    turn.abortController.abort();
    const capture = turn.capture;
    turn.capture = null;
    await capture?.stop();
  }, []);

  const resetTurnState = useCallback((turn: ActiveVoiceTurn): void => {
    if (turn.confirmationTimer) clearTimeout(turn.confirmationTimer);
    turn.confirmationTimer = null;
    if (activeTurnRef.current === turn) activeTurnRef.current = null;
    activationModeRef.current = null;
    chordHeldRef.current = false;
    pressedCodesRef.current.clear();
    setIsHolding(false);
    setStatus(
      enabledRef.current &&
        !disabledRef.current &&
        platform !== 'unsupported'
        ? 'idle'
        : 'unavailable',
    );
  }, [platform]);

  const maybeFinishTurn = useCallback(
    (turn: ActiveVoiceTurn): void => {
      if (
        activeTurnRef.current !== turn ||
        turn.cancelled ||
        !turn.released ||
        turn.expectedSegmentCount === null ||
        turn.assembler.outcomes.size < turn.expectedSegmentCount ||
        turn.submitted
      ) {
        return;
      }

      turn.submitted = true;
      const transcript = turn.assembler.completeTranscript(
        turn.expectedSegmentCount,
      );
      const provisional = turn.assembler.provisionalTranscript();
      const releaseToFinalMs = Math.max(
        0,
        Date.now() - (turn.releasedAt ?? Date.now()),
      );
      if (turn.expectedSegmentCount === 0) {
        resetTurnState(turn);
        void closeTurn(turn);
        voiceTurnDiagnostic('completed', {
          attempt: turn.attempt,
          disposition: 'no_speech',
          releaseToFinalMs,
          segmentCount: 0,
        });
        onErrorRef.current(
          `No speech was detected. Hold ${pushToTalkShortcutName(platform)} and try again.`,
        );
        return;
      }
      if (transcript === null) {
        resetTurnState(turn);
        void closeTurn(turn);
        voiceTurnDiagnostic('completed', {
          attempt: turn.attempt,
          disposition: 'partial_failure',
          releaseToFinalMs,
          segmentCount: turn.expectedSegmentCount,
        });
        if (provisional) onTranscriptChangeRef.current(provisional);
        onErrorRef.current(
          'A part of this recording could not be transcribed. Review it or record again.',
        );
        return;
      }
      if (transcript.trim().length < 2) {
        resetTurnState(turn);
        void closeTurn(turn);
        voiceTurnDiagnostic('completed', {
          attempt: turn.attempt,
          disposition: 'no_speech',
          releaseToFinalMs,
          segmentCount: turn.expectedSegmentCount,
        });
        onErrorRef.current(
          `No speech was detected. Hold ${pushToTalkShortcutName(platform)} and try again.`,
        );
        return;
      }

      voiceTurnDiagnostic('transcript-ready', {
        attempt: turn.attempt,
        characters: transcript.length,
        confirmationMs: VOICE_TRANSCRIPT_CONFIRMATION_MS,
        releaseToFinalMs,
        segmentCount: turn.expectedSegmentCount,
      });
      onTranscriptChangeRef.current(transcript);
      turn.confirmationTimer = setTimeout(() => {
        if (activeTurnRef.current !== turn || turn.cancelled) return;
        resetTurnState(turn);
        void closeTurn(turn);
        voiceTurnDiagnostic('completed', {
          attempt: turn.attempt,
          characters: transcript.length,
          disposition: 'submitted',
          releaseToFinalMs,
          segmentCount: turn.expectedSegmentCount ?? 0,
        });
        onTranscriptSubmitRef.current(transcript);
      }, VOICE_TRANSCRIPT_CONFIRMATION_MS);
    },
    [closeTurn, platform, resetTurnState],
  );

  const dispatchSegment = useCallback(
    (turn: ActiveVoiceTurn, segment: FinalizedVoiceSegment): void => {
      turn.segmentCount += 1;
      voiceTurnDiagnostic('segment-finalized', {
        boundary: segment.boundary,
        durationMs: Math.round(segment.durationMs),
        overlap: segment.overlapWithPrevious,
        sequence: segment.sequence,
      });
      void turn.queue.enqueue(segment).catch(() => undefined);
    },
    [],
  );

  const cancel = useCallback(() => {
    attemptRef.current += 1;
    const turn = activeTurnRef.current;
    if (turn) {
      turn.cancelled = true;
      voiceTurnDiagnostic('completed', {
        attempt: turn.attempt,
        disposition: 'cancelled',
        segmentCount: turn.segmentCount,
      });
      turn.queue.cancelPending();
      resetTurnState(turn);
      void closeTurn(turn);
      onTranscriptChangeRef.current('');
    } else {
      activationModeRef.current = null;
      chordHeldRef.current = false;
      pressedCodesRef.current.clear();
      setIsHolding(false);
      setStatus(
        enabledRef.current &&
          !disabledRef.current &&
          platform !== 'unsupported'
          ? 'idle'
          : 'unavailable',
      );
    }
  }, [closeTurn, platform, resetTurnState]);

  const beginListening = useCallback(
    async (activationMode: VoiceActivationMode = 'local-hold') => {
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

      const attempt = attemptRef.current + 1;
      attemptRef.current = attempt;
      const abortController = new AbortController();
      const assembler = new OrderedTranscriptAssembler();
      const segmenter = new VoiceSegmenter();
      const turn = {} as ActiveVoiceTurn;
      const queue = new SegmentUploadQueue<FinalizedVoiceSegment, void>(
        async (segment) => {
          let encoded;
          try {
            encoded = encodePcm16Wav(segment.samples, segment.sampleRate);
          } catch (error) {
            if (activeTurnRef.current === turn && !turn.cancelled) {
              assembler.addFailure(
                segment.sequence,
                error instanceof Error ? error : new Error(String(error)),
              );
              logVoiceConnectionFailure('audio_encode', error);
              void window.tro
                .reportVoiceDiagnostic(
                  createVoiceConnectionDiagnostic('audio_encode', error),
                )
                .catch(() => undefined);
              if (turn.released) maybeFinishTurn(turn);
            }
            return;
          }

          const segmentStartedAt = Date.now();
          const requestId = crypto.randomUUID();
          voiceTurnDiagnostic('segment-dispatched', {
            byteCount: encoded.bytes.byteLength,
            durationMs: Math.round(encoded.durationMs),
            requestId,
            sequence: segment.sequence,
          });
          try {
            const result = await window.tro.transcribeVoiceSegment({
              audioBase64: bytesToBase64(encoded.bytes),
              durationMs: Math.round(encoded.durationMs),
              requestId,
              sequence: segment.sequence,
              utteranceId: turn.utteranceId,
            });
            if (activeTurnRef.current !== turn || turn.cancelled) return;
            voiceTurnDiagnostic('segment-completed', {
              billedSeconds: result.billedSeconds,
              latencyMs: Date.now() - segmentStartedAt,
              requestId,
              sequence: segment.sequence,
            });
            assembler.addSuccess({
              overlapWithPrevious: segment.overlapWithPrevious,
              sequence: result.sequence,
              text: result.text,
            });
            const provisional = assembler.provisionalTranscript();
            if (provisional) onTranscriptChangeRef.current(provisional);
            if (turn.released) maybeFinishTurn(turn);
          } catch (error) {
            if (activeTurnRef.current !== turn || turn.cancelled) return;
            voiceTurnDiagnostic('segment-uncertain', {
              latencyMs: Date.now() - segmentStartedAt,
              requestId,
              sequence: segment.sequence,
            });
            assembler.addFailure(
              segment.sequence,
              error instanceof Error ? error : new Error(String(error)),
            );
            logVoiceConnectionFailure('segment_upload', error);
            void window.tro
              .reportVoiceDiagnostic(
                createVoiceConnectionDiagnostic('segment_upload', error),
              )
              .catch(() => undefined);
            if (turn.released) maybeFinishTurn(turn);
          }
        },
      );
      Object.assign(turn, {
        abortController,
        activationMode,
        assembler,
        attempt,
        cancelled: false,
        capture: null,
        confirmationTimer: null,
        expectedSegmentCount: null,
        limitReached: false,
        queue,
        released: false,
        releasedAt: null,
        segmentCount: 0,
        segmenter,
        submitted: false,
        utteranceId: crypto.randomUUID(),
      } satisfies ActiveVoiceTurn);
      activeTurnRef.current = turn;
      activationModeRef.current = activationMode;
      chordHeldRef.current = true;
      setIsHolding(true);
      setStatus('requesting_permission');
      voiceTurnDiagnostic('started', { attempt, platform });

      try {
        const capture = await openVoiceCapture({
          onFrame: (frame) => {
            if (activeTurnRef.current !== turn || turn.cancelled || turn.released) {
              return;
            }
            const update = segmenter.push(frame);
            for (const segment of update.segments) dispatchSegment(turn, segment);
            if (update.limitReached && !turn.limitReached) {
              turn.limitReached = true;
              void turn.capture?.stop();
              turn.capture = null;
              onErrorRef.current(
                'Voice input reached 60 seconds. Release the shortcut to finish.',
              );
            }
          },
          signal: abortController.signal,
        });
        if (activeTurnRef.current !== turn || turn.cancelled || turn.released) {
          await capture.stop();
          return;
        }
        turn.capture = capture;
        setStatus('listening');
        voiceTurnDiagnostic('listening', { attempt });
      } catch (error) {
        if (turn.cancelled || abortController.signal.aborted) return;
        resetTurnState(turn);
        void closeTurn(turn);
        logVoiceConnectionFailure('microphone', error);
        void window.tro
          .reportVoiceDiagnostic(
            createVoiceConnectionDiagnostic('microphone', error),
          )
          .catch(() => undefined);
        onErrorRef.current(voiceConnectionErrorMessage(error));
      }
    },
    [closeTurn, dispatchSegment, maybeFinishTurn, platform, resetTurnState],
  );

  const finishListening = useCallback((): void => {
    const turn = activeTurnRef.current;
    if (!turn || turn.cancelled || turn.released) return;
    turn.released = true;
    turn.releasedAt = Date.now();
    chordHeldRef.current = false;
    setIsHolding(false);
    setStatus('processing');
    const capture = turn.capture;
    turn.capture = null;
    void capture?.stop();
    turn.abortController.abort();
    const finalUpdate = turn.segmenter.finish();
    for (const segment of finalUpdate.segments) dispatchSegment(turn, segment);
    turn.expectedSegmentCount = turn.segmentCount;
    voiceTurnDiagnostic('released', {
      attempt: turn.attempt,
      segmentCount: turn.expectedSegmentCount,
    });
    maybeFinishTurn(turn);
  }, [dispatchSegment, maybeFinishTurn]);

  useEffect(() => {
    finishListeningRef.current = finishListening;
  }, [finishListening]);

  useEffect(() => {
    if (!enabled || disabled || platform === 'unsupported') {
      cancel();
      return;
    }
    if (activeTurnRef.current) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && !activeTurnRef.current) setStatus('idle');
    });
    return () => {
      cancelled = true;
    };
  }, [cancel, disabled, enabled, platform]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && activeTurnRef.current) {
        cancel();
        return;
      }
      if (event.repeat) return;
      pressedCodesRef.current.add(event.code);
      const isChordHeld = isPushToTalkChord(platform, pressedCodesRef.current);
      if (isChordHeld && !chordHeldRef.current) {
        void beginListening('local-hold');
      }
    };
    const handleKeyUp = (event: KeyboardEvent): void => {
      pressedCodesRef.current.delete(event.code);
      const isChordHeld = isPushToTalkChord(platform, pressedCodesRef.current);
      if (
        shouldFinishVoiceOnLocalRelease({
          activationMode: activationModeRef.current,
          isListening: Boolean(activeTurnRef.current),
          isLocalChordHeld: isChordHeld,
        })
      ) {
        finishListeningRef.current();
      }
    };
    const handleBlur = (): void => {
      if (activeTurnRef.current) cancel();
      pressedCodesRef.current.clear();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [beginListening, cancel, platform]);

  useEffect(() =>
    window.tro.onVoiceShortcut((event) => {
      handleVoiceShortcutEvent(event, {
        beginListening: () => beginListening('global-hold'),
        finishListening: () => finishListeningRef.current(),
        isListening: Boolean(activeTurnRef.current),
      });
    }),
  [beginListening]);

  useEffect(
    () => () => {
      const turn = activeTurnRef.current;
      if (!turn) return;
      turn.cancelled = true;
      turn.queue.cancelPending();
      turn.abortController.abort();
      void turn.capture?.stop();
      activeTurnRef.current = null;
    },
    [],
  );

  return { cancel, isHolding, platform, status };
}
