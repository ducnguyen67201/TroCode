import { useCallback, useEffect, useRef, useState } from 'react';

import type { VoiceMode } from '../shared/contracts';

import { useVoiceShortcuts } from './features/voice/use-voice-shortcuts';
import { useVoiceTurnCompletion } from './features/voice/use-voice-turn-completion';
import {
  bytesToBase64,
  createVoiceConnectionDiagnostic,
  logVoiceConnectionFailure,
  voiceConnectionErrorMessage,
  voiceTurnDiagnostic,
} from './features/voice/voice-diagnostics';
import {
  beginPushToTalkAttemptIfValid,
  getPushToTalkPlatform,
  shouldCancelVoiceTurnForAvailability,
} from './features/voice/voice-input-policy';
import type {
  ActiveVoiceTurn,
  PushToTalkState,
  UsePushToTalkOptions,
  VoiceActivationMode,
  VoiceInputStatus,
  VoiceTurnContext,
  VoiceTurnEndReason,
} from './features/voice/voice-input-types';
import { type PushToTalkPlatform } from './push-to-talk';
import { openVoiceCapture } from './voice-capture';
import {
  encodePcm16Wav,
  type FinalizedVoiceSegment,
  normalizeVoiceSamples,
  OrderedTranscriptAssembler,
  SegmentUploadQueue,
  VoiceSegmenter,
} from './voice-segmentation';

