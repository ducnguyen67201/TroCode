import type * as React from 'react';
import { useCallback } from 'react';

import type { PushToTalkPlatform } from '../../push-to-talk';
import { pushToTalkShortcutName } from '../../push-to-talk';

import { voiceTurnDiagnostic } from './voice-diagnostics';
import type {
  ActiveVoiceTurn,
  VoiceCommitDisposition,
  VoiceInputStatus,
  VoiceTurnContext,
  VoiceTurnEndReason,
} from './voice-input-types';

export function useVoiceTurnCompletion({
  activeTurnRef,
  setStatus,
  onTranscriptReadyRef,
  finishTerminalTurn,
  onErrorRef,
  platform,
  onTranscriptChangeRef,
}: {
  activeTurnRef: React.RefObject<ActiveVoiceTurn | null>;
  setStatus: React.Dispatch<React.SetStateAction<VoiceInputStatus>>;
  onTranscriptReadyRef: React.RefObject<
    (
      context: VoiceTurnContext,
      transcript: string,
    ) => Promise<VoiceCommitDisposition | void>
  >;
  finishTerminalTurn: (
    turn: ActiveVoiceTurn,
    reason: VoiceTurnEndReason,
  ) => void;
  onErrorRef: React.RefObject<(message: string) => void>;
  platform: PushToTalkPlatform;
  onTranscriptChangeRef: React.RefObject<
    (context: VoiceTurnContext, transcript: string) => void
  >;
}) {
  const commitTranscript = useCallback(
    async (
      turn: ActiveVoiceTurn,
      transcript: string,
      releaseToFinalMs: number,
    ): Promise<void> => {
      if (activeTurnRef.current !== turn || turn.cancelled) return;
      setStatus('committing');
      try {
        const disposition =
          (await onTranscriptReadyRef.current(turn.context, transcript)) ??
          'completed';
        if (activeTurnRef.current !== turn || turn.cancelled) return;
        voiceTurnDiagnostic('completed', {
          activation: turn.context.activation,
          attempt: turn.attempt,
          characters: transcript.length,
          disposition,
          mode: turn.context.mode,
          releaseToFinalMs,
          segmentCount: turn.expectedSegmentCount ?? 0,
        });
        finishTerminalTurn(turn, 'completed');
      } catch (error) {
        if (activeTurnRef.current !== turn || turn.cancelled) return;
        voiceTurnDiagnostic('completed', {
          activation: turn.context.activation,
          attempt: turn.attempt,
          disposition: 'delivery_failed',
          mode: turn.context.mode,
          releaseToFinalMs,
          segmentCount: turn.expectedSegmentCount ?? 0,
        });
        finishTerminalTurn(turn, 'failed');
        onErrorRef.current(
          error instanceof Error && error.message
            ? error.message
            : 'Tro could not finish voice input.',
        );
      }
    },
    [
      activeTurnRef,
      finishTerminalTurn,
      onErrorRef,
      onTranscriptReadyRef,
      setStatus,
    ],
  );

  const maybeFinishTurn = useCallback(
    (turn: ActiveVoiceTurn): void => {
      if (
        activeTurnRef.current !== turn ||
        turn.cancelled ||
        !turn.released ||
        turn.expectedSegmentCount === null ||
        turn.assembler.outcomes.size < turn.expectedSegmentCount ||
        turn.finalizing
      ) {
        return;
      }

      turn.finalizing = true;
      const transcript = turn.assembler.completeTranscript(
        turn.expectedSegmentCount,
      );
      const provisional = turn.assembler.provisionalTranscript();
      const releaseToFinalMs = Math.max(
        0,
        Date.now() - (turn.releasedAt ?? Date.now()),
      );
      if (turn.expectedSegmentCount === 0) {
        finishTerminalTurn(turn, 'no_speech');
        voiceTurnDiagnostic('completed', {
          activation: turn.context.activation,
          attempt: turn.attempt,
          disposition: 'no_speech',
          mode: turn.context.mode,
          releaseToFinalMs,
          segmentCount: turn.expectedSegmentCount,
        });
        onErrorRef.current(
          `No speech was detected. Hold ${pushToTalkShortcutName(platform)} and try again.`,
        );
        return;
      }
      if (transcript === null) {
        if (provisional) {
          onTranscriptChangeRef.current(turn.context, provisional);
        }
        finishTerminalTurn(turn, 'partial_failure');
        voiceTurnDiagnostic('completed', {
          activation: turn.context.activation,
          attempt: turn.attempt,
          disposition: 'partial_failure',
          mode: turn.context.mode,
          releaseToFinalMs,
          segmentCount: turn.expectedSegmentCount,
        });
        onErrorRef.current(
          'A part of this recording could not be transcribed. Review it or record again.',
        );
        return;
      }
      if (!transcript.trim()) {
        finishTerminalTurn(turn, 'no_speech');
        voiceTurnDiagnostic('completed', {
          activation: turn.context.activation,
          attempt: turn.attempt,
          disposition: 'no_speech',
          mode: turn.context.mode,
          releaseToFinalMs,
          segmentCount: turn.expectedSegmentCount,
        });
        onErrorRef.current(
          `No speech was detected. Hold ${pushToTalkShortcutName(platform)} and try again.`,
        );
        return;
      }

      voiceTurnDiagnostic('transcript-ready', {
        activation: turn.context.activation,
        attempt: turn.attempt,
        characters: transcript.length,
        confirmationMs: 0,
        mode: turn.context.mode,
        releaseToFinalMs,
        segmentCount: turn.expectedSegmentCount,
      });
      onTranscriptChangeRef.current(turn.context, transcript);
      void commitTranscript(turn, transcript, releaseToFinalMs);
    },
    [
      activeTurnRef,
      commitTranscript,
      finishTerminalTurn,
      onErrorRef,
      onTranscriptChangeRef,
      platform,
    ],
  );

  return { maybeFinishTurn };
}
