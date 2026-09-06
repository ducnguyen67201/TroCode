import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AppLanguage,
  CompanionVoiceActivity,
  TaskSnapshot,
  TeacherClassroomSelection,
} from '../../../shared/contracts';
import { sameClassroomVoiceDestination } from '../../classroom-voice-binding';
import {
  applyDictationTranscript,
  captureVoiceDraftSnapshot,
  type VoiceDraftSnapshot,
} from '../../voice-draft';
import type { VoiceTerminalDisposition } from '../../voice-route';
import {
  shouldRetainVoiceTerminalActivity,
  voiceTaskScreenContext,
  voiceTurnRoute,
} from '../../voice-route';

import { useVoiceAttemptStart } from './use-voice-attempt-start';
import type {
  VoiceCommitDisposition,
  VoiceTurnContext,
  VoiceTurnEndReason,
} from './voice-input-types';

export function useVoiceTurnRouting({
  setInput,
  clearError,
  setVoiceTranscript,
  teacherSelectionPendingRef,
  reportError,
  t,
  latestSnapshotRef,
  teacherVoiceBindingsRef,
  teacherSelectionRef,
  taskRequestRef,
  input,
  appLanguageDraft,
  sendInput,
}: {
  setInput: React.Dispatch<React.SetStateAction<string>>;
  clearError: () => void;
  setVoiceTranscript: React.Dispatch<React.SetStateAction<string>>;
  teacherSelectionPendingRef: React.RefObject<boolean>;
  reportError: (message: string) => void;
  t: (
    message: string,
    replacements?: Readonly<Record<string, string | number>>,
  ) => string;
  latestSnapshotRef: React.RefObject<TaskSnapshot | null>;
  teacherVoiceBindingsRef: React.RefObject<
    Map<
      string,
      {
        selectionId: string | null;
        taskId: string | null;
        interactionId: string | null;
      }
    >
  >;
  teacherSelectionRef: React.RefObject<TeacherClassroomSelection | null>;
  taskRequestRef: React.RefObject<HTMLTextAreaElement | null>;
  input: string;
  appLanguageDraft: AppLanguage;
  sendInput: (
    requestText?: string,
    options?: {
      screenContext?: 'auto' | 'required' | 'disabled';
      teacherClassroomSelectionId?: string | null;
    },
  ) => Promise<boolean>;
}) {
  const [voiceDestination, setVoiceDestination] = useState<
    CompanionVoiceActivity['destination']
  >({ kind: 'tro_composer', label: 'Tro composer' });

  const [voiceActivityOverride, setVoiceActivityOverride] =
    useState<CompanionVoiceActivity | null>(null);

  const preparedGlobalDictationsRef = useRef(new Set<string>());

  const voiceDraftSnapshotsRef = useRef(new Map<string, VoiceDraftSnapshot>());

  const voiceDestinationsRef = useRef(
    new Map<string, CompanionVoiceActivity['destination']>(),
  );

  const latestVoiceTranscriptRef = useRef('');

  const voiceActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const showVoiceTerminalActivity = useCallback(
    (
      activity: CompanionVoiceActivity,
      durationMs: number,
      disposition: VoiceTerminalDisposition = 'feedback',
    ): void => {
      if (voiceActivityTimerRef.current) {
        clearTimeout(voiceActivityTimerRef.current);
      }
      if (
        !shouldRetainVoiceTerminalActivity({
          disposition,
          mode: activity.mode,
        })
      ) {
        setVoiceActivityOverride(null);
        voiceActivityTimerRef.current = null;
        return;
      }
      setVoiceActivityOverride(activity);
      voiceActivityTimerRef.current = setTimeout(() => {
        setVoiceActivityOverride(null);
        voiceActivityTimerRef.current = null;
      }, durationMs);
    },
    [],
  );

  const recordVoiceOutcome = useCallback(
    (
      context: VoiceTurnContext,
      transcript: string,
      destination: CompanionVoiceActivity['destination']['kind'],
      disposition:
        | 'delivery_unverified'
        | 'draft_updated'
        | 'inserted'
        | 'not_inserted'
        | 'task_submitted',
    ): void => {
      void window.tro
        .recordVoiceTranscript({
          characterCount: transcript.length,
          destination,
          disposition,
          mode: context.mode,
        })
        .catch(() => undefined);
    },
    [],
  );

  const keepVoiceRecoveryDraft = useCallback(
    (transcript: string): void => {
      setInput(
        (current) =>
          applyDictationTranscript(
            captureVoiceDraftSnapshot(current, null, null, false),
            transcript,
          ).value,
      );
    },
    [setInput],
  );
  const { handleVoiceAttemptStart } = useVoiceAttemptStart({
    clearError,
    latestVoiceTranscriptRef,
    setVoiceTranscript,
    setVoiceActivityOverride,
    voiceActivityTimerRef,
    teacherSelectionPendingRef,
    reportError,
    t,
    latestSnapshotRef,
    teacherVoiceBindingsRef,
    teacherSelectionRef,
    voiceDestinationsRef,
    setVoiceDestination,
    taskRequestRef,
    input,
    voiceDraftSnapshotsRef,
    showVoiceTerminalActivity,
    appLanguageDraft,
    preparedGlobalDictationsRef,
  });

  const handleVoiceTranscriptChange = useCallback(
    (context: VoiceTurnContext, transcript: string): void => {
      latestVoiceTranscriptRef.current = transcript;
      setVoiceTranscript(transcript);
      const route = voiceTurnRoute(context);
      if (route === 'task') {
        setInput(transcript);
        return;
      }
      if (route === 'local_dictation') {
        const snapshot = voiceDraftSnapshotsRef.current.get(context.turnId);
        if (snapshot)
          setInput(applyDictationTranscript(snapshot, transcript).value);
      }
    },
    [setInput, setVoiceTranscript],
  );

  const handleVoiceTranscriptReady = useCallback(
    async (
      context: VoiceTurnContext,
      transcript: string,
    ): Promise<VoiceCommitDisposition> => {
      const destination =
        voiceDestinationsRef.current.get(context.turnId) ?? voiceDestination;
      const route = voiceTurnRoute(context);
      if (route === 'task') {
        const frozen = teacherVoiceBindingsRef.current.get(context.turnId);
        const current = latestSnapshotRef.current;
        if (
          !sameClassroomVoiceDestination(frozen, {
            selectionId: teacherSelectionRef.current?.selectionId ?? null,
            taskId: current?.taskId ?? null,
            interactionId: current?.pendingInteraction?.id ?? null,
          })
        ) {
          setInput(transcript);
          throw new Error(
            'The task or class changed while you were speaking. Review the transcript and send again.',
          );
        }
        if (
          !(await sendInput(transcript, {
            teacherClassroomSelectionId: frozen!.selectionId,
            screenContext: voiceTaskScreenContext(context),
          }))
        ) {
          throw new Error('The task could not accept that voice input.');
        }
        recordVoiceOutcome(context, transcript, 'task', 'task_submitted');
        showVoiceTerminalActivity(
          {
            appLanguage: appLanguageDraft,
            destination,
            mode: 'task',
            phase: 'complete',
            transcript,
          },
          12_000,
          'task_submitted',
        );
        return 'task_submitted';
      }

      if (route === 'local_dictation') {
        const draft = voiceDraftSnapshotsRef.current.get(context.turnId);
        if (!draft) throw new Error('The Tro draft is no longer available.');
        const result = applyDictationTranscript(draft, transcript);
        setInput(result.value);
        recordVoiceOutcome(
          context,
          transcript,
          'tro_composer',
          'draft_updated',
        );
        window.requestAnimationFrame(() => {
          const textarea = taskRequestRef.current;
          if (!textarea) return;
          textarea.focus({ preventScroll: true });
          textarea.setSelectionRange(result.caret, result.caret);
        });
        showVoiceTerminalActivity(
          {
            appLanguage: appLanguageDraft,
            destination,
            message: t('Dictation added to your Tro draft.'),
            mode: 'dictation',
            phase: 'complete',
            transcript: '',
          },
          800,
        );
        return 'completed';
      }

      preparedGlobalDictationsRef.current.delete(context.turnId);
      try {
        const result = await window.tro.commitDictation({
          text: transcript,
          turnId: context.turnId,
        });
        recordVoiceOutcome(
          context,
          transcript,
          'application',
          result.disposition,
        );
        if (result.disposition === 'inserted') {
          latestVoiceTranscriptRef.current = '';
          setVoiceTranscript('');
          showVoiceTerminalActivity(
            {
              appLanguage: appLanguageDraft,
              destination,
              message: t('Dictation inserted.'),
              mode: 'dictation',
              phase: 'complete',
              transcript: '',
            },
            800,
          );
          return 'completed';
        }
        keepVoiceRecoveryDraft(transcript);
        const message = t('Text kept in your Tro draft. {summary}', {
          summary: result.summary,
        }).slice(0, 240);
        reportError(message);
        showVoiceTerminalActivity(
          {
            appLanguage: appLanguageDraft,
            destination,
            message,
            mode: 'dictation',
            phase: 'error',
            transcript: '',
          },
          3_000,
        );
      } catch {
        void window.tro
          .cancelDictation({ turnId: context.turnId })
          .catch(() => undefined);
        keepVoiceRecoveryDraft(transcript);
        recordVoiceOutcome(
          context,
          transcript,
          'application',
          'delivery_unverified',
        );
        const message = t(
          'Insertion could not be verified. Text kept in your Tro draft.',
        );
        reportError(message);
        showVoiceTerminalActivity(
          {
            appLanguage: appLanguageDraft,
            destination,
            message,
            mode: 'dictation',
            phase: 'error',
            transcript: '',
          },
          3_000,
        );
      }
      return 'completed';
    },
    [
      appLanguageDraft,
      keepVoiceRecoveryDraft,
      latestSnapshotRef,
      recordVoiceOutcome,
      reportError,
      sendInput,
      setInput,
      setVoiceTranscript,
      showVoiceTerminalActivity,
      t,
      taskRequestRef,
      teacherSelectionRef,
      teacherVoiceBindingsRef,
      voiceDestination,
    ],
  );

  const handleVoiceTurnEnd = useCallback(
    (context: VoiceTurnContext, reason: VoiceTurnEndReason): void => {
      const draft = voiceDraftSnapshotsRef.current.get(context.turnId);
      if (draft && reason !== 'completed') setInput(draft.value);
      voiceDraftSnapshotsRef.current.delete(context.turnId);

      if (
        context.activation === 'global_hold' &&
        context.mode === 'dictation' &&
        reason !== 'completed'
      ) {
        preparedGlobalDictationsRef.current.delete(context.turnId);
        void window.tro
          .cancelDictation({ turnId: context.turnId })
          .catch(() => undefined);
      }

      const destination = voiceDestinationsRef.current.get(context.turnId);
      teacherVoiceBindingsRef.current.delete(context.turnId);
      voiceDestinationsRef.current.delete(context.turnId);
      if (
        destination &&
        (reason === 'no_speech' ||
          reason === 'partial_failure' ||
          reason === 'failed')
      ) {
        const message =
          reason === 'partial_failure'
            ? t('The draft was restored because part of the recording failed.')
            : reason === 'no_speech'
              ? t('No speech was detected. The draft was left unchanged.')
              : t('Voice input could not be completed.');
        showVoiceTerminalActivity(
          {
            appLanguage: appLanguageDraft,
            destination,
            message,
            mode: context.mode,
            phase: 'error',
            transcript:
              reason === 'partial_failure'
                ? latestVoiceTranscriptRef.current
                : '',
          },
          2_500,
        );
      }
    },
    [
      appLanguageDraft,
      setInput,
      showVoiceTerminalActivity,
      t,
      teacherVoiceBindingsRef,
    ],
  );

  useEffect(
    () => () => {
      if (voiceActivityTimerRef.current) {
        clearTimeout(voiceActivityTimerRef.current);
      }
      void window.tro.setCompanionVoiceActivity(null);
    },
    [],
  );

  return {
    handleVoiceAttemptStart,
    handleVoiceTranscriptChange,
    handleVoiceTranscriptReady,
    handleVoiceTurnEnd,
    showVoiceTerminalActivity,
    voiceActivityOverride,
    voiceDestination,
  };
}