export function usePushToTalk({
  disabled = false,
  enabled = true,
  onAttemptStart,
  onError,
  onTranscriptChange,
  onTranscriptReady,
  onTurnEnd,
  selectedMode,
}: UsePushToTalkOptions): PushToTalkState {
  const [platform] = useState<PushToTalkPlatform>(getPushToTalkPlatform);
  const [status, setStatus] = useState<VoiceInputStatus>(() =>
    enabled && platform !== 'unsupported' ? 'idle' : 'unavailable',
  );
  const [isHolding, setIsHolding] = useState(false);
  const [mode, setMode] = useState<VoiceMode | null>(null);
  const activeTurnRef = useRef<ActiveVoiceTurn | null>(null);
  const activationModeRef = useRef<VoiceActivationMode | null>(null);
  const attemptRef = useRef(0);
  const chordHeldRef = useRef(false);
  const disabledRef = useRef(disabled);
  const enabledRef = useRef(enabled);
  const onAttemptStartRef = useRef(onAttemptStart);
  const onErrorRef = useRef(onError);
  const onTranscriptChangeRef = useRef(onTranscriptChange);
  const onTranscriptReadyRef = useRef(onTranscriptReady);
  const onTurnEndRef = useRef(onTurnEnd);
  const selectedModeRef = useRef(selectedMode);

  useEffect(() => {
    disabledRef.current = disabled;
    enabledRef.current = enabled;
    onAttemptStartRef.current = onAttemptStart;
    onErrorRef.current = onError;
    onTranscriptChangeRef.current = onTranscriptChange;
    onTranscriptReadyRef.current = onTranscriptReady;
    onTurnEndRef.current = onTurnEnd;
    selectedModeRef.current = selectedMode;
  }, [
    disabled,
    enabled,
    onAttemptStart,
    onError,
    onTranscriptChange,
    onTranscriptReady,
    onTurnEnd,
    selectedMode,
  ]);

  const notifyTurnEnd = useCallback(
    (turn: ActiveVoiceTurn, reason: VoiceTurnEndReason): void => {
      if (turn.endNotified) return;
      turn.endNotified = true;
      onTurnEndRef.current(turn.context, reason);
    },
    [],
  );

  const closeTurn = useCallback(
    async (turn: ActiveVoiceTurn): Promise<void> => {
      turn.abortController.abort();
      const capture = turn.capture;
      turn.capture = null;
      await capture?.stop().catch(() => undefined);
    },
    [],
  );

  const resetTurnState = useCallback(
    (turn: ActiveVoiceTurn): void => {
      if (activeTurnRef.current === turn) activeTurnRef.current = null;
      activationModeRef.current = null;
      chordHeldRef.current = false;
      setIsHolding(false);
      setMode(null);
      setStatus(
        enabledRef.current && !disabledRef.current && platform !== 'unsupported'
          ? 'idle'
          : 'unavailable',
      );
    },
    [platform],
  );

  const finishTerminalTurn = useCallback(
    (turn: ActiveVoiceTurn, reason: VoiceTurnEndReason): void => {
      resetTurnState(turn);
      void closeTurn(turn);
      notifyTurnEnd(turn, reason);
    },
    [closeTurn, notifyTurnEnd, resetTurnState],
  );
  const { maybeFinishTurn } = useVoiceTurnCompletion({
    activeTurnRef,
    setStatus,
    onTranscriptReadyRef,
    finishTerminalTurn,
    onErrorRef,
    platform,
    onTranscriptChangeRef,
  });

  const dispatchSegment = useCallback(
    (turn: ActiveVoiceTurn, segment: FinalizedVoiceSegment): void => {
      turn.segmentCount += 1;
      voiceTurnDiagnostic('segment-finalized', {
        boundary: segment.boundary,
        durationMs: Math.round(segment.durationMs),
        mode: turn.context.mode,
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
        activation: turn.context.activation,
        attempt: turn.attempt,
        disposition: 'cancelled',
        mode: turn.context.mode,
        segmentCount: turn.segmentCount,
      });
      turn.queue.cancelPending();
      finishTerminalTurn(turn, 'cancelled');
      return;
    }
    activationModeRef.current = null;
    chordHeldRef.current = false;
    setIsHolding(false);
    setMode(null);
    setStatus(
      enabledRef.current && !disabledRef.current && platform !== 'unsupported'
        ? 'idle'
        : 'unavailable',
    );
  }, [finishTerminalTurn, platform]);

  const beginListening = useCallback(
    async (
      activation: VoiceActivationMode = 'local_hold',
      voiceMode: VoiceMode = 'dictation',
    ) => {
      if (
        !beginPushToTalkAttemptIfValid(
          {
            disabled: disabledRef.current,
            enabled: enabledRef.current,
            hasActiveTurn: activeTurnRef.current !== null,
            isChordHeld: chordHeldRef.current,
            platform,
          },
          () => undefined,
        )
      ) {
        return;
      }

      const attempt = attemptRef.current + 1;
      attemptRef.current = attempt;
      const abortController = new AbortController();
      const assembler = new OrderedTranscriptAssembler();
      const segmenter = new VoiceSegmenter();
      const context: VoiceTurnContext = {
        activation,
        mode: voiceMode,
        turnId: crypto.randomUUID(),
      };
      const turn = {} as ActiveVoiceTurn;
      const queue = new SegmentUploadQueue<FinalizedVoiceSegment, void>(
        async (segment) => {
          let encoded;
          try {
            const normalized = normalizeVoiceSamples(segment.samples);
            encoded = encodePcm16Wav(normalized.samples, segment.sampleRate);
            voiceTurnDiagnostic('segment-normalized', {
              gain: Number(normalized.gain.toFixed(2)),
              inputDbfs: Number(
                (
                  20 * Math.log10(Math.max(normalized.inputRms, 0.000_001))
                ).toFixed(1),
              ),
              mode: turn.context.mode,
              sequence: segment.sequence,
            });
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
            mode: turn.context.mode,
            requestId,
            sequence: segment.sequence,
          });
          try {
            const result = await window.tro.transcribeVoiceSegment({
              audioBase64: bytesToBase64(encoded.bytes),
              durationMs: Math.round(encoded.durationMs),
              requestId,
              sequence: segment.sequence,
              utteranceId: turn.context.turnId,
            });
            if (activeTurnRef.current !== turn || turn.cancelled) return;
            voiceTurnDiagnostic('segment-completed', {
              billedSeconds: result.billedSeconds,
              latencyMs: Date.now() - segmentStartedAt,
              mode: turn.context.mode,
              requestId,
              sequence: segment.sequence,
            });
            assembler.addSuccess({
              overlapWithPrevious: segment.overlapWithPrevious,
              sequence: result.sequence,
              text: result.text,
            });
            const provisional = assembler.provisionalTranscript();
            if (provisional) {
              onTranscriptChangeRef.current(turn.context, provisional);
            }
            if (turn.released) maybeFinishTurn(turn);
          } catch (error) {
            if (activeTurnRef.current !== turn || turn.cancelled) return;
            voiceTurnDiagnostic('segment-uncertain', {
              latencyMs: Date.now() - segmentStartedAt,
              mode: turn.context.mode,
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
        assembler,
        attempt,
        cancelled: false,
        capture: null,
        context,
        endNotified: false,
        expectedSegmentCount: null,
        finalizing: false,
        limitReached: false,
        queue,
        released: false,
        releasedAt: null,
        segmentCount: 0,
        segmenter,
      } satisfies ActiveVoiceTurn);
      activeTurnRef.current = turn;
      activationModeRef.current = activation;
      chordHeldRef.current = true;
      setIsHolding(true);
      setMode(voiceMode);
      setStatus('requesting_permission');
      voiceTurnDiagnostic('started', {
        activation,
        attempt,
        mode: voiceMode,
        platform,
      });

      try {
        const decision = await onAttemptStartRef.current(context);
        if (activeTurnRef.current !== turn || turn.cancelled || turn.released) {
          if (!turn.endNotified) notifyTurnEnd(turn, 'cancelled');
          return;
        }
        if (!decision.accepted) {
          finishTerminalTurn(turn, 'preflight_rejected');
          return;
        }

        const capture = await openVoiceCapture({
          onFrame: (frame) => {
            if (
              activeTurnRef.current !== turn ||
              turn.cancelled ||
              turn.limitReached ||
              turn.released
            ) {
              return;
            }
            const update = segmenter.push(frame);
            for (const segment of update.segments) {
              dispatchSegment(turn, segment);
            }
            if (update.limitReached && !turn.limitReached) {
              turn.limitReached = true;
              void turn.capture?.stop().catch(() => undefined);
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
        voiceTurnDiagnostic('listening', {
          activation,
          attempt,
          mode: voiceMode,
        });
      } catch (error) {
        if (turn.cancelled || abortController.signal.aborted) return;
        finishTerminalTurn(turn, 'failed');
        logVoiceConnectionFailure('microphone', error);
        void window.tro
          .reportVoiceDiagnostic(
            createVoiceConnectionDiagnostic('microphone', error),
          )
          .catch(() => undefined);
        onErrorRef.current(voiceConnectionErrorMessage(error));
      }
    },
    [
      dispatchSegment,
      finishTerminalTurn,
      maybeFinishTurn,
      notifyTurnEnd,
      platform,
    ],
  );

  const finishListening = useCallback(
    (releasedMode?: VoiceMode): void => {
      const turn = activeTurnRef.current;
      if (!turn || turn.cancelled || turn.released) return;
      if (releasedMode && releasedMode !== turn.context.mode) return;
      if (!turn.capture) {
        turn.cancelled = true;
        turn.queue.cancelPending();
        finishTerminalTurn(turn, 'cancelled');
        return;
      }
      turn.released = true;
      turn.releasedAt = Date.now();
      chordHeldRef.current = false;
      setIsHolding(false);
      setStatus('processing');
      const capture = turn.capture;
      turn.capture = null;
      void capture.stop().catch(() => undefined);
      turn.abortController.abort();
      const finalUpdate = turn.segmenter.finish();
      for (const segment of finalUpdate.segments) {
        dispatchSegment(turn, segment);
      }
      turn.expectedSegmentCount = turn.segmentCount;
      voiceTurnDiagnostic('released', {
        activation: turn.context.activation,
        attempt: turn.attempt,
        mode: turn.context.mode,
        segmentCount: turn.expectedSegmentCount,
      });
      maybeFinishTurn(turn);
    },
    [dispatchSegment, finishTerminalTurn, maybeFinishTurn],
  );
  useVoiceShortcuts({
    finishListening,
    platform,
    selectedModeRef,
    beginListening,
    activeTurnRef,
    cancel,
  });

  useEffect(() => {
    if (
      shouldCancelVoiceTurnForAvailability({
        disabled,
        enabled,
        finalizing: activeTurnRef.current?.finalizing ?? false,
        platform,
      })
    ) {
      cancel();
      return;
    }
    if (disabled) return;
    if (activeTurnRef.current) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && !activeTurnRef.current) setStatus('idle');
    });
    return () => {
      cancelled = true;
    };
  }, [cancel, disabled, enabled, platform]);

  useEffect(
    () => () => {
      const turn = activeTurnRef.current;
      if (!turn) return;
      turn.cancelled = true;
      turn.queue.cancelPending();
      turn.abortController.abort();
      void turn.capture?.stop().catch(() => undefined);
      notifyTurnEnd(turn, 'cancelled');
      activeTurnRef.current = null;
    },
    [notifyTurnEnd],
  );

  return { cancel, isHolding, mode, platform, status };
}

export type {
  UsePushToTalkOptions,
  VoiceActivationMode,
  VoiceAttemptDecision,
  VoiceCommitDisposition,
  VoiceConnectionStep,
  VoiceInputStatus,
  VoiceTurnContext,
  VoiceTurnEndReason,
} from './features/voice/voice-input-types';
